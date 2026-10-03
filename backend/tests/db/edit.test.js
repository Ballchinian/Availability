import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    An edit as the plan it leaves (planEdit), and as the writes that leave it so
    (applyPlanEdit). Bo said yes to Sat 10, Cy said no, and Di hasn't answered.
*/

const store = vi.hoisted(() => ({ plan: null, writes: [], bulk: [], matched: 1 }));

vi.mock('../../src/db/mongo.js', async (real) => ({
    ...(await real()),
    col: () => ({
        findOne: async () => store.plan,
        updateOne: async (filter, update) => {
            store.writes.push({ filter, update });
            return { matchedCount: store.matched, modifiedCount: store.matched };
        },
        bulkWrite: async (ops) => store.bulk.push(...ops)
    })
}));

const { planEdit, applyPlanEdit } = await import('../../src/db/plans.js');

const SAT = '2026-10-10';
const people = () => [
    { userId: 'bo', in: true, vote: 'yes', voteReason: null, votedAt: 'then', override: null, invited: true },
    { userId: 'cy', in: true, vote: 'no', voteReason: 'away', votedAt: 'then', override: null, invited: true },
    { userId: 'di', in: null, vote: null, override: null, invited: false }
];
const setPlan = (over = {}) => ({
    planId: 'p1',
    name: 'Board games',
    description: '',
    status: 'closed',
    chosenDate: SAT,
    chosenTime: '19:00',
    dateRange: { start: '2026-10-01', end: '2026-10-14' },
    allowedWeekdays: [6],
    repeatWeeks: null,
    hostIds: ['ali'],
    round: 2,
    participants: people(),
    ...over
});
const form = (over = {}) => ({
    name: 'Board games',
    description: '',
    participantIds: ['bo', 'cy', 'di'],
    hostIds: ['ali'],
    repeatWeeks: null,
    set: true,
    date: SAT,
    time: '19:00',
    ...over
});
const answers = (plan) => plan.participants.map((p) => [p.userId, p.vote, p.invited]);

beforeEach(() => {
    store.plan = null;
    store.writes.length = 0;
    store.bulk.length = 0;
    store.matched = 1;
});

describe('planEdit', () => {
    it('leaves every answer alone when only the time moves', () => {
        const { plan, wiped } = planEdit(setPlan(), form({ time: '20:00' }));
        expect(wiped).toBe(false);
        expect(plan.chosenTime).toBe('20:00');
        expect(answers(plan)).toEqual(answers(setPlan()));
    });

    it('clears every answer and asks everyone again when the day moves', () => {
        const { plan, wiped } = planEdit(setPlan(), form({ date: '2026-10-17' }));
        expect(wiped).toBe(true);
        expect(answers(plan)).toEqual([['bo', null, true], ['cy', null, true], ['di', null, true]]);
        expect(plan).toMatchObject({ round: 3, probeActive: true, chosenDate: '2026-10-17' });
    });

    it('stretches the window to reach a day past it, and adds the day to the weekdays it asks about', () => {
        const { plan } = planEdit(setPlan(), form({ date: '2026-10-21' }));
        expect(plan.dateRange).toEqual({ start: '2026-10-01', end: '2026-10-21' });
        expect(plan.allowedWeekdays).toEqual([3, 6]);
    });

    it('gives a day moved back to its answers back', () => {
        const away = planEdit(setPlan(), form({ date: '2026-10-17' })).plan;
        const { plan, restore } = planEdit(away, form({ date: SAT }));
        expect(restore.map((v) => v.userId)).toEqual(['bo', 'cy']);
        expect(answers(plan).slice(0, 2)).toEqual([['bo', 'yes', true], ['cy', 'no', true]]);
        expect(plan.round).toBe(2);
    });

    it('sends a set plan back for dates with nobody answering for a day, and keeps what they said', () => {
        const window = { start: '2026-11-01', end: '2026-11-14' };
        const { plan, wiped } = planEdit(setPlan(), form({ set: false, window, allowedWeekdays: null }));
        expect(wiped).toBe(true);
        expect(plan).toMatchObject({ status: 'collecting', chosenDate: null, chosenTime: null, dateRange: window, probeActive: false });
        expect(plan.pastVotes.at(-1)).toMatchObject({ date: SAT, round: 2 });
    });

    it('starts the chasing over when a window moves', () => {
        const collecting = setPlan({ status: 'collecting', chosenDate: null, lastRemindedAt: 'then', allInNotifiedAt: 'then' });
        const same = planEdit(collecting, form({ set: false, window: collecting.dateRange, allowedWeekdays: [6], name: 'Quiz night' })).plan;
        expect(same).toMatchObject({ lastRemindedAt: 'then', allInNotifiedAt: 'then' });
        const moved = planEdit(collecting, form({ set: false, window: { start: '2026-10-01', end: '2026-10-21' }, allowedWeekdays: [6] })).plan;
        expect(moved).toMatchObject({ lastRemindedAt: null, allInNotifiedAt: null });
    });

    it('names whoever turns a repeat on or changes it, and nobody once it stops', () => {
        const ali = { id: 'ali', name: 'Ali' };
        const on = planEdit(setPlan(), form({ repeatWeeks: 2 }), ali).plan;
        expect(on.repeatBy).toEqual(ali);

        const sam = { id: 'sam', name: 'Sam' };
        expect(planEdit(on, form({ repeatWeeks: 2, name: 'Quiz night' }), sam).plan.repeatBy).toEqual(ali);
        expect(planEdit(on, form({ repeatWeeks: 4 }), sam).plan.repeatBy).toEqual(sam);
        expect(planEdit(on, form({ repeatWeeks: null }), sam).plan.repeatBy).toBe(null);
    });

    it('takes people off and puts new ones on fresh', () => {
        const { plan } = planEdit(setPlan(), form({ participantIds: ['bo', 'fi'] }));
        expect(plan.participants.map((p) => p.userId)).toEqual(['bo', 'fi']);
        expect(plan.participants[1]).toMatchObject({ in: null, vote: null, invited: true });
    });

    it('folds an older plan\'s note into what it is about', () => {
        const { plan } = planEdit(setPlan({ description: 'Camping', chosenNote: 'bring boots' }), form({ description: 'Camping bring boots' }));
        expect(plan).toMatchObject({ description: 'Camping bring boots', chosenNote: null });
    });
});

