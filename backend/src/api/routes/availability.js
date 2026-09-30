import { Router } from 'express';
import { requireUser } from '../../lib/session.js';
import { getAvailabilityInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { getUserById, setCoveredUntil, getPlanningPrefs } from '../../db/users.js';
import { getCollectingPlansForUser } from '../../db/plans.js';
import { newlyCovered } from '../../lib/coverage.js';
import { answersMoved } from '../../bot/plans.js';
import { maxEnd } from '../../lib/dates.js';
import { validHours } from '../../lib/hours.js';
import { safeZone } from '../../lib/zones.js';
import { takeAction } from '../../db/ratelimits.js';
import { SAVE_LIMIT, NO_GUILD } from '../../lib/limits.js';

/*
    The general availability page, not tied to any plan. People can fill their
    timetable ahead of time, say if they know they will be away. It is the same
    grid as a plan, the only difference is they choose the window themselves.
*/

const router = Router();

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', requireUser, async (req, res) => {
    const { start, end } = req.query;
    const availability = SHAPE.test(start || '') && SHAPE.test(end || '')
        ? await getAvailabilityInRange(req.user.id, start, end)
        : [];
    const summary = await getAvailabilitySummary(req.user.id);
    const userDoc = await getUserById(req.user.id);
    res.json({
        availability,
        lastFilled: summary.lastFilled,
        lastUpdatedAt: summary.lastUpdatedAt,
        coveredUntil: userDoc?.coveredUntil || null,
        //The clock these hours are read in when a plan lines them up against someone else's
        timeZone: safeZone(userDoc?.timeZone)
    });
});

router.post('/', requireUser, async (req, res) => {
    const { start, end, days, coveredUntil } = req.body || {};
    if (!SHAPE.test(start || '') || !SHAPE.test(end || '') || start > end) {
        return res.status(400).json({ error: 'Pick a valid range.' });
    }
    if (end > maxEnd()) return res.status(400).json({ error: 'That is more than two years out.' });

    const valid = Array.isArray(days) ? days.filter((d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end) : [];
    if (!valid.every((d) => validHours(d.hours))) {
        return res.status(400).json({ error: 'Something was off with the hours you sent.' });
    }

    //Everything is checked before a slot is spent, and nothing is written before one is
    const rl = await takeAction(req.user.id, NO_GUILD, 'save', SAVE_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have saved ${SAVE_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    //Read before the save moves it, so the reply can name the plans this save answered
    const [plans, before] = await Promise.all([getCollectingPlansForUser(req.user.id), getPlanningPrefs([req.user.id])]);

    //Left alone when it is missing, which is how a page from before the field saves
    if (coveredUntil === null || SHAPE.test(coveredUntil || '')) {
        await setCoveredUntil(req.user.id, coveredUntil || null);
    }

    const savedDays = await replaceAvailabilityInRange(req.user.id, start, end, valid);
    const after = await getPlanningPrefs([req.user.id]);
    answersMoved(req.user.id, plans.map((p) => p.planId));

    res.json({ ok: true, savedDays, answers: newlyCovered(plans, req.user.id, before[req.user.id], after[req.user.id]) });
});

export default router;
