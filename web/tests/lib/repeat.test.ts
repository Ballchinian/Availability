import { describe, it, expect } from 'vitest';
import { nextPlanShape } from '../../src/lib/calendar.js';
import { REPEAT_WEEKS, describeRepeat } from '../../src/lib/format.js';

/*
    Both the create form and the compare panel offer exactly this list, and the backend
    refuses anything not on it, so a value only one side knows about would be a plan that
    could be made and then not described.
*/

describe('REPEAT_WEEKS', () => {
    it('is whole weeks, so a repeat lands on the same weekday', () => {
        expect(REPEAT_WEEKS.every((w) => Number.isInteger(w) && w > 0)).toBe(true);
    });

    it('offers every one of them a name', () => {
        for (const weeks of REPEAT_WEEKS) expect(describeRepeat(weeks)).toBeTruthy();
    });
});

describe('describeRepeat', () => {
    it('says the two common ones the way people do', () => {
        expect(describeRepeat(1)).toBe('every week');
        expect(describeRepeat(2)).toBe('every other week');
    });

    it('counts the rest out', () => {
        expect(describeRepeat(4)).toBe('every 4 weeks');
    });

    //A one off has nothing to say, which is what lets the callers drop the phrase entirely
    it('says nothing at all for a plan that does not repeat', () => {
        expect(describeRepeat(null)).toBe('');
        expect(describeRepeat(0)).toBe('');
        expect(describeRepeat()).toBe('');
    });
});

/*
    The dates the repeat panel shows before anything is saved. The maths itself is covered
    against the sweep in backend/tests/bot/repeat.test.js, so what matters here is that the
    site reaches the same function rather than a copy of it that could drift.
*/
describe('the repeat preview', () => {
    it('previews another set day for a plan announced with its day known', () => {
        const shape = nextPlanShape(
            { repeatWeeks: 2, dateRange: { start: '2026-08-06', end: '2026-08-06' }, chosenDate: '2026-08-06', chosenTime: '19:00' },
            '2026-08-08'
        );
        expect(shape).toEqual({
            set: true,
            dateRange: { start: '2026-08-20', end: '2026-08-20' },
            chosen: { date: '2026-08-20', time: '19:00', note: null }
        });
    });

    it('previews a window of the same length for a plan that collected dates', () => {
        const shape = nextPlanShape(
            { repeatWeeks: 1, dateRange: { start: '2026-08-01', end: '2026-08-14' }, chosenDate: '2026-08-10' },
            '2026-08-12'
        );
        expect(shape).toEqual({ set: false, dateRange: { start: '2026-08-15', end: '2026-08-28' }, chosen: null });
    });

    //What the panel says out loud instead of a date, rather than showing one it cannot promise
    it('has nothing to show once the series runs past what the site reaches', () => {
        const far = '2030-01-01';
        expect(nextPlanShape({ repeatWeeks: 1, dateRange: { start: far, end: far }, chosenDate: far }, far)).toBe(null);
    });
});
