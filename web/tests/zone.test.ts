import { describe, it, expect, vi } from 'vitest';
import { describeZone, todayIn, planInstant, wallTime } from '../src/calendar/zone.js';

//The maths is shared/zones.js, tested from the backend. These are what only the site writes.

describe('describeZone', () => {
    it('names the clock and what it reads', () => {
        expect(describeZone('Asia/Tokyo')).toBe('Asia/Tokyo (GMT+9)');
    });

    it('says nothing about a zone nobody set', () => {
        expect(describeZone('')).toBe('');
    });
});

describe('todayIn', () => {
    //1pm UTC on the 26th, which is already the 27th in Auckland
    it('reads the date off the plan clock rather than the device', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-26T13:00:00Z'));
        try {
            expect(todayIn('Pacific/Auckland')).toBe('2026-09-27');
            expect(todayIn('Europe/London')).toBe('2026-09-26');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('wallTime', () => {
    const at = (zone: string, date: string, time: string) => planInstant(zone, date, time) as Date;

    it('reads a plan time on another clock', () => {
        expect(wallTime('America/New_York', at('Europe/London', '2026-09-12', '19:00'))).toBe('2pm on Sat 12 Sep 2026');
    });

    it('keeps the minutes and moves the day when it has to', () => {
        expect(wallTime('Asia/Tokyo', at('America/New_York', '2026-12-31', '21:15'))).toBe('11:15am on Fri 1 Jan 2027');
    });
});

describe('describeZone on a given day', () => {
    it('gives the offset in force then rather than now', () => {
        expect(describeZone('Europe/London', new Date('2026-07-12T12:00:00Z'))).toBe('Europe/London (GMT+1)');
        expect(describeZone('Europe/London', new Date('2026-01-12T12:00:00Z'))).toBe('Europe/London (GMT)');
    });
});
