import { Router } from 'express';
import { requireUser } from '../../lib/session.js';
import { guildContext } from '../context.js';
import { announceAfter } from '../announce.js';
import { getPlan, confirmParticipant, setPlanChosen, setPlanWhen, setReminded, setVoteReminded, setPlanDates, addParticipants, setPlanDetails, setAttendanceOverride, markPlanCancelled, setPlanRepeat, addPlanEvent } from '../../db/plans.js';
import { getGuildConfig } from '../../db/guilds.js';
import { getAvailabilityInRange, getAvailabilityForUsersInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { getUserById, setSureUntil, getPlanningPrefs } from '../../db/users.js';
import { announceOutcome, announceWhenEdit, announceDetailsEdit, remindStragglers, remindVoters, announcePlanDates, announceCancel, leavePlan, announceAddition, notifyCreatorIfAllIn, syncPlan, applyConfirmations, applyAttendanceMove, autoConfirmCoveredPlans } from '../../bot/plans.js';
import { threadUrl, planUrl } from '../../bot/util.js';
import { buildIcs, icsFileName } from '../../lib/ics.js';
import { today, maxEnd, shiftDate, weekdayAllowed, weekdayOf, allowedDaysInRange, cleanWeekdays, describeWeekdays, weekdayChange, REPEAT_WEEKS } from '../../lib/dates.js';
import { validHours } from '../../lib/hours.js';
import { safeZone } from '../../lib/zones.js';
import { gatherFreeDays } from '../../lib/freedays.js';
import { takeAction, refundAction } from '../../db/ratelimits.js';
import { DAILY_LIMIT, MAX_PARTICIPANTS, SAVE_LIMIT, NO_GUILD } from '../../lib/limits.js';
import { realMembers } from '../../lib/members.js';

/*
    The availability side of a plan. GET hands the page everything it needs to
    draw the grid, including this person's remembered free days so the grid comes
    up prefilled. POST saves their picks, marks them confirmed for this plan, and
    nudges the thread with the running count.
*/

const router = Router();

//Ahead of the lookup below on purpose: express runs a param callback before the route's own
//middleware, so without this a logged out request would read a plan out of the database
router.use(requireUser);

/*
    The plan the whole file is about, on req for every route under it. Answering a
    missing one here is what lets each handler open with its own gate rather than
    with the same four lines the one before it wrote.
*/
router.param('planId', async (req, res, next, planId) => {
    const plan = await getPlan(planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });
    req.plan = plan;
    next();
});

/*
    Planner only, and always about the plan's own server. What it leaves on req is the
    guild, its config and the member, which is where the routes past it get the actor's
    name and the clock the plan runs on.
*/
async function requirePlanner(req, res, next) {
    const ctx = await guildContext(req.plan.guildId, req.user.id, { requirePlanner: true });
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    req.ctx = ctx;
    next();
}

/*
    Nothing about a cancelled plan can be changed. The routes that go without it are the
    ones worth noticing: compare still reads one back, cancel quietly says yes again, and
    the two that check the guest list first keep the refusal in the handler so a stranger
    is turned away before being told anything about the plan.
*/
function refuseCancelled(req, res, next) {
    if (req.plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });
    next();
}

/*
    How loudly a request wants to land. quiet forces off everything that would reach
    somebody who is not already looking, so a planner fixing their own mistake is not
    announcing the mistake to seventeen people.

    What quiet never turns off is the rewriting: the pin, the confirmation and every card
    are brought in line whatever this says, since an edit reaches nobody and a DM left
    saying the wrong time is the thing worth avoiding in the first place.
*/
function loudness(body = {}) {
    const quiet = body.quiet === true;
    return { quiet, post: !quiet && body.post !== false, dm: !quiet && body.dm !== false };
}

