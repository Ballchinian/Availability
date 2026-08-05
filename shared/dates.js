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
