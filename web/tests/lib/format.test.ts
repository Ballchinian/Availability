import { describe, it, expect } from 'vitest';
import { formatDate, formatLong, formatTime, describeWeekdays } from '../../src/lib/format.js';

describe('formatDate', () => {
    it('reads a stored date back as day-month-year', () => {
        expect(formatDate('2026-08-05')).toBe('05/08/2026');
    });

    it('is blank when there is no date', () => {
        expect(formatDate('')).toBe('');
    });
});

describe('formatLong', () => {
    it('says the date out loud without a leading zero', () => {
        expect(formatLong('2026-08-05')).toBe('Wednesday 5 August 2026');
        expect(formatLong('2026-12-25')).toBe('Friday 25 December 2026');
    });

    it('is blank when there is no date', () => {
        expect(formatLong('')).toBe('');
    });
});

describe('formatTime', () => {
    it('drops the minutes when there are none', () => {
        expect(formatTime('19:00')).toBe('7pm');
    });

    it('keeps the minutes when there are some', () => {
        expect(formatTime('19:30')).toBe('7:30pm');
    });

    it('reads midnight and noon as 12', () => {
        expect(formatTime('00:00')).toBe('12am');
        expect(formatTime('12:00')).toBe('12pm');
    });

    it('is blank for no time or a bad shape', () => {
        expect(formatTime(null)).toBe('');
        expect(formatTime('9:00')).toBe('');
    });
});

describe('describeWeekdays', () => {
    /*
        The bot's copy in backend/src/lib/dates.js says "every day" here on purpose,
        because it writes into a sentence rather than a chip. Merging the two has to
        keep both wordings.
    */
    it('is blank when there is no real restriction', () => {
        expect(describeWeekdays(null)).toBe('');
        expect(describeWeekdays([])).toBe('');
        expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('');
    });

    it('has a word for the two common shapes', () => {
        expect(describeWeekdays([0, 6])).toBe('weekends');
        expect(describeWeekdays([1, 2, 3, 4, 5])).toBe('weekdays');
    });

    it('names a single day', () => {
        expect(describeWeekdays([3])).toBe('Wednesdays');
    });

    it('lists the rest Monday first', () => {
        expect(describeWeekdays([1, 3])).toBe('Mondays and Wednesdays');
        expect(describeWeekdays([0, 1, 3])).toBe('Mondays, Wednesdays and Sundays');
    });
});
