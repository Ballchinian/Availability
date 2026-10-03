import { Router } from 'express';
import { requireUser } from '../../lib/session.js';
import { guildContext } from '../context.js';
import { announceAfter } from '../announce.js';
import { readPlanForm } from '../planForm.js';
import { createPlan, setPlanChosen } from '../../db/plans.js';
import { announcePlan, announceSetPlan, notifyHostsPicked } from '../../bot/plans.js';
import { planUrl } from '../../bot/util.js';
import { takeAction } from '../../db/ratelimits.js';
import { DAILY_LIMIT } from '../../lib/limits.js';
import { realMembers, listMembers } from '../../lib/members.js';
import { safeZone, todayIn } from '../../lib/zones.js';

/*
    Server scoped routes: who the logged in person is in this server, the member
    list for the people picker, and creating a plan. Only people with the planner
    role can pull the member list or start a plan, matching the rule that the bot
    only listens to planners.
*/

const router = Router();

//Tells the frontend the server name and whether this person can plan here
router.get('/:guildId', requireUser, async (req, res) => {
    const ctx = await guildContext(req.params.guildId, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    res.json({
        guildId: ctx.cfg.guildId,
        guildName: ctx.cfg.guildName,
        isMember: ctx.isMember,
        isPlanner: ctx.isPlanner
    });
});

router.get('/:guildId/members', requireUser, async (req, res) => {
    const ctx = await guildContext(req.params.guildId, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (!ctx.isPlanner) return res.status(403).json({ error: 'You need the planner role to do that.' });

    try {
        const list = await listMembers(ctx.guild);
        res.json({ members: list });
    } catch (err) {
        console.error('[members] failed:', err);
        res.status(500).json({ error: 'Could not load the member list.' });
    }
});

router.post('/:guildId/plans', requireUser, async (req, res) => {
    const ctx = await guildContext(req.params.guildId, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (!ctx.isPlanner) return res.status(403).json({ error: 'You need the planner role to start a plan.' });

    const read = readPlanForm(req.body, { today: todayIn(ctx.cfg.timeZone) });
    if (read.error) return res.status(400).json({ error: read.error });
    const { form } = read;

    /*
        Two ways to start a plan. The usual one collects availability over a date
        range. The set-plan one already knows the day, so it is announced as decided,
        no collecting, and its window is that one day.
    */
    const setMode = form.set;
    const dateRange = setMode ? { start: form.date, end: form.date } : form.window;

    //Only keep ids that are real, non bot members of this server
    const validIds = await realMembers(ctx.guild, form.participantIds);
    if (validIds.length === 0) return res.status(400).json({ error: 'None of those people are in the server.' });
    //Whoever made it leads the list, whether or not the form named them
    const hosts = [req.user.id, ...(await realMembers(ctx.guild, form.hostIds)).filter((id) => id !== req.user.id)];

    //A high daily backstop, since the planner role is the real gate on who can do this
    const rl = await takeAction(req.user.id, req.params.guildId, 'create', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have started your ${DAILY_LIMIT} plans for today. Try again in ${rl.retryAfterHours} hours.` });
    }

    try {
        let plan = await createPlan({
            guildId: req.params.guildId,
            name: form.name,
            description: form.description,
            createdBy: req.user.id,
            hostIds: hosts,
            actorName: ctx.member.displayName,
            dateRange,
            participantIds: validIds,
            allowedWeekdays: setMode ? null : form.allowedWeekdays,
            //The clock the plan's day and time are read in, which is the server's
            timeZone: safeZone(ctx.cfg.timeZone),
            //Coming round is always the day it was on, some weeks later, so a plan with no day yet starts as a one off
            repeatWeeks: setMode ? form.repeatWeeks : null
        });

        //Counted once each, since someone can be named to come and to run it
        const kept = new Set([...validIds, ...hosts]);
        const dropped = new Set([...form.participantIds, ...form.hostIds].filter((id) => !kept.has(id))).size;

        /*
            The thread, the pings and the DMs all run after the response. Everything the
            planner gets back is known the moment createPlan returns, and announcing is
            forty odd sequential Discord calls for a plan of twenty, so waiting on it only
            ever meant sitting on "Setting it up...". If it stumbles the plan still exists.
        */
        if (setMode) {
            //Record the date straight away, then announce it as decided
            plan = await setPlanChosen(plan.planId, form.date, form.time, null);
            announceAfter(plan.planId, 'set-plan announce', (current) => announceSetPlan(current, ctx.cfg, ctx.member.displayName));
            announceAfter(plan.planId, 'hosts picked', (current) => notifyHostsPicked(current, req.user.id));
            return res.json({ planId: plan.planId, url: planUrl(plan.planId), invited: validIds.length, dropped, set: true });
        }

        announceAfter(plan.planId, 'announce', (current) => announcePlan(current, ctx.cfg, ctx.member.displayName));
        announceAfter(plan.planId, 'hosts picked', (current) => notifyHostsPicked(current, req.user.id));

        res.json({ planId: plan.planId, url: planUrl(plan.planId), invited: validIds.length, dropped });
    } catch (err) {
        console.error('[plans] create failed:', err);
        res.status(500).json({ error: 'Could not create the plan.' });
    }
});

export default router;
