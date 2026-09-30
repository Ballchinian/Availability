import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    addParticipants against one plan document held in memory. Reads hand back a copy,
    and both calls in a race read before either writes, which is the order that used to
    put someone on twice.
*/

const store = vi.hoisted(() => ({ doc: null }));

vi.mock('../../src/db/mongo.js', () => ({
    collections: { plans: 'plans' },
    col: () => ({
        findOne: async ({ planId }) => (store.doc?.planId === planId ? structuredClone(store.doc) : null),
        updateOne: async (filter, update) => {
            const nin = filter['participants.userId']?.$nin || [];
            if (store.doc.participants.some((p) => nin.includes(p.userId))) return { modifiedCount: 0 };
            store.doc.participants.push(...update.$push.participants.$each);
            return { modifiedCount: 1 };
        }
    })
}));

const { addParticipants } = await import('../../src/db/plans.js');

const ids = () => store.doc.participants.map((p) => p.userId);

beforeEach(() => {
    store.doc = { planId: 'p1', participants: [{ userId: 'ali' }] };
});

describe('addParticipants', () => {
    it('adds the same id once however many times it is sent', async () => {
        await addParticipants('p1', ['bo', 'bo', 'cass']);
        expect(ids()).toEqual(['ali', 'bo', 'cass']);
    });

    it('leaves anyone already on the plan where they are', async () => {
        await addParticipants('p1', ['ali', 'bo']);
        expect(ids()).toEqual(['ali', 'bo']);
    });

    it('adds people who have not said if they are in', async () => {
        await addParticipants('p1', ['bo']);
        expect(store.doc.participants[1]).toMatchObject({ in: null, inReason: null, sentBack: null });
    });

    it('puts each person on once when two adds land together', async () => {
        await Promise.all([addParticipants('p1', ['bo', 'cass']), addParticipants('p1', ['cass', 'dee'])]);
        expect(ids().sort()).toEqual(['ali', 'bo', 'cass', 'dee']);
    });
});