router.get('/:planId', async (req, res) => {
    const { plan } = req;

    /*
        Checked before anything is read, so the name, description, dates and server
        never reach someone who is not on the guest list. Plan ids are random ten
        character strings so nobody arrives here by chance, but a link passed on
        would otherwise hand over the details.
    */
    const me = plan.participants.find((p) => p.userId === req.user.id);
    if (!me) return res.status(403).json({ error: 'You are not on the guest list for this plan.' });

    //None of the four reads the others, so they go together: one wait rather than four
    const [cfg, availability, summary, userDoc] = await Promise.all([
        getGuildConfig(plan.guildId),
        getAvailabilityInRange(req.user.id, plan.dateRange.start, plan.dateRange.end),
        getAvailabilitySummary(req.user.id),
        getUserById(req.user.id)
    ]);

    res.json({
        plan: {
            planId: plan.planId,
            name: plan.name,
            description: plan.description || '',
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            status: plan.status,
            allowedWeekdays: plan.allowedWeekdays || null,
            /*
                The day, once there is one. No secret: it is on their landing page and in
                the DM they were sent. Here so a plan with its day settled can say so
                rather than go on asking for dates it has stopped needing.
            */
            chosenDate: plan.chosenDate || null,
            chosenTime: plan.chosenTime || null,
            chosenNote: plan.chosenNote || null,
            //The clock the plan's own days run on, which the page only mentions when it is not theirs
            timeZone: safeZone(cfg?.timeZone),
            guildName: cfg?.guildName || ''
        },
        confirmed: Boolean(me.confirmed),
        confirmedCount: plan.participants.filter((p) => p.confirmed).length,
        totalParticipants: plan.participants.length,
        availability,
        lastFilled: summary.lastFilled,
        lastUpdatedAt: summary.lastUpdatedAt,
        sureUntil: userDoc?.sureUntil || null,
        //The clock their own hours are read in, which is whatever their browser last said
        timeZone: safeZone(userDoc?.timeZone)
    });
});

