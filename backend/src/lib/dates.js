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
