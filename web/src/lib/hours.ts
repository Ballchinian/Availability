/*
    Every hour of the day, in display order so the picker reads left to right: 5am
    right through to 4am the next morning, which puts the wrap past midnight inside
    the list where a late night stays one unbroken run rather than splitting at 12.

    5am is the seam because it is the one hour nothing spans. A night out running to
    4am and a hike starting at 6am both come out contiguous either side of it, and
    anything covering the seam itself is free all day, which hoursOf handles instead.

    backend/src/lib/hours.js holds the same list to validate what gets saved. Change
    the order here and change it there too.
*/
export const DAY_HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4];
export const HOUR_COUNT = DAY_HOURS.length;

//Turns a 24h number into a friendly label, 0 is 12am, 12 is 12pm, 23 is 11pm
export function hourLabel(h: number): string {
    const period = h < 12 ? 'am' : 'pm';
    const base = h % 12 === 0 ? 12 : h % 12;
    return `${base}${period}`;
}

//A free day with an empty hours list counts as free the whole day
export function hoursOf(hours?: number[]): number[] {
    return hours && hours.length ? hours : DAY_HOURS;
}

//Groups a set of hours into readable runs, e.g. "8am to 11am, 1pm to 3pm"
export function formatHours(hours?: number[]): string {
    if (!hours || !hours.length || hours.length === HOUR_COUNT) return 'all day';

    //Sort the picked hours into the canonical evening order so runs read left to right
    const sorted = [...hours]
        .filter((h) => DAY_HOURS.includes(h))
        .sort((a, b) => DAY_HOURS.indexOf(a) - DAY_HOURS.indexOf(b));

    const runs: [number, number][] = [];
    let runStart = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        const h = sorted[i];
        if (DAY_HOURS.indexOf(h) === DAY_HOURS.indexOf(prev) + 1) {
            prev = h;
        } else {
            runs.push([runStart, prev]);
            runStart = h;
            prev = h;
        }
    }
    runs.push([runStart, prev]);

    return runs.map(([a, b]) => `${hourLabel(a)} to ${hourLabel((b + 1) % 24)}`).join(', ');
}
