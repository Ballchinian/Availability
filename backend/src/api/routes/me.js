import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getUserById, setUserGuilds } from '../../db/users.js';
import { getGuildConfigs } from '../../db/guilds.js';
import { getActivePlansForUser } from '../../db/plans.js';
import { computeUserGuilds } from '../../bot/cleanup.js';
import { today } from '../../lib/dates.js';

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

router.get('/plans', requireUser, async (req, res) => {
    const plans = await getActivePlansForUser(req.user.id, today());
    const configs = await getGuildConfigs([...new Set(plans.map((plan) => plan.guildId))]);
    const names = new Map(configs.map((cfg) => [cfg.guildId, cfg.guildName]));

    const rows = [];
    for (const plan of plans) {
        const me = plan.participants.find((p) => p.userId === req.user.id);
        const running = plan.createdBy === req.user.id;
        //Left off the invite list when the date was locked, so there is nothing to come to, unless they run it
        if (plan.status === 'closed' && me?.invited === false && !running) continue;

        rows.push({
            planId: plan.planId,
            name: plan.name,
            guildName: names.get(plan.guildId) || '',
            status: plan.status,
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            chosenDate: plan.chosenDate || null,
            chosenTime: plan.chosenTime || null,
            //A planner who did not invite themselves is running this one without being in it
            inIt: Boolean(me),
            //Whether they still owe this plan their dates, which is the whole reason for the list
            filledIn: Boolean(me?.confirmed),
            //Their own plans carry the compare link, since nobody else could open it anyway
            mine: running
        });
    }

    res.json({ plans: rows });
});

export default router;