router.post('/:planId/availability', async (req, res) => {
    const { plan } = req;

    const me = plan.participants.find((p) => p.userId === req.user.id);
    if (!me) return res.status(403).json({ error: 'You are not part of this plan.' });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { days, autoConfirm, sureUntil } = req.body || {};
    if (!Array.isArray(days)) return res.status(400).json({ error: 'Something was off with the dates you sent.' });

    const { start, end } = plan.dateRange;
    const allowed = plan.allowedWeekdays || null;
    //Keep only well formed days that sit inside this plan's range and on a day it asks about
    const valid = days.filter(
        (d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end && weekdayAllowed(d.date, allowed)
    );
    if (!valid.every((d) => validHours(d.hours))) {
        return res.status(400).json({ error: 'Something was off with the hours you sent.' });
    }

    //The same allowance the general page spends, since both write the one timetable
    const rl = await takeAction(req.user.id, NO_GUILD, 'save', SAVE_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have saved ${SAVE_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    //Their certainty horizon rides along with the save, empty meaning no limit
    if (sureUntil === null || /^\d{4}-\d{2}-\d{2}$/.test(sureUntil || '')) {
        await setSureUntil(req.user.id, sureUntil || null);
    }

    //A weekday-pinned plan only rewrites the days it asks about, so a person's saved
    //availability on the other days (from other plans) is left untouched
    const onlyDates = allowed ? allowedDaysInRange(start, end, allowed) : null;
    const savedDays = await replaceAvailabilityInRange(req.user.id, start, end, valid, onlyDates);
    const updated = await confirmParticipant(plan.planId, req.user.id);

    //No thread post here on purpose, a confirmation is quiet, the planner sees it on the compare page.
    //If that was the last person though, the planner gets a DM nudging them to compare.
    try {
        await notifyCreatorIfAllIn(updated);
    } catch (err) {
        console.error('[plans] all-in notify failed:', err);
    }

    //The same auto-accept the general page has: confirm any other plan this window covers
    let confirmedPlans = [];
    if (autoConfirm) {
        try {
            confirmedPlans = await autoConfirmCoveredPlans(req.user.id, start, end);
        } catch (err) {
            console.error('[plans] auto-confirm failed:', err);
        }
    }

    res.json({
        ok: true,
        confirmedCount: updated.participants.filter((p) => p.confirmed).length,
        totalParticipants: updated.participants.length,
        savedDays,
        confirmedPlans
    });
});

/*
    The set date as a calendar file, so it goes into a calendar rather than being copied
    across by hand. Same gate as the plan itself: the guest list, plus whoever is running
    it, since nothing makes a planner invite themselves to their own plan.
*/
router.get('/:planId/calendar.ics', async (req, res) => {
    const { plan } = req;

    const onIt = plan.participants.some((p) => p.userId === req.user.id) || plan.createdBy === req.user.id;
    if (!onIt) return res.status(403).json({ error: 'You are not on the guest list for this plan.' });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });
    if (!plan.chosenDate) return res.status(400).json({ error: 'No day has been set for this plan yet.' });

    const cfg = await getGuildConfig(plan.guildId);

    res.type('text/calendar');
    res.set('Content-Disposition', `attachment; filename="${icsFileName(plan)}"`);
    res.send(buildIcs(plan, { guildName: cfg?.guildName || '', url: planUrl(plan.planId) }));
});

//Everything the compare page needs: who is in, and how many are free each day
router.get('/:planId/compare', requirePlanner, async (req, res) => {
    const { plan, ctx } = req;

    /*
        Only people who have confirmed count, and we send their hours so the site can
        work out the overlap window for each day. The query below reaches a day past
        each end because everyone writes their hours in their own clock and the plan
        runs on the server's, so a day of theirs spills onto a day of ours either side.
        gatherFreeDays does that reading and drops whatever still lands outside.
    */
    const guildZone = safeZone(ctx.cfg.timeZone);
    const confirmed = plan.participants.filter((p) => p.confirmed);

    /*
        The three reads this page needs, together: everyone's horizons and clocks, their
        names and avatars, and the hours themselves. Who is confirmed comes off the plan
        we already hold, so nothing here waits on anything else here. The member fetches
        are one wait for twenty people rather than twenty on their own.
    */
    const [prefs, members, rows] = await Promise.all([
        getPlanningPrefs(plan.participants.map((p) => p.userId)),
        Promise.all(plan.participants.map((p) => ctx.guild.members.fetch(p.userId).catch(() => null))),
        getAvailabilityForUsersInRange(
            confirmed.map((p) => p.userId),
            shiftDate(plan.dateRange.start, -1),
            shiftDate(plan.dateRange.end, 1)
        )
    ]);

    const participants = plan.participants.map((p, i) => {
        const m = members[i];
        return {
            userId: p.userId,
            displayName: m?.displayName || 'Someone who left',
            avatarUrl: m?.displayAvatarURL({ size: 64 }) || '',
            confirmed: p.confirmed,
            //The confirmation vote, so the planner can watch who is in without leaning on DMs
            vote: p.vote || null,
            voteReason: p.voteReason || null,
            //A planner's manual call on them, sitting over whatever they answered
            override: p.override || null,
            //Whether they are still on the invite list for the set date
            invited: p.invited !== false,
            //How far ahead they said they could plan, days past it read as unsure not busy
            sureUntil: prefs[p.userId]?.sureUntil || null
        };
    });

    const freeByDate = gatherFreeDays(rows, {
        userIds: confirmed.map((p) => p.userId),
        prefs,
        zone: guildZone,
        start: plan.dateRange.start,
        end: plan.dateRange.end
    });

    res.json({
        plan: {
            planId: plan.planId,
            name: plan.name,
            description: plan.description || '',
            guildId: plan.guildId,
            guildName: ctx.cfg.guildName,
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            allowedWeekdays: plan.allowedWeekdays || null,
            //Which clock the grid, the hours and the set time are all read in
            timeZone: guildZone,
            status: plan.status,
            chosenDate: plan.chosenDate,
            chosenTime: plan.chosenTime || null,
            chosenNote: plan.chosenNote || null,
            probeActive: Boolean(plan.probeActive),
            //Whether this comes round again once its day has been, and where the chain has got to
            repeatWeeks: plan.repeatWeeks || null,
            repeatedFrom: plan.repeatedFrom || null,
            repeatedInto: plan.repeatedInto || null,
            //The way back to where the plan is actually being talked about
            threadUrl: plan.threadId ? threadUrl(plan.guildId, plan.threadId) : null
        },
        participants,
        //Whether the planner is on the guest list too, so they get their own way to fill dates in
        youAreIn: plan.participants.some((p) => p.userId === req.user.id),
        confirmedCount: confirmed.length,
        totalParticipants: plan.participants.length,
        freeByDate,
        /*
            Oldest first, the order it happened in. The page turns it round to show the
            latest at the top, which is a choice about reading rather than about the data.
            Dates go over the wire as strings like every other date here.
        */
        history: (plan.history || []).map((e) => ({ ...e, at: new Date(e.at).toISOString() }))
    });
});

/*
    What it takes to set another plan up like this one, for the create form to open with.
    The crowd, the name and the days carry, the dates never do: a plan run again is the
    same shape in a different month, and the window is the part that moves.

    No refuseCancelled on purpose. A plan that fell through and one that has already been
    are the two you most want to run again, and both are read only everywhere else.
*/
router.get('/:planId/template', requirePlanner, (req, res) => {
    const { plan } = req;
    res.json({
        name: plan.name,
        description: plan.description || '',
        allowedWeekdays: plan.allowedWeekdays || null,
        participantIds: plan.participants.map((p) => p.userId)
    });
});

//Lock in the winning date, close the plan, and announce it
router.post('/:planId/choose', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan, ctx } = req;

    const { date, time, inviteMode, attendingIds, probe, quiet } = req.body || {};
    if (typeof date !== 'string' || date < plan.dateRange.start || date > plan.dateRange.end) {
        return res.status(400).json({ error: 'Pick a date inside the plan range.' });
    }
    //A weekday-pinned plan can only land on one of the days it collected for
    if (!weekdayAllowed(date, plan.allowedWeekdays)) {
        return res.status(400).json({ error: 'That day is not one this plan asked about.' });
    }

    //The time is optional and only sticks if it looks like HH:MM
    const cleanTime = typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : null;
    /*
        Carried through rather than taken from the caller. What a plan is about is one field
        now, edited on details, and a day being moved is not a reason to lose the line an
        older plan still holds beside it.
    */
    const cleanNote = plan.chosenNote || null;

    //A high daily backstop on locking in or moving a date, since it pings and DMs everyone
    const rl = await takeAction(req.user.id, plan.guildId, 'choose', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have set a date ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    /*
        The day it is already on, so this edits the time and nothing else. Every vote, the
        confirmation and the invite list all stand, since nobody answered about a different
        day. This used to run through setPlanChosen and wipe the lot.

        The status half is belt and braces: going back out for dates nulls the day and
        reopens in one write, so a collecting plan never has a day to be already on.
    */
    if (plan.status === 'closed' && plan.chosenDate === date) {
        if (cleanTime === (plan.chosenTime || null)) {
            return res.status(400).json({ error: 'Nothing changed there. Move the time to update it.' });
        }

        const was = { time: plan.chosenTime || null, note: cleanNote };
        const updated = await setPlanWhen(plan.planId, cleanTime, cleanNote);

        await addPlanEvent(plan.planId, {
            type: 'when',
            by: req.user.id,
            byName: ctx.member.displayName,
            time: cleanTime,
            quiet: quiet === true
        });

        announceAfter('when edit', () =>
            announceWhenEdit(updated, ctx.cfg, { actorName: ctx.member.displayName, was, quiet: quiet === true })
        );

        return res.json({ ok: true, chosenDate: date, chosenTime: cleanTime, chosenNote: cleanNote, changed: false, edited: true });
    }

    /*
        Who is still invited once the date is set. "attending" narrows the plan to
        the people the site worked out can make the day, so only they get pinged,
        DMed and counted in the confirmation tally. Anything else keeps everyone on
        the list, and moving the date invites everyone back too.
    */
    let invitedIds = null;
    if (inviteMode === 'attending' && Array.isArray(attendingIds)) {
        const here = new Set(plan.participants.map((p) => p.userId));
        const kept = attendingIds.filter((id) => here.has(id));
        if (kept.length) invitedIds = kept;
    }

    //If a date was already set and this is a different one, it is a reorganise
    const changed = Boolean(plan.chosenDate && plan.chosenDate !== date);
    const updated = await setPlanChosen(plan.planId, date, cleanTime, cleanNote, invitedIds);

    const event = { type: changed ? 'moved' : 'chosen', by: req.user.id, byName: ctx.member.displayName, date, time: cleanTime, probe: probe === true };
    //The day it moved off, which is the whole point of recording a move rather than a set
    if (changed) event.from = plan.chosenDate;
    await addPlanEvent(plan.planId, event);

    announceAfter('outcome post', () =>
        announceOutcome(updated, ctx.cfg, {
            changed,
            actorName: ctx.member.displayName,
            probe: probe === true,
            quiet: quiet === true
        })
    );

    res.json({ ok: true, chosenDate: date, chosenTime: cleanTime, chosenNote: cleanNote, changed, quiet: quiet === true });
});

