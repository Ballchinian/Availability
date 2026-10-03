import { guildContext } from '../../context.js';
import { planRole } from '../../roles.js';
import { formatDate } from '../../../lib/dates.js';
import { dayHasPassed } from '../../../lib/zones.js';
import { isPracticeId } from '../../../lib/practice.js';

//Who can do what to a plan, checked before a route runs

//A practice plan is there for the planner it is for and their made-up people, who see nothing else
export function hiddenFrom(plan, req) {
    if (isPracticeId(req.user.id)) return plan.practice !== req.realUser.id;
    return Boolean(plan.practice) && plan.practice !== req.user.id;
}

/*
    For whoever runs the plan, planner role or not, and always about the plan's own
    server. What it leaves on req is the guild, its config and the member, which is
    where the routes past it get the actor's name and the clock the plan runs on.
*/
export async function requireHost(req, res, next) {
    const ctx = await guildContext(req.plan.guildId, req.user.id);
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (!ctx.isMember) return res.status(403).json({ error: 'You are not in that server.' });
    if (planRole(req.plan, req.user.id) !== 'host') {
        return res.status(403).json({ error: 'Only whoever runs this plan can do that.' });
    }
    req.ctx = ctx;
    next();
}

//Whoever is making a change, for a form opened before it to name. See db/plans/rev.js.
export const byOf = (req) => ({ id: req.user.id, name: req.ctx.member.displayName });

//Starting another plan like this one is starting a plan, so it takes the planner role as well as being on this one
export async function requirePlanner(req, res, next) {
    const ctx = await guildContext(req.plan.guildId, req.user.id, { requirePlanner: true });
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
    if (!planRole(req.plan, req.user.id)) return res.status(403).json({ error: 'You are not on this plan.' });
    req.ctx = ctx;
    next();
}

/*
    Nothing about a plan that is over can be changed: one called off, or one whose day
    has been on its server's clock. Without the second, a host with no planner role
    could send an old plan back out for dates and have started a new one. The routes
    that go without it are the ones worth noticing: the overview still reads one back,
    repair still corrects its DMs, and saving availability checks the guest list first
    and keeps the refusal in the handler, so a stranger is turned away before being told
    anything about the plan.
*/
export function refuseFinished(req, res, next) {
    const over = finished(req.plan);
    if (over) return res.status(409).json({ error: over });
    next();
}

//Why a plan is over, or null while it is still live
export function finished(plan) {
    if (plan.status === 'cancelled') return 'This plan was called off.';
    if (dayHasPassed(plan)) return `This plan was on ${formatDate(plan.chosenDate)}, so nothing about it can change now.`;
    return null;
}
