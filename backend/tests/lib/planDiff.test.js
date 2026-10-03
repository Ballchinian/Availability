import { describe, it, expect } from 'vitest';
import { kindOf, diffPlan, listed, owedOn, whoHears } from '../../../shared/planDiff.js';

/*
    Ali runs it. Bo is in with every day answered, Cy is in with days left, Di hasn't
    said, and Ed said it's not for him.
*/
const people = () => [
    { userId: 'bo', in: true },
    { userId: 'cy', in: true },
    { userId: 'di', in: null },
    { userId: 'ed', in: false }
];

const collect = (over = {}) => ({
    name: 'Pub quiz',
    description: '',
    chosenNote: null,
    status: 'collecting',
    chosenDate: null,
    chosenTime: null,
    dateRange: { start: '2026-10-01', end: '2026-10-14' },
    allowedWeekdays: null,
    repeatWeeks: null,
    participants: people(),
    hostIds: ['ali'],
    ...over
});

const set = (over = {}) =>
    collect({ status: 'closed', chosenDate: '2026-10-10', chosenTime: '19:00', ...over });

//The same people with their yes or no for a set day
const voted = (votes) => people().map((p) => ({ ...p, vote: votes[p.userId] ?? null, override: null, invited: true }));

const covered = { state: 'covered', daysLeft: 0, lastCovered: '2026-10-14', total: 14 };
const partial = { state: 'partial', daysLeft: 3, lastCovered: '2026-10-11', total: 14 };

const ids = (heard) => heard.map((h) => h.userId);

describe('kindOf', () => {
    it('reads a plan with its day as set, and anything else as finding one', () => {
        expect(kindOf(set())).toBe('set');
        expect(kindOf(collect())).toBe('collect');
        expect(kindOf(collect({ status: 'closed' }))).toBe('collect');
    });
});

describe('diffPlan', () => {
    it('finds nothing in a plan left as it was', () => {
        expect(diffPlan(collect(), collect())).toEqual([]);
        expect(diffPlan(set(), set())).toEqual([]);
    });

    it('keeps the old name beside the new one', () => {
        expect(diffPlan(collect(), collect({ name: 'Quiz night' }))).toEqual([{ type: 'name', from: 'Pub quiz', to: 'Quiz night' }]);
    });

    it('reads an older plan whose note was folded into what it is about as unchanged', () => {
        const old = set({ description: 'Camping', chosenNote: 'bring boots' });
        expect(diffPlan(old, set({ description: 'Camping bring boots' }))).toEqual([]);
        expect(diffPlan(old, set({ description: 'Camping' }))).toEqual([{ type: 'description', to: 'Camping' }]);
    });

    it('says a day was set, with its time', () => {
        expect(diffPlan(collect(), set())).toEqual([{ type: 'set', date: '2026-10-10', time: '19:00' }]);
    });

    it('says where a day moved from', () => {
        expect(diffPlan(set(), set({ chosenDate: '2026-10-17' }))).toEqual([{ type: 'day', from: '2026-10-10', date: '2026-10-17', time: '19:00' }]);
    });

    it('says only the time changed when the day stayed', () => {
        expect(diffPlan(set(), set({ chosenTime: null }))).toEqual([{ type: 'time', from: '19:00', to: null }]);
    });

    //The stored window of a set plan is stretched to reach its day, which is nobody's business
    it('says nothing about the window of a plan that has its day', () => {
        expect(diffPlan(set(), set({ dateRange: { start: '2026-10-01', end: '2026-10-20' } }))).toEqual([]);
    });

    it('says what a plan sent back for dates now asks about', () => {
        expect(diffPlan(set(), collect({ dateRange: { start: '2026-11-01', end: '2026-11-14' }, allowedWeekdays: [0, 6] }))).toEqual([
            { type: 'collect', start: '2026-11-01', end: '2026-11-14', allowedWeekdays: [0, 6] }
        ]);
    });

    it('counts a window and its days as one change', () => {
        const after = collect({ dateRange: { start: '2026-10-01', end: '2026-10-21' }, allowedWeekdays: [5, 6] });
        expect(diffPlan(collect(), after)).toEqual([{ type: 'window', start: '2026-10-01', end: '2026-10-21', allowedWeekdays: [5, 6] }]);
    });

    it('reads every day ticked as the same ask as no restriction', () => {
        expect(diffPlan(collect(), collect({ allowedWeekdays: [0, 1, 2, 3, 4, 5, 6] }))).toEqual([]);
        expect(diffPlan(collect({ allowedWeekdays: [6, 0] }), collect({ allowedWeekdays: [0, 6] }))).toEqual([]);
    });

    it('says a repeat starting and stopping', () => {
        expect(diffPlan(set(), set({ repeatWeeks: 2 }))).toEqual([{ type: 'repeat', from: null, to: 2 }]);
        expect(diffPlan(set({ repeatWeeks: 2 }), set())).toEqual([{ type: 'repeat', from: 2, to: null }]);
    });

    it('names who came on and who went off', () => {
        const after = collect({ participants: [...people().filter((p) => p.userId !== 'cy'), { userId: 'fi' }] });
        expect(diffPlan(collect(), after)).toEqual([
            { type: 'added', ids: ['fi'] },
            { type: 'removed', ids: ['cy'] }
        ]);
    });

    it('names who started and stopped running it', () => {
        expect(diffPlan(collect({ hostIds: ['ali', 'sam'] }), collect({ hostIds: ['ali', 'jo'] }))).toEqual([
            { type: 'hosts', added: ['jo'], removed: ['sam'] }
        ]);
    });

    it('lists the changes in the order a message reads them', () => {
        const after = set({ name: 'Quiz night', description: 'Upstairs', repeatWeeks: 1, participants: [...people(), { userId: 'fi' }] });
        expect(diffPlan(collect(), after).map((c) => c.type)).toEqual(['name', 'description', 'set', 'repeat', 'added']);
    });
});

