import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getPlan, confirmParticipant, setPlanChosen, setReminded, extendPlan, addParticipant } from '../../db/plans.js';
import { getGuildConfig } from '../../db/guilds.js';
import { getAvailabilityInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { announceOutcome, remindStragglers, announceExtension, cancelPlan, leavePlan, announceAddition } from '../../bot/plans.js';
import { maxEnd } from '../../lib/dates.js';
import { takeAction } from '../../db/ratelimits.js';
import { DAILY_LIMIT } from '../../lib/limits.js';

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

    return { cfg, guild, member };
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
            description: plan.description || '',
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
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { days } = req.body || {};
    if (!Array.isArray(days)) return res.status(400).json({ error: 'Something was off with the dates you sent.' });

    const { start, end } = plan.dateRange;
    //Keep only well formed days that sit inside this plan's range
    const valid = days.filter((d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end);

    await replaceAvailabilityInRange(req.user.id, start, end, valid);
    const updated = await confirmParticipant(plan.planId, req.user.id);

    //No thread post here on purpose, a confirmation is quiet, the planner sees it on the compare page

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
            description: plan.description || '',
            guildId: plan.guildId,
            guildName: ctx.cfg.guildName,
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            status: plan.status,
            chosenDate: plan.chosenDate
        },
        participants,
        confirmedCount: confirmed.length,
        totalParticipants: plan.participants.length,
        freeByDate
    });
});

//Lock in the winning date, close the plan, and announce it
router.post('/:planId/choose', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { date, pingAttending, pingAllInvited, attendingIds } = req.body || {};
    if (typeof date !== 'string' || date < plan.dateRange.start || date > plan.dateRange.end) {
        return res.status(400).json({ error: 'Pick a date inside the plan range.' });
    }

    //A high daily backstop on locking in or moving a date, since it pings and DMs everyone
    const rl = await takeAction(req.user.id, plan.guildId, 'choose', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have set a date ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
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
            actorName: ctx.member.displayName
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
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const last = plan.lastRemindedAt ? new Date(plan.lastRemindedAt).getTime() : 0;
    const hoursSince = (Date.now() - last) / 3600000;
    if (hoursSince < 24) {
        return res.status(429).json({ error: `Already nudged recently. You can remind again in ${Math.ceil(24 - hoursSince)} hours.` });
    }

    const pinged = await remindStragglers(plan, ctx.member.displayName);
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
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { newEnd } = req.body || {};
    if (typeof newEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(newEnd)) {
        return res.status(400).json({ error: 'Pick a valid new end date.' });
    }
    if (newEnd <= plan.dateRange.end) return res.status(400).json({ error: 'The new end has to be later than the current one.' });
    if (newEnd > maxEnd()) return res.status(400).json({ error: 'That is more than two years out.' });

    //A high daily backstop on pushing the range out, since each one pings and DMs everyone
    const rl = await takeAction(req.user.id, plan.guildId, 'extend', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have extended ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    const updated = await extendPlan(plan.planId, newEnd);

    try {
        await announceExtension(updated, ctx.cfg, { actorName: ctx.member.displayName });
    } catch (err) {
        console.error('[plans] extension post failed:', err);
    }

    res.json({ ok: true, end: newEnd });
});

//Cancel a plan: mark it cancelled, ping and DM everyone, leave the thread to be deleted by hand
router.post('/:planId/cancel', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    //Already cancelled, do not tell everyone twice
    if (plan.status === 'cancelled') return res.json({ ok: true });

    try {
        await cancelPlan(plan, ctx.member.displayName);
    } catch (err) {
        console.error('[plans] cancel failed:', err);
        return res.status(500).json({ error: 'Could not cancel the plan.' });
    }

    res.json({ ok: true });
});

//Pull extra people into a running plan. Planner only, same gate as the rest.
router.post('/:planId/add', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const ctx = await plannerContext(plan, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (plan.status === 'cancelled') return res.status(409).json({ error: 'This plan was cancelled.' });

    const { userIds } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'Pick at least one person to add.' });
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

    let updated = plan;
    for (const id of toAdd) updated = await addParticipant(plan.planId, id);

    try {
        await announceAddition(updated, toAdd, ctx.member.displayName);
    } catch (err) {
        console.error('[plans] add announce failed:', err);
    }

    res.json({ ok: true, added: toAdd.length });
});

//Drop yourself out of a plan you were invited to, the website side of the DM button
router.post('/:planId/leave', requireUser, async (req, res) => {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });

    const me = plan.participants.find((p) => p.userId === req.user.id);
    if (!me) return res.status(403).json({ error: 'You are not part of this plan.' });

    try {
        await leavePlan(plan, req.user.id);
    } catch (err) {
        console.error('[plans] leave failed:', err);
        return res.status(500).json({ error: 'Could not drop you out of the plan.' });
    }

    res.json({ ok: true });
});

export default router;
