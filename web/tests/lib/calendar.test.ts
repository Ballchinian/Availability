import { describe, it, expect } from 'vitest';
import { WEEKDAYS, buildMonths, isoOf, weekdayOf, isWeekdayAllowed } from '../../src/lib/calendar.js';

describe('isoOf', () => {
    it('pads the month and the day', () => {
        expect(isoOf(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(isoOf(new Date(2026, 11, 25))).toBe('2026-12-25');
    });
});

describe('weekdayOf', () => {
    it('numbers the week from Sunday, lining up with WEEKDAYS', () => {
        expect(WEEKDAYS[weekdayOf('2026-08-09')]).toBe('Su');
        expect(WEEKDAYS[weekdayOf('2026-08-05')]).toBe('We');
        expect(WEEKDAYS[weekdayOf('2026-08-08')]).toBe('Sa');
    });
});

describe('isWeekdayAllowed', () => {
    it('allows everything when there is no restriction', () => {
        expect(isWeekdayAllowed('2026-08-05', null)).toBe(true);
        expect(isWeekdayAllowed('2026-08-05', [])).toBe(true);
        expect(isWeekdayAllowed('2026-08-05')).toBe(true);
    });

    it('checks the date against the list', () => {
        expect(isWeekdayAllowed('2026-08-05', [3])).toBe(true);
        expect(isWeekdayAllowed('2026-08-05', [0, 6])).toBe(false);
    });
});

describe('buildMonths', () => {
    it('is empty without both ends of a range', () => {
        expect(buildMonths('', '2026-08-20')).toEqual([]);
        expect(buildMonths('2026-08-05', '')).toEqual([]);
    });

    it('is one month for a range inside one month', () => {
        const months = buildMonths('2026-08-05', '2026-08-20');
        expect(months).toHaveLength(1);
        expect(months[0]).toMatchObject({ year: 2026, month: 7, label: 'August' });
    });

    it('covers every month the range touches, ends included', () => {
        expect(buildMonths('2026-08-30', '2026-10-02').map((m) => m.label)).toEqual([
            'August',
            'September',
            'October'
        ]);
    });

    it('rolls the year over rather than running backwards', () => {
        const months = buildMonths('2026-11-20', '2027-02-03');
        expect(months.map((m) => `${m.label} ${m.year}`)).toEqual([
            'November 2026',
            'December 2026',
            'January 2027',
            'February 2027'
        ]);
    });

    /*
        The month starts on the first cell whose weekday matches, so the padding
        count has to be the weekday of the 1st. August 2026 opens on a Saturday.
    */
    it('pads the start of the month up to the right weekday', () => {
        const [aug] = buildMonths('2026-08-05', '2026-08-20');
        const lead = aug.cells.findIndex((c) => c !== null);
        expect(lead).toBe(6);
        expect(aug.cells.slice(0, 6).every((c) => c === null)).toBe(true);
        expect(aug.cells[6]).toMatchObject({ day: 1, date: '2026-08-01' });
    });

    it('has a cell for every day of the month', () => {
        const [feb] = buildMonths('2028-02-01', '2028-02-29');
        expect(feb.cells.filter((c) => c !== null)).toHaveLength(29);
    });

    it('marks only the days inside the range', () => {
        const [aug] = buildMonths('2026-08-05', '2026-08-20');
        expect(aug.inRangeCount).toBe(16);
        expect(aug.cells.find((c) => c?.date === '2026-08-04')?.inRange).toBe(false);
        expect(aug.cells.find((c) => c?.date === '2026-08-05')?.inRange).toBe(true);
        expect(aug.cells.find((c) => c?.date === '2026-08-20')?.inRange).toBe(true);
        expect(aug.cells.find((c) => c?.date === '2026-08-21')?.inRange).toBe(false);
    });

    it('leaves the months either side of the range mostly out of it', () => {
        const [aug, , oct] = buildMonths('2026-08-30', '2026-10-02');
        expect(aug.inRangeCount).toBe(2);
        expect(oct.inRangeCount).toBe(2);
    });
});
