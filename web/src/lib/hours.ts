/*
    The sociable hours a plan cares about: 8am right through to 2am the next
    morning, kept in display order so the picker reads left to right and the wrap
    past midnight stays in the right place. A free day with no specific hours
    means the whole window, so that is what hoursOf falls back to.
*/
export const SOCIABLE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2];
export const HOUR_COUNT = SOCIABLE_HOURS.length;

//Turns a 24h number into a friendly label, 0 is 12am, 12 is 12pm, 23 is 11pm
export function hourLabel(h: number): string {
    const period = h < 12 ? 'am' : 'pm';
    const base = h % 12 === 0 ? 12 : h % 12;
    return `${base}${period}`;
}

//A free day with an empty hours list counts as free the whole window
export function hoursOf(hours?: number[]): number[] {
    return hours && hours.length ? hours : SOCIABLE_HOURS;
}

//Groups a set of hours into readable runs, e.g. "8am to 11am, 1pm to 3pm"
export function formatHours(hours?: number[]): string {
    if (!hours || !hours.length || hours.length === HOUR_COUNT) return 'all evening';

    //Sort the picked hours into the canonical evening order so runs read left to right
    const sorted = [...hours]
        .filter((h) => SOCIABLE_HOURS.includes(h))
        .sort((a, b) => SOCIABLE_HOURS.indexOf(a) - SOCIABLE_HOURS.indexOf(b));

    const runs: [number, number][] = [];
    let runStart = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        const h = sorted[i];
        if (SOCIABLE_HOURS.indexOf(h) === SOCIABLE_HOURS.indexOf(prev) + 1) {
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
