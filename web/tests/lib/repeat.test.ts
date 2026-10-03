import { describe, it, expect } from 'vitest';
import { nextPlanShape, repeatSeries } from '../../src/lib/calendar.js';
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

    it('previews the day a plan that collected dates landed on, a week on', () => {
        const shape = nextPlanShape(
            { repeatWeeks: 1, dateRange: { start: '2026-08-01', end: '2026-08-14' }, chosenDate: '2026-08-10' },
            '2026-08-12'
        );
        expect(shape).toEqual({ set: true, dateRange: { start: '2026-08-17', end: '2026-08-17' }, chosen: { date: '2026-08-17', time: null, note: null } });
    });

    //What the panel says out loud instead of a date, rather than showing one it cannot promise
    it('has nothing to show once the series runs past what the site reaches', () => {
        const far = '2030-01-01';
        expect(nextPlanShape({ repeatWeeks: 1, dateRange: { start: far, end: far }, chosenDate: far }, far)).toBe(null);
    });
});

/*
    The days the calendar draws. Chained through nextPlanShape rather than stepping the
    interval, so a drawn date is one the sweep would make, and the shape of the plan is
    what decides how many turns are worth drawing.
*/
describe('repeatSeries', () => {
    const setPlan = (repeatWeeks: number | null) => ({
        repeatWeeks: repeatWeeks as number,
        dateRange: { start: '2026-08-06', end: '2026-08-06' },
        chosenDate: '2026-08-06',
        chosenTime: '19:00'
    });

    it('walks a set day out a whole interval at a time', () => {
        const dates = repeatSeries(setPlan(2)).map((s) => s.chosen?.date);
        expect(dates).toEqual(['2026-08-20', '2026-09-03', '2026-09-17', '2026-10-01', '2026-10-15', '2026-10-29']);
    });

    it('carries the time onto every turn, since the plan keeps it', () => {
        expect(repeatSeries(setPlan(1)).every((s) => s.chosen?.time === '19:00')).toBe(true);
    });

    it('walks a plan that collected dates out from the day it found, the same as one made with its day', () => {
        const series = repeatSeries({ repeatWeeks: 1, dateRange: { start: '2026-08-01', end: '2026-08-14' }, chosenDate: '2026-08-10' });
        expect(series.map((s) => s.chosen.date)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
    });

    it('has nothing to draw for a plan with no day yet', () => {
        expect(repeatSeries({ repeatWeeks: 1, dateRange: { start: '2026-08-01', end: '2026-08-14' }, chosenDate: null })).toEqual([]);
    });

    it('has nothing to draw for a one off', () => {
        expect(repeatSeries(setPlan(null))).toEqual([]);
    });

    it('stops rather than running past the two years anything here reaches', () => {
        const far = '2030-01-01';
        expect(repeatSeries({ repeatWeeks: 1, dateRange: { start: far, end: far }, chosenDate: far })).toEqual([]);
    });
});
