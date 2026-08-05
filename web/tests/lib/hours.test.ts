import { describe, it, expect } from 'vitest';
import { SOCIABLE_HOURS, hourLabel, hoursOf, formatHours } from '../../src/lib/hours.js';

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
    it('treats nothing picked as the whole window', () => {
        expect(hoursOf()).toEqual(SOCIABLE_HOURS);
        expect(hoursOf([])).toEqual(SOCIABLE_HOURS);
    });

    it('leaves a real pick alone', () => {
        expect(hoursOf([8, 9])).toEqual([8, 9]);
    });
});

describe('formatHours', () => {
    it('says all day for nothing picked or everything picked', () => {
        expect(formatHours()).toBe('all day');
        expect(formatHours([])).toBe('all day');
        expect(formatHours([...SOCIABLE_HOURS])).toBe('all day');
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
        2am is the far end of the window and 8am the near end, so they sit at
        opposite ends of the order and must not join up into one run.
    */
    it('does not wrap the end of the window back round to the start', () => {
        expect(formatHours([2, 8])).toBe('8am to 9am, 2am to 3am');
    });

    it('drops hours outside the window', () => {
        expect(formatHours([5, 8, 9])).toBe('8am to 10am');
    });
});