describe('listed', () => {
    it('leaves out who comes and who runs it', () => {
        const changes = [
            { type: 'name', from: 'a', to: 'b' },
            { type: 'added', ids: ['fi'] },
            { type: 'removed', ids: ['cy'] },
            { type: 'hosts', added: ['jo'], removed: [] }
        ];
        expect(listed(changes)).toEqual([{ type: 'name', from: 'a', to: 'b' }]);
    });
});

describe('owedOn', () => {
    it('owes a yes or no on a set day until there is one, theirs or a call made for them', () => {
        const plan = set();
        expect(owedOn({ in: true, vote: null }, plan, null)).toBe('vote');
        expect(owedOn({ in: true, vote: 'no' }, plan, null)).toBe(null);
        expect(owedOn({ in: null, override: 'yes' }, plan, null)).toBe(null);
    });

    it('owes nothing on a set day they were left off, or after saying not for me', () => {
        expect(owedOn({ in: true, invited: false }, set(), null)).toBe(null);
        expect(owedOn({ in: false }, set(), null)).toBe(null);
    });

    it('owes what coverage says on a plan finding its day', () => {
        expect(owedOn({ in: null }, collect(), covered)).toBe('answer');
        expect(owedOn({ in: true }, collect(), partial)).toBe('days');
        expect(owedOn({ in: true }, collect(), covered)).toBe(null);
        expect(owedOn({ in: false }, collect(), partial)).toBe(null);
    });
});

