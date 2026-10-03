import { PermissionFlagsBits } from 'discord.js';
import { client } from '../bot/client.js';
import { getGuildConfig } from '../db/guilds.js';
import { getPracticePerson } from '../db/practice.js';
import { isPracticeId } from '../lib/practice.js';
import { practiceMember } from '../lib/members.js';

/*
    Where the requester stands inside a server: the guild, its config, and whether
    they are a member, a planner and able to manage the server there. Every route
    that touches a server opens with this, and takes the answer as it comes. The one
    plan route that is planner only passes requirePlanner, which turns the two ways
    of failing into the errors it would otherwise write itself.

    An error result carries the status and the line to show, and nothing else, so
    a caller can only either pass it on or use a context that came back whole.

    A made-up person is a member of the server they were made for and of no other,
    holds the planner role if they were made with it, and never manages anything.
    practice is their record, for whoever made them.
*/
export async function guildContext(guildId, userId, { requirePlanner = false } = {}) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { error: 404, message: 'I am not in that server.' };

    const cfg = await getGuildConfig(guildId);
    if (!cfg || !cfg.setupComplete) return { error: 400, message: 'That server has not run /setup yet.' };

    const madeUp = isPracticeId(userId);
    const person = madeUp ? await getPracticePerson(userId) : null;
    const member = madeUp
        ? person?.guildId === guildId ? practiceMember(person) : null
        : await guild.members.fetch(userId).catch(() => null);
    const isMember = Boolean(member);
    const isPlanner = isMember && (person ? person.planner : member.roles.cache.has(cfg.plannerRoleId));
    const canManage = isMember && !person && member.permissions.has(PermissionFlagsBits.ManageGuild);

    if (requirePlanner) {
        if (!isMember) return { error: 403, message: 'You are not in that server.' };
        if (!isPlanner) return { error: 403, message: 'You need the planner role to do that.' };
    }

    return { guild, cfg, member, isMember, isPlanner, canManage, practice: person };
}
