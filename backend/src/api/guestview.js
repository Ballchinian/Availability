/*
    What a guest's overview leaves out. Whoever runs a plan sees all of it. A guest sees
    where each person stands and nothing a host works from: no reasons, no calls made on
    the board, nothing about anyone's DMs or how old their calendar is.
*/

//One person as a guest sees them. A host's call on the board reads as their answer, since it decides their column.
export function forGuest(p) {
    return {
        ...p,
        inReason: null,
        vote: p.override || p.vote || null,
        voteReason: null,
        override: null,
        coveredUntil: null,
        updatedAt: null,
        dmsClosed: false,
        sentBack: null
    };
}

//The only reason a history line carries is why a day was called off
export function historyForGuest(history) {
    return history.map(({ reason: _reason, ...event }) => event);
}

/*
    Everyone's free days with the names taken off, for a guest on a plan made before
    guests could see each other's days: people on those answered expecting only the
    planner to see. How many and which hours stay, who does not. Each day is put in
    order of its hours, so where someone sits in the list gives nothing away either.
*/
export function nameless(freeByDate) {
    const out = {};
    for (const [date, free] of Object.entries(freeByDate)) {
        out[date] = free
            .map((f) => f.hours || [])
            .sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()))
            .map((hours, i) => ({ userId: `free${i}`, hours }));
    }
    return out;
}

/*
    How many of the people in have not answered each day, for that same guest, who is
    sent no names to count from. toFill is each person's days still to answer. Someone
    free on a day counts as free on it, the way the site counts them.
*/
export function unansweredCounts(toFill, freeByDate) {
    const counts = {};
    for (const [userId, days] of Object.entries(toFill)) {
        for (const d of days) {
            if ((freeByDate[d] || []).some((f) => f.userId === userId)) continue;
            counts[d] = (counts[d] || 0) + 1;
        }
    }
    return counts;
}
