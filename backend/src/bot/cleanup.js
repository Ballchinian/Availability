import { client } from './client.js';
import { getGuildConfig, saveGuildConfig, deleteGuildConfig, markSetupBroken } from '../db/guilds.js';
import { getPlanByThread, setPlanThread, deletePlansForGuild, removeUserFromGuildPlans } from '../db/plans.js';
import { getUserById, deleteUser, getUsersInGuild, removeUserGuild, addUserGuild } from '../db/users.js';
import { deleteAllForUser } from '../db/availability.js';
import { findWritableChannel, createPublicThread, pinMessage, introText } from './util.js';
import { postThreadGone } from './plans.js';

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
        await deleteUser(userId);
    }
}

export async function onThreadDelete(thread) {
    const cfg = await getGuildConfig(thread.guildId);

    const plan = await getPlanByThread(thread.id);
    if (plan) {
        //A settled plan does not need its thread back, just drop the dead link
        if (plan.chosenDate) {
            await setPlanThread(plan.planId, null);
            return;
        }
        if (cfg) await postThreadGone(plan, cfg);
        return;
    }

    //The planner intro thread, just quietly stand it back up
    if (cfg && cfg.introThreadId === thread.id) {
        const guild = thread.guild || (await client.guilds.fetch(thread.guildId).catch(() => null));
        if (guild) await remakeIntro(guild, cfg);
    }
}

async function remakeIntro(guild, cfg) {
    const channel = await guild.channels.fetch(cfg.plansChannelId).catch(() => null);
    if (!channel) return;
    const fresh = await createPublicThread(channel, 'planner');
    const intro = await fresh.send({ content: introText(guild.id, cfg.plannerRoleId, cfg.trustedRoleId), allowedMentions: { parse: [] } });
    await pinMessage(intro).catch(() => {});
    await saveGuildConfig(guild.id, { introThreadId: fresh.id, introMessageId: intro.id });
}

export async function onChannelDelete(channel) {
    const cfg = await getGuildConfig(channel.guildId);
    if (!cfg || cfg.plansChannelId !== channel.id) return;

    await markSetupBroken(channel.guildId);

    const guild = channel.guild;
    const fallback = guild ? findWritableChannel(guild) : null;
    if (fallback) {
        await fallback
            .send('Heads up, the plans channel I was using got deleted, so planning is paused. Run `/setup` to point me at a new one.')
            .catch(() => {});
    }
    if (cfg.setupBy) {
        try {
            const user = await client.users.fetch(cfg.setupBy);
            await user.send(`Your plans channel in ${guild?.name || 'your server'} was deleted, so planning is paused there. Run /setup to fix it.`);
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
