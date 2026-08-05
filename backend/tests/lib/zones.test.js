import { describe, it, expect } from 'vitest';
import { isValidZone, instantToWall, wallToInstant, clocksAgree, retimeDay, planInstant } from '../../src/lib/zones.js';
import { suggestZones } from '../../src/bot/timezone.js';

/*
    Dates are picked so the answer differs from the naive one. Europe/London in August
    is an hour off UTC, so anything that quietly skipped the conversion would show up.
    2026-03-29 and 2026-10-25 are the two days the UK clocks move that year.
*/

describe('isValidZone', () => {
    it('takes an IANA name', () => {
        expect(isValidZone('Europe/London')).toBe(true);
        expect(isValidZone('UTC')).toBe(true);
    });

    it('refuses anything the runtime does not know', () => {
        expect(isValidZone('Middle/Earth')).toBe(false);
        expect(isValidZone('GMT+1')).toBe(false);
        expect(isValidZone('')).toBe(false);
        expect(isValidZone(null)).toBe(false);
        expect(isValidZone(7)).toBe(false);
    });
});

describe('instantToWall', () => {
    it('reads an instant off a clock', () => {
        expect(instantToWall('Europe/London', new Date('2026-08-12T19:00:00Z'))).toEqual({ date: '2026-08-12', hour: 20, minute: 0 });
        expect(instantToWall('UTC', new Date('2026-08-12T19:00:00Z'))).toEqual({ date: '2026-08-12', hour: 19, minute: 0 });
    });

    it('carries the date over with the clock', () => {
        expect(instantToWall('Asia/Tokyo', new Date('2026-08-12T19:00:00Z')).date).toBe('2026-08-13');
        expect(instantToWall('America/Los_Angeles', new Date('2026-08-12T04:00:00Z')).date).toBe('2026-08-11');
    });

    it('keeps the minutes a half hour zone reads', () => {
        expect(instantToWall('Asia/Kolkata', new Date('2026-08-12T19:00:00Z'))).toEqual({ date: '2026-08-13', hour: 0, minute: 30 });
    });
});

describe('wallToInstant', () => {
    it('finds the moment a reading points at', () => {
        expect(wallToInstant('Europe/London', '2026-08-12', 20).toISOString()).toBe('2026-08-12T19:00:00.000Z');
        expect(wallToInstant('Asia/Tokyo', '2026-08-13', 4).toISOString()).toBe('2026-08-12T19:00:00.000Z');
    });

    //The half the two passes exist for: the offset in force at the answer, not at the guess
    it('follows a zone across its own clock change', () => {
        expect(wallToInstant('Europe/London', '2026-01-12', 20).toISOString()).toBe('2026-01-12T20:00:00.000Z');
        expect(wallToInstant('Europe/London', '2026-08-12', 20).toISOString()).toBe('2026-08-12T19:00:00.000Z');
    });

    it('round trips every hour of an ordinary day', () => {
        for (let h = 0; h < 24; h++) {
            const back = instantToWall('America/New_York', wallToInstant('America/New_York', '2026-08-12', h));
            expect(back).toEqual({ date: '2026-08-12', hour: h, minute: 0 });
        }
    });

    //An hour the clocks deleted has no moment of its own, so it lands on the one they jumped to
    it('does not invent an hour that never happened', () => {
        const skipped = wallToInstant('Europe/London', '2026-03-29', 1);
        expect(instantToWall('Europe/London', skipped).hour).toBe(2);
    });
});

describe('clocksAgree', () => {
    it('is about the offset on the day, not the name', () => {
        expect(clocksAgree('Europe/London', 'UTC', new Date('2026-01-12T12:00:00Z'))).toBe(true);
        expect(clocksAgree('Europe/London', 'UTC', new Date('2026-08-12T12:00:00Z'))).toBe(false);
        expect(clocksAgree('Europe/London', 'Europe/Dublin', new Date('2026-08-12T12:00:00Z'))).toBe(true);
    });
});

