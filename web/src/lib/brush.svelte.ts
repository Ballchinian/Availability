import { formatHours } from './hours.js';

/*
    The hours a day gets when it is marked: whatever the clock was last closed on, and
    all day ([], the way a day stores it) until then. Lives only as long as the grid,
    since a brush left over from a last visit would quietly narrow every day marked in
    the next.
*/
export class Brush {
    hours = $state<number[]>([]);

    get allDay() {
        return this.hours.length === 0;
    }

    //Days already marked keep their hours, so a day has to come off and go on again to take these
    mark(selection: Record<string, number[]>, date: string): Record<string, number[]> {
        return date in selection ? selection : { ...selection, [date]: [...this.hours] };
    }

    /*
        A day's clock closing on what it was left at. Closed on no hours at all, the day
        comes off instead, which says nothing about the hours new days want. Answers the
        line to read out, empty when nothing changed.
    */
    closed(stored: number[] | undefined, empty: boolean): string {
        const next = stored ?? [];
        if (empty || (next.length === this.hours.length && next.every((h) => this.hours.includes(h)))) return '';
        this.hours = [...next];
        return this.said();
    }

    reset(): string {
        this.hours = [];
        return this.said();
    }

    said() {
        return `New days get ${formatHours(this.hours)}.`;
    }
}
