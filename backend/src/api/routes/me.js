import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getUserById, setUserGuilds } from '../../db/users.js';
import { getGuildConfigs } from '../../db/guilds.js';
import { computeUserGuilds } from '../../bot/cleanup.js';

/*
    What the landing page runs on. Every other screen arrives from a link the bot
    handed out and so already knows which server or plan it is about. Someone who
    just types the domain in has none of that, so these routes answer it from the
    session alone.
*/

const router = Router();

/*
    Which of the bot's servers this person is in. The stored list is written at
    login and kept current by cleanup.js as people join and leave, so reading it
    costs one lookup. A document saved while the database was struggling has no
    list at all, so work it out the slow way once and keep it rather than showing
    someone an empty page.
*/
async function sharedGuildIds(userId) {
    const user = await getUserById(userId);
    if (Array.isArray(user?.guilds)) return user.guilds;

    const ids = await computeUserGuilds(userId);
    await setUserGuilds(userId, ids);
    return ids;
}

router.get('/guilds', requireUser, async (req, res) => {
    const ids = await sharedGuildIds(req.user.id);
    const configs = await getGuildConfigs(ids);
    const byId = new Map(configs.map((cfg) => [cfg.guildId, cfg]));

    const rows = await Promise.all(
        ids.map(async (guildId) => {
            const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
            if (!guild) return null;

            //The stored list only loses a server on an event the bot was awake for, so it can run ahead of the truth
            const member = guild.members.cache.get(req.user.id) || (await guild.members.fetch(req.user.id).catch(() => null));
            if (!member) return null;

            const cfg = byId.get(guildId);
            return {
                guildId,
                guildName: cfg?.guildName || guild.name,
                iconUrl: guild.iconURL({ size: 64 }),
                setupComplete: Boolean(cfg?.setupComplete),
                isPlanner: Boolean(cfg?.plannerRoleId && member.roles.cache.has(cfg.plannerRoleId))
            };
        })
    );

    const guilds = rows.filter(Boolean).sort((a, b) => a.guildName.localeCompare(b.guildName));
    res.json({ guilds });
});

export default router;