/*
    Open or close the confirmation on a set date. A switch, so neither direction touches an
    answer: one closed by mistake comes back with every yes and no still on it. Only a day
    moving clears answers, which is choose and dates, not this.

    No rate limit: opening revives a message rather than sending one, so there is no volume.
*/
router.post('/:planId/confirmations', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan, ctx } = req;
    if (!plan.chosenDate) return res.status(400).json({ error: 'Set a date first, then ask people to confirm it.' });

    const { active } = req.body || {};
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'Say whether confirmations are on or off.' });
    if (active === Boolean(plan.probeActive)) {
        return res.json({ ok: true, active, revived: false, unchanged: true });
    }

    const { revived } = await applyConfirmations(plan, active, { cfg: ctx.cfg, mention: req.body?.quiet !== true });

    await addPlanEvent(plan.planId, {
        type: 'confirmations',
        by: req.user.id,
        byName: ctx.member.displayName,
        active
    });

    res.json({ ok: true, active, revived });
});

/*
    Put Discord back in step with the plan by hand: the pinned opener, the confirmation and
    everyone's DM, all rewritten and anything deleted since put back.

    Every change already does this on its way past, so this is for when that failed and
    nothing said so. announceAfter runs the Discord side after the response and only logs a
    failure, so a Discord outage leaves the plan set, the database right and not a word sent.
    Until now there was no second attempt.

    Sends nothing and pings nobody, so it is safe to lean on. Answers with what it managed.

    No refuseCancelled, which makes four planner routes without one. A cancelled plan is the
    one whose DMs most want correcting, a stale card there having somebody turn up to nothing.
*/
router.post('/:planId/repair', requirePlanner, async (req, res) => {
    const { plan, ctx } = req;

    const cards = await syncPlan(plan, { cfg: ctx.cfg }).catch((err) => {
        console.error('[plans] repair failed:', err);
        return null;
    });
    if (cards === null) return res.status(502).json({ error: 'Discord would not answer. Try again in a minute.' });

    const holders = plan.participants.filter((p) => p.cardMessageId).length;
    res.json({ ok: true, cards, holders, thread: Boolean(plan.threadId) });
});

