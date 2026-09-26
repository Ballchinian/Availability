import { describe, it, expect } from 'vitest';
import {
    isoDate,
    formatDay,
    formatDate,
    formatTime,
    checkRange,
    eachDay,
    weekdayOf,
    weekdayAllowed,
    allowedDaysInRange,
    describeWeekdays,
    cleanWeekdays,
    weekdayChange,
    readTime
} from '../../src/lib/dates.js';

//Days from today as a YYYY-MM-DD string, for the range checks that read the clock
function isoIn(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return isoDate(d);
}

describe('isoDate', () => {
    it('pads the month and the day', () => {
        expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(isoDate(new Date(2026, 11, 25))).toBe('2026-12-25');
    });
});

describe('formatDay', () => {
    it('reads as a day someone can recognise', () => {
        expect(formatDay('2026-08-12')).toBe('Wed 12 Aug');
        expect(formatDay('2026-01-01')).toBe('Thu 1 Jan');
        expect(formatDay('2026-12-31')).toBe('Thu 31 Dec');
    });

    it('drops the leading zero a stored date carries', () => {
        expect(formatDay('2026-08-05')).toBe('Wed 5 Aug');
    });

    //Every /free option label is one of these, and Discord caps those at 100 characters
    it('stays well inside what an option can hold', () => {
        expect(formatDay('2026-09-30').length).toBeLessThanOrEqual(100);
    });

    it('is blank when there is no date', () => {
        expect(formatDay('')).toBe('');
        expect(formatDay(null)).toBe('');
    });
});

describe('formatDate', () => {
    it('reads a stored date back with its weekday, month name and year', () => {
        expect(formatDate('2026-08-05')).toBe('Wed 5 Aug 2026');
        expect(formatDate('2027-01-01')).toBe('Fri 1 Jan 2027');
    });

    it('is blank when there is no date', () => {
        expect(formatDate('')).toBe('');
        expect(formatDate(null)).toBe('');
    });
});

describe('formatTime', () => {
    it('drops the minutes when there are none', () => {
        expect(formatTime('19:00')).toBe('7pm');
    });

    it('keeps the minutes when there are some', () => {
        expect(formatTime('19:30')).toBe('7:30pm');
        expect(formatTime('08:05')).toBe('8:05am');
    });

    it('reads midnight and noon as 12', () => {
        expect(formatTime('00:00')).toBe('12am');
        expect(formatTime('12:00')).toBe('12pm');
        expect(formatTime('00:30')).toBe('12:30am');
    });

    it('is blank for no time or a bad shape', () => {
        expect(formatTime(null)).toBe('');
        expect(formatTime('')).toBe('');
        expect(formatTime('9:00')).toBe('');
        expect(formatTime('tonight')).toBe('');
    });
});

describe('checkRange', () => {
    it('passes a normal range', () => {
        expect(checkRange(isoIn(1), isoIn(14))).toBeNull();
    });

    it('rejects anything that is not a date', () => {
        expect(checkRange('2026-8-5', isoIn(14))).toBe('Pick a valid start and end date.');
        expect(checkRange(isoIn(1), 'soon')).toBe('Pick a valid start and end date.');
    });

    it('rejects a start of today or earlier', () => {
        expect(checkRange(isoIn(0), isoIn(14))).toBe('The start date has to be tomorrow or later.');
        expect(checkRange(isoIn(-1), isoIn(14))).toBe('The start date has to be tomorrow or later.');
    });

    it('rejects an end more than two years out', () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 2);
        d.setDate(d.getDate() + 2);
        expect(checkRange(isoIn(1), isoDate(d))).toBe('The end date cannot be more than two years away.');
    });

    it('rejects a range that runs backwards', () => {
        expect(checkRange(isoIn(10), isoIn(2))).toBe('The start date is after the end date.');
    });

    it('allows a single day range', () => {
        expect(checkRange(isoIn(1), isoIn(1))).toBeNull();
    });
});

