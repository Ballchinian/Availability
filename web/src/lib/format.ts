import { MONTHS, weekdayOf } from './calendar.js';

/*
    How a date reads on screen. The three the bot says out loud too come from
    shared/dates.js, so the DM and the page cannot word the same date differently,
    and the rest are here because only the site has anywhere to put them.
*/
export { formatDate, formatTime, describeWeekdays, REPEAT_WEEKS, describeRepeat } from '../../../shared/dates.js';

//Weekday names indexed by getDay(), the singular form the long date reads out
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/*
    A date said out loud, "Wednesday 5 August 2026". For the accessible name on a
    calendar cell, whose visible text is a bare day number that means nothing on
    its own.
*/
export function formatLong(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${WEEKDAY_NAMES[weekdayOf(iso)]} ${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