/*
    A planner's manual call on someone's attendance for the set date, the moves on
    the compare page's board. "coming" and "cant" lay an override over whatever the
    person answered, "waiting" clears it and their own answer stands again. Moving
    someone to coming also puts them back on the invite list if they were left off,
    which is how you let in someone who never filled their availability.

    Silent for the person moved. The board is a planner's own working state, and the
    reason to reach for it is having decided that person will not answer.
*/
router.post('/:planId/attendance', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan } = req;
    if (!plan.chosenDate) return res.status(400).json({ error: 'Set a date first, then sort out who is coming.' });

    const { userId, status } = req.body || {};
    if (!['coming', 'cant', 'waiting'].includes(status)) {
        return res.status(400).json({ error: 'Something was off with that move.' });
    }
    const person = plan.participants.find((p) => p.userId === userId);
    if (!person) return res.status(400).json({ error: 'That person is not on this plan.' });

    const override = status === 'coming' ? 'yes' : status === 'cant' ? 'no' : null;
    const reinvite = status === 'coming' && person.invited === false;
    const updated = await setAttendanceOverride(plan.planId, userId, override, { reinvite });

    try {
        await applyAttendanceMove(updated, status);
    } catch (err) {
        console.error('[plans] attendance move failed:', err);
    }

    res.json({ ok: true });
});

/*
    Turn repeating on or off. Nothing is scheduled by saying yes: the next plan is only
    made once this one's day has been and gone, so this is a standing instruction on the
    live plan rather than a calendar of its own, and turning it off is just as immediate.

    Deliberately allowed on a plan with no date yet. Setting it up front is the point,
    since somebody who knows this is their fortnightly thing should not have to come back
    and say so after the day is picked.
*/
router.post('/:planId/repeat', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan, ctx } = req;

    const { repeatWeeks } = req.body || {};
    const wanted = repeatWeeks === null ? null : REPEAT_WEEKS.includes(repeatWeeks) ? repeatWeeks : false;
    if (wanted === false) return res.status(400).json({ error: 'That is not a repeat I can do.' });
    if (wanted === (plan.repeatWeeks || null)) return res.json({ ok: true, repeatWeeks: wanted });

    await setPlanRepeat(plan.planId, wanted);
    await addPlanEvent(plan.planId, { type: 'repeat', by: req.user.id, byName: ctx.member.displayName, repeatWeeks: wanted });

    res.json({ ok: true, repeatWeeks: wanted });
});