describe('eachDay', () => {
    it('includes both ends', () => {
        expect(eachDay('2026-08-05', '2026-08-08')).toEqual([
            '2026-08-05',
            '2026-08-06',
            '2026-08-07',
            '2026-08-08'
        ]);
    });

    it('is one day for a range that starts and ends together', () => {
        expect(eachDay('2026-08-05', '2026-08-05')).toEqual(['2026-08-05']);
    });

    it('is empty for a range that runs backwards', () => {
        expect(eachDay('2026-08-08', '2026-08-05')).toEqual([]);
    });

    it('crosses the end of a month', () => {
        expect(eachDay('2026-08-30', '2026-09-02')).toEqual([
            '2026-08-30',
            '2026-08-31',
            '2026-09-01',
            '2026-09-02'
        ]);
    });

    it('counts the leap day', () => {
        expect(eachDay('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    });

    //Stepping by whole days rather than 24 hours, so the clocks going forward does not skip one
    it('does not lose a day to a clock change', () => {
        expect(eachDay('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    });
});

describe('weekdayOf', () => {
    it('numbers the week from Sunday', () => {
        expect(weekdayOf('2026-08-09')).toBe(0);
        expect(weekdayOf('2026-08-03')).toBe(1);
        expect(weekdayOf('2026-08-05')).toBe(3);
        expect(weekdayOf('2026-08-08')).toBe(6);
    });
});

describe('weekdayAllowed', () => {
    it('allows everything when there is no restriction', () => {
        expect(weekdayAllowed('2026-08-05', null)).toBe(true);
        expect(weekdayAllowed('2026-08-05', [])).toBe(true);
        expect(weekdayAllowed('2026-08-05', undefined)).toBe(true);
    });

    it('checks the date against the list', () => {
        expect(weekdayAllowed('2026-08-05', [3])).toBe(true);
        expect(weekdayAllowed('2026-08-05', [0, 6])).toBe(false);
        expect(weekdayAllowed('2026-08-08', [0, 6])).toBe(true);
    });
});

describe('allowedDaysInRange', () => {
    it('keeps only the days the plan asks about', () => {
        expect(allowedDaysInRange('2026-08-03', '2026-08-09', [0, 6])).toEqual(['2026-08-08', '2026-08-09']);
    });

    it('keeps the whole range when there is no restriction', () => {
        expect(allowedDaysInRange('2026-08-03', '2026-08-09', null)).toHaveLength(7);
    });

    it('is empty when no day in the range qualifies', () => {
        expect(allowedDaysInRange('2026-08-03', '2026-08-05', [0, 6])).toEqual([]);
    });
});

describe('describeWeekdays', () => {
    /*
        The site's copy in web/src/lib/format.ts returns a blank string here on
        purpose, because it renders into a chip rather than a sentence. Merging the
        two has to keep both wordings.
    */
    it('says every day when there is no real restriction', () => {
        expect(describeWeekdays(null)).toBe('every day');
        expect(describeWeekdays([])).toBe('every day');
        expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
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
        expect(describeWeekdays([6, 2])).toBe('Tuesdays and Saturdays');
    });
});

describe('cleanWeekdays', () => {
    it('is null when there is no real restriction', () => {
        expect(cleanWeekdays(null)).toBeNull();
        expect(cleanWeekdays(undefined)).toBeNull();
        expect(cleanWeekdays('weekends')).toBeNull();
        expect(cleanWeekdays([])).toBeNull();
        expect(cleanWeekdays([0, 1, 2, 3, 4, 5, 6])).toBeNull();
    });

    it('takes numbers off the wire as strings', () => {
        expect(cleanWeekdays(['1', '5'])).toEqual([1, 5]);
    });

    it('drops anything that is not a weekday', () => {
        expect(cleanWeekdays(['x', 9, -1, 2.5, null, 2])).toEqual([2]);
    });

    it('does not read a blank or an object as Sunday', () => {
        expect(cleanWeekdays([null])).toBeNull();
        expect(cleanWeekdays([''])).toBeNull();
        expect(cleanWeekdays(['  '])).toBeNull();
        expect(cleanWeekdays([[]])).toBeNull();
        expect(cleanWeekdays([false])).toBeNull();
        expect(cleanWeekdays([{}])).toBeNull();
    });

    it('still takes a real Sunday', () => {
        expect(cleanWeekdays([0, 6])).toEqual([0, 6]);
        expect(cleanWeekdays(['0'])).toEqual([0]);
    });

    it('sorts and dedupes', () => {
        expect(cleanWeekdays([5, 1, 1, '5'])).toEqual([1, 5]);
    });
});

describe('weekdayChange', () => {
    it('spots the same set whatever order it arrives in', () => {
        expect(weekdayChange([1, 3], [3, 1]).same).toBe(true);
        expect(weekdayChange([1, 3], [1, 3]).opensADay).toBe(false);
    });

    //A plan with no restriction and one pinned to all seven days ask about the same days
    it('reads null and every weekday as the same set', () => {
        expect(weekdayChange(null, [0, 1, 2, 3, 4, 5, 6]).same).toBe(true);
        expect(weekdayChange([0, 1, 2, 3, 4, 5, 6], null).same).toBe(true);
        expect(weekdayChange(null, null).same).toBe(true);
    });

    it('opens a day when the change adds one', () => {
        expect(weekdayChange([1], [1, 3])).toEqual({ same: false, opensADay: true });
    });

    it('opens a day when the change swaps one out for another', () => {
        expect(weekdayChange([1], [3])).toEqual({ same: false, opensADay: true });
    });

    it('does not open a day when the change only takes days away', () => {
        expect(weekdayChange([1, 3, 5], [3])).toEqual({ same: false, opensADay: false });
        expect(weekdayChange(null, [0, 6])).toEqual({ same: false, opensADay: false });
    });

    //Dropping the restriction opens every day the plan was not already asking about
    it('opens days when the restriction is lifted', () => {
        expect(weekdayChange([0, 6], null)).toEqual({ same: false, opensADay: true });
    });
});

describe('readTime', () => {
    it('takes any time on a 24 hour clock', () => {
        expect(readTime('00:00')).toBe('00:00');
        expect(readTime('23:59')).toBe('23:59');
    });

    it('has nothing to say when no time was given', () => {
        expect(readTime(null)).toBe(null);
        expect(readTime(undefined)).toBe(null);
        expect(readTime('')).toBe(null);
    });

    it('refuses what only looks like a time', () => {
        for (const bad of ['25:99', '24:00', '19:60', '7:00', '19:00:00', 'soon', 1900]) {
            expect([bad, readTime(bad)]).toEqual([bad, false]);
        }
    });
});

describe('checkRange on a server clock', () => {
    //The machine's today is left out on purpose: now is whatever the plan's server says it is
    it('counts tomorrow from the day it is given', () => {
        expect(checkRange('2026-09-27', '2026-09-30', '2026-09-26')).toBe(null);
        expect(checkRange('2026-09-27', '2026-09-30', '2026-09-27')).toMatch(/tomorrow or later/);
    });
});
