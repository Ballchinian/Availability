import { describe, it, expect } from 'vitest';
import { clearPractice } from '../../src/db/mongo.js';

//Practice mode's plans and made-up people, cleared on boot once it was taken out

//Each collection an array, behind just enough of a matcher for the filters clearPractice sends
function fakeDatabase(rows) {
    const matches = (doc, filter) =>
        Object.entries(filter).every(([key, want]) => {
            if (key === '$or') return want.some((f) => matches(doc, f));
            const have = doc[key] ?? null;
            if ('$ne' in want) return have !== want.$ne;
            if ('$in' in want) return want.$in.includes(have);
            if ('$regex' in want) return new RegExp(want.$regex).test(have);
            return false;
        });
    const dropped = [];
    const collection = (name) => ({
        find: (filter) => ({ toArray: async () => (rows[name] || []).filter((doc) => matches(doc, filter)) }),
        deleteMany: async (filter) => {
            const before = (rows[name] || []).length;
            rows[name] = (rows[name] || []).filter((doc) => !matches(doc, filter));
            return { deletedCount: before - rows[name].length };
        },
        drop: async () => dropped.push(name)
    });
    return { collection, dropped };
}

describe('clearPractice', () => {
    const seed = () => ({
        plans: [{ planId: 'drill', practice: 'u1' }, { planId: 'real', practice: null }, { planId: 'older' }],
        users: [{ userId: 'practice_pat' }, { userId: 'u1' }],
        availability: [{ userId: 'practice_pat', date: '2026-10-10' }, { userId: 'u1', date: '2026-10-10' }],
        ratelimits: [{ userId: 'practice_pat' }, { userId: 'drill' }, { userId: 'u1' }, { userId: 'real' }]
    });
    const ids = (list, key) => list.map((doc) => doc[key]);

    it('takes the practice plans and made-up people, and leaves everything real', async () => {
        const rows = seed();
        const database = fakeDatabase(rows);
        await clearPractice(database);
        expect(ids(rows.plans, 'planId')).toEqual(['real', 'older']);
        expect(ids(rows.users, 'userId')).toEqual(['u1']);
        expect(ids(rows.availability, 'userId')).toEqual(['u1']);
        expect(ids(rows.ratelimits, 'userId')).toEqual(['u1', 'real']);
        expect(database.dropped).toEqual(['practice', 'practiceOutbox']);
    });

    it('finds nothing left to do on the next boot', async () => {
        const rows = seed();
        expect(await clearPractice(fakeDatabase(rows))).toBe(2);
        expect(await clearPractice(fakeDatabase(rows))).toBe(0);
    });
});