/*
    Nudge whoever the plan is actually waiting on, capped at once a day so it cannot be
    spammed. Which people that is depends on where the plan stands: before a date is set
    it is the ones who have not filled their availability, and once a date is locked with
    a probe running it is the ones who have not said whether they are coming, which is
    the point a planner most wants to chase.

    The two carry their own cooldowns. Sharing one would mean a planner who nudged for
    dates this morning, then set a date and started a probe, could not chase a single
    answer until tomorrow.
*/
router.post('/:planId/remind', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan, ctx } = req;

    const chasingVotes = Boolean(plan.probeActive && plan.chosenDate);
    const lastAt = chasingVotes ? plan.lastVoteRemindedAt : plan.lastRemindedAt;
    const last = lastAt ? new Date(lastAt).getTime() : 0;
    const hoursSince = (Date.now() - last) / 3600000;
    if (hoursSince < 24) {
        return res.status(429).json({ error: `Already nudged recently. You can remind again in ${Math.ceil(24 - hoursSince)} hours.` });
    }

    const kind = chasingVotes ? 'vote' : 'availability';
    const pinged = chasingVotes
        ? await remindVoters(plan, ctx.member.displayName)
        : await remindStragglers(plan, ctx.member.displayName);
    if (pinged === 0) return res.json({ ok: true, pinged: 0, kind });

    if (chasingVotes) await setVoteReminded(plan.planId);
    else await setReminded(plan.planId);
    await addPlanEvent(plan.planId, { type: 'reminded', by: req.user.id, byName: ctx.member.displayName, kind, count: pinged });
    res.json({ ok: true, pinged, kind });
});

