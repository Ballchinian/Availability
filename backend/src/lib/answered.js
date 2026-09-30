import { shiftDate, cleanWeekdays } from './dates.js';

/*
    The windows of days a person has answered, kept on their user record so a save on
    one plan answers every other plan over the same days. See shared/coverage.js for
    how they are read.
*/

export const MAX_WINDOWS = 50;

const sameWeekdays = (a, b) => String(a.allowedWeekdays) === String(b.allowedWeekdays);
const touching = (a, b) => a.start <= shiftDate(b.end, 1) && b.start <= shiftDate(a.end, 1);

/*
    The list with one more window in it. Windows asking about the same weekdays that
    overlap or sit end to end become one, so saving the same plan twice changes
    nothing. Anything that ended before today goes. The window just saved goes last,
    and the cap drops from the front, so it is never the one lost.
*/
export function mergeAnswered(list, window, today) {
    const kept = [];
    let merged = null;
    if (window?.start && window?.end && window.start <= window.end) {
        merged = { start: window.start, end: window.end, allowedWeekdays: cleanWeekdays(window.allowedWeekdays) };
    }

    for (const w of list || []) {
        if (w.end < today) continue;
        const other = { start: w.start, end: w.end, allowedWeekdays: cleanWeekdays(w.allowedWeekdays) };
        if (merged && sameWeekdays(other, merged) && touching(other, merged)) {
            merged.start = other.start < merged.start ? other.start : merged.start;
            merged.end = other.end > merged.end ? other.end : merged.end;
        } else {
            kept.push(other);
        }
    }

    if (merged && merged.end >= today) kept.push(merged);
    return kept.slice(-MAX_WINDOWS);
}

/*
    Adds windows to one person's list without losing a save landing at the same moment:
    the write only goes through while the list is still the one read, and reads again
    when it is not. Makes the record for someone who has only ever used /free, since
    their answers count as much as anyone's.
*/
export async function saveAnswered(users, userId, windows, today) {
    for (let tries = 0; tries < 3; tries++) {
        const row = await users.findOne({ userId }, { projection: { _id: 0, answered: 1 } });
        const had = row?.answered ?? null;
        const next = windows.reduce((list, w) => mergeAnswered(list, w, today), had || []);
        if (JSON.stringify(had || []) === JSON.stringify(next)) return next;

        const res = row
            ? await users.updateOne({ userId, answered: had }, { $set: { answered: next } })
            : await users.updateOne({ userId }, { $setOnInsert: { answered: next } }, { upsert: true });
        if (res.modifiedCount || res.upsertedCount) return next;
    }
    return null;
}
