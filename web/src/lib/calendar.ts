/*
    Shared calendar layout. Turns a start and end date into a list of months,
    each with weekday aligned cells. A cell is null for the blank padding before
    the first of the month, otherwise it carries the day number, the iso date,
    and whether that date sits inside the plan range. Both the availability grid
    and the compare grid build off this.
*/

export const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export interface Cell {
    day: number;       // day of the month, 1 to 31
    date: string;      // the iso date, YYYY-MM-DD
    inRange: boolean;  // whether the date sits inside the plan range
}

export interface Month {
    year: number;
    month: number;           // zero-based month index, 0 to 11
    label: string;           // the month's name, like "June"
    cells: (Cell | null)[];  // weekday-aligned cells, null for leading padding
    inRangeCount: number;    // how many cells fall inside the plan range
}

function iso(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

//A Date as the YYYY-MM-DD string everything else is stored and compared in, in local time
export function isoOf(d: Date): string {
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

/*
    A date some way off from today, for the min and max of a date input. Stepping
    a month off the 31st lands in the month after, which is close enough for the
    rough windows these bound.
*/
export function isoFromNow(amount: number, unit: 'day' | 'month' | 'year'): string {
    const d = new Date();
    if (unit === 'day') d.setDate(d.getDate() + amount);
    if (unit === 'month') d.setMonth(d.getMonth() + amount);
    if (unit === 'year') d.setFullYear(d.getFullYear() + amount);
    return isoOf(d);
}

//The day after a YYYY-MM-DD date. setDate carries the month and the year for us
export function nextDay(date: string): string {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return isoOf(d);
}

//Whole days between a stored timestamp and now, for deciding something has gone stale
export function daysSince(ts: string): number {
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

/*
    Which weekday a date is, and whether a plan asks about it. Both come from
    shared/dates.js so the bot and the grid pin a plan to the same days, and
    weekdayAllowed keeps its site name here since that is what the screens read as.
*/
export { weekdayOf, weekdayAllowed as isWeekdayAllowed } from '../../../shared/dates.js';

//Days in a range, or just the ones on the allowed weekdays when the plan is pinned
export function countDays(start: string, end: string, allowedWeekdays?: number[] | null): number {
    const a = new Date(`${start}T00:00:00`);
    const b = new Date(`${end}T00:00:00`);
    const span = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
    if (span < 1) return 0;
    if (!allowedWeekdays || allowedWeekdays.length === 0) return span;

    //Step a day at a time with setDate so daylight saving cannot drift the weekday
    let n = 0;
    const d = new Date(a);
    for (let i = 0; i < span; i++) {
        if (allowedWeekdays.includes(d.getDay())) n++;
        d.setDate(d.getDate() + 1);
    }
    return n;
}

export function buildMonths(start: string, end: string): Month[] {
    if (!start || !end) return [];
    const out: Month[] = [];
    const startD = new Date(`${start}T00:00:00`);
    const endD = new Date(`${end}T00:00:00`);
    let y = startD.getFullYear();
    let m = startD.getMonth();

    while (y < endD.getFullYear() || (y === endD.getFullYear() && m <= endD.getMonth())) {
        out.push(buildMonth(y, m, start, end));
        m += 1;
        if (m > 11) {
            m = 0;
            y += 1;
        }
    }
    return out;
}

function buildMonth(year: number, month: number, start: string, end: string): Month {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = new Date(year, month, 1).getDay();
    const cells: (Cell | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);

    let inRangeCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const date = iso(year, month, d);
        const inRange = date >= start && date <= end;
        if (inRange) inRangeCount += 1;
        cells.push({ day: d, date, inRange });
    }
    return { year, month, label: MONTHS[month], cells, inRangeCount };
}
