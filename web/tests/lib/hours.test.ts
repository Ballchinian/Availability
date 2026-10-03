import { describe, it, expect } from 'vitest';
import { DAY_HOURS, HOUR_COUNT, hourLabel, hoursOf, formatHours, storedHours, withHour } from '../../src/lib/hours.js';

describe('hourLabel', () => {
    it('reads midnight and noon as 12', () => {
        expect(hourLabel(0)).toBe('12am');
        expect(hourLabel(12)).toBe('12pm');
    });

    it('reads the rest of the clock', () => {
        expect(hourLabel(8)).toBe('8am');
        expect(hourLabel(11)).toBe('11am');
        expect(hourLabel(13)).toBe('1pm');
        expect(hourLabel(23)).toBe('11pm');
    });
});

describe('hoursOf', () => {
    it('treats nothing picked as the whole day', () => {
        expect(hoursOf()).toEqual(DAY_HOURS);
        expect(hoursOf([])).toEqual(DAY_HOURS);
    });

    it('leaves a real pick alone', () => {
        expect(hoursOf([8, 9])).toEqual([8, 9]);
    });
});

describe('formatHours', () => {
    it('says all day for nothing picked or everything picked', () => {
        expect(formatHours()).toBe('all day');
        expect(formatHours([])).toBe('all day');
        expect(formatHours([...DAY_HOURS])).toBe('all day');
    });

    it('ends a run on the hour after the last one picked', () => {
        expect(formatHours([8])).toBe('8am to 9am');
        expect(formatHours([8, 9, 10])).toBe('8am to 11am');
    });

    it('splits a gap into two runs', () => {
        expect(formatHours([8, 9, 10, 13, 14, 15])).toBe('8am to 11am, 1pm to 4pm');
    });

    it('keeps a run going across midnight', () => {
        expect(formatHours([22, 23, 0, 1])).toBe('10pm to 2am');
    });

    it('sorts into the evening order rather than by number', () => {
        expect(formatHours([1, 0, 23])).toBe('11pm to 2am');
    });

    /*
        4am is the far end of the day and 5am the near end, so they sit at opposite
        ends of the order and must not join up into one run.
    */
    it('does not wrap the end of the day back round to the start', () => {
        expect(formatHours([4, 5])).toBe('5am to 6am, 4am to 5am');
    });

    //The two the wider window is for: a morning that used to be unsayable, and a
    //night that now runs past 2am without breaking in half
    it('takes an early morning', () => {
        expect(formatHours([6, 7, 8])).toBe('6am to 9am');
    });

    it('keeps a late night going to the small hours', () => {
        expect(formatHours([22, 23, 0, 1, 2, 3])).toBe('10pm to 4am');
    });

    it('drops anything that is not an hour of the day', () => {
        expect(formatHours([99, 8, 9])).toBe('8am to 10am');
    });
});

describe('storedHours', () => {
    it('stores every hour kept as all day', () => {
        expect(storedHours(DAY_HOURS)).toEqual([]);
    });

    it('stores part of a day as it is', () => {
        expect(storedHours([17, 18])).toEqual([17, 18]);
    });
});

describe('withHour', () => {
    it('takes one hour off a day free all day', () => {
        const left = withHour(hoursOf([]), 17, false);
        expect(left).toHaveLength(HOUR_COUNT - 1);
        expect(left).not.toContain(17);
    });

    it('keeps display order whatever order the hours came in', () => {
        expect(withHour([1, 22, 5], 23, true)).toEqual([5, 22, 23, 1]);
    });

    it('leaves nothing once the last hour goes', () => {
        expect(withHour([9], 9, false)).toEqual([]);
    });
});
