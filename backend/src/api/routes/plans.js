import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getPlan, confirmParticipant, setPlanChosen, voidPlanChoice, setReminded, setPlanRange, setPlanWeekdays, addParticipant, setPlanDetails } from '../../db/plans.js';
import { getGuildConfig } from '../../db/guilds.js';
import { getAvailabilityInRange, replaceAvailabilityInRange, getAvailabilitySummary } from '../../db/availability.js';
import { announceOutcome, remindStragglers, announceRangeChange, announceWeekdaysChange, cancelPlan, leavePlan, announceAddition, announceVoid, notifyCreatorIfAllIn, applyDetailsEdit } from '../../bot/plans.js';
import { today, maxEnd, weekdayAllowed, allowedDaysInRange, cleanWeekdays, describeWeekdays } from '../../lib/dates.js';
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
            allowedWeekdays: plan.allowedWeekdays || null,
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
    const allowed = plan.allowedWeekdays || null;
    //Keep only well formed days that sit inside this plan's range and on a day it asks about
    const valid = days.filter(
        (d) => d && typeof d.date === 'string' && d.date >= start && d.date <= end && weekdayAllowed(d.date, allowed)
    );

    //A weekday-pinned plan only rewrites the days it asks about, so a person's saved
    //availability on the other days (from other plans) is left untouched
    const onlyDates = allowed ? allowedDaysInRange(start, end, allowed) : null;
    await replaceAvailabilityInRange(req.user.id, start, end, valid, onlyDates);
    const updated = await confirmParticipant(plan.planId, req.user.id);

    //No thread post here on purpose, a confirmation is quiet, the planner sees it on the compare page.
    //If that was the last person though, the planner gets a DM nudging them to compare.
    try {
        await notifyCreatorIfAllIn(updated);
    } catch (err) {
        console.error('[plans] all-in notify failed:', err);
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
            confirmed: p.confirmed,
            //The confirmation vote, so the planner can watch who is in without leaning on DMs
            vote: p.vote || null,
            voteReason: p.voteReason || null
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
            allowedWeekdays: plan.allowedWeekdays || null,
            status: plan.status,
            chosenDate: plan.chosenDate,
            chosenTime: plan.chosenTime || null,
            chosenNote: plan.chosenNote || null,
            probeActive: Boolean(plan.probeActive)
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

    const { date, time, note, pingAttending, pingAllInvited, attendingIds, post, dm, probe } = req.body || {};
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

    //If a date was already set and this is a different one, it is a reorganise
    const changed = Boolean(plan.chosenDate && plan.chosenDate !== date);
    const updated = await setPlanChosen(plan.planId, date, cleanTime, cleanNote);

    try {
        await announceOutcome(updated, ctx.cfg, {
            pingAttending: Boolean(pingAttending),
            pingAllInvited: Boolean(pingAllInvited),
            attendingIds: Array.isArray(attendingIds) ? attendingIds : null,
            changed,
            actorName: ctx.member.displayName,
            post: post !== false,
            dm: dm !== false,
            probe: probe === true
        });
    } catch (err) {
        console.error('[plans] outcome post failed:', err);
    }

    res.json({ ok: true, chosenDate: date, chosenTime: cleanTime, chosenNote: cleanNote, changed });
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

    try {
        await announceVoid(updated, ctx.cfg, ctx.member.displayName, reason, { dm: req.body?.dm !== false });
    } catch (err) {
        console.error('[plans] void announce failed:', err);
    }

    res.json({ ok: true });
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

    try {
        await announceRangeChange(updated, ctx.cfg, { actorName: ctx.member.displayName, note: cleanNote, post: post !== false, dm: dm !== false });
    } catch (err) {
        console.error('[plans] range post failed:', err);
    }

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
    //A null set means every day, so spell both sides out as full weekday sets to compare
    const currentSet = new Set(plan.allowedWeekdays || [0, 1, 2, 3, 4, 5, 6]);
    const nextSet = new Set(weekdays || [0, 1, 2, 3, 4, 5, 6]);

    //Nothing to do if it lands on the same set the plan already has
    if (currentSet.size === nextSet.size && [...nextSet].every((d) => currentSet.has(d))) {
        return res.status(400).json({ error: 'Those are already the days this plan asks about.' });
    }

    /*
        Only make everyone confirm again when the change opens a day they have not been
        asked about, a pure addition or a swap that brings a new day in. Taking days away
        never needs a fresh round, so we do not waste anyone's time on it.
    */
    const opensADay = [...nextSet].some((d) => !currentSet.has(d));

    const cleanNote = String(note || '').trim().slice(0, 200) || null;

    //A high daily backstop, since changing the days pings and DMs everyone like a range change
    const rl = await takeAction(req.user.id, plan.guildId, 'weekdays', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have changed the days ${DAILY_LIMIT} times today. Try again in ${rl.retryAfterHours} hours.` });
    }

    const updated = await setPlanWeekdays(plan.planId, weekdays, { reopen: opensADay });

    try {
        await announceWeekdaysChange(updated, ctx.cfg, {
            actorName: ctx.member.displayName,
            daysLabel: describeWeekdays(weekdays),
            reopened: opensADay,
            note: cleanNote,
            post: post !== false,
            dm: dm !== false
        });
    } catch (err) {
        console.error('[plans] weekdays post failed:', err);
    }

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

    try {
        await cancelPlan(plan, ctx.member.displayName, { post: req.body?.post !== false, dm: req.body?.dm !== false });
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

    const { userIds, dm } = req.body || {};
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
        await announceAddition(updated, toAdd, ctx.member.displayName, { dm: dm !== false });
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
