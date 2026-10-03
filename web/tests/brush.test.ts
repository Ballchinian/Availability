import { describe, it, expect } from 'vitest';
import { Brush } from '../src/calendar/brush.svelte.js';
import { Press } from '../src/calendar/paint.svelte.js';

/*
    "Free 5pm to 10pm every weekday" used to mean opening the clock on every single day.
    Wired up the way DayGrid wires it: every mark goes through Press's set, and set
    goes through the brush.
*/
const EVENING = [17, 18, 19, 20, 21];
const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

function grid(start: Record<string, number[]> = {}) {
    const brush = new Brush();
    let selection = { ...start };
    const press = new Press({
        isOn: (d: string) => d in selection,
        set: (d: string, on: boolean) => {
            if (on) selection = brush.mark(selection, d);
            else {
                const { [d]: _gone, ...rest } = selection;
                selection = rest;
            }
        },
        between: (a: string, b: string) => week.slice(Math.min(week.indexOf(a), week.indexOf(b)), Math.max(week.indexOf(a), week.indexOf(b)) + 1),
        save: () => selection,
        restore: (saved: Record<string, number[]>) => (selection = saved)
    });
    const drag = (from: number, to: number) => {
        press.down(week[from], { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, shiftKey: false, currentTarget: null, preventDefault: () => {} } as unknown as PointerEvent);
        for (let i = from + 1; i <= to; i++) press.enter(week[i]);
        press.up({ pointerId: 1 } as PointerEvent);
    };
    return { brush, drag, days: () => selection };
}

describe('the brush', () => {
    it('gives new days all day until a clock says otherwise', () => {
        const { brush, drag, days } = grid();
        drag(0, 1);
        expect(days()).toEqual({ [week[0]]: [], [week[1]]: [] });
        expect(brush.allDay).toBe(true);
    });

    it('gives every day dragged across the hours the last clock closed on', () => {
        const { brush, drag, days } = grid({ [week[0]]: EVENING });
        brush.closed(EVENING, false);
        drag(1, 5);
        for (const day of week.slice(1, 6)) expect(days()[day]).toEqual(EVENING);
    });

    it('goes back to all day for the next ones', () => {
        const { brush, drag, days } = grid({ [week[0]]: EVENING });
        brush.closed(EVENING, false);
        drag(1, 2);
        expect(brush.reset()).toBe('New days get all day.');
        drag(3, 4);
        expect(days()[week[2]]).toEqual(EVENING);
        expect(days()[week[3]]).toEqual([]);
    });

    it('leaves days already marked with the hours they had', () => {
        const { brush, drag, days } = grid({ [week[1]]: [9, 10] });
        brush.closed(EVENING, false);
        drag(0, 2);
        expect(days()[week[1]]).toEqual([9, 10]);
        expect(days()[week[2]]).toEqual(EVENING);
    });

    it('gives a day the new hours once it comes off and goes on again', () => {
        const { brush, drag, days } = grid({ [week[1]]: [9, 10] });
        brush.closed(EVENING, false);
        drag(1, 1);
        drag(1, 1);
        expect(days()[week[1]]).toEqual(EVENING);
    });

    //All day is stored as no hours at all, so closing on every hour lit is closing on all day
    it('goes back to all day when a clock closes on all day', () => {
        const { brush } = grid();
        brush.closed(EVENING, false);
        expect(brush.closed([], false)).toBe('New days get all day.');
        expect(brush.allDay).toBe(true);
    });

    //That takes the day off, and says nothing about what new days want
    it('stays put when a clock closes with every hour switched off', () => {
        const { brush } = grid();
        brush.closed(EVENING, false);
        expect(brush.closed([], true)).toBe('');
        expect(brush.hours).toEqual(EVENING);
    });

    it('says what new days get when it changes, and nothing when it does not', () => {
        const { brush } = grid();
        expect(brush.closed(EVENING, false)).toBe('New days get 5pm to 10pm.');
        expect(brush.closed([...EVENING].reverse(), false)).toBe('');
    });

    it('never hands two days the same list', () => {
        const { brush, drag, days } = grid();
        brush.closed(EVENING, false);
        drag(0, 1);
        expect(days()[week[0]]).not.toBe(days()[week[1]]);
    });
});
