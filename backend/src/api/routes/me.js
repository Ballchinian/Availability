import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getUserById, setUserGuilds, setUserTimeZone } from '../../db/users.js';
import { getGuildConfigs } from '../../db/guilds.js';
import { getActivePlansForUser, getFinishedPlansForUser } from '../../db/plans.js';
import { computeUserGuilds } from '../../bot/cleanup.js';
import { today } from '../../lib/dates.js';
import { isValidZone, safeZone } from '../../lib/zones.js';

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

/*
    The clock this person reads their own hours in, sent by the browser rather than
    asked for: a device already knows this and getting it wrong is worse than a
    setting nobody can find. It follows them, so someone who fills a week in from
    abroad has that week read as local to where they are.
*/
router.put('/timezone', requireUser, async (req, res) => {
    const { timeZone } = req.body || {};
    if (!isValidZone(timeZone)) return res.status(400).json({ error: 'That is not a time zone I know.' });
    await setUserTimeZone(req.user.id, timeZone);
    res.json({ ok: true, timeZone });
});

//One plan as the landing page reads it, or null for one this person has nothing to do with
function planRow(plan, userId, names) {
    const me = plan.participants.find((p) => p.userId === userId);
    const running = plan.createdBy === userId;
    //Left off the invite list when the date was locked, so there is nothing to come to, unless they run it
    if (plan.status === 'closed' && me?.invited === false && !running) return null;

    return {
        planId: plan.planId,
        name: plan.name,
        guildName: names.get(plan.guildId) || '',
        status: plan.status,
        start: plan.dateRange.start,
        end: plan.dateRange.end,
        chosenDate: plan.chosenDate || null,
        chosenTime: plan.chosenTime || null,
        //The clock that time is written in, which the list only mentions when it is not theirs
        timeZone: safeZone(plan.timeZone),
        //A planner who did not invite themselves is running this one without being in it
        inIt: Boolean(me),
        //Whether they still owe this plan their dates, which is the whole reason for the list
        filledIn: Boolean(me?.confirmed),
        /*
            Marks the plans they started, which is what decides whether a row offers the
            compare link. Not a permission: any planner in the server can open compare on
            a plan they have the link to, invited to it or not.
        */
        mine: running
    };
}

router.get('/plans', requireUser, async (req, res) => {
    //Neither list reads the other, and the server names below need the two of them
    //The one date decides both lists: a day that has come round drops out of the first and into the second
    const from = today();
    const [live, over] = await Promise.all([
        getActivePlansForUser(req.user.id, from),
        getFinishedPlansForUser(req.user.id, from)
    ]);
    const configs = await getGuildConfigs([...new Set([...live, ...over].map((plan) => plan.guildId))]);
    const names = new Map(configs.map((cfg) => [cfg.guildId, cfg.guildName]));

    res.json({
        plans: live.map((plan) => planRow(plan, req.user.id, names)).filter(Boolean),
        //The ones that are done with, kept apart so the live list stays what the page opens on
        past: over.map((plan) => planRow(plan, req.user.id, names)).filter(Boolean)
    });
});

export default router;
