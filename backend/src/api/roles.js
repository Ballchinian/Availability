import { hostIdsOf } from '../lib/hosts.js';

/*
    Where someone stands on one plan. A host can change anything on it and needs no
    planner role, a guest is on its list, and someone who is both reads as a host.
    Null is nobody to this plan, whatever role they hold in the server.
*/
export function planRole(plan, userId) {
    if (hostIdsOf(plan).includes(userId)) return 'host';
    return plan.participants.some((p) => p.userId === userId) ? 'guest' : null;
}

/*
    Take it on, which makes someone a host. A planner can once nobody who runs the plan
    is still in the server. Manage Server always can, which is the way in on a plan
    being misused.

    here is the hosts still in the server, asked of Discord rather than read off the
    plan: one who left while the bot was down is still on its list. ctx is what
    guildContext hands back.
*/
export function canTakeOn(plan, userId, ctx, here) {
    if (!ctx.isMember || hostIdsOf(plan).includes(userId)) return false;
    return ctx.canManage || (ctx.isPlanner && here.length === 0);
}
