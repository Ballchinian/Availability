/*
    Plain calendar date helpers. Everything is a YYYY-MM-DD string so a date is
    just the day, no time zone baggage, and string compare works for ordering.
    A plan can start no earlier than tomorrow and run no more than two years out.
*/

export function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

//Turns a stored YYYY-MM-DD into the day-month-year we show people
export function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

//Turns a stored HH:MM into a friendly 7:30pm style label, blank if there is no time
export function formatTime(t) {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? 'am' : 'pm';
    const base = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${base}${period}` : `${base}:${String(m).padStart(2, '0')}${period}`;
}

export function today() {
    return isoDate(new Date());
}

export function tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return isoDate(d);
}

export function maxEnd() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    return isoDate(d);
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

//The weekday of a YYYY-MM-DD date, 0 (Sunday) through 6 (Saturday), matching JS getDay()
export function weekdayOf(date) {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/*
    Whether a plan lets people mark this date. A plan can be pinned to certain
    weekdays, like weekends only. No list (null or empty) means every day counts,
    which is the default and how every plan behaved before.
*/
export function weekdayAllowed(date, allowedWeekdays) {
    if (!Array.isArray(allowedWeekdays) || allowedWeekdays.length === 0) return true;
    return allowedWeekdays.includes(weekdayOf(date));
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
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
    }
    if (set.size === 0 || set.size === 7) return null;
    return [...set].sort((a, b) => a - b);
}
