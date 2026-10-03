import { describe, it, expect } from 'vitest';
import { repeatSeries } from '../src/calendar/calendar.js';
import { describeRepeat } from '../src/site/format.js';

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