/*
    Everything the "ask about different dates" screen sets, in one go: the window, which
    weekdays count, who is on it and whether it comes round again. The window, the days
    and undoing a set date each had a route of their own before this, and each put its
    own message in the thread.

    Reopening reads the window first. A moved window always sends everyone back for their
    dates, since the days they answered about are not the days being asked any more. A
    window that stayed put falls back to the weekday rule, where opening a day reopens and
    a pure narrowing leaves every answer standing.

    Nobody is ever taken off here. A list arriving short of someone already on the plan
    means the picker did not know about them, not that they are meant to go, and dropping
    people is what the guest list panel is for.
*/
router.post('/:planId/dates', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan, ctx } = req;

    const { start, end, allowedWeekdays, participantIds, repeatWeeks, note, date, time } = req.body || {};
    const { quiet, post, dm } = loudness(req.body);

    //Naming the day outright rather than asking about a window, the fork the create form takes
    const setMode = typeof date === 'string' && date.length > 0;
    const shape = /^\d{4}-\d{2}-\d{2}$/;

    let window;
    let weekdays;

    if (setMode) {
        if (!shape.test(date)) return res.status(400).json({ error: 'Pick a valid date.' });
        if (date < today()) return res.status(400).json({ error: 'That date is in the past.' });
        if (date > maxEnd()) return res.status(400).json({ error: 'That date cannot be more than two years away.' });

        /*
            Stretched to reach the day rather than replaced by it, which is what makes a day
            outside the window pickable at all. The rest of the window is left alone so the
            dates people already gave are still about something.
        */
        window = {
            start: date < plan.dateRange.start ? date : plan.dateRange.start,
            end: date > plan.dateRange.end ? date : plan.dateRange.end
        };

        /*
            A day named by hand joins the set the plan asks about. Left out, the plan would sit
            on a day its own weekday rule says it never collects, and every path that reads the
            two together treats that as a day to be dropped.
        */
        weekdays = plan.allowedWeekdays || null;
        if (weekdays && !weekdayAllowed(date, weekdays)) {
            weekdays = [...new Set([...weekdays, weekdayOf(date)])].sort((a, b) => a - b);
        }
    } else {
        if (!shape.test(start || '') || !shape.test(end || '')) {
            return res.status(400).json({ error: 'Pick a valid start and end date.' });
        }
        if (start > end) return res.status(400).json({ error: 'The start date is after the end date.' });
        if (end < today()) return res.status(400).json({ error: 'That whole range is in the past.' });
        if (end > maxEnd()) return res.status(400).json({ error: 'The end date cannot be more than two years away.' });

        window = { start, end };
        weekdays = cleanWeekdays(allowedWeekdays);
        if (weekdays && !allowedDaysInRange(start, end, weekdays).length) {
            return res.status(400).json({ error: 'None of those days fall inside that range.' });
        }
    }

    const wanted = repeatWeeks == null ? null : REPEAT_WEEKS.includes(repeatWeeks) ? repeatWeeks : false;
    if (wanted === false) return res.status(400).json({ error: 'That is not a repeat I can do.' });

    //Only the people the plan has never had. Anyone already on it is left exactly as they are.
    const already = new Set(plan.participants.map((p) => p.userId));
    const asked = Array.isArray(participantIds) ? participantIds.filter((id) => !already.has(id)) : [];
    if (asked.length > MAX_PARTICIPANTS) {
        return res.status(400).json({ error: `That is more than ${MAX_PARTICIPANTS} people to add at once.` });
    }
    const toAdd = asked.length ? await realMembers(ctx.guild, asked) : [];

    const movedWindow = window.start !== plan.dateRange.start || window.end !== plan.dateRange.end;
    const { same: sameDays, opensADay } = weekdayChange(plan.allowedWeekdays, weekdays);
    const movedRepeat = wanted !== (plan.repeatWeeks || null);
    const cleanTime = typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : null;
    //A day is new when the plan had none, moved when it had a different one
    const movedDay = setMode && date !== plan.chosenDate;
    const movedTime = setMode && cleanTime !== (plan.chosenTime || null);

    if (!movedWindow && sameDays && !movedRepeat && !movedDay && !movedTime && toAdd.length === 0) {
        return res.status(400).json({
            error: setMode
                ? 'Nothing changed there. Move the day, the time, the people or the repeat.'
                : 'Nothing changed there. Move the window, the days, the people or the repeat.'
        });
    }

    //Shares one cooldown with the other ways a window moves, since it is the same ask
    const rl = await takeAction(req.user.id, plan.guildId, 'extend', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have changed the dates ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    const cleanNote = String(note || '').trim().slice(0, 200) || null;
    /*
        Only asking again sends people back over their dates. Naming a day asks nobody
        anything, so every answer already given stands however far the window stretched
        to reach it.
    */
    const reopen = !setMode && (movedWindow || opensADay);

    let updated = await setPlanDates(plan.planId, {
        start: window.start,
        end: window.end,
        allowedWeekdays: weekdays,
        repeatWeeks: wanted,
        reopen
    });
    if (toAdd.length) updated = await addParticipants(plan.planId, toAdd);

    if (setMode) {
        /*
            The same two halves the choose route has. A day that is staying put is an edit to
            the time, which costs nobody their answer; a day that moved starts the round again.
        */
        if (movedDay) {
            updated = await setPlanChosen(plan.planId, date, cleanTime, plan.chosenNote || null);
            const event = { type: plan.chosenDate ? 'moved' : 'chosen', by: req.user.id, byName: ctx.member.displayName, date, time: cleanTime, probe: false };
            if (plan.chosenDate) event.from = plan.chosenDate;
            await addPlanEvent(plan.planId, event);
        } else {
            updated = await setPlanWhen(plan.planId, cleanTime, plan.chosenNote || null);
            await addPlanEvent(plan.planId, {
                type: 'when',
                by: req.user.id,
                byName: ctx.member.displayName,
                time: cleanTime,
                quiet
            });
        }

        const settled = updated;
        const wasTime = plan.chosenTime || null;
        announceAfter('dates day post', async () => {
            if (movedDay) {
                await announceOutcome(settled, ctx.cfg, {
                    changed: Boolean(plan.chosenDate),
                    actorName: ctx.member.displayName,
                    quiet: quiet || !post,
                    added: toAdd
                });
            } else {
                await announceWhenEdit(settled, ctx.cfg, {
                    actorName: ctx.member.displayName,
                    was: { time: wasTime, note: plan.chosenNote || null },
                    quiet: quiet || !dm
                });
                if (toAdd.length) await announceAddition(settled, toAdd, ctx.member.displayName, { dm });
            }
        });

        return res.json({
            ok: true,
            start: window.start,
            end: window.end,
            allowedWeekdays: weekdays,
            repeatWeeks: wanted,
            added: toAdd.length,
            chosenDate: date,
            chosenTime: cleanTime,
            set: true,
            quiet
        });
    }

    await addPlanEvent(plan.planId, {
        type: 'dates',
        by: req.user.id,
        byName: ctx.member.displayName,
        start: window.start,
        end: window.end,
        allowedWeekdays: weekdays,
        added: toAdd.length,
        reopened: reopen
    });

    announceAfter('dates post', () =>
        announcePlanDates(updated, ctx.cfg, {
            actorName: ctx.member.displayName,
            daysLabel: describeWeekdays(weekdays),
            reopened: reopen,
            note: cleanNote,
            added: toAdd,
            post,
            dm
        })
    );

    res.json({ ok: true, start: window.start, end: window.end, allowedWeekdays: weekdays, repeatWeeks: wanted, added: toAdd.length, reopened: reopen, quiet });
});

