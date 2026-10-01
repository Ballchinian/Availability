/*
    Who runs a plan. One from before hosts carries no list and reads as run by whoever
    made it. An empty list is an answer of its own: everyone who ran it has left the
    server, which is when a planner can take it on.
*/
export function hostIdsOf(plan) {
    if (Array.isArray(plan?.hostIds)) return plan.hostIds;
    return plan?.createdBy ? [plan.createdBy] : [];
}
