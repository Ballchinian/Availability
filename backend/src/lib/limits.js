/*
    How freely one person can fire the noisy actions (start a plan, extend it,
    lock a date in) in a server each day. Only people with the planner role can
    do any of this, so the role is the real gate, the daily cap is just a backstop
    against a runaway loop or a slip of the finger. It sits high on purpose, and
    cancelling a plan hands the create slot back, so a group can test freely
    without painting themselves into a corner.
*/

export const DAILY_LIMIT = 30;