describe('whoHears', () => {
    //Where each person stood on the collect plan above: Bo done, Cy owing days, Di not said
    const asked = { bo: null, cy: 'days', di: 'answer', ed: null };
    const owed = (after) => Object.fromEntries(Object.entries(asked).map(([id, had]) => [id, { before: had, after: after[id] ?? null }]));

    //Pathway 7
    it('sends a day being set loudly to everyone in or yet to say, and never to anyone out', () => {
        const after = set({ participants: voted({}) });
        const heard = whoHears(collect(), after, { owed: owed({ bo: 'vote', cy: 'vote', di: 'vote' }) });
        expect(heard).toEqual([
            { userId: 'bo', why: 'vote' },
            { userId: 'cy', why: 'changed' },
            { userId: 'di', why: 'changed' }
        ]);
    });

    it('sends a day set quietly only to whoever owed nothing before it', () => {
        const after = set({ participants: voted({}) });
        expect(ids(whoHears(collect(), after, { quiet: true, owed: owed({ bo: 'vote', cy: 'vote', di: 'vote' }) }))).toEqual(['bo']);
    });

    //Pathway 10
    it('sends a window moved loudly to everyone on it, saying who now owes days', () => {
        const after = collect({ dateRange: { start: '2026-10-01', end: '2026-10-21' } });
        expect(whoHears(collect(), after, { owed: owed({ bo: 'days', cy: 'days', di: 'answer' }) })).toEqual([
            { userId: 'bo', why: 'days' },
            { userId: 'cy', why: 'changed' },
            { userId: 'di', why: 'changed' }
        ]);
    });

    //Pathway 11
    it('sends a window moved quietly only to whoever was done and now owes days', () => {
        const after = collect({ dateRange: { start: '2026-10-01', end: '2026-10-21' } });
        expect(whoHears(collect(), after, { quiet: true, owed: owed({ bo: 'days', cy: 'days', di: 'answer' }) })).toEqual([{ userId: 'bo', why: 'days' }]);
    });

    //Pathway 12
    it('sends a day fixed quietly before anyone answered to nobody', () => {
        const before = set({ participants: voted({}) });
        const after = set({ chosenDate: '2026-10-11', participants: voted({}) });
        const all = { before: 'vote', after: 'vote' };
        expect(whoHears(before, after, { quiet: true, owed: { bo: all, cy: all, di: all } })).toEqual([]);
    });

    it('sends a day fixed quietly to whoever had answered for the old one', () => {
        const before = set({ participants: voted({ bo: 'yes', di: 'no' }) });
        const after = set({ chosenDate: '2026-10-11', participants: voted({}) });
        const owedNow = { bo: { before: null, after: 'vote' }, cy: { before: 'vote', after: 'vote' }, di: { before: null, after: 'vote' } };
        expect(whoHears(before, after, { quiet: true, owed: owedNow })).toEqual([
            { userId: 'bo', why: 'cleared' },
            { userId: 'di', why: 'cleared' }
        ]);
    });

    it('leaves out someone a day moved back to has their answer back for', () => {
        const before = set({ participants: voted({ bo: 'yes' }) });
        const after = set({ chosenDate: '2026-10-03', participants: voted({ bo: 'yes' }) });
        expect(ids(whoHears(before, after, { quiet: true }))).toEqual([]);
    });

    //Pathway 13's half that is about DMs: a rename is posted, not sent
    it('sends a new name to nobody', () => {
        expect(whoHears(collect(), collect({ name: 'Quiz night' }), { owed: owed(asked) })).toEqual([]);
    });

    it('sends what it is about to everyone once there is a day, and to nobody before', () => {
        expect(ids(whoHears(set({ participants: voted({}) }), set({ description: 'Upstairs', participants: voted({}) })))).toEqual(['bo', 'cy', 'di']);
        expect(whoHears(collect(), collect({ description: 'Upstairs' }), { owed: owed(asked) })).toEqual([]);
    });

    //Pathway 14
    it('tells nobody else about people coming on and going off', () => {
        const after = collect({ participants: [...people().filter((p) => p.userId !== 'cy'), { userId: 'fi', in: null }] });
        expect(whoHears(collect(), after, { owed: owed(asked) })).toEqual([]);
        expect(whoHears(collect(), after, { quiet: true, owed: owed(asked) })).toEqual([]);
    });

    it('never sends a set day to someone left off it', () => {
        const before = set({ participants: voted({}).map((p) => (p.userId === 'cy' ? { ...p, invited: false } : p)) });
        const after = set({ chosenTime: '20:00', participants: before.participants });
        expect(ids(whoHears(before, after))).toEqual(['bo', 'di']);
    });
});
