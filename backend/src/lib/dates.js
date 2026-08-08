import { describeWeekdays as describeDays, weekdayAllowed, isoDate, tomorrow, maxEnd } from '../../../shared/dates.js';

/*
    Plain calendar date helpers. Everything is a YYYY-MM-DD string so a date is
    just the day, no time zone baggage, and string compare works for ordering.
    A plan can start no earlier than tomorrow and run no more than two years out.

    The half the site says out loud too lives in shared/dates.js and is passed
    straight back through here, so every import inside backend/ still comes from
    this one file.
*/

export {
    formatDate, formatTime, weekdayOf, weekdayAllowed, REPEAT_WEEKS, describeRepeat,
    isoDate, tomorrow, maxEnd, shiftDate, daysBetween, nextInSeries, nextPlanShape
} from '../../../shared/dates.js';

//The bot writes the days into a sentence, so no restriction has to read as something
export function describeWeekdays(allowedWeekdays) {
    return describeDays(allowedWeekdays, 'every day');
}

export function today() {
    return isoDate(new Date());
}

//Returns an error string if the range is no good, or null if it is fine
export function checkRange(start, end) {
    const shape = /^\d{4}-\d{2}-\d{2}$/;
    if (!shape.test(start) || !shape.test(end)) return 'Pick a valid start and end date.';
    if (start < tomorrow()) return 'The start date has to be tomorrow or later.';
    if (end > maxEnd()) return 'The end date cannot be more than two years away.';
    if (start > end) return 'The start date is after the end date.';
    return null;
}

//Every day from start to end, inclusive, as YYYY-MM-DD strings
export function eachDay(start, end) {
    const days = [];
    const d = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    while (d <= last) {
        days.push(isoDate(d));
        d.setDate(d.getDate() + 1);
    }
    return days;
}

//The days in a range that fall on one of the allowed weekdays, as YYYY-MM-DD strings
export function allowedDaysInRange(start, end, allowedWeekdays) {
    return eachDay(start, end).filter((d) => weekdayAllowed(d, allowedWeekdays));
}

/*
    Tidy a weekday restriction coming off the wire into a sorted list of 0-6, or
    null when there is no real restriction. An empty pick, junk, or every day
    selected all collapse to null, so the plan just asks for the whole range.
*/
export function cleanWeekdays(input) {
    if (!Array.isArray(input)) return null;
    const set = new Set();
    for (const v of input) {
        //Number() reads null, '' and [] as 0, which would quietly pin the plan to Sundays
        if (typeof v !== 'number' && typeof v !== 'string') continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
    }
    if (set.size === 0 || set.size === 7) return null;
    return [...set].sort((a, b) => a - b);
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/*
    What changing a plan's weekdays from one set to another means. Both sides come
    in as cleanWeekdays output, so null is every day and has to be spelled out
    before they can be compared. Only a change that opens a day nobody has been
    asked about needs a fresh round of answers: taking days away never does, so it
    does not waste anyone's time.
*/
export function weekdayChange(current, next) {
    const currentSet = new Set(current || EVERY_DAY);
    const nextSet = new Set(next || EVERY_DAY);
    const same = currentSet.size === nextSet.size && [...nextSet].every((d) => currentSet.has(d));
    return { same, opensADay: [...nextSet].some((d) => !currentSet.has(d)) };
}
