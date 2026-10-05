import { announceAfter } from '../../announce.js';
import { readPlanForm } from '../../planForm.js';
import { getPlan, addPlanEvent, planEdit, applyPlanEdit } from '../../../db/plans/index.js';
import { getPlanningPrefs } from '../../../db/users.js';
import { announceEdit } from '../../../bot/plans/index.js';
import { buildEditMessages } from '../../../bot/edits.js';
import { todayIn } from '../../../lib/zones.js';
import { inOf, owedAcross } from '../../../lib/coverage.js';
import { diffPlan, whoHears, kindOf } from '../../../../../shared/planDiff.js';
import { takeAction, refundAction } from '../../../db/ratelimits.js';
import { EDIT_LIMIT, PLAN_ANNOUNCE_LIMIT } from '../../../lib/limits.js';
import { realMembers, namesFor } from '../../../lib/members.js';
import { hostIdsOf } from '../../../lib/hosts.js';
import { requireHost, byOf, refuseFinished } from './gates.js';

const NEEDS_PLANNER = 'You need the planner role to make a plan come round again.';

//Why an edit is out of date: someone changed the plan after the form opened, the reader included, in another tab
function staleEdit(plan, userId) {
    const by = plan?.revBy;
    if (by?.id === userId) return 'You changed this plan somewhere else while this was open. Reload to see it as it is now.';
    return `${by?.name || 'Someone'} changed this plan while you were editing. Reload to see their changes.`;
}

//Everyone an edit's changes name, for looking up once
function idsIn(changes) {
    return changes.flatMap((c) => c.ids || [...(c.added || []), ...(c.removed || [])]);
}

//The changes with names where they had ids, which is how the review shows them and the history keeps them
function named(changes, names) {
    const name = (id) => names[id] || 'Someone who left';
    return changes.map((c) => {
        if (c.type === 'added' || c.type === 'removed') return { type: c.type, names: c.ids.map(name) };
        if (c.type === 'hosts') return { type: 'hosts', added: c.added.map(name), removed: c.removed.map(name) };
        return c;
    });
}

//Both caps a save counts against, the person's and the plan's. The line to show when either is spent, or null.
async function spendEdit(userId, plan) {
    const mine = await takeAction(userId, plan.guildId, 'edit', EDIT_LIMIT);
    if (!mine.allowed) return `You have saved ${EDIT_LIMIT} edits today. Try again in ${mine.retryAfterHours} hours.`;
    const its = await takeAction(plan.planId, plan.guildId, 'edit', PLAN_ANNOUNCE_LIMIT);
    if (its.allowed) return null;
    await refundAction(userId, plan.guildId, 'edit');
    return `This plan has been changed ${PLAN_ANNOUNCE_LIMIT} times today. Try again in ${its.retryAfterHours} hours.`;
}

/*
    What a save would do, for the review step: the changes, how many of the people the
    plan waits on have already answered and how many it will ask, every message loud
    with who gets it, and who would still hear if it went quietly.
*/
async function previewEdit(ctx, before, after, changes, prefs, actorName) {
    const owed = owedAcross(before, after, prefs);
    const heard = whoHears(before, after, { owed });
    const quietly = whoHears(before, after, { quiet: true, owed });
    const messages = buildEditMessages(before, after, changes, { actorName, guildName: ctx.cfg.guildName, heard });
    const names = await namesFor(ctx.guild, [...idsIn(changes), ...heard.map((h) => h.userId), ...quietly.map((h) => h.userId)]);
    const name = (id) => names[id] || 'Someone who left';

    const waiting = after.participants.filter((p) => inOf(p) !== false && !(kindOf(after) === 'set' && p.invited === false));
    const asked = waiting.filter((p) => owed[p.userId]?.after).length;
    return {
        preview: true,
        changes: named(changes, names),
        settled: waiting.length - asked,
        asked,
        messages: messages.map((m) => ({ ...m, to: m.to === 'thread' ? 'thread' : m.to.map(name) })),
        quietly: quietly.map((h) => ({ name: name(h.userId), why: h.why }))
    };
}

