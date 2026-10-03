import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Rounds: which day a yes/no button was sent about. A move starts a new one, and a move
    back to a day the plan has been on gets that day's round and answers back.
*/

const store = vi.hoisted(() => ({ plan: null, writes: [], bulk: [] }));

vi.mock('../../src/db/mongo.js', async (real) => ({
    ...(await real()),
    col: () => ({
        findOne: async () => store.plan,
        updateOne: async (filter, update, options) => store.writes.push({ filter, update, options }),
        bulkWrite: async (ops) => store.bulk.push(...ops)
    })
}));

const { roundFor, setPlanChosen } = await import('../../src/db/plans/index.js');

const SAT = '2026-09-12';
const SUN = '2026-09-13';

const onDay = (date, over = {}) => ({
    planId: 'p1',
    status: 'closed',
    chosenDate: date,
    allowedWeekdays: null,
    round: 1,
    participants: [
        { userId: 'ali', vote: 'yes', voteReason: null, votedAt: 'then', override: null },
        { userId: 'bo', vote: 'no', voteReason: 'away', votedAt: 'then', override: null },
        { userId: 'cass', vote: null, override: 'yes' },
        { userId: 'di', vote: null, override: null }
    ],
    ...over
});

beforeEach(() => {
    store.plan = null;
    store.writes.length = 0;
    store.bulk.length = 0;
});

describe('roundFor', () => {
    it('starts a new round for a new day and keeps the answers for the old one', () => {
        const turn = roundFor(onDay(SAT), SUN);

        expect(turn.round).toBe(2);
        expect(turn.restore).toEqual([]);
        expect(turn.pastVotes).toHaveLength(1);
        expect(turn.pastVotes[0]).toMatchObject({ date: SAT, round: 1 });
        //Only people with an answer or a planner's call, and nothing else about them
        expect(turn.pastVotes[0].votes.map((v) => v.userId)).toEqual(['ali', 'bo', 'cass']);
        expect(turn.pastVotes[0].votes[1]).toEqual({ userId: 'bo', vote: 'no', voteReason: 'away', votedAt: 'then', override: null });
    });

    it('gives a day moved back to its old round and its answers', () => {
        const away = roundFor(onDay(SAT), SUN);
        const back = roundFor({ ...onDay(SUN, { round: away.round, lastRound: away.lastRound }), pastVotes: away.pastVotes }, SAT);

        expect(back.round).toBe(1);
        expect(back.restore.map((v) => v.userId)).toEqual(['ali', 'bo', 'cass']);
        //Sunday is kept in its place, so its buttons can say what they were about
        expect(back.pastVotes.map((d) => d.date)).toEqual([SUN]);
        expect(back.lastRound).toBe(2);
    });

    //A later new day must not take a number an older button already carries
    it('numbers a new day past every round there has been, after a move back', () => {
        const plan = onDay(SAT, { round: 1, lastRound: 2, pastVotes: [{ date: SUN, round: 2, votes: [] }] });
        expect(roundFor(plan, '2026-09-19').round).toBe(3);
    });

    //Everything sent before this carries no round, which reads as 0, the same as the plan
    it('reads a plan from before rounds as round 0, so its first move is round 1', () => {
        const turn = roundFor(onDay(SAT, { round: undefined }), SUN);
        expect(turn.round).toBe(1);
        expect(turn.pastVotes[0].round).toBe(0);
    });

    it('keeps the last three days', () => {
        const pastVotes = ['2026-09-01', '2026-09-02', '2026-09-03'].map((date, i) => ({ date, round: i + 1, votes: [] }));
        const turn = roundFor(onDay(SAT, { round: 4, pastVotes }), SUN);
        expect(turn.pastVotes.map((d) => d.date)).toEqual(['2026-09-02', '2026-09-03', SAT]);
    });

    it('starts a brand new plan on round 1', () => {
        expect(roundFor(null, SAT)).toEqual({ round: 1, lastRound: 1, pastVotes: [], restore: [] });
    });
});

describe('moving the day', () => {
    it('writes the round with the day and puts back the answers a day moved back to had', async () => {
        store.plan = onDay(SUN, { round: 2, lastRound: 2, pastVotes: [{ date: SAT, round: 1, votes: [{ userId: 'ali', vote: 'yes', voteReason: null, votedAt: 'then', override: null }] }] });

        await setPlanChosen('p1', SAT);

        expect(store.writes[0].update.$set).toMatchObject({ chosenDate: SAT, round: 1, lastRound: 2 });
        expect(store.writes[0].update.$set.pastVotes.map((d) => d.date)).toEqual([SUN]);
        expect(store.bulk).toHaveLength(1);
        expect(store.bulk[0].updateOne.filter).toEqual({ planId: 'p1', 'participants.userId': 'ali' });
        expect(store.bulk[0].updateOne.update.$set['participants.$.vote']).toBe('yes');
    });

    //What someone sent back held belongs to the day they were sent back from
    it('ends everyone being sent back', async () => {
        store.plan = onDay(SAT);
        await setPlanChosen('p1', SUN);
        expect(store.writes[0].update.$set['participants.$[].sentBack']).toBeNull();
    });

    it('puts nothing back on a day the plan has not been on', async () => {
        store.plan = onDay(SAT);
        await setPlanChosen('p1', SUN);
        expect(store.bulk).toEqual([]);
    });
});
