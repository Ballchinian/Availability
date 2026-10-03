import { describe, it, expect } from 'vitest';
import { DAY_HOURS, validHours } from '../../src/lib/hours.js';

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