//The edit form's review and save
export function editRoutes(router) {
    /*
        The edit form's save: the whole plan as it should be, and the rev the form opened on.
        A plan changed since is refused with who changed it, before anything is written, so
        two people editing at once cannot quietly undo each other. preview writes nothing and
        answers with what would change and who would hear what, built by the functions the
        save sends with.

        quiet posts nothing, and DMs only the people whoHears names for it: anyone whose yes
        or no the change took away, or who owed nothing before and owes something now. The
        card everyone else holds is rewritten where it sits.

        Turning a repeat on, or changing how often, takes the planner role, and only whoever
        made the plan can take them off running it. Anyone listed as running it who has left
        the server comes off without that counting as a change.
    */
    router.post('/:planId/edit', requireHost, refuseFinished, async (req, res) => {
        const { plan, ctx } = req;
        const { rev, preview = false } = req.body || {};
        const quiet = req.body?.quiet === true;
        if (rev !== (plan.rev || 0)) return res.status(409).json({ error: staleEdit(plan, req.user.id) });

        const read = readPlanForm(req.body, { today: todayIn(plan.timeZone), plan });
        if (read.error) return res.status(400).json({ error: read.error });
        const { form } = read;
        if (form.repeatWeeks && form.repeatWeeks !== (plan.repeatWeeks || null) && !ctx.isPlanner) {
            return res.status(403).json({ error: NEEDS_PLANNER });
        }

        //Only names the plan has never had are asked of Discord. Everyone already on it stays exactly as they are.
        const wanted = new Set(form.participantIds);
        const on = plan.participants.map((p) => p.userId);
        const joining = await realMembers(ctx.guild, [...wanted].filter((id) => !on.includes(id)));
        const coming = [...on.filter((id) => wanted.has(id)), ...joining];
        if (!coming.length) return res.status(400).json({ error: 'None of those people are in the server.' });

        const listed = hostIdsOf(plan);
        const here = await realMembers(ctx.guild, listed);
        if (here.includes(plan.createdBy) && plan.createdBy !== req.user.id && !form.hostIds.includes(plan.createdBy)) {
            return res.status(403).json({ error: 'Only whoever made this plan can stop running it.' });
        }
        //Whoever saves always runs it, the same as whoever makes a plan
        const staying = here.filter((id) => id === req.user.id || form.hostIds.includes(id));
        const hostIds = [...staying, ...(await realMembers(ctx.guild, form.hostIds.filter((id) => !listed.includes(id))))];

        const before = { ...plan, hostIds: here };
        const edit = planEdit(before, { ...form, participantIds: coming, hostIds }, byOf(req));
        const changes = diffPlan(before, edit.plan);
        if (!changes.length) return res.status(400).json({ error: 'Nothing has changed yet.' });

        const prefs = await getPlanningPrefs([...new Set([...on, ...joining])]);
        const actorName = ctx.member.displayName;
        if (preview) return res.json(await previewEdit(ctx, before, edit.plan, changes, prefs, actorName));

        const spent = await spendEdit(req.user.id, plan);
        if (spent) return res.status(429).json({ error: spent });

        const saved = await applyPlanEdit(plan, edit, byOf(req));
        if (!saved) {
            await refundAction(req.user.id, plan.guildId, 'edit');
            await refundAction(plan.planId, plan.guildId, 'edit');
            return res.status(409).json({ error: staleEdit(await getPlan(plan.planId), req.user.id) });
        }

        //Read back rather than taken from planEdit, so what is announced is what was written
        const after = { ...saved, hostIds: hostIdsOf(saved) };
        const done = diffPlan(before, after);
        const owed = owedAcross(before, after, prefs);
        const heard = whoHears(before, after, { quiet, owed });
        const owing = after.participants.map((p) => p.userId).filter((id) => owed[id]?.after);
        await addPlanEvent(plan.planId, { type: 'edited', by: req.user.id, byName: actorName, changes: named(done, await namesFor(ctx.guild, idsIn(done))), quiet });

        announceAfter(plan.planId, 'edit', (current) => announceEdit(current, ctx.cfg, { before, changes: done, actorName, quiet, heard, owing }));

        res.json({ ok: true, quiet });
    });
}
