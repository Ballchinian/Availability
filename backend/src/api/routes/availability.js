import { Router } from 'express';
import { requireUser } from '../../lib/session.js';
import { getAvailabilityInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { getUserById, setSureUntil } from '../../db/users.js';
import { autoConfirmCoveredPlans } from '../../bot/plans.js';
import { maxEnd } from '../../lib/dates.js';
import { validHours } from '../../lib/hours.js';
import { safeZone } from '../../lib/zones.js';

/*
    The general availability page, not tied to any plan. People can fill their
    timetable ahead of time, say if they know they will be away. It is the same
    grid as a plan, the only difference is they choose the window themselves. With
    auto-accept on, saving confirms them for any plan they have now fully covered.
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
        sureUntil: userDoc?.sureUntil || null,
        //The clock these hours are read in when a plan lines them up against someone else's
        timeZone: safeZone(userDoc?.timeZone)
    });
});

router.post('/', requireUser, async (req, res) => {
    const { start, end, days, autoConfirm, sureUntil } = req.body || {};
    if (!SHAPE.test(start || '') || !SHAPE.test(end || '') || start > end) {
        return res.status(400).json({ error: 'Pick a valid range.' });
    }
    if (end > maxEnd()) return res.status(400).json({ error: 'That is more than two years out.' });

    //Their certainty horizon rides along with the save, empty meaning no limit
    if (sureUntil === null || SHAPE.test(sureUntil || '')) {
        await setSureUntil(req.user.id, sureUntil || null);
    }

    const valid = Array.isArray(days) ? days.filter((d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end) : [];
    if (!valid.every((d) => validHours(d.hours))) {
        return res.status(400).json({ error: 'Something was off with the hours you sent.' });
    }

    const savedDays = await replaceAvailabilityInRange(req.user.id, start, end, valid);

    //Accept any plan the new window fully covers, if they asked us to
    let confirmedPlans = [];
    if (autoConfirm) {
        try {
            confirmedPlans = await autoConfirmCoveredPlans(req.user.id, start, end);
        } catch (err) {
            console.error('[availability] auto-confirm failed:', err);
        }
    }

    res.json({ ok: true, savedDays, confirmedPlans });
});

export default router;
