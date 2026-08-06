/*
    Announcements run after the response, never inside it. The write they follow
    is already committed, and dmEach sends one at a time, so a plan of twenty
    would otherwise leave the planner on "Saving..." for twenty round trips and
    a slow Discord would turn that into a timeout. Failure stays non-fatal.
*/
export function announceAfter(label, run) {
    Promise.resolve().then(run).catch((err) => console.error(`[plans] ${label} failed:`, err));
}
