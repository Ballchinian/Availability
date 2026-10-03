import { planRole } from '../../roles.js';
import { announceAfter } from '../../announce.js';
import { getCollectingPlansForUser, confirmParticipant, setIn, recordVote } from '../../../db/plans/index.js';
import { getGuildConfig } from '../../../db/guilds.js';
import { getAvailabilityInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../../db/availability.js';
import { setCoveredUntil, getPlanningPrefs, addAnswered } from '../../../db/users.js';
import { leavePlan, notifyHostsDropped, announceJoin, announceVote, answersMoved } from '../../../bot/plans/index.js';
import { formatDate, shiftDate, weekdayAllowed, allowedDaysInRange } from '../../../lib/dates.js';
import { validHours } from '../../../lib/hours.js';
import { safeZone } from '../../../lib/zones.js';
import { newlyCovered, answersOn, askFor, daysToFill, inOf } from '../../../lib/coverage.js';
import { takeAction } from '../../../db/ratelimits.js';
import { DAILY_LIMIT, SAVE_LIMIT, NO_GUILD } from '../../../lib/limits.js';
import { finished } from './gates.js';

//Where someone stands: in or not, and on a plan still finding its day, the line under the question and the days left to fill
function answerOf(plan, me, prefs, rows, lastUpdatedAt) {
    const collecting = plan.status === 'collecting';
    return {
        in: inOf(me),
        inReason: me.inReason || null,
        ask: collecting ? askFor(plan, me, prefs, rows, lastUpdatedAt) : '',
        toFill: collecting ? daysToFill(answersOn(plan, prefs, me)) : []
    };
}

//The same, read fresh after something they did has moved it
async function answerNow(plan, me, prefs) {
    const { start, end } = plan.dateRange;
    const [rows, summary] = await Promise.all([
        getAvailabilityInRange(me.userId, shiftDate(start, -1), shiftDate(end, 1)),
        getAvailabilitySummary(me.userId)
    ]);
    return answerOf(plan, me, prefs, rows, summary.lastUpdatedAt);
}

//What someone on the plan answers with: their dates, in or not, coming or not, and leaving
export function answerRoutes(router) {
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
        const { start, end } = plan.dateRange;
        const [cfg, rows, summary, prefs] = await Promise.all([
            getGuildConfig(plan.guildId),
            //A day either side, which is where their free days on the plan's clock spill in from
            getAvailabilityInRange(req.user.id, shiftDate(start, -1), shiftDate(end, 1)),
            getAvailabilitySummary(req.user.id),
            getPlanningPrefs([req.user.id])
        ]);
        const mine = prefs[req.user.id];

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
            //Whether they run it as well as being on it. The site also reads it as word that the overview is theirs to open.
            role: planRole(plan, req.user.id),
            confirmed: Boolean(me.confirmed),
            confirmedCount: plan.participants.filter((p) => p.confirmed).length,
            totalParticipants: plan.participants.length,
            availability: rows.filter((r) => r.date >= start && r.date <= end),
            coveredUntil: mine?.coveredUntil || null,
            ...answerOf(plan, me, mine, rows, summary.lastUpdatedAt),
            //The clock their own hours are read in, which is whatever their browser last said
            timeZone: safeZone(mine?.timeZone)
        });
    });

    router.post('/:planId/availability', async (req, res) => {
        const { plan } = req;

        const me = plan.participants.find((p) => p.userId === req.user.id);
        if (!me) return res.status(403).json({ error: 'You are not part of this plan.' });
        if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was called off.' });

        const { days, coveredUntil } = req.body || {};
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

        //Read before the save moves it, so the reply can name the other plans this save answered
        const [plans, before] = await Promise.all([getCollectingPlansForUser(req.user.id), getPlanningPrefs([req.user.id])]);

        //Left alone when it is missing, which is how a page from before the field saves
        if (coveredUntil === null || /^\d{4}-\d{2}-\d{2}$/.test(coveredUntil || '')) {
            await setCoveredUntil(req.user.id, coveredUntil || null);
        }

        //A weekday-pinned plan only rewrites the days it asks about, so a person's saved
        //availability on the other days (from other plans) is left untouched
        const onlyDates = allowed ? allowedDaysInRange(start, end, allowed) : null;
        const savedDays = await replaceAvailabilityInRange(req.user.id, start, end, valid, onlyDates);
        await addAnswered(req.user.id, { start, end, allowedWeekdays: allowed });
        const updated = await confirmParticipant(plan.planId, req.user.id);
        const after = await getPlanningPrefs([req.user.id]);
        const others = plans.filter((p) => p.planId !== plan.planId);
        const meNow = updated.participants.find((p) => p.userId === req.user.id) || me;

        //No thread post, a save is quiet. Their cards catch up, and a plan it finished may DM whoever runs it.
        answersMoved(req.user.id, [...new Set([plan.planId, ...plans.map((p) => p.planId)])]);

        res.json({
            ok: true,
            confirmedCount: updated.participants.filter((p) => p.confirmed).length,
            totalParticipants: updated.participants.length,
            savedDays,
            answers: newlyCovered(others, req.user.id, before[req.user.id], after[req.user.id]),
            ...(await answerNow(updated, meNow, after[req.user.id]))
        });
    });

    /*
        Count me in or Not for me, the plan page's side of the buttons on the DM. Only while
        the plan is still finding its day: once it has one, the question is I'm coming or
        Can't make it. A reason only rides along with a no, and only whoever runs the plan
        reads it. Answers with who the note about it reached.
    */
    router.post('/:planId/join', async (req, res) => {
        const { plan } = req;

        const me = plan.participants.find((p) => p.userId === req.user.id);
        if (!me) return res.status(403).json({ error: 'You are not on the guest list for this plan.' });
        if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was called off.' });
        if (plan.chosenDate) return res.status(409).json({ error: `This plan is set for ${formatDate(plan.chosenDate)} now.` });

        const { in: value, reason } = req.body || {};
        if (typeof value !== 'boolean') return res.status(400).json({ error: 'Something was off with that answer.' });

        //Each no, and each change of mind after one, DMs whoever runs the plan
        const rl = await takeAction(req.user.id, plan.guildId, 'join', DAILY_LIMIT);
        if (!rl.allowed) {
            return res.status(429).json({ error: `You have answered ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
        }

        const was = inOf(me);
        const why = value ? null : String(reason || '').trim().slice(0, 200) || null;
        const updated = await setIn(plan.planId, req.user.id, value, why);
        const meNow = updated.participants.find((p) => p.userId === req.user.id) || me;
        const prefs = await getPlanningPrefs([req.user.id]);

        const [heard, answer] = await Promise.all([
            announceAfter(plan.planId, 'join', (current) => announceJoin(current, req.user.id, was, why)),
            answerNow(updated, meNow, prefs[req.user.id])
        ]);

        res.json({ ok: true, ...answer, told: heard?.told ?? [], missed: heard?.missed ?? [] });
    });

    /*
        I'm coming or Can't make it, the overview's side of the buttons on the DM and the
        pinned post. Only once the plan has its day, and only for someone on that day's list.
        A reason only rides along with a no, and only whoever runs the plan reads it. Answers
        with who the note about a no reached.
    */
    router.post('/:planId/vote', async (req, res) => {
        const { plan } = req;

        const me = plan.participants.find((p) => p.userId === req.user.id);
        if (!me) return res.status(403).json({ error: 'You are not on the guest list for this plan.' });
        const over = finished(plan);
        if (over) return res.status(409).json({ error: over });
        if (!plan.chosenDate) return res.status(409).json({ error: 'This plan has no day to answer for yet.' });
        if (me.invited === false) return res.status(409).json({ error: 'You are not on the list for this date.' });

        const { vote, reason } = req.body || {};
        if (vote !== 'yes' && vote !== 'no') return res.status(400).json({ error: 'Something was off with that answer.' });

        //Each fresh no DMs whoever runs the plan
        const rl = await takeAction(req.user.id, plan.guildId, 'vote', DAILY_LIMIT);
        if (!rl.allowed) {
            return res.status(429).json({ error: `You have answered ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
        }

        const was = me.vote || null;
        const why = vote === 'no' ? String(reason || '').trim().slice(0, 200) || null : null;
        await recordVote(plan.planId, req.user.id, vote, why);

        //Waited on, since the answer has to say who heard about a no
        const heard = await announceAfter(plan.planId, 'vote', (current) => announceVote(current, req.user.id, was, why));
        res.json({ ok: true, vote, told: heard?.told ?? [], missed: heard?.missed ?? [] });
    });

    //Take yourself off a plan with its day set, which also keeps you off the ones that come round after it
    router.post('/:planId/leave', async (req, res) => {
        const { plan } = req;

        const me = plan.participants.find((p) => p.userId === req.user.id);
        if (!me) return res.status(403).json({ error: 'You are not part of this plan.' });
        const over = finished(plan);
        if (over) return res.status(409).json({ error: over });

        try {
            await leavePlan(plan, req.user.id, req.user.displayName);
        } catch (err) {
            console.error('[plans] leave failed:', err);
            return res.status(500).json({ error: 'Could not drop you out of the plan.' });
        }

        const { told, missed } = await notifyHostsDropped(plan, req.user.id, null).catch(() => ({ told: [], missed: [] }));
        res.json({ ok: true, told, missed });
    });
}
