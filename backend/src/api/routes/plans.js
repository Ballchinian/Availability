import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getPlan, confirmParticipant, setPlanChosen, setReminded, extendPlan } from '../../db/plans.js';
import { getGuildConfig } from '../../db/guilds.js';
import { getAvailabilityInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { postConfirmation, announceOutcome, remindStragglers, announceExtension, cancelPlan } from '../../bot/plans.js';
import { maxEnd } from '../../lib/dates.js';
import { takeAction } from '../../db/ratelimits.js';
import { limitFor } from '../../lib/limits.js';

/*
    The availability side of a plan. GET hands the page everything it needs to
    draw the grid, including this person's remembered free days so the grid comes
    up prefilled. POST saves their picks, marks them confirmed for this plan, and
    nudges the thread with the running count.
*/

const router = Router();

//Compare and choose are planner only, so this looks the requester up in the guild
async function plannerContext(plan, userId) {
    const cfg = await getGuildConfig(plan.guildId);
    if (!cfg || !cfg.setupComplete) return { error: 400, message: 'That server has not run /setup yet.' };

    const guild = await client.guilds.fetch(plan.guildId).catch(() => null);
    if (!guild) return { error: 404, message: 'I am not in that server.' };

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { error: 403, message: 'You are not in that server.' };
    if (!member.roles.cache.has(cfg.plannerRoleId)) return { error: 403, message: 'You need the planner role to do that.' };

    const isTrusted = Boolean(cfg.trustedRoleId) && member.roles.cache.has(cfg.trustedRoleId);
    return { cfg, guild, member, isTrusted };
}

router.get('/:planId', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const me = plan.participants.find((p) => p.userId === req.user.id);
    const cfg = await getGuildConfig(plan.guildId);
    const availability = await getAvailabilityInRange(req.user.id, plan.dateRange.start, plan.dateRange.end);
    const summary = await getAvailabilitySummary(req.user.id);

    res.json({
        plan: {
            planId: plan.planId,
            name: plan.name,
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            status: plan.status,
            guildName: cfg?.guildName || ''
        },
        isParticipant: Boolean(me),
        confirmed: Boolean(me?.confirmed),
        confirmedCount: plan.participants.filter((p) => p.confirmed).length,
        totalParticipants: plan.participants.length,
        availability,
        lastFilled: summary.lastFilled,
        lastUpdatedAt: summary.lastUpdatedAt
    });
});

router.post('/:planId/availability', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const me = plan.participants.find((p) => p.userId === req.user.id);
    if (!me) return res.status(403).json({ error: 'You are not part of this plan.' });

    const { days } = req.body || {};
    if (!Array.isArray(days)) return res.status(400).json({ error: 'Something was off with the dates you sent.' });

    const { start, end } = plan.dateRange;
    //Keep only well formed days that sit inside this plan's range
    const valid = days.filter((d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end);

    await replaceAvailabilityInRange(req.user.id, start, end, valid);
    const updated = await confirmParticipant(plan.planId, req.user.id);

    try {
        await postConfirmation(updated, req.user.id);
    } catch (err) {
        console.error('[plans] confirm post failed:', err);
    }

    res.json({
        ok: true,
        confirmedCount: updated.participants.filter((p) => p.confirmed).length,
        totalParticipants: updated.participants.length,
        savedDays: valid.length
    });
});

