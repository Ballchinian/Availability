import { describe, it, expect } from 'vitest';
import { nextInSeries, nextPlanShape, weekdayOf, maxEnd } from '../../src/lib/dates.js';

/*
    The dates here are fixed rather than relative to today, and every call passes its own
    notBefore, so nothing in this file changes meaning as time goes on. 2026-08-06 is a
    Thursday, which is what "every other Thursday" is checked against.
*/

const setPlan = {
    dateRange: { start: '2026-08-06', end: '2026-08-06' },
    chosenDate: '2026-08-06',
    chosenTime: '19:00',
    chosenNote: 'my place',
    repeatWeeks: 2
};

const collectPlan = {
    dateRange: { start: '2026-08-01', end: '2026-08-14' },
    chosenDate: '2026-08-06',
    chosenTime: null,
    chosenNote: null,
    repeatWeeks: 4
};

describe('nextInSeries', () => {
    it('steps one interval on when that is already enough', () => {
        expect(nextInSeries('2026-08-06', 1, '2026-08-07')).toBe('2026-08-13');
        expect(nextInSeries('2026-08-06', 2, '2026-08-07')).toBe('2026-08-20');
        expect(nextInSeries('2026-08-06', 4, '2026-08-07')).toBe('2026-09-03');
    });

    /*
        The catching up case, which is a service that was off rather than anything a person
        did. One plan on the next date still to come, not one for every date that was missed.
    */
    it('skips past the dates that already went', () => {
        expect(nextInSeries('2026-01-01', 2, '2026-08-07')).toBe('2026-08-13');
        expect(nextInSeries('2026-01-01', 1, '2026-08-07')).toBe('2026-08-13');
    });

    it('stays on the beat while it skips', () => {
        const from = '2026-01-01';
        const landed = nextInSeries(from, 2, '2026-08-07');
        const days = Math.round((Date.parse(landed) - Date.parse(from)) / 86400000);
        expect(days % 14).toBe(0);
    });

    //A plan stale by years should stop rather than quietly reappear years later
    it('gives up rather than counting forever', () => {
        expect(nextInSeries('2020-01-01', 1, '2026-08-07')).toBe(null);
    });

    it('takes a date that is exactly the earliest allowed', () => {
        expect(nextInSeries('2026-08-06', 1, '2026-08-13')).toBe('2026-08-13');
    });
});

describe('nextPlanShape', () => {
    it('turns a set plan into another set plan on the next date', () => {
        expect(nextPlanShape(setPlan, '2026-08-07')).toEqual({
            set: true,
            dateRange: { start: '2026-08-20', end: '2026-08-20' },
            chosen: { date: '2026-08-20', time: '19:00', note: 'my place' }
        });
    });

    it('carries a collecting plan forward as a window of the same length', () => {
        const next = nextPlanShape(collectPlan, '2026-08-07');
        expect(next).toEqual({ set: false, dateRange: { start: '2026-08-29', end: '2026-09-11' }, chosen: null });
        expect(next.chosen).toBe(null);
    });

    //The whole reason intervals are whole weeks: a plan pinned to weekends stays on weekends
    it('lands on the same weekdays it started on', () => {
        const next = nextPlanShape(collectPlan, '2026-08-07');
        expect(weekdayOf(next.dateRange.start)).toBe(weekdayOf(collectPlan.dateRange.start));
        expect(weekdayOf(next.dateRange.end)).toBe(weekdayOf(collectPlan.dateRange.end));
    });

    it('keeps every other Thursday on Thursdays', () => {
        let date = setPlan.chosenDate;
        for (let round = 0; round < 6; round++) {
            date = nextPlanShape({ ...setPlan, dateRange: { start: date, end: date }, chosenDate: date }, date).chosen.date;
            expect(weekdayOf(date)).toBe(weekdayOf(setPlan.chosenDate));
        }
    });

    it('drops the note and time a set plan never had', () => {
        const bare = { ...setPlan, chosenTime: null, chosenNote: null };
        expect(nextPlanShape(bare, '2026-08-07').chosen).toEqual({ date: '2026-08-20', time: null, note: null });
    });

    /*
        Over the cap on skips, which at every other week is about eight years. Under it the
        plan does catch up, which is the point: a fortnightly plan left since 2019 is stale,
        not broken.
    */
    it('stops when the series is too far gone to catch up', () => {
        const stale = (from) => nextPlanShape({ ...setPlan, chosenDate: from, dateRange: { start: from, end: from } }, '2026-08-07');
        expect(stale('2019-01-01')).not.toBe(null);
        expect(stale('2015-01-01')).toBe(null);
    });

    //Everything else here is bounded at two years out, and a repeat is not the way past that
    it('will not put a plan past the two year limit', () => {
        const far = maxEnd();
        expect(nextPlanShape({ ...setPlan, chosenDate: far, dateRange: { start: far, end: far } }, far)).toBe(null);
    });

    it('does not let a long window run past the limit either', () => {
        const far = maxEnd();
        const wide = { dateRange: { start: far, end: far }, chosenDate: far, chosenTime: null, chosenNote: null, repeatWeeks: 1 };
        expect(nextPlanShape(wide, far)).toBe(null);
    });
});
