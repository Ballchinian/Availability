import { client } from './client.js';
import { getGuildConfig, deleteGuildConfig, markSetupBroken } from '../db/guilds.js';
import { getPlanByThread, deletePlan, deletePlansForGuild, deletePlansUnderChannel, removeUserFromGuildPlans } from '../db/plans.js';
import { getUserById, forgetUser, getUsersInGuild, removeUserGuild, addUserGuild } from '../db/users.js';
import { deleteAllForUser } from '../db/availability.js';
import { findWritableChannel } from './util.js';
import { syncPlanCards } from './plans.js';

/*
    Keeping things tidy when bits get deleted, so the user never hits a silent
    dead end. Threads and channels going missing are handled here, along with
    forgetting data we no longer have any use for.
*/

//A person's timetable is only worth keeping while they share a server with the bot
async function forgetIfOrphaned(userId) {
    const user = await getUserById(userId);
    if (user && (!user.guilds || user.guilds.length === 0)) {
        await deleteAllForUser(userId);
        await forgetUser(userId);
    }
}

/*
    Deleting a plan thread by hand is the signal to scrap the whole plan. The cards are
    rewritten after the delete, off the copy read before it, so the plan goes even if
    Discord is slow, and a button pressed in between already finds nothing to act on.
*/
export async function onThreadDelete(thread) {
    const plan = await getPlanByThread(thread.id);
    if (!plan) return;
    await deletePlan(plan.planId);
    await syncPlanCards({ ...plan, deleted: true }).catch((err) => console.error('[cleanup] retiring cards failed:', err));
}

/*
    Discord does not promise a thread delete for every thread a channel takes with it, so
    their plans are cleared here as well. Not only for the channel the server is set up
    with: a /setup that could not reach the old channel made a new one, and the old one
    can still hold plan threads when it goes later.
*/
export async function onChannelDelete(channel) {
    const cfg = await getGuildConfig(channel.guildId);
    const current = Boolean(cfg && cfg.plansChannelId === channel.id);

    const gone = await deletePlansUnderChannel(channel.guildId, channel.id, { unknownParent: current });
    for (const plan of gone) {
        await syncPlanCards({ ...plan, deleted: true }, cfg).catch((err) => console.error('[cleanup] retiring cards failed:', err));
    }

    if (!current) return;

    await markSetupBroken(channel.guildId);

    const guild = channel.guild;
    const fallback = guild ? findWritableChannel(guild) : null;
    if (fallback) {
        await fallback
            .send('Heads up, the plan bot info channel I made got deleted, so planning is paused. Run `/setup` and I will make a fresh one.')
            .catch(() => {});
    }
    if (cfg.setupBy) {
        try {
            const user = await client.users.fetch(cfg.setupBy);
            await user.send(`The plan bot info channel in ${guild?.name || 'your server'} was deleted, so planning is paused there. Run /setup and I will make a fresh one.`);
        } catch {
            //DMs off, the channel message still covers it
        }
    }
}

export async function onGuildDelete(guild) {
    await deletePlansForGuild(guild.id);
    await deleteGuildConfig(guild.id);

    const users = await getUsersInGuild(guild.id);
    for (const u of users) {
        await removeUserGuild(u.userId, guild.id);
        await forgetIfOrphaned(u.userId);
    }
}

export async function onGuildMemberRemove(member) {
    await removeUserFromGuildPlans(member.guild.id, member.id);

    //Only people who have used the site have anything to clean up
    const user = await getUserById(member.id);
    if (user) {
        await removeUserGuild(member.id, member.guild.id);
        await forgetIfOrphaned(member.id);
    }
}

export async function onGuildMemberAdd(member) {
    const user = await getUserById(member.id);
    if (user) await addUserGuild(member.id, member.guild.id);
}

//Works out which of the bot's servers a person is in, for the login refresh
export async function computeUserGuilds(userId) {
    const ids = [];
    for (const [guildId, guild] of client.guilds.cache) {
        const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
        if (member) ids.push(guildId);
    }
    return ids;
}
