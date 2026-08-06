/*
    How freely one person can fire the noisy actions (start a plan, extend it,
    lock a date in) in a server each day. Only people with the planner role can
    do any of this, so the role is the real gate, the daily cap is just a backstop
    against a runaway loop or a slip of the finger. It sits high on purpose, and
    cancelling a plan hands the create slot back, so a group can test freely
    without painting themselves into a corner.
*/

export const DAILY_LIMIT = 30;

/*
    How many people one request may name at once, when starting a plan or adding
    to one. Every id that is not already cached costs a REST call to Discord, so
    without a cap ten thousand ids means ten thousand round trips. Far above any
    real plan, low enough that the worst case is a few hundred lookups.
*/
export const MAX_PARTICIPANTS = 200;

/*
    How many times a day one person can save their availability. Nothing about this
    is noisy, nobody is pinged, so it sits far above what filling a grid in takes: it
    is here because one save is a delete plus up to 730 upserts, and nothing else
    stops a logged in account looping it.
*/
export const SAVE_LIMIT = 200;

/*
    The guild a counter is kept under when the action is not about one. Somebody has
    a single timetable rather than one per server, so every save they make counts
    against the same allowance wherever it came from. A Discord id is always digits,
    so this can never land on a real server's counter.
*/
export const NO_GUILD = 'global';
