/*
    The date helpers both sides have to agree on. Everything here turns a stored
    value into words a person reads, or answers a question about a date, so a
    change to how a date reads only has to be made once and the bot's DMs and the
    site's screens cannot drift apart in front of the same user.

    Plain ESM .js with no imports on purpose: node runs it straight out of the
    backend, vite bundles it into the site, and neither one needs a build step or
    the other's tooling to read it. dates.d.ts next door is what the typescript
    side reads, so a signature changed here has to be changed there too.

    The package.json next to it holds nothing but "type": "module", and has to be
    there: backend/package.json only covers files under backend/, so without it
    node reads this as commonjs and the service dies on boot with an import error
    that neither vitest nor the vite build will show you.

    Anything that only one side needs stays on that side: backend/src/lib/dates.js
    holds the range and validation half, web/src/lib/calendar.ts the grid layout.
*/

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

/*
    The weekday of a YYYY-MM-DD date, 0 (Sunday) through 6 (Saturday), matching
    getDay(). Read in UTC so a zone that moves its clocks at midnight cannot land
    the date on the day before.
*/
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

//Weekday names indexed by getDay(), 0 (Sunday) to 6, for spelling out a plan's days
const WEEKDAY_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
//Week reading order, Monday first, so a list of days comes out the way people say it
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/*
    A plain-English name for which days a plan asks about. The two common shapes
    get their own word, otherwise the days are listed Monday first. No restriction
    is where the two sides part: the bot writes it into a sentence and wants "every
    day", the site puts it in a line of its own and wants nothing at all, so the
    caller says which.
*/
export function describeWeekdays(allowedWeekdays, everyDay = '') {
    if (!Array.isArray(allowedWeekdays) || allowedWeekdays.length === 0 || allowedWeekdays.length === 7) {
        return everyDay;
    }
    const set = new Set(allowedWeekdays);
    const key = [...allowedWeekdays].sort((a, b) => a - b).join(',');
    if (key === '0,6') return 'weekends';
    if (key === '1,2,3,4,5') return 'weekdays';
    const names = MONDAY_FIRST.filter((d) => set.has(d)).map((d) => WEEKDAY_LONG[d]);
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/*
    How often a plan can be set to come round again, in whole weeks. Weeks and not months
    because shifting a date by a multiple of seven lands on the same weekday, so "every
    other Thursday" stays on Thursdays and a plan pinned to weekends stays on weekends,
    with nothing to work out. Four weeks is as close to monthly as that honestly gets.

    Here rather than in either lib/limits.js or the create form because both ends validate
    against it and a list that only one side agreed to would let a plan be made that the
    other cannot describe.
*/
export const REPEAT_WEEKS = [1, 2, 4];

//How a repeat reads in a sentence, since nobody says "every 1 weeks"
export function describeRepeat(weeks) {
    if (!weeks) return '';
    if (weeks === 1) return 'every week';
    if (weeks === 2) return 'every other week';
    return `every ${weeks} weeks`;
}

export function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return isoDate(d);
}

//Nothing here goes further out than this, repeats included
export function maxEnd() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    return isoDate(d);
}

/*
    The day a number of days either side of this one. Walked in UTC so a zone that
    moves its clocks at midnight cannot land it on the wrong date, which is the same
    reason weekdayOf reads that way.
*/
export function shiftDate(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

//How many days from one date to another, negative if the second is the earlier one
export function daysBetween(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/*
    How many intervals forward we are willing to skip to find a date that has not already
    gone. Only reached when the service was off for a long time, and the point of a cap is
    that a plan stale by years should stop rather than quietly reappear.
*/
const MAX_SKIPS = 200;

/*
    The next date in the series that has not already passed. Normally one interval on,
    but a service that was off for a month has to catch up, and the right answer there is
    one plan on the next date still to come, not four plans for days nobody can attend.
*/
export function nextInSeries(date, weeks, notBefore) {
    let next = shiftDate(date, weeks * 7);
    for (let skipped = 0; next < notBefore && skipped < MAX_SKIPS; skipped++) {
        next = shiftDate(next, weeks * 7);
    }
    return next < notBefore ? null : next;
}

/*
    What the next plan in the series looks like. A plan announced with its day already
    decided (a range of one day) comes back as another of those on the next date. A plan
    that collected availability comes back as another window of the same length, shifted
    the same way, so it asks about the same stretch of the same weekdays.

    Null when the series has run out of road: too stale to catch up, or the next window
    would land past the two years everything else here is bounded by.

    Shared because the compare page shows a planner the dates before they turn a repeat
    on, and a preview worked out any other way would be a promise the sweep might not keep.
*/
export function nextPlanShape(plan, from = tomorrow()) {
    const weeks = plan.repeatWeeks;
    const wasSet = plan.dateRange.start === plan.dateRange.end;

    if (wasSet) {
        const date = nextInSeries(plan.chosenDate, weeks, from);
        if (!date || date > maxEnd()) return null;
        return { set: true, dateRange: { start: date, end: date }, chosen: { date, time: plan.chosenTime || null, note: plan.chosenNote || null } };
    }

    const span = daysBetween(plan.dateRange.start, plan.dateRange.end);
    const start = nextInSeries(plan.dateRange.start, weeks, from);
    if (!start) return null;
    const end = shiftDate(start, span);
    if (end > maxEnd()) return null;
    return { set: false, dateRange: { start, end }, chosen: null };
}
