import { Router } from 'express';
import { client } from '../../bot/client.js';
import { requireUser } from '../../lib/session.js';
import { getGuildConfig } from '../../db/guilds.js';
import { createPlan } from '../../db/plans.js';
import { announcePlan } from '../../bot/plans.js';
import { checkRange } from '../../lib/dates.js';
import { planUrl } from '../../bot/util.js';
import { takeAction } from '../../db/ratelimits.js';
import { DAILY_LIMIT } from '../../lib/limits.js';

/*
    Server scoped routes: who the logged in person is in this server, the member
    list for the people picker, and creating a plan. Only people with the planner
    role can pull the member list or start a plan, matching the rule that the bot
    only listens to planners.
*/

const router = Router();

/*
    Fetching the whole member list is a gateway call (opcode 8) that Discord rate
    limits hard, so we cannot do it on every page load. We hold the list per guild
    for a short while, share a single in-flight fetch when several requests land at
    once, and fall back to whatever the client already has cached if the gateway
    says no. The member picker can live with a list that is up to a minute stale.
*/
const memberCache = new Map();
const memberInFlight = new Map();
const MEMBER_TTL_MS = 60 * 1000;

function shapeMembers(collection) {
    return collection
        .filter((m) => !m.user.bot)
        .map((m) => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            avatarUrl: m.displayAvatarURL({ size: 64 })
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function listMembers(guild) {
    const cached = memberCache.get(guild.id);
    if (cached && Date.now() - cached.at < MEMBER_TTL_MS) return cached.list;
    if (memberInFlight.has(guild.id)) return memberInFlight.get(guild.id);

    const work = (async () => {
        let collection;
        try {
            collection = await guild.members.fetch();
        } catch (err) {
            //Rate limited or otherwise, lean on what the client already knows
            if (guild.members.cache.size > 1) collection = guild.members.cache;
            else throw err;
        }
        const list = shapeMembers(collection);
        memberCache.set(guild.id, { at: Date.now(), list });
        return list;
    })();

    memberInFlight.set(guild.id, work);
    try {
        return await work;
    } finally {
        memberInFlight.delete(guild.id);
    }
}

//Looks up the requester inside the guild and works out what they are allowed to do
async function loadContext(guildId, userId) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { error: 404, message: 'I am not in that server.' };

    const cfg = await getGuildConfig(guildId);
    if (!cfg || !cfg.setupComplete) return { error: 400, message: 'That server has not run /setup yet.' };

    const member = await guild.members.fetch(userId).catch(() => null);
    const isMember = Boolean(member);
    const isPlanner = isMember && member.roles.cache.has(cfg.plannerRoleId);

    return { guild, cfg, member, isMember, isPlanner };
}

//Tells the frontend the server name and whether this person can plan here
router.get('/:guildId', requireUser, async (req, res) => {
    const ctx = await loadContext(req.params.guildId, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    res.json({
        guildId: ctx.cfg.guildId,
        guildName: ctx.cfg.guildName,
        isMember: ctx.isMember,
        isPlanner: ctx.isPlanner
    });
});

router.get('/:guildId/members', requireUser, async (req, res) => {
    const ctx = await loadContext(req.params.guildId, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (!ctx.isPlanner) return res.status(403).json({ error: 'You need the planner role to do that.' });

    try {
        const list = await listMembers(ctx.guild);
        res.json({ members: list });
    } catch (err) {
        console.error('[members] failed:', err);
        res.status(500).json({ error: 'Could not load the member list.' });
    }
});

router.post('/:guildId/plans', requireUser, async (req, res) => {
    const ctx = await loadContext(req.params.guildId, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (!ctx.isPlanner) return res.status(403).json({ error: 'You need the planner role to start a plan.' });

    const { name, description, start, end, participantIds } = req.body || {};

    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Give the plan a name.' });
    if (cleanName.length > 90) return res.status(400).json({ error: 'That name is a bit long, keep it under 90 characters.' });

    const cleanDescription = String(description || '').trim();
    if (!cleanDescription) return res.status(400).json({ error: 'Say a little about what the plan is.' });
    if (cleanDescription.length > 280) return res.status(400).json({ error: 'Keep the description under 280 characters.' });

    const rangeError = checkRange(start, end);
    if (rangeError) return res.status(400).json({ error: rangeError });

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({ error: 'Pick at least one person to invite.' });
    }

    //Only keep ids that are real, non bot members of this server
    const validIds = [];
    for (const id of participantIds) {
        const m = ctx.guild.members.cache.get(id) || (await ctx.guild.members.fetch(id).catch(() => null));
        if (m && !m.user.bot) validIds.push(id);
    }
    if (validIds.length === 0) return res.status(400).json({ error: 'None of those people are in the server.' });

    //A high daily backstop, since the planner role is the real gate on who can do this
    const rl = await takeAction(req.user.id, req.params.guildId, 'create', DAILY_LIMIT);
    if (!rl.allowed) {
        return res.status(429).json({ error: `You have started your ${DAILY_LIMIT} plans for today. Try again in ${rl.retryAfterHours} hours.` });
    }

    try {
        const plan = await createPlan({
            guildId: req.params.guildId,
            name: cleanName,
            description: cleanDescription,
            createdBy: req.user.id,
            dateRange: { start, end },
            participantIds: validIds
        });

        //Open the thread, ping and DM everyone. If this stumbles, the plan still exists.
        try {
            await announcePlan(plan, ctx.cfg, ctx.member.displayName);
        } catch (err) {
            console.error('[plans] announce failed:', err);
        }

        const dropped = participantIds.length - validIds.length;
        res.json({ planId: plan.planId, url: planUrl(plan.planId), invited: validIds.length, dropped });
    } catch (err) {
        console.error('[plans] create failed:', err);
        res.status(500).json({ error: 'Could not create the plan.' });
    }
});

export default router;