//Everything the compare page needs: who is in, and how many are free each day
router.get('/:planId/compare', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    //Names and avatars for everyone invited
    const participants = [];
    for (const p of plan.participants) {
        const m = await ctx.guild.members.fetch(p.userId).catch(() => null);
        participants.push({
            userId: p.userId,
            displayName: m?.displayName || 'Someone who left',
            avatarUrl: m?.displayAvatarURL({ size: 64 }) || '',
            confirmed: p.confirmed
        });
    }

    //Only people who have confirmed count, and we send their hours so the site
    //can work out the overlap window for each day
    const confirmed = plan.participants.filter((p) => p.confirmed);
    const freeByDate = {};
    for (const p of confirmed) {
        const avail = await getAvailabilityInRange(p.userId, plan.dateRange.start, plan.dateRange.end);
        for (const a of avail) {
            (freeByDate[a.date] ||= []).push({ userId: p.userId, hours: a.hours || [] });
        }
    }

    res.json({
        plan: {
            planId: plan.planId,
            name: plan.name,
            guildName: ctx.cfg.guildName,
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            status: plan.status,
            chosenDate: plan.chosenDate
        },
        participants,
        confirmedCount: confirmed.length,
        totalParticipants: plan.participants.length,
        freeByDate,
        isTrusted: ctx.isTrusted
    });
});

//Lock in the winning date, close the plan, and announce it
router.post('/:planId/choose', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    const { date, pingAttending, pingAllInvited, attendingIds } = req.body || {};
    if (typeof date !== 'string' || date < plan.dateRange.start || date > plan.dateRange.end) {
        return res.status(400).json({ error: 'Pick a date inside the plan range.' });
    }

    //Cap how often a date can be locked in or moved, so people are not pinged repeatedly
    const limit = limitFor(ctx.isTrusted);
    const rl = await takeAction(req.user.id, plan.guildId, 'choose', limit);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have set a date ${limit} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    //If a date was already set and this is a different one, it is a reorganise
    const changed = Boolean(plan.chosenDate && plan.chosenDate !== date);
    const updated = await setPlanChosen(plan.planId, date);

    try {
        await announceOutcome(updated, ctx.cfg, {
            pingAttending: Boolean(pingAttending),
            pingAllInvited: Boolean(pingAllInvited),
            attendingIds: Array.isArray(attendingIds) ? attendingIds : null,
            changed,
            dm: ctx.isTrusted && Boolean(req.body?.dmPeople)
        });
    } catch (err) {
        console.error('[plans] outcome post failed:', err);
    }

    res.json({ ok: true, chosenDate: date, changed });
});

//Nudge the people who have not confirmed, capped at once a day so it cannot be spammed
router.post('/:planId/remind', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    const last = plan.lastRemindedAt ? new Date(plan.lastRemindedAt).getTime() : 0;
    const hoursSince = (Date.now() - last) / 3600000;
    if (hoursSince < 24) {
        return res.status(429).json({ error: `Already nudged recently. You can remind again in ${Math.ceil(24 - hoursSince)} hours.` });
    }

    const pinged = await remindStragglers(plan);
    if (pinged === 0) return res.json({ ok: true, pinged: 0 });

    await setReminded(plan.planId);
    res.json({ ok: true, pinged });
});

//Push the end date out, reopen, and tell everyone to fill in the new days
router.post('/:planId/extend', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    const { newEnd } = req.body || {};
    if (typeof newEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(newEnd)) {
        return res.status(400).json({ error: 'Pick a valid new end date.' });
    }
    if (newEnd <= plan.dateRange.end) return res.status(400).json({ error: 'The new end has to be later than the current one.' });
    if (newEnd > maxEnd()) return res.status(400).json({ error: 'That is more than two years out.' });

    //Cap how often the range can be pushed out, since each one pings everyone
    const limit = limitFor(ctx.isTrusted);
    const rl = await takeAction(req.user.id, plan.guildId, 'extend', limit);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have extended ${limit} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    const updated = await extendPlan(plan.planId, newEnd);

    try {
        await announceExtension(updated, { dm: ctx.isTrusted && Boolean(req.body?.dmPeople) });
    } catch (err) {
        console.error('[plans] extension post failed:', err);
    }

    res.json({ ok: true, end: newEnd });
});

//Scrap a plan: DM everyone, delete the thread, forget the plan
router.post('/:planId/cancel', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    try {
        await cancelPlan(plan);
    } catch (err) {
        console.error('[plans] cancel failed:', err);
        return res.status(500).json({ error: 'Could not cancel the plan.' });
    }

    res.json({ ok: true });
});

export default router;
