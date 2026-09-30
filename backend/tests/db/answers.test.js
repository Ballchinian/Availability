import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Where in, inReason and sentBack get written. One plan document in memory, and an
    updateOne that applies a positional $set to whoever the filter named.
*/

const store = vi.hoisted(() => ({ doc: null }));

vi.mock('../../src/db/mongo.js', () => ({
    collections: { plans: 'plans' },
    col: () => ({
        findOne: async () => structuredClone(store.doc),
        updateOne: async (filter, update) => {
            const p = store.doc.participants.find((q) => q.userId === filter['participants.userId']);
            for (const [path, value] of Object.entries(update.$set)) p[path.replace('participants.$.', '')] = value;
        }
    })
}));

const { confirmParticipant, recordVote, setIn, setSentBack } = await import('../../src/db/plans.js');

const bo = () => store.doc.participants[0];

beforeEach(() => {
    store.doc = { planId: 'p1', participants: [{ userId: 'bo', confirmed: false, in: null, inReason: null, sentBack: { byName: 'Ali' } }] };
});

describe('saving dates', () => {
    it('counts as in and ends being sent back', async () => {
        await confirmParticipant('p1', 'bo');
        expect(bo()).toMatchObject({ confirmed: true, in: true, sentBack: null });
    });

    it('brings someone who was out back in without their reason', async () => {
        Object.assign(bo(), { in: false, inReason: 'Away' });
        await confirmParticipant('p1', 'bo');
        expect(bo()).toMatchObject({ in: true, inReason: null });
    });
});

describe('a vote on a set day', () => {
    it('counts a yes as in', async () => {
        await recordVote('p1', 'bo', 'yes');
        expect(bo()).toMatchObject({ vote: 'yes', in: true, sentBack: null });
    });

    //Can't make it is about the one day, not the plan
    it('leaves in alone on a no', async () => {
        bo().in = true;
        await recordVote('p1', 'bo', 'no', 'Working');
        expect(bo()).toMatchObject({ vote: 'no', voteReason: 'Working', in: true, sentBack: null });
    });
});

describe('Count me in / Not for me', () => {
    it('keeps the reason with a no', async () => {
        await setIn('p1', 'bo', false, 'Away that month');
        expect(bo()).toMatchObject({ in: false, inReason: 'Away that month', sentBack: null });
    });

    it('drops the reason with a yes', async () => {
        Object.assign(bo(), { in: false, inReason: 'Away' });
        await setIn('p1', 'bo', true, 'ignored');
        expect(bo()).toMatchObject({ in: true, inReason: null });
    });

    //Only saving their dates ends it, or the calendar they were asked to look over answers again
    it('keeps someone sent back when they say they are in', async () => {
        await setIn('p1', 'bo', true);
        expect(bo().sentBack).toEqual({ byName: 'Ali' });
    });
});

describe('a host sending someone back', () => {
    const back = { byName: 'Ali', at: 'now', was: { vote: 'yes', voteReason: null, votedAt: 'then', override: null } };

    it('clears the vote it was handed null for', async () => {
        Object.assign(bo(), { sentBack: null, vote: 'yes', votedAt: 'then', override: 'no' });
        await setSentBack('p1', 'bo', back, null);
        expect(bo()).toMatchObject({ sentBack: back, vote: null, votedAt: null, override: null });
    });

    it('puts back the vote it is handed', async () => {
        Object.assign(bo(), { sentBack: back, vote: null });
        await setSentBack('p1', 'bo', null, back.was);
        expect(bo()).toMatchObject({ sentBack: null, vote: 'yes', votedAt: 'then', override: null });
    });

    it('leaves the vote alone when handed none', async () => {
        Object.assign(bo(), { sentBack: null, vote: 'no' });
        await setSentBack('p1', 'bo', back);
        expect(bo()).toMatchObject({ sentBack: back, vote: 'no' });
    });
});
