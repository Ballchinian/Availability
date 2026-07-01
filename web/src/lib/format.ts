/*
    Dates are stored as YYYY-MM-DD but shown to people as day-month-year, which
    is how everyone here reads a date. One helper so every screen formats the
    same way.
*/
export function formatDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

//Weekday names indexed by getDay(), 0 (Sunday) to 6, for spelling out a plan's allowed days
const WEEKDAY_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
//Week reading order, Monday first, so a list of days comes out the way people say it
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/*
    A plain-English name for which days a plan asks about. The two common shapes get
    their own word, otherwise we list the days out Monday first. Empty or all seven
    means no restriction, so there is nothing to say.
*/
export function describeWeekdays(allowedWeekdays?: number[] | null): string {
    if (!allowedWeekdays || allowedWeekdays.length === 0 || allowedWeekdays.length === 7) return '';
    const set = new Set(allowedWeekdays);
    const key = [...allowedWeekdays].sort((a, b) => a - b).join(',');
    if (key === '0,6') return 'weekends';
    if (key === '1,2,3,4,5') return 'weekdays';
    const names = MONDAY_FIRST.filter((d) => set.has(d)).map((d) => WEEKDAY_LONG[d]);
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

//Turns a stored HH:MM into a friendly 7:30pm style label, blank if there is no time
export function formatTime(t?: string | null): string {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? 'am' : 'pm';
    const base = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${base}${period}` : `${base}:${String(m).padStart(2, '0')}${period}`;
}
