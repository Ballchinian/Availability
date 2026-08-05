/*
    The sociable hours a plan cares about: 8am right through to 2am the next
    morning, kept in display order so the wrap past midnight stays in the right
    place. The same list lives in web/src/lib/hours.ts for the picker, so a change
    to the window has to be made on both sides or they disagree about what a day
    can hold.

    Nothing outside this list is ever stored. packHours in bot/plans.js shifts by
    the hour number, which silently breaks above 31, and the overlap maths on the
    site assumes every hour it sees is one of these.
*/
export const SOCIABLE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2];

const ALLOWED = new Set(SOCIABLE_HOURS);

/*
    Whether an hours list is one we are willing to store: missing or empty (free
    the whole window), otherwise real sociable hours with no repeats. Strict about
    the type too, so a string "8" is refused rather than quietly stored.
*/
export function validHours(hours) {
    if (hours === undefined || hours === null) return true;
    if (!Array.isArray(hours)) return false;
    if (hours.length > SOCIABLE_HOURS.length) return false;

    const seen = new Set();
    for (const h of hours) {
        if (!ALLOWED.has(h) || seen.has(h)) return false;
        seen.add(h);
    }
    return true;
}
