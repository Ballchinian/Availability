import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getUserById, setUserGuilds, setUserTimeZone, getPlanningPrefs } from '../../db/users.js';
import { getGuildConfigs } from '../../db/guilds.js';
import { getActivePlansForUser, getFinishedPlansForUser } from '../../db/plans/index.js';
import { computeUserGuilds } from '../../bot/cleanup.js';
import { planRole } from '../roles.js';
import { today } from '../../lib/dates.js';
import { isValidZone, safeZone } from '../../lib/zones.js';
import { hostIdsOf } from '../../lib/hosts.js';
import { rowFor } from '../../lib/coverage.js';
import { memberOf } from '../../lib/members.js';

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

/*
    The display names of a few people in one server, in the order asked for, leaving out
    anyone who has left. A cache hit for nearly all of them, since the member cache is
    warmed at boot.
*/
async function namesIn(guildId, ids) {
    if (!ids.length) return [];
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return [];
    const members = await Promise.all(ids.map((id) => memberOf(guild, id)));
    return members.filter(Boolean).map((m) => m.displayName);
}

//One plan as the landing page reads it, or null for one this person has nothing to do with
async function planRow(plan, userId, names, prefs) {
    const role = planRole(plan, userId);
    if (!role) return null;
    const me = plan.participants.find((p) => p.userId === userId);
    //Left off the invite list when the date was locked, so there is nothing to come to, unless they run it
    if (plan.status === 'closed' && me?.invited === false && role !== 'host') return null;

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
        repeatWeeks: plan.repeatWeeks || null,
        //Whoever runs it, other than them: all of them for a guest, the rest for one of them
        hosts: await namesIn(plan.guildId, hostIdsOf(plan).filter((id) => id !== userId)),
        //Where they stand on it, which is what nextStep in shared/coverage.js turns into the card's button
        ...rowFor(plan, userId, prefs),
        //Someone who runs a plan without inviting themselves is not in it
        inIt: Boolean(me),
        filledIn: Boolean(me?.confirmed),
        //What role is called by a site from before it
        mine: role === 'host'
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

    /*
        Their own answers, and everyone's on the plans they run that are still finding a
        day, since "pick the day" waits on all of them. One read for the lot.
    */
    const waitingOn = live.filter((plan) => plan.status === 'collecting' && hostIdsOf(plan).includes(req.user.id));
    const [configs, prefs] = await Promise.all([
        getGuildConfigs([...new Set([...live, ...over].map((plan) => plan.guildId))]),
        getPlanningPrefs([...new Set([req.user.id, ...waitingOn.flatMap((plan) => plan.participants.map((p) => p.userId))])])
    ]);
    const names = new Map(configs.map((cfg) => [cfg.guildId, cfg.guildName]));
    const rows = (plans) => Promise.all(plans.map((plan) => planRow(plan, req.user.id, names, prefs)));
    const [plans, past] = await Promise.all([rows(live), rows(over)]);

    res.json({
        plans: plans.filter(Boolean),
        //The ones that are done with, kept apart so the live list stays what the page opens on
        past: past.filter(Boolean)
    });
});

export default router;
