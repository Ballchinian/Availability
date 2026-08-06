/*
    Announcements run after the response, never inside it. The write they follow is
    already committed, and what they send is a Discord round trip per person however
    few of them go at once, so a plan of twenty would otherwise leave the planner on
    "Saving..." for the lot and a slow Discord would turn that into a timeout.
    Failure stays non-fatal.
*/
export function announceAfter(label, run) {
    Promise.resolve().then(run).catch((err) => console.error(`[plans] ${label} failed:`, err));
}
