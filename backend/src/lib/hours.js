/*
    Every hour of the day, in the order the picker lays them out: 5am right through to
    4am the next morning, so the wrap past midnight sits inside the list and a late
    night stays one unbroken run rather than splitting at 12.

    5am is the seam because it is the one hour nothing spans. A night out running to 4am
    and a hike starting at 6am both come out contiguous either side of it, and anything
    that covers the seam itself is free all day, which is stored as nothing at all.

    The same list lives in web/src/lib/hours.ts for the picker, so a change to the window
    or the order has to be made on both sides or they disagree about what a day can hold.

    Nothing outside this list is ever stored. packHours in bot/plans.js shifts by the
    hour number, which silently breaks above 31, so staying inside 0 to 23 matters.
*/
export const DAY_HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4];

const ALLOWED = new Set(DAY_HOURS);

/*
    Whether an hours list is one we are willing to store: missing or empty (free the
    whole day), otherwise real hours of the day with no repeats. Strict about the type
    too, so a string "8" is refused rather than quietly stored.
*/
export function validHours(hours) {
    if (hours === undefined || hours === null) return true;
    if (!Array.isArray(hours)) return false;
    if (hours.length > DAY_HOURS.length) return false;

    const seen = new Set();
    for (const h of hours) {
        if (!ALLOWED.has(h) || seen.has(h)) return false;
        seen.add(h);
    }
    return true;
}
