import { getPlan } from '../db/plans.js';

//The last announcement queued for each plan, dropped once it has run
const queues = new Map();

/*
    Announcements run after the response, never inside it. The write they follow is
    already committed, and what they send is a Discord round trip per person however
    few of them go at once, so a plan of twenty would otherwise leave the planner on
    "Saving..." for the lot and a slow Discord would turn that into a timeout.
    Failure stays non-fatal.

    One plan's announcements run one at a time in the order they were queued, or two
    quick saves interleave their posts and DMs. Each is handed the plan as it stands
    when its turn comes, not as the save saw it. A plan deleted by then gets nothing,
    and a cancelled one gets only its cancel. The queue lives in memory, which holds
    only while this is one process.
*/
export function announceAfter(planId, label, run, { cancel = false } = {}) {
    const turn = (queues.get(planId) || Promise.resolve())
        .then(async () => {
            const plan = await getPlan(planId);
            if (!plan || (plan.status === 'cancelled' && !cancel)) return;
            await run(plan);
        })
        .catch((err) => console.error(`[plans] ${label} failed:`, err));

    queues.set(planId, turn);
    turn.then(() => {
        if (queues.get(planId) === turn) queues.delete(planId);
    });
    return turn;
}
