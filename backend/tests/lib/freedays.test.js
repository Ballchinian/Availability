import { describe, it, expect } from 'vitest';
import { gatherFreeDays } from '../../src/lib/freedays.js';

/*
    The gathering, not the retiming: retimeDay has its own tests in zones.test.js and
    this is what happens to what it returns. Every case names both clocks, since the
    whole point of the code is that they differ.

    August 2026 puts London on BST, so Paris reads an hour ahead of it and Kiritimati
    thirteen. Those two offsets are what the spill and the gather cases are built on.
*/

const zoned = (zone) => ({ a: { timeZone: zone }, b: { timeZone: zone } });
const call = (rows, opts) => gatherFreeDays(rows, { zone: 'Europe/London', ...opts });

describe('gatherFreeDays', () => {
    it('sends a day back untouched when both clocks agree', () => {
        const rows = [{ userId: 'a', date: '2026-08-05', hours: [] }];
        expect(call(rows, { userIds: ['a'], prefs: zoned('Europe/London'), start: '2026-08-01', end: '2026-08-14' })).toEqual({
            '2026-08-05': [{ userId: 'a', hours: [] }]
        });
    });

    it('keeps the hours somebody actually picked', () => {
        const rows = [{ userId: 'a', date: '2026-08-05', hours: [21, 20] }];
        expect(call(rows, { userIds: ['a'], prefs: zoned('Europe/London'), start: '2026-08-01', end: '2026-08-14' })).toEqual({
            '2026-08-05': [{ userId: 'a', hours: [20, 21] }]
        });
    });

    //A row saved before hours were a thing, which reads as free all day
    it('takes a row with no hours on it as the whole day', () => {
        const rows = [{ userId: 'a', date: '2026-08-05' }];
        expect(call(rows, { userIds: ['a'], prefs: zoned('Europe/London'), start: '2026-08-01', end: '2026-08-14' })).toEqual({
            '2026-08-05': [{ userId: 'a', hours: [] }]
        });
    });

    //The 11pm the night before that the route reaches a day past each end for
    it('spills an hour ahead onto the evening before', () => {
        const rows = [{ userId: 'a', date: '2026-08-05', hours: [] }];
        const out = call(rows, { userIds: ['a'], prefs: zoned('Europe/Paris'), start: '2026-08-04', end: '2026-08-06' });
        expect(out['2026-08-04']).toEqual([{ userId: 'a', hours: [23] }]);
        expect(out['2026-08-05']).toEqual([{ userId: 'a', hours: Array.from({ length: 23 }, (_, h) => h) }]);
    });

    /*
        Kiritimati is thirteen hours ahead, so their day covers eleven of one of ours and
        thirteen of the next. Two of theirs gather into one whole day of ours, which is
        the case the fill back to empty exists for.
    */
    it('gathers two of their days into one of ours, and a full one goes back to empty', () => {
        const rows = [
            { userId: 'a', date: '2026-08-05', hours: [] },
            { userId: 'a', date: '2026-08-06', hours: [] }
        ];
        expect(call(rows, { userIds: ['a'], prefs: zoned('Pacific/Kiritimati'), start: '2026-08-05', end: '2026-08-05' })).toEqual({
            '2026-08-05': [{ userId: 'a', hours: [] }]
        });
    });

    it('drops whatever still lands outside the range', () => {
        const rows = [
            { userId: 'a', date: '2026-08-04', hours: [] },
            { userId: 'a', date: '2026-08-05', hours: [] },
            { userId: 'a', date: '2026-08-06', hours: [] }
        ];
        const out = call(rows, { userIds: ['a'], prefs: zoned('Europe/London'), start: '2026-08-05', end: '2026-08-05' });
        expect(Object.keys(out)).toEqual(['2026-08-05']);
    });

    //The site breaks ties by position, so the order it goes out in is the order it came in
    it('holds the order the ids were given in', () => {
        const rows = [
            { userId: 'a', date: '2026-08-05', hours: [] },
            { userId: 'b', date: '2026-08-05', hours: [] }
        ];
        const opts = { prefs: zoned('Europe/London'), start: '2026-08-01', end: '2026-08-14' };
        expect(call(rows, { ...opts, userIds: ['a', 'b'] })['2026-08-05'].map((f) => f.userId)).toEqual(['a', 'b']);
        expect(call(rows, { ...opts, userIds: ['b', 'a'] })['2026-08-05'].map((f) => f.userId)).toEqual(['b', 'a']);
    });

    it('has nothing to say about someone with no days saved', () => {
        const rows = [{ userId: 'a', date: '2026-08-05', hours: [] }];
        const out = call(rows, { userIds: ['a', 'b'], prefs: zoned('Europe/London'), start: '2026-08-01', end: '2026-08-14' });
        expect(out['2026-08-05'].map((f) => f.userId)).toEqual(['a']);
    });

    it('ignores rows belonging to anyone not asked about', () => {
        const rows = [
            { userId: 'a', date: '2026-08-05', hours: [] },
            { userId: 'b', date: '2026-08-05', hours: [] }
        ];
        const out = call(rows, { userIds: ['a'], prefs: zoned('Europe/London'), start: '2026-08-01', end: '2026-08-14' });
        expect(out['2026-08-05']).toEqual([{ userId: 'a', hours: [] }]);
    });

    /*
        A zone nobody can read falls back to the deployment's, which is the same place a
        person who was never asked lands. Compared against each other rather than against
        a date, since which clock that is depends on the machine the tests run on.
    */
    it('falls back the same way for a junk zone and for no zone at all', () => {
        const rows = [{ userId: 'a', date: '2026-08-05', hours: [] }];
        const opts = { userIds: ['a'], start: '2026-08-01', end: '2026-08-14' };
        const junk = call(rows, { ...opts, prefs: { a: { timeZone: 'nonsense/zone' } } });
        expect(junk).toEqual(call(rows, { ...opts, prefs: {} }));
        expect(Object.keys(junk).length).toBeGreaterThan(0);
    });
});
