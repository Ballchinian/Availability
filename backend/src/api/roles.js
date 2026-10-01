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
