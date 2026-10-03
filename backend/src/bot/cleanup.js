import { client } from './client.js';
import { getGuildConfig, deleteGuildConfig, markSetupBroken } from '../db/guilds.js';
import { getPlanByThread, deletePlan, deletePlansForGuild, deletePlansUnderChannel, removeUserFromGuildPlans, deletePracticePlans } from '../db/plans.js';
import { removePracticePeople } from '../db/practice.js';
import { deleteOutboxFor } from '../db/outbox.js';
import { getUserById, forgetUser, getUsersInGuild, removeUserGuild, addUserGuild } from '../db/users.js';
import { deleteAllForUser } from '../db/availability.js';
import { findWritableChannel } from './util.js';
import { syncPlanCards, afterLeaving } from './plans/index.js';
import { dayHasPassed } from '../lib/zones.js';

/*
    Keeping things tidy when bits get deleted, so the user never hits a silent
    dead end. Threads and channels going missing are handled here, along with
    forgetting data we no longer have any use for.
*/

/*
    A person's timetable is only worth keeping while they share a server with the bot.
    Only a record whose servers were worked out at login can say so: one made to hold
    the answers of someone who has only used /free has no list, and reading that as
    none would wipe their calendar the first time they left any server.
*/
async function forgetIfOrphaned(userId) {
    const user = await getUserById(userId);
    if (Array.isArray(user?.guilds) && user.guilds.length === 0) {
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
            .send('The plan bot info channel I made got deleted, so planning is paused. Run `/setup` and I will make a fresh one.')
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

/*
    A planner's practice in a server goes once they cannot practise there any more: their
    made-up people, the practice plans that hold them, and everything kept for either.
    Their own cards on those plans say the plan has gone, as a deleted thread's do.
*/
export async function forgetPractice(ownerId, guildId) {
    const plans = await deletePracticePlans(ownerId, guildId);
    for (const plan of plans) {
        await syncPlanCards({ ...plan, deleted: true }).catch((err) => console.error('[cleanup] retiring practice cards failed:', err));
    }
    const people = await removePracticePeople(ownerId, guildId);
    for (const id of people) await deleteAllForUser(id);
    await deleteOutboxFor(plans.map((plan) => plan.planId), people);
}

//Losing the planner role ends practice. A member from before the cache filled says nothing of before, so is checked anyway.
export async function onGuildMemberUpdate(before, after) {
    const cfg = await getGuildConfig(after.guild.id);
    if (!cfg?.plannerRoleId || after.roles.cache.has(cfg.plannerRoleId)) return;
    if (!before.partial && !before.roles.cache.has(cfg.plannerRoleId)) return;
    await forgetPractice(after.id, after.guild.id);
}

export async function onGuildDelete(guild) {
    const plans = await deletePlansForGuild(guild.id);
    await deleteGuildConfig(guild.id);
    //Made-up people first, so the loop below does not leave each a record with only a session version on it
    const people = await removePracticePeople(null, guild.id);
    for (const id of people) await deleteAllForUser(id);
    await deleteOutboxFor(plans.filter((plan) => plan.practice).map((plan) => plan.planId), people);

    const users = await getUsersInGuild(guild.id);
    for (const u of users) {
        await removeUserGuild(u.userId, guild.id);
        await forgetIfOrphaned(u.userId);
    }
}

export async function onGuildMemberRemove(member) {
    //Before the plans they leave, so a practice plan of theirs is gone rather than told they left it
    await forgetPractice(member.id, member.guild.id);
    const plans = await removeUserFromGuildPlans(member.guild.id, member.id, { id: member.id, name: member.displayName || '' });
    /*
        Whoever is left on a plan may now all have answered, which nothing else would
        notice, and a set day's pin was counting them. A plan that is over has nobody
        left to tell.
    */
    for (const plan of plans) {
        if (plan.status === 'cancelled' || dayHasPassed(plan)) continue;
        await afterLeaving(plan).catch((err) => console.error(`[cleanup] ${plan.planId} after a member left:`, err));
    }

    //Only people who have logged in to the site have a list of servers to keep
    const user = await getUserById(member.id);
    if (Array.isArray(user?.guilds)) {
        await removeUserGuild(member.id, member.guild.id);
        await forgetIfOrphaned(member.id);
    }
}

//Starting a list here would make this their only server, and leaving it would wipe them
export async function onGuildMemberAdd(member) {
    const user = await getUserById(member.id);
    if (Array.isArray(user?.guilds)) await addUserGuild(member.id, member.guild.id);
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