/*
    A plan's title and what it is about. Renaming reaches into Discord and renames the
    thread with it; the description is rewritten wherever it already sits.

    One field now holds what the description and the day's own note held between them,
    which is why a plan with a day set DMs everyone about a change here. Saving also lets
    go of any note still stored, the form having handed both back joined up.
*/
router.post('/:planId/details', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan, ctx } = req;

    const { name, description } = req.body || {};
    const quiet = req.body?.quiet === true;

    //Same shape as creating a plan: a name (required) and a description (optional), both capped
    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Give the plan a name.' });
    if (cleanName.length > 90) return res.status(400).json({ error: 'That name is a bit long, keep it under 90 characters.' });

    const cleanDescription = String(description || '').trim();
    if (cleanDescription.length > 280) return res.status(400).json({ error: 'Keep the description under 280 characters.' });

    //The note counts as changed too, since saving is what folds it into the description
    if (cleanName === plan.name && cleanDescription === (plan.description || '') && !plan.chosenNote) {
        return res.status(400).json({ error: 'Nothing changed there. Edit the title or the description to update it.' });
    }

    //Only the title drives a thread rename, which Discord rate limits, so track it separately
    const renamed = cleanName !== plan.name;
    const updated = await setPlanDetails(plan.planId, cleanName, cleanDescription);

    await addPlanEvent(plan.planId, { type: 'details', by: req.user.id, byName: ctx.member.displayName, renamed });

    announceAfter('details edit', () =>
        announceDetailsEdit(updated, ctx.cfg, { actorName: ctx.member.displayName, quiet, rename: renamed })
    );

    res.json({ ok: true, name: cleanName, description: cleanDescription, quiet });
});

//Cancel a plan: mark it cancelled, ping and DM everyone, leave the thread to be deleted by hand
router.post('/:planId/cancel', requirePlanner, async (req, res) => {
    const { plan, ctx } = req;
    //Already cancelled, do not tell everyone twice
    if (plan.status === 'cancelled') return res.json({ ok: true });

    const { quiet, post, dm } = loudness(req.body);

    //Marked cancelled here rather than inside the announcement, so a reload sees it gone straight away
    let cancelled;
    try {
        cancelled = await markPlanCancelled(plan.planId);
        await refundAction(plan.createdBy, plan.guildId, 'create', plan.createdAt);
        await addPlanEvent(plan.planId, { type: 'cancelled', by: req.user.id, byName: ctx.member.displayName });
    } catch (err) {
        console.error('[plans] cancel failed:', err);
        return res.status(500).json({ error: 'Could not cancel the plan.' });
    }

    //The cancelled copy, since what the pin and everyone's DM end up saying is read off the status
    announceAfter('cancel announce', () =>
        announceCancel(cancelled || plan, ctx.member.displayName, { post, dm })
    );

    res.json({ ok: true, quiet });
});

//Pull extra people into a running plan. Planner only, same gate as the rest.
router.post('/:planId/add', requirePlanner, refuseCancelled, async (req, res) => {
    const { plan, ctx } = req;

    const { userIds } = req.body || {};
    const { quiet, dm } = loudness(req.body);
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'Pick at least one person to add.' });
    }
    if (userIds.length > MAX_PARTICIPANTS) {
        return res.status(400).json({ error: `That is more than ${MAX_PARTICIPANTS} people to add at once.` });
    }

    //Skip anyone already in, and keep only real non bot members of this server
    const already = new Set(plan.participants.map((p) => p.userId));
    const toAdd = await realMembers(ctx.guild, userIds.filter((id) => !already.has(id)));
    if (toAdd.length === 0) return res.status(400).json({ error: 'Nobody new to add there.' });

    const updated = await addParticipants(plan.planId, toAdd);

    await addPlanEvent(plan.planId, { type: 'added', by: req.user.id, byName: ctx.member.displayName, count: toAdd.length });

    announceAfter('add announce', () => announceAddition(updated, toAdd, ctx.member.displayName, { dm }));

    res.json({ ok: true, added: toAdd.length, quiet });
});

//Drop yourself out of a plan you were invited to, the website side of the DM button
router.post('/:planId/leave', async (req, res) => {
    const { plan } = req;

    const me = plan.participants.find((p) => p.userId === req.user.id);
    if (!me) return res.status(403).json({ error: 'You are not part of this plan.' });

    try {
        await leavePlan(plan, req.user.id, req.user.displayName);
    } catch (err) {
        console.error('[plans] leave failed:', err);
        return res.status(500).json({ error: 'Could not drop you out of the plan.' });
    }

    res.json({ ok: true });
});

export default router;
