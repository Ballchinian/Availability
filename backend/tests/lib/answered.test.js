import { describe, it, expect, beforeEach } from 'vitest';
import { mergeAnswered, saveAnswered, MAX_WINDOWS } from '../../src/lib/answered.js';
import { shiftDate } from '../../src/lib/dates.js';

const today = '2026-09-01';
const w = (start, end, allowedWeekdays = null) => ({ start, end, allowedWeekdays });

describe('mergeAnswered', () => {
    it('adds a window to an empty list', () => {
        expect(mergeAnswered([], w('2026-09-07', '2026-09-11'), today)).toEqual([w('2026-09-07', '2026-09-11')]);
    });

    it('changes nothing when the same plan is saved twice', () => {
        const list = [w('2026-09-07', '2026-09-11')];
        expect(mergeAnswered(list, w('2026-09-07', '2026-09-11'), today)).toEqual(list);
    });

    it('joins windows that overlap', () => {
        expect(mergeAnswered([w('2026-09-07', '2026-09-11')], w('2026-09-10', '2026-09-15'), today)).toEqual([w('2026-09-07', '2026-09-15')]);
    });

    it('joins windows that sit end to end', () => {
        expect(mergeAnswered([w('2026-09-07', '2026-09-11')], w('2026-09-12', '2026-09-15'), today)).toEqual([w('2026-09-07', '2026-09-15')]);
    });

    it('joins every window the new one bridges', () => {
        const list = [w('2026-09-01', '2026-09-05'), w('2026-09-20', '2026-09-25'), w('2026-09-10', '2026-09-12')];
        expect(mergeAnswered(list, w('2026-09-06', '2026-09-09'), today)).toEqual([w('2026-09-20', '2026-09-25'), w('2026-09-01', '2026-09-12')]);
    });

    it('keeps a gap between two windows', () => {
        expect(mergeAnswered([w('2026-09-07', '2026-09-11')], w('2026-09-13', '2026-09-15'), today)).toHaveLength(2);
    });

    //Weekends answered says nothing about the weekdays between them
    it('keeps windows asking about different weekdays apart', () => {
        expect(mergeAnswered([w('2026-09-01', '2026-09-30', [0, 6])], w('2026-09-07', '2026-09-11'), today)).toHaveLength(2);
    });

    it('reads every weekday ticked as every day', () => {
        expect(mergeAnswered([w('2026-09-07', '2026-09-11')], w('2026-09-07', '2026-09-11', [6, 5, 4, 3, 2, 1, 0]), today)).toEqual([
            w('2026-09-07', '2026-09-11')
        ]);
    });

    it('drops windows that ended before today', () => {
        expect(mergeAnswered([w('2026-08-01', '2026-08-31')], w('2026-09-07', '2026-09-11'), today)).toEqual([w('2026-09-07', '2026-09-11')]);
    });

    it('adds nothing for a window that has already ended', () => {
        expect(mergeAnswered([], w('2026-08-01', '2026-08-31'), today)).toEqual([]);
    });

    it('ignores a window with no days in it', () => {
        expect(mergeAnswered([], w('2026-09-11', '2026-09-07'), today)).toEqual([]);
    });

    it('keeps the newest when the list is full', () => {
        const full = Array.from({ length: MAX_WINDOWS }, (_, i) => w(shiftDate(today, i * 3), shiftDate(today, i * 3)));
        const next = w('2027-06-01', '2027-06-01');
        const merged = mergeAnswered(full, next, today);
        expect(merged).toHaveLength(MAX_WINDOWS);
        expect(merged.at(-1)).toEqual(next);
        expect(merged[0]).toEqual(full[1]);
    });
});

/*
    A users collection in a Map, enough of one for the write: it only goes through while
    answered is still what was read, null matching a record that has none, the same as
    the real one.
*/
const rows = new Map();
const users = {
    findOne: async ({ userId }) => (rows.has(userId) ? structuredClone(rows.get(userId)) : null),
    updateOne: async (filter, update, { upsert = false } = {}) => {
        const doc = rows.get(filter.userId);
        if (!doc) {
            if (!upsert) return { modifiedCount: 0 };
            rows.set(filter.userId, { userId: filter.userId, ...update.$setOnInsert });
            return { upsertedCount: 1 };
        }
        if ('answered' in filter && JSON.stringify(doc.answered ?? null) !== JSON.stringify(filter.answered)) return { modifiedCount: 0 };
        Object.assign(doc, update.$set);
        return { modifiedCount: update.$set ? 1 : 0 };
    }
};

describe('saveAnswered', () => {
    beforeEach(() => rows.clear());

    it('makes a record for someone who has only used /free', async () => {
        await saveAnswered(users, 'bo', [w('2026-09-07', '2026-09-11')], today);
        expect(rows.get('bo')).toEqual({ userId: 'bo', answered: [w('2026-09-07', '2026-09-11')] });
    });

    it('adds to the list on a record that has one', async () => {
        rows.set('bo', { userId: 'bo', timeZone: 'Europe/London', answered: [w('2026-09-20', '2026-09-25')] });
        await saveAnswered(users, 'bo', [w('2026-09-07', '2026-09-11')], today);
        expect(rows.get('bo').answered).toEqual([w('2026-09-20', '2026-09-25'), w('2026-09-07', '2026-09-11')]);
        expect(rows.get('bo').timeZone).toBe('Europe/London');
    });

    it('makes no record when there is nothing to keep', async () => {
        await saveAnswered(users, 'bo', [w('2026-08-01', '2026-08-31')], today);
        expect(rows.has('bo')).toBe(false);
    });

    it('keeps both of two saves landing at once', async () => {
        rows.set('bo', { userId: 'bo' });
        await Promise.all([
            saveAnswered(users, 'bo', [w('2026-09-07', '2026-09-11')], today),
            saveAnswered(users, 'bo', [w('2026-09-20', '2026-09-25')], today)
        ]);
        expect(rows.get('bo').answered).toHaveLength(2);
    });
});
