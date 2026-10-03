import { announceAfter } from '../../announce.js';
import { setPlanChosen, setPlanWhen, setReminded, setVoteReminded, setAttendanceOverride, setSentBack, setAskedAgain, markPlanCancelled, addPlanEvent } from '../../../db/plans/index.js';
import { announceOutcome, announceWhenEdit, remindStragglers, remindVoters, announceCancel, syncPlan, applyAttendanceMove, askAgain } from '../../../bot/plans/index.js';
import { weekdayAllowed, readTime, BAD_TIME } from '../../../lib/dates.js';
import { todayIn, dayHasPassed } from '../../../lib/zones.js';
import { inOf } from '../../../lib/coverage.js';
import { takeAction, refundAction } from '../../../db/ratelimits.js';
import { DAILY_LIMIT } from '../../../lib/limits.js';
import { requireHost, byOf, refuseFinished, finished } from './gates.js';

//Whoever runs the plan setting its day, sorting who is coming, nudging, and calling it off
export function runningRoutes(router) {
    //Lock in the winning date, close the plan, and announce it
    router.post('/:planId/choose', requireHost, refuseFinished, async (req, res) => {
        const { plan, ctx } = req;

        const { date, time, inviteMode, attendingIds } = req.body || {};
        if (typeof date !== 'string' || date < plan.dateRange.start || date > plan.dateRange.end) {
            return res.status(400).json({ error: 'Pick a date inside the plan range.' });
        }
        if (date < todayIn(plan.timeZone)) return res.status(400).json({ error: 'That date is in the past.' });
        //A weekday-pinned plan can only land on one of the days it collected for
        if (!weekdayAllowed(date, plan.allowedWeekdays)) {
            return res.status(400).json({ error: 'That day is not one this plan asked about.' });
        }

        const cleanTime = readTime(time);
        if (cleanTime === false) return res.status(400).json({ error: BAD_TIME });
        /*
            Carried through rather than taken from the caller. What a plan is about is one field
            now, changed on the edit form, and a day being moved is not a reason to lose the line
            an older plan still holds beside it.
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
            await setPlanWhen(plan.planId, cleanTime, cleanNote, byOf(req));

            await addPlanEvent(plan.planId, { type: 'when', by: req.user.id, byName: ctx.member.displayName, time: cleanTime });

            announceAfter(plan.planId, 'when edit', (current) => announceWhenEdit(current, ctx.cfg, { actorName: ctx.member.displayName, was }));

            return res.json({ ok: true, chosenDate: date, chosenTime: cleanTime, chosenNote: cleanNote, changed: false, edited: true });
        }

        /*
            Who is still invited once the date is set. "attending" narrows the plan to
            the people the site worked out can make the day, plus by default anyone who
            has not answered for it, so only they get pinged, DMed and counted in the tally.
            Anything else keeps everyone on the list, and moving the date invites everyone
            back too.

            Anyone who said Not for me stays on a narrowed list without being asked, since
            nothing is sent to them and their card has to keep I'm coming for a change of mind.
        */
        let invitedIds = null;
        if (inviteMode === 'attending' && Array.isArray(attendingIds)) {
            const here = new Set(plan.participants.map((p) => p.userId));
            const kept = attendingIds.filter((id) => here.has(id));
            const out = plan.participants.filter((p) => inOf(p) === false).map((p) => p.userId);
            if (kept.length) invitedIds = [...new Set([...kept, ...out])];
        }

        //If a date was already set and this is a different one, it is a reorganise
        const changed = Boolean(plan.chosenDate && plan.chosenDate !== date);
        await setPlanChosen(plan.planId, date, cleanTime, cleanNote, invitedIds, byOf(req));

        const event = { type: changed ? 'moved' : 'chosen', by: req.user.id, byName: ctx.member.displayName, date, time: cleanTime, probe: true };
        //The day it moved off, which is the whole point of recording a move rather than a set
        if (changed) event.from = plan.chosenDate;
        await addPlanEvent(plan.planId, event);

        announceAfter(plan.planId, 'outcome post', (current) => announceOutcome(current, ctx.cfg, { changed, actorName: ctx.member.displayName }));

        res.json({ ok: true, chosenDate: date, chosenTime: cleanTime, chosenNote: cleanNote, changed });
    });

    /*
        Put Discord back in step with the plan by hand: the pinned opener, the confirmation and
        everyone's DM, all rewritten and anything deleted since put back.

        Every change already does this on its way past, so this is for when that failed and
        nothing said so. announceAfter runs the Discord side after the response and only logs a
        failure, so a Discord outage leaves the plan set, the database right and not a word sent.
        Until now there was no second attempt.

        Sends nothing and pings nobody, so it is safe to lean on. Answers with what it managed.

        No refuseFinished on purpose. A cancelled plan is the one whose DMs most want
        correcting, a stale card there having somebody turn up to nothing.
    */
    router.post('/:planId/repair', requireHost, async (req, res) => {
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
        the overview's board. "coming" and "cant" lay an override over whatever the
        person answered. "waiting" sends them back: what they had goes in sentBack and
        the column is cleared, so the next nudge asks them again. Moved out of Waiting
        before they answer, they get back exactly what they had if it is the column they
        left, and otherwise that with the new column laid over it. "invite" is the one move
        for someone left off the day's list: back on it with no answer.

        Silent for the person moved, except an invite, which DMs them the yes/no. The board
        is a planner's own working state, and the reason to reach for it is having decided
        that person will not answer. dm says whether an invite's DM landed.
    */
    router.post('/:planId/attendance', requireHost, refuseFinished, async (req, res) => {
        const { plan, ctx } = req;
        if (!plan.chosenDate) return res.status(400).json({ error: 'Set a date first, then sort out who is coming.' });

        const { userId, status } = req.body || {};
        if (!['coming', 'cant', 'waiting', 'invite'].includes(status)) {
            return res.status(400).json({ error: 'Something was off with that move.' });
        }
        const person = plan.participants.find((p) => p.userId === userId);
        if (!person) return res.status(400).json({ error: 'That person is not on this plan.' });

        const invite = status === 'invite';
        if (invite !== (person.invited === false)) {
            return res.status(400).json({ error: invite ? 'They are already invited to this date.' : 'They are not invited to this date yet.' });
        }

        const override = status === 'coming' ? 'yes' : status === 'cant' ? 'no' : null;
        const answer = { vote: person.vote || null, voteReason: person.voteReason || null, votedAt: person.votedAt || null, override: person.override || null };
        const columnOf = (a) => a.override || a.vote || null;

        //Their card shows their own answer, so it is rewritten whenever that moves
        let rewrite = false;
        if (status === 'waiting') {
            if (!columnOf(answer)) return res.status(400).json({ error: 'They are already waiting to answer.' });
            await setSentBack(plan.planId, userId, { byName: ctx.member.displayName, at: new Date(), was: answer }, null);
            rewrite = true;
        } else if (person.sentBack?.was && !invite) {
            const was = person.sentBack.was;
            await setSentBack(plan.planId, userId, null, columnOf(was) === override ? was : { ...was, override });
            rewrite = true;
        } else {
            await setAttendanceOverride(plan.planId, userId, override, { reinvite: invite });
        }

        //Waited on, since the answer has to say whether the invite's DM landed
        const reached = await announceAfter(plan.planId, 'attendance move', (current) =>
            applyAttendanceMove(current, status, userId, ctx.member.displayName, { rewrite })
        );

        res.json(invite ? { ok: true, dm: reached === true } : { ok: true });
    });

    /*
        Ask again, beside each name on a plan still finding its day: that one person's card
        DMed now. Someone in is sent back as well, so their calendar stops answering this plan
        until they save their dates again. Once a day for each person. dm says whether it landed.
    */
    router.post('/:planId/askagain', requireHost, refuseFinished, async (req, res) => {
        const { plan, ctx } = req;
        if (plan.status !== 'collecting') {
            return res.status(409).json({ error: 'This plan has its day. Move them to Waiting to answer on the board instead.' });
        }
        const person = plan.participants.find((p) => p.userId === req.body?.userId);
        if (!person) return res.status(400).json({ error: 'That person is not on this plan.' });
        const joined = inOf(person);
        if (joined === false) return res.status(400).json({ error: "They said it's not for them, so I don't DM them." });

        const hoursSince = (Date.now() - (person.askedAgainAt ? new Date(person.askedAgainAt).getTime() : 0)) / 3600000;
        if (hoursSince < 24) {
            return res.status(429).json({ error: `Already asked them in the last day. You can ask again in ${Math.ceil(24 - hoursSince)} hours.` });
        }

        const byName = ctx.member.displayName;
        await setAskedAgain(plan.planId, person.userId, joined === true ? { byName, at: new Date(), was: { in: true } } : null);
        const reached = await announceAfter(plan.planId, 'ask again', (current) => askAgain(current, person.userId, byName));
        res.json({ ok: true, dm: reached === true });
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
    router.post('/:planId/remind', requireHost, refuseFinished, async (req, res) => {
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

    //Cancel a plan: mark it cancelled, ping and DM everyone, leave the thread to be deleted by hand
    router.post('/:planId/cancel', requireHost, async (req, res) => {
        const { plan, ctx } = req;
        //Already cancelled, do not tell everyone twice
        if (plan.status === 'cancelled') return res.json({ ok: true });
        if (dayHasPassed(plan)) return res.status(409).json({ error: finished(plan) });

        //Marked cancelled here rather than inside the announcement, so a reload sees it gone straight away
        let cancelled;
        try {
            cancelled = await markPlanCancelled(plan.planId);
            //Cancelled by something else since this request read the plan, which has told everyone already
            if (!cancelled) return res.json({ ok: true });
            await refundAction(plan.createdBy, plan.guildId, 'create', plan.createdAt);
            await addPlanEvent(plan.planId, { type: 'cancelled', by: req.user.id, byName: ctx.member.displayName });
        } catch (err) {
            console.error('[plans] cancel failed:', err);
            return res.status(500).json({ error: 'Could not call the plan off.' });
        }

        announceAfter(plan.planId, 'cancel announce', (current) => announceCancel(current, ctx.member.displayName), { cancel: true });

        res.json({ ok: true });
    });
}
