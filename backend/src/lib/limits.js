/*
    How freely one person can fire the noisy actions (start a plan, extend it,
    lock a date in) in a server each day. A planner gets a small allowance so a
    group cannot be blasted, the trusted role a much larger one and the choice to
    DM people. The numbers live here so create, choose and extend all agree.
*/

export const PLANNER_LIMIT = 2;
export const TRUSTED_LIMIT = 10;

//Daily allowance for one person, given whether they hold the trusted role
export function limitFor(isTrusted) {
    return isTrusted ? TRUSTED_LIMIT : PLANNER_LIMIT;
}