describe('applyPlanEdit', () => {
    it('lands only on the rev it read, and moves it on with who saved', async () => {
        const before = setPlan({ rev: 4 });
        store.plan = before;
        await applyPlanEdit(before, planEdit(before, form({ name: 'Quiz night' })), { id: 'ali', name: 'Ali' });
        expect(store.writes[0].filter).toEqual({ planId: 'p1', rev: 4 });
        expect(store.writes[0].update.$inc).toEqual({ rev: 1 });
        expect(store.writes[0].update.$set.revBy).toEqual({ id: 'ali', name: 'Ali' });
    });

    it('reads a plan from before rev as rev 0', async () => {
        const before = setPlan();
        await applyPlanEdit(before, planEdit(before, form({ name: 'Quiz night' })));
        expect(store.writes[0].filter.rev).toEqual({ $in: [null, 0] });
    });

    it('writes only what changed', async () => {
        const before = setPlan();
        await applyPlanEdit(before, planEdit(before, form({ name: 'Quiz night' })));
        const { revBy, ...set } = store.writes[0].update.$set;
        expect(revBy).toBe(null);
        expect(set).toEqual({ name: 'Quiz night' });
    });

    it('hands back null and writes nothing more when another save got there first', async () => {
        store.matched = 0;
        const before = setPlan();
        expect(await applyPlanEdit(before, planEdit(before, form({ participantIds: ['bo'] })))).toBe(null);
        expect(store.writes).toHaveLength(1);
    });

    it('clears answers in place, and puts a day moved back to its answers back after', async () => {
        const away = planEdit(setPlan(), form({ date: '2026-10-17' })).plan;
        await applyPlanEdit(away, planEdit(away, form({ date: SAT })));
        expect(store.writes[0].update.$set).toMatchObject({ 'participants.$[].vote': null, 'participants.$[].invited': true, chosenDate: SAT });
        expect(store.bulk.map((op) => op.updateOne.filter['participants.userId'])).toEqual(['bo', 'cy']);
    });

    it('takes people off in a write of its own, and adds new ones the way any add does', async () => {
        const before = setPlan();
        store.plan = before;
        await applyPlanEdit(before, planEdit(before, form({ participantIds: ['bo', 'fi'] })));
        expect(store.writes[1].update).toEqual({ $pull: { participants: { userId: { $in: ['cy', 'di'] } } } });
        expect(store.writes[2].update.$push.participants.$each.map((p) => p.userId)).toEqual(['fi']);
    });
});