describe('retimeDay', () => {
    it('leaves a day alone when both clocks read the same', () => {
        expect(retimeDay('Europe/London', 'Europe/London', '2026-08-12', [20, 21])).toEqual([{ date: '2026-08-12', hours: [20, 21] }]);
        expect(retimeDay('Europe/London', 'Europe/Dublin', '2026-08-12', [20, 21])).toEqual([{ date: '2026-08-12', hours: [20, 21] }]);
    });

    //The whole point of storing hours as written: an empty list is theirs, not everyone's
    it('keeps free all day as an empty list only while the clocks agree', () => {
        expect(retimeDay('Europe/London', 'Europe/London', '2026-08-12', [])).toEqual([{ date: '2026-08-12', hours: [] }]);
        expect(retimeDay('Asia/Tokyo', 'Europe/London', '2026-08-12', [])).toHaveLength(2);
    });

    it('moves an evening onto the day the other clock calls it', () => {
        expect(retimeDay('Europe/London', 'Asia/Tokyo', '2026-08-12', [20, 21, 22])).toEqual([{ date: '2026-08-13', hours: [4, 5, 6] }]);
    });

    it('splits a day that straddles midnight over there', () => {
        expect(retimeDay('Asia/Tokyo', 'Europe/London', '2026-08-12', [])).toEqual([
            { date: '2026-08-11', hours: [16, 17, 18, 19, 20, 21, 22, 23] },
            { date: '2026-08-12', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
        ]);
    });

    //Half an hour cannot be stored, so a window lands on the hour that holds its start
    it('rounds a half hour zone down onto whole hours', () => {
        expect(retimeDay('Europe/London', 'Asia/Kolkata', '2026-08-12', [20, 21])).toEqual([{ date: '2026-08-13', hours: [0, 1] }]);
    });

    it('never hands back an hour outside 0 to 23', () => {
        for (const zone of ['Pacific/Kiritimati', 'Pacific/Niue', 'Asia/Kathmandu', 'America/St_Johns']) {
            for (const { hours } of retimeDay(zone, 'Europe/London', '2026-08-12', [])) {
                expect(hours.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)).toBe(true);
            }
        }
    });

    /*
        A clock moving inside the day breaks the one-subtraction shortcut, so these two
        take the slow path. The 23 hour day loses one and the 25 hour day cannot say the
        repeat, which is the documented cost and an hour wide once a year.
    */
    it('keeps to the real hours on a day the clocks move', () => {
        const spring = retimeDay('Europe/London', 'UTC', '2026-03-29', []);
        expect(spring).toHaveLength(1);
        expect(spring[0].hours).toHaveLength(23);

        const autumn = retimeDay('Europe/London', 'UTC', '2026-10-25', []);
        expect(autumn.flatMap((d) => d.hours)).toHaveLength(24);
    });

    it('sorts the days and the hours inside them', () => {
        const days = retimeDay('Pacific/Auckland', 'Europe/London', '2026-08-12', [3, 1, 22, 14]);
        expect(days.map((d) => d.date)).toEqual([...days.map((d) => d.date)].sort());
        for (const d of days) expect(d.hours).toEqual([...d.hours].sort((a, b) => a - b));
    });
});

describe('planInstant', () => {
    it('reads a plan\'s day and time off the server\'s clock', () => {
        expect(planInstant('Europe/London', '2026-08-12', '19:00').toISOString()).toBe('2026-08-12T18:00:00.000Z');
        expect(planInstant('Asia/Tokyo', '2026-08-12', '19:00').toISOString()).toBe('2026-08-12T10:00:00.000Z');
    });

    it('has no moment to give for a plan with no time', () => {
        expect(planInstant('Europe/London', '2026-08-12', null)).toBe(null);
        expect(planInstant('Europe/London', '2026-08-12', '')).toBe(null);
        expect(planInstant('Europe/London', null, '19:00')).toBe(null);
        expect(planInstant('Europe/London', '2026-08-12', '7pm')).toBe(null);
    });
});

describe('suggestZones', () => {
    it('never sends Discord more than it takes', () => {
        expect(suggestZones('').length).toBeLessThanOrEqual(25);
        expect(suggestZones('a').length).toBeLessThanOrEqual(25);
    });

    it('finds a zone from the middle of its name', () => {
        expect(suggestZones('lond')).toContain('Europe/London');
        expect(suggestZones('tokyo')).toContain('Asia/Tokyo');
    });

    //Discord hands over what was typed, spaces and all, where the names use underscores
    it('reads a typed space as the underscore in the name', () => {
        expect(suggestZones('new york')).toContain('America/New_York');
    });

    it('offers something to a box nobody has typed in yet', () => {
        expect(suggestZones('').length).toBeGreaterThan(0);
    });

    it('comes back empty rather than guessing', () => {
        expect(suggestZones('zzzznotazone')).toEqual([]);
    });
});
