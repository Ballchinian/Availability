import { Router } from 'express';
import { requireUser } from '../../lib/session.js';
import { getAvailabilityInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { getPlansCoveredBy, confirmParticipant } from '../../db/plans.js';
import { notifyCreatorIfAllIn } from '../../bot/plans.js';
import { maxEnd } from '../../lib/dates.js';

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
    res.json({ availability, lastFilled: summary.lastFilled, lastUpdatedAt: summary.lastUpdatedAt });
});

router.post('/', requireUser, async (req, res) => {
    const { start, end, days, autoConfirm } = req.body || {};
    if (!SHAPE.test(start || '') || !SHAPE.test(end || '') || start > end) {
        return res.status(400).json({ error: 'Pick a valid range.' });
    }
    if (end > maxEnd()) return res.status(400).json({ error: 'That is more than two years out.' });

    const valid = Array.isArray(days) ? days.filter((d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end) : [];
    await replaceAvailabilityInRange(req.user.id, start, end, valid);

    //Accept any plan the new window fully covers, if they asked us to
    const confirmedPlans = [];
    if (autoConfirm) {
        const plans = await getPlansCoveredBy(req.user.id, start, end);
        for (const plan of plans) {
            const me = plan.participants.find((p) => p.userId === req.user.id);
            if (me && !me.confirmed) {
                //Quiet confirm, no thread post, the planner sees it on the compare page
                const updated = await confirmParticipant(plan.planId, req.user.id);
                confirmedPlans.push(plan.name);
                //If this filled the last slot, nudge the creator to go and compare
                try {
                    await notifyCreatorIfAllIn(updated);
                } catch (err) {
                    console.error('[availability] all-in notify failed:', err);
                }
            }
        }
    }

    res.json({ ok: true, savedDays: valid.length, confirmedPlans });
});

export default router;
