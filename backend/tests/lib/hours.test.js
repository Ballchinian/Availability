import { describe, it, expect } from 'vitest';
import { DAY_HOURS, validHours } from '../../src/lib/hours.js';

describe('DAY_HOURS', () => {
    it('covers the whole clock exactly once', () => {
        expect(DAY_HOURS).toHaveLength(24);
        expect([...DAY_HOURS].sort((a, b) => a - b)).toEqual([...Array(24).keys()]);
    });

    //Both sides lay the picker out from this, so a difference would mean the site and
    //the validator disagree about what a day holds
    it('matches the order the picker uses', () => {
        expect(DAY_HOURS[0]).toBe(5);
        expect(DAY_HOURS[23]).toBe(4);
    });

    //packHours in bot/plans.js shifts by the hour number and breaks silently above 31
    it('stays inside what a bitmask can carry', () => {
        expect(Math.max(...DAY_HOURS)).toBeLessThan(31);
    });
});

describe('validHours', () => {
    it('lets an absent or empty list through, which means free all day', () => {
        expect(validHours(undefined)).toBe(true);
        expect(validHours(null)).toBe(true);
        expect(validHours([])).toBe(true);
    });

    it('takes any real hours of the day', () => {
        expect(validHours([8, 9, 10])).toBe(true);
        expect(validHours([22, 23, 0, 1])).toBe(true);
        expect(validHours([...DAY_HOURS])).toBe(true);
    });

    //The point of 8.7: an early morning and the small hours used to be refused
    it('takes the hours the old window would not', () => {
        expect(validHours([5, 6, 7])).toBe(true);
        expect(validHours([3, 4])).toBe(true);
    });

    it('refuses anything off the clock', () => {
        expect(validHours([24])).toBe(false);
        expect(validHours([-1])).toBe(false);
        expect(validHours([1.5])).toBe(false);
    });

    //Number() would read a string, null and [] as an hour, so the check is on the type
    it('refuses a value that only looks like an hour', () => {
        expect(validHours(['8'])).toBe(false);
        expect(validHours([null])).toBe(false);
        expect(validHours([[]])).toBe(false);
    });

    it('refuses repeats and anything that is not a list', () => {
        expect(validHours([8, 8])).toBe(false);
        expect(validHours('8')).toBe(false);
        expect(validHours({ 0: 8 })).toBe(false);
    });

    //A body naming more hours than exist is junk whatever the values are
    it('refuses a list longer than a day', () => {
        expect(validHours([...DAY_HOURS, 8])).toBe(false);
    });
});
