import { Router } from 'express';
import { requireUser } from '../../lib/session.js';
import { guildContext } from '../context.js';
import { getPlan, confirmParticipant, setPlanChosen, voidPlanChoice, setReminded, setVoteReminded, setPlanRange, setPlanWeekdays, addParticipants, setPlanDetails, setAttendanceOverride, markPlanCancelled, setPlanRepeat, addPlanEvent } from '../../db/plans.js';
import { getGuildConfig } from '../../db/guilds.js';
import { getAvailabilityInRange, getAvailabilityForUsersInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { getUserById, setSureUntil, getPlanningPrefs } from '../../db/users.js';
import { announceOutcome, remindStragglers, remindVoters, announceRangeChange, announceWeekdaysChange, announceCancel, leavePlan, announceAddition, announceVoid, notifyCreatorIfAllIn, applyDetailsEdit, applyAttendanceMove, autoConfirmCoveredPlans } from '../../bot/plans.js';
import { threadUrl, planUrl } from '../../bot/util.js';
import { buildIcs, icsFileName } from '../../lib/ics.js';
import { today, maxEnd, shiftDate, weekdayAllowed, allowedDaysInRange, cleanWeekdays, describeWeekdays, weekdayChange, REPEAT_WEEKS } from '../../lib/dates.js';
import { DAY_HOURS, validHours } from '../../lib/hours.js';
import { safeZone, retimeDay } from '../../lib/zones.js';
import { takeAction, refundAction } from '../../db/ratelimits.js';
import { DAILY_LIMIT, MAX_PARTICIPANTS } from '../../lib/limits.js';

/*
    The availability side of a plan. GET hands the page everything it needs to
    draw the grid, including this person's remembered free days so the grid comes
    up prefilled. POST saves their picks, marks them confirmed for this plan, and
    nudges the thread with the running count.
*/

const router = Router();

//Every route below the availability pair is planner only, and always about the plan's own server
const plannerContext = (plan, userId) => guildContext(plan.guildId, userId, { requirePlanner: true });

/*
    Announcements run after the response, never inside it. The write they follow
    is already committed, and dmEach sends one at a time, so a plan of twenty
    would otherwise leave the planner on "Saving..." for twenty round trips and
    a slow Discord would turn that into a timeout. Failure stays non-fatal.
*/
function announceAfter(label, run) {
    Promise.resolve().then(run).catch((err) => console.error(`[plans] ${label} failed:`, err));
}

router.get('/:planId', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    /*
        Checked before anything is read, so the name, description, dates and server
        never reach someone who is not on the guest list. Plan ids are random ten
        character strings so nobody arrives here by chance, but a link passed on
        would otherwise hand over the details.
    */
    const me = plan.participants.find((p) => p.userId === req.user.id);
    if (!me) return res.status(403).json({ error: 'You are not on the guest list for this plan.' });

    const cfg = await getGuildConfig(plan.guildId);
    const availability = await getAvailabilityInRange(req.user.id, plan.dateRange.start, plan.dateRange.end);
    const summary = await getAvailabilitySummary(req.user.id);
    const userDoc = await getUserById(req.user.id);

    res.json({
        plan: {
            planId: plan.planId,
            name: plan.name,
            description: plan.description || '',
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            status: plan.status,
            allowedWeekdays: plan.allowedWeekdays || null,
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

router.post('/:planId/availability', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const me = plan.participants.find((p) => p.userId === req.user.id);
    if (!me) return res.status(403).json({ error: 'You are not part of this plan.' });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { days, autoConfirm, sureUntil } = req.body || {};
    if (!Array.isArray(days)) return res.status(400).json({ error: 'Something was off with the dates you sent.' });

    //Their certainty horizon rides along with the save, empty meaning no limit
    if (sureUntil === null || /^\d{4}-\d{2}-\d{2}$/.test(sureUntil || '')) {
        await setSureUntil(req.user.id, sureUntil || null);
    }

    const { start, end } = plan.dateRange;
    const allowed = plan.allowedWeekdays || null;
    //Keep only well formed days that sit inside this plan's range and on a day it asks about
    const valid = days.filter(
        (d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end && weekdayAllowed(d.date, allowed)
    );
    if (!valid.every((d) => validHours(d.hours))) {
        return res.status(400).json({ error: 'Something was off with the hours you sent.' });
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
router.get('/:planId/calendar.ics', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

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
router.get('/:planId/compare', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    //Names and avatars for everyone invited, plus their horizons and their clocks in one query
    const prefs = await getPlanningPrefs(plan.participants.map((p) => p.userId));
    //Fetched together rather than one after another, so twenty people is one wait, not twenty
    const members = await Promise.all(plan.participants.map((p) => ctx.guild.members.fetch(p.userId).catch(() => null)));
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

    /*
        Only people who have confirmed count, and we send their hours so the site can
        work out the overlap window for each day.

        Everyone writes their hours in their own clock, and the plan runs on the
        server's, so the hours are read into that before anyone is compared. Someone an
        hour ahead of the server is free from 11pm the night before as far as this grid
        is concerned, which is why the query reaches a day past each end: that is where
        the spill comes from. Anything still landing outside the range is dropped.
    */
    const guildZone = safeZone(ctx.cfg.timeZone);
    const confirmed = plan.participants.filter((p) => p.confirmed);
    const rows = await getAvailabilityForUsersInRange(
        confirmed.map((p) => p.userId),
        shiftDate(plan.dateRange.start, -1),
        shiftDate(plan.dateRange.end, 1)
    );

    const byUser = new Map();
    for (const r of rows) {
        if (!byUser.has(r.userId)) byUser.set(r.userId, []);
        byUser.get(r.userId).push(r);
    }

    /*
        Grouped in participant order, since the overlap maths breaks ties by position.
        Two of someone's days can land on one of the server's, so their hours are
        gathered per day before anything goes out, and a full 24 goes back to the empty
        that means all day: a server where everyone shares one clock sends exactly what
        it always did.
    */
    const freeByDate = {};
    for (const p of confirmed) {
        const zone = safeZone(prefs[p.userId]?.timeZone);
        const gathered = new Map();
        for (const a of byUser.get(p.userId) || []) {
            for (const day of retimeDay(zone, guildZone, a.date, a.hours || [])) {
                if (day.date < plan.dateRange.start || day.date > plan.dateRange.end) continue;
                if (!gathered.has(day.date)) gathered.set(day.date, new Set());
                const set = gathered.get(day.date);
                for (const h of day.hours.length ? day.hours : DAY_HOURS) set.add(h);
            }
        }
        for (const [date, set] of gathered) {
            const hours = set.size === DAY_HOURS.length ? [] : [...set].sort((a, b) => a - b);
            (freeByDate[date] ||= []).push({ userId: p.userId, hours });
        }
    }

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

//Lock in the winning date, close the plan, and announce it
router.post('/:planId/choose', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { date, time, note, inviteMode, attendingIds, probe } = req.body || {};
    if (typeof date !== 'string' || date < plan.dateRange.start || date > plan.dateRange.end) {
        return res.status(400).json({ error: 'Pick a date inside the plan range.' });
    }
    //A weekday-pinned plan can only land on one of the days it collected for
    if (!weekdayAllowed(date, plan.allowedWeekdays)) {
        return res.status(400).json({ error: 'That day is not one this plan asked about.' });
    }

    //Time and note are both optional, the time only sticks if it looks like HH:MM
    const cleanTime = typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : null;
    const cleanNote = String(note || '').trim().slice(0, 200) || null;

    //A high daily backstop on locking in or moving a date, since it pings and DMs everyone
    const rl = await takeAction(req.user.id, plan.guildId, 'choose', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have set a date ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    /*
        Who is still invited once the date is set. "attending" narrows the plan to
        the people the site worked out can make the day, so only they get pinged,
        DMed and counted in the confirmation tally. Anything else keeps everyone on
        the list, and voiding or moving the date invites everyone back too.
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
            probe: probe === true
        })
    );

    res.json({ ok: true, chosenDate: date, chosenTime: cleanTime, chosenNote: cleanNote, changed });
});

/*
    A planner's manual call on someone's attendance for the set date, the moves on
    the compare page's board. "coming" and "cant" lay an override over whatever the
    person answered, "waiting" clears it and their own answer stands again. Moving
    someone to coming also puts them back on the invite list if they were left off,
    which is how you let in someone who never filled their availability.
*/
router.post('/:planId/attendance', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });
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
        await applyAttendanceMove(updated, userId, status, req.user.id, ctx.member.displayName);
    } catch (err) {
        console.error('[plans] attendance move failed:', err);
    }

    res.json({ ok: true });
});

//Undo a confirmed date and reschedule. DMs everyone (no thread post), planner only.
router.post('/:planId/void', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });
    if (!plan.chosenDate) return res.status(400).json({ error: 'There is no set date to undo.' });

    const reason = String(req.body?.reason || '').trim().slice(0, 200) || null;
    const updated = await voidPlanChoice(plan.planId);

    await addPlanEvent(plan.planId, { type: 'voided', by: req.user.id, byName: ctx.member.displayName, from: plan.chosenDate, reason });

    announceAfter('void announce', () => announceVoid(updated, ctx.cfg, ctx.member.displayName, reason, { dm: req.body?.dm !== false }));

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
router.post('/:planId/repeat', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

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
router.post('/:planId/remind', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

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

//Set a fresh start and end on the range, reopen, and tell everyone to refill the new window
router.post('/:planId/range', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { start, end, note, post, dm } = req.body || {};
    const shape = /^\d{4}-\d{2}-\d{2}$/;
    if (!shape.test(start || '') || !shape.test(end || '')) {
        return res.status(400).json({ error: 'Pick a valid start and end date.' });
    }
    if (start > end) return res.status(400).json({ error: 'The start date is after the end date.' });
    if (end < today()) return res.status(400).json({ error: 'That whole range is in the past.' });
    if (end > maxEnd()) return res.status(400).json({ error: 'The end date cannot be more than two years away.' });
    if (start === plan.dateRange.start && end === plan.dateRange.end) {
        return res.status(400).json({ error: 'That is already the range. Move the start or the end to change it.' });
    }
    //A weekday-pinned plan needs at least one of its days to survive inside the new window
    if (plan.allowedWeekdays && !allowedDaysInRange(start, end, plan.allowedWeekdays).length) {
        return res.status(400).json({ error: 'None of the days this plan asks about fall inside that new range.' });
    }

    const cleanNote = String(note || '').trim().slice(0, 200) || null;

    //A high daily backstop on changing the range, since each one pings and DMs everyone
    const rl = await takeAction(req.user.id, plan.guildId, 'extend', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have changed the dates ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    const updated = await setPlanRange(plan.planId, start, end);

    await addPlanEvent(plan.planId, { type: 'range', by: req.user.id, byName: ctx.member.displayName, start, end });

    announceAfter('range post', () =>
        announceRangeChange(updated, ctx.cfg, { actorName: ctx.member.displayName, note: cleanNote, post: post !== false, dm: dm !== false })
    );

    res.json({ ok: true, start, end });
});

//Change which weekdays the plan asks about, reopen it, and tell everyone to fill in the new days
router.post('/:planId/weekdays', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { allowedWeekdays, note, post, dm } = req.body || {};
    const weekdays = cleanWeekdays(allowedWeekdays);

    //The new set has to leave at least one day inside the plan's current range
    if (weekdays && !allowedDaysInRange(plan.dateRange.start, plan.dateRange.end, weekdays).length) {
        return res.status(400).json({ error: 'None of those days fall inside the plan range.' });
    }
    const { same, opensADay } = weekdayChange(plan.allowedWeekdays, weekdays);

    //Nothing to do if it lands on the same set the plan already has
    if (same) {
        return res.status(400).json({ error: 'Those are already the days this plan asks about.' });
    }

    const cleanNote = String(note || '').trim().slice(0, 200) || null;

    //A high daily backstop, since changing the days pings and DMs everyone like a range change
    const rl = await takeAction(req.user.id, plan.guildId, 'weekdays', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have changed the days ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    const updated = await setPlanWeekdays(plan.planId, weekdays, { reopen: opensADay });

    await addPlanEvent(plan.planId, { type: 'weekdays', by: req.user.id, byName: ctx.member.displayName, allowedWeekdays: weekdays });

    announceAfter('weekdays post', () =>
        announceWeekdaysChange(updated, ctx.cfg, {
            actorName: ctx.member.displayName,
            daysLabel: describeWeekdays(weekdays),
            reopened: opensADay,
            note: cleanNote,
            post: post !== false,
            dm: dm !== false
        })
    );

    res.json({ ok: true, allowedWeekdays: weekdays, reopened: opensADay });
});

//Edit a plan's title and description. Renames the thread and rewrites the pinned opener, quietly.
router.post('/:planId/details', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { name, description } = req.body || {};

    //Same shape as creating a plan: a name (required) and a description (optional), both capped
    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Give the plan a name.' });
    if (cleanName.length > 90) return res.status(400).json({ error: 'That name is a bit long, keep it under 90 characters.' });

    const cleanDescription = String(description || '').trim();
    if (cleanDescription.length > 280) return res.status(400).json({ error: 'Keep the description under 280 characters.' });

    if (cleanName === plan.name && cleanDescription === (plan.description || '')) {
        return res.status(400).json({ error: 'Nothing changed there. Edit the title or the description to update it.' });
    }

    //Only the title drives a thread rename, which Discord rate limits, so track it separately
    const renamed = cleanName !== plan.name;
    const updated = await setPlanDetails(plan.planId, cleanName, cleanDescription);

    await addPlanEvent(plan.planId, { type: 'details', by: req.user.id, byName: ctx.member.displayName, renamed });

    try {
        await applyDetailsEdit(updated, renamed);
    } catch (err) {
        console.error('[plans] details edit failed:', err);
    }

    res.json({ ok: true, name: cleanName, description: cleanDescription });
});

//Cancel a plan: mark it cancelled, ping and DM everyone, leave the thread to be deleted by hand
router.post('/:planId/cancel', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    //Already cancelled, do not tell everyone twice
    if (plan.status === 'cancelled') return res.json({ ok: true });

    //Marked cancelled here rather than inside the announcement, so a reload sees it gone straight away
    try {
        await markPlanCancelled(plan.planId);
        await refundAction(plan.createdBy, plan.guildId, 'create', plan.createdAt);
        await addPlanEvent(plan.planId, { type: 'cancelled', by: req.user.id, byName: ctx.member.displayName });
    } catch (err) {
        console.error('[plans] cancel failed:', err);
        return res.status(500).json({ error: 'Could not cancel the plan.' });
    }

    announceAfter('cancel announce', () =>
        announceCancel(plan, ctx.member.displayName, { post: req.body?.post !== false, dm: req.body?.dm !== false })
    );

    res.json({ ok: true });
});

//Pull extra people into a running plan. Planner only, same gate as the rest.
router.post('/:planId/add', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { userIds, dm } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'Pick at least one person to add.' });
    }
    if (userIds.length > MAX_PARTICIPANTS) {
        return res.status(400).json({ error: `That is more than ${MAX_PARTICIPANTS} people to add at once.` });
    }

    //Skip anyone already in, and keep only real non bot members of this server
    const already = new Set(plan.participants.map((p) => p.userId));
    const toAdd = [];
    for (const id of userIds) {
        if (already.has(id)) continue;
        const m = ctx.guild.members.cache.get(id) || (await ctx.guild.members.fetch(id).catch(() => null));
        if (m && !m.user.bot) toAdd.push(id);
    }
    if (toAdd.length === 0) return res.status(400).json({ error: 'Nobody new to add there.' });

    const updated = await addParticipants(plan.planId, toAdd);

    await addPlanEvent(plan.planId, { type: 'added', by: req.user.id, byName: ctx.member.displayName, count: toAdd.length });

    announceAfter('add announce', () => announceAddition(updated, toAdd, ctx.member.displayName, { dm: dm !== false }));

    res.json({ ok: true, added: toAdd.length });
});

//Drop yourself out of a plan you were invited to, the website side of the DM button
router.post('/:planId/leave', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

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
