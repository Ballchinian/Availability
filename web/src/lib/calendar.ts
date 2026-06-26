/*
    Shared calendar layout. Turns a start and end date into a list of months,
    each with weekday aligned cells. A cell is null for the blank padding before
    the first of the month, otherwise it carries the day number, the iso date,
    and whether that date sits inside the plan range. Both the availability grid
    and the compare grid build off this.
*/

export const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTHS = [
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
