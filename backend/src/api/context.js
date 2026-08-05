import { client } from '../bot/client.js';
import { getGuildConfig } from '../db/guilds.js';

/*
    Where the requester stands inside a server: the guild, its config, and whether
    they are a member and a planner there. Every route that touches a server opens
    with this, and the two kinds want different things from it. The server routes
    hand the answer to the frontend, so they take it as it comes. The plan routes
    are planner only, so requirePlanner turns the two ways of failing into the
    errors each of them would otherwise write itself.

    An error result carries the status and the line to show, and nothing else, so
    a caller can only either pass it on or use a context that came back whole.
*/
export async function guildContext(guildId, userId, { requirePlanner = false } = {}) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { error: 404, message: 'I am not in that server.' };

    const cfg = await getGuildConfig(guildId);
    if (!cfg || !cfg.setupComplete) return { error: 400, message: 'That server has not run /setup yet.' };

    const member = await guild.members.fetch(userId).catch(() => null);
    const isMember = Boolean(member);
    const isPlanner = isMember && member.roles.cache.has(cfg.plannerRoleId);

    if (requirePlanner) {
        if (!isMember) return { error: 403, message: 'You are not in that server.' };
        if (!isPlanner) return { error: 403, message: 'You need the planner role to do that.' };
    }

    return { guild, cfg, member, isMember, isPlanner };
}
