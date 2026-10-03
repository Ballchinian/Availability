import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    rev: what moves it, so an edit form opened before is refused rather than saving over
    the change, and what leaves it alone, since the form never sends an answer.
*/

const store = vi.hoisted(() => ({ plan: null, writes: [] }));

vi.mock('../../src/db/mongo.js', async (real) => ({
    ...(await real()),
    col: () => {
        const write = async (filter, update) => {
            store.writes.push(update);
            return { modifiedCount: 1 };
        };
        return {
            findOne: async () => store.plan,
            find: () => ({ toArray: async () => [store.plan] }),
            updateOne: write,
            updateMany: write,
            findOneAndUpdate: write,
            bulkWrite: async () => {}
        };
    }
}));

const db = await import('../../src/db/plans.js');

const ali = { id: 'ali', name: 'Ali' };
const moves = (update) => update.$inc?.rev === 1;

beforeEach(() => {
    store.writes.length = 0;
    store.plan = { planId: 'p1', guildId: 'g1', status: 'collecting', chosenDate: null, participants: [{ userId: 'bo' }], hostIds: ['ali'] };
});

describe('rev', () => {
    it('moves on, with who moved it, for everything the edit form sends', async () => {
        await db.setPlanChosen('p1', '2026-10-10', '19:00', null, null, ali);
        await db.setPlanWhen('p1', '20:00', null, ali);
        await db.addParticipants('p1', ['cy'], ali);
        await db.removeParticipant('p1', 'bo', { id: 'bo', name: 'Bo' });
        await db.addHost('p1', 'sam', [], ali);
        await db.removeUserFromGuildPlans('g1', 'bo', { id: 'bo', name: 'Bo' });

        const moved = store.writes.filter(moves);
        expect(moved).toHaveLength(6);
        expect(moved.map((u) => u.$set.revBy.id)).toEqual(['ali', 'ali', 'ali', 'bo', 'ali', 'bo']);
    });

    it('moves on for a cancel and a repeat stopping, naming nobody', async () => {
        await db.markPlanCancelled('p1');
        await db.setPlanRepeat('p1', null);
        expect(store.writes.every(moves)).toBe(true);
        expect(store.writes.map((u) => u.$set.revBy)).toEqual([null, null]);
    });

    it('stays put for an answer, which the form never sends', async () => {
        await db.setIn('p1', 'bo', true);
        await db.recordVote('p1', 'bo', 'yes');
        await db.confirmParticipant('p1', 'bo');
        await db.setAttendanceOverride('p1', 'bo', 'yes');
        await db.setPlanCards('p1', [{ userId: 'bo', messageId: 'm1' }]);
        expect(store.writes.some(moves)).toBe(false);
    });
});
