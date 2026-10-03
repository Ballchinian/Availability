import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { shiftDate } from '../../src/lib/dates.js';
import { todayIn } from '../../src/lib/zones.js';
import { EDIT_LIMIT } from '../../src/lib/limits.js';

/*
    The edit route: who can save, what a stale form gets, what a preview hands back and
    what a save writes, records and queues. Ali made the plan and runs it with Sam. Bo
    and Cy are on it, Di is in the server and not, and Gone has left the server.
*/

let sessionUser = null;
let realUser = null;
let ctx = null;
const plans = new Map();
const lookups = [];

const { stubs } = vi.hoisted(() => ({ stubs: (...names) => Object.fromEntries(names.map((n) => [n, vi.fn()])) }));

vi.mock('../../src/lib/session.js', () => ({
    requireUser: (req, res, next) => {
        req.user = sessionUser;
        req.realUser = realUser || sessionUser;
        next();
    }
}));
vi.mock('../../src/api/context.js', () => ({ guildContext: vi.fn(async () => ctx) }));
//Pat and Lou are Ali's made-up people
const madeUp = vi.hoisted(() => [
    { id: 'practice_pat', ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: false },
    { id: 'practice_lou', ownerId: 'ali', guildId: 'g1', displayName: 'Lou', planner: true }
]);
//A practice plan's thread: the pin, and a post after it
const kept = vi.hoisted(() => [
    { id: 'm2', planId: 'p1', to: 'thread', content: 'Later', components: [], pinned: false, at: new Date('2026-10-02'), editedAt: null },
    { id: 'm1', planId: 'p1', to: 'thread', content: 'Pinned', components: [], pinned: true, at: new Date('2026-10-01'), editedAt: null }
]);
vi.mock('../../src/db/outbox.js', async (real) => ({ ...(await real()), getOutbox: vi.fn(async (to, planId) => kept.filter((m) => m.to === to && m.planId === planId)) }));
vi.mock('../../src/db/practice.js', () => ({
    getPracticePerson: async (id) => madeUp.find((p) => p.id === id) || null,
    getPracticePeople: async (ownerId, guildId) => madeUp.filter((p) => p.ownerId === ownerId && p.guildId === guildId),
    getPracticePeopleById: async (ids) => madeUp.filter((p) => ids.includes(p.id))
}));

//planEdit is the real one. Saving stands in for the guarded write: it lands only on the rev it was read at.
vi.mock('../../src/db/plans.js', async (real) => ({
    ...(await real()),
    getPlan: vi.fn(async (planId) => structuredClone(plans.get(planId) || null)),
    applyPlanEdit: vi.fn(async (plan, edit, by) => {
        const stored = plans.get(plan.planId);
        if ((stored.rev || 0) !== (plan.rev || 0)) return null;
        plans.set(plan.planId, { ...structuredClone(edit.plan), rev: (plan.rev || 0) + 1, revBy: by });
        return structuredClone(plans.get(plan.planId));
    }),
    addPlanEvent: vi.fn()
}));
vi.mock('../../src/bot/plans.js', () => stubs('announceEdit'));
vi.mock('../../src/bot/util.js', () => stubs('threadUrl'));
vi.mock('../../src/api/announce.js', () => stubs('announceAfter'));
vi.mock('../../src/db/ratelimits.js', () => ({ takeAction: vi.fn(async () => ({ allowed: true })), refundAction: vi.fn() }));
vi.mock('../../src/db/users.js', () => ({ getPlanningPrefs: vi.fn(async () => ({})) }));

const db = await import('../../src/db/plans.js');
const bot = await import('../../src/bot/plans.js');
const { announceAfter } = await import('../../src/api/announce.js');
const { takeAction } = await import('../../src/db/ratelimits.js');
const { default: plansRouter } = await import('../../src/api/routes/plans.js');

const NAMES = { ali: 'Ali', sam: 'Sam', bo: 'Bo', cy: 'Cy', di: 'Di' };
const guild = {
    id: 'g1',
    members: {
        cache: new Map(),
        fetch: async (id) => {
            lookups.push(id);
            if (!NAMES[id]) throw new Error('Unknown Member');
            return { id, displayName: NAMES[id], displayAvatarURL: () => '', user: { bot: false } };
        }
    }
};
const asHost = (id, over = {}) => ({
    guild,
    cfg: { guildId: 'g1', guildName: 'The server', timeZone: 'Europe/London' },
    member: { displayName: NAMES[id] },
    isMember: true,
    isPlanner: true,
    canManage: false,
    ...over
});

const ahead = (days) => shiftDate(todayIn('Europe/London'), days);

const stored = (over = {}) => ({
    planId: 'p1',
    guildId: 'g1',
    name: 'Board games',
    description: '',
    status: 'collecting',
    chosenDate: null,
    chosenTime: null,
    timeZone: 'Europe/London',
    dateRange: { start: ahead(1), end: ahead(14) },
    allowedWeekdays: null,
    repeatWeeks: null,
    createdBy: 'ali',
    hostIds: ['ali', 'sam'],
    participants: [
        { userId: 'bo', in: true, invited: true },
        { userId: 'cy', in: null, invited: true }
    ],
    history: [],
    ...over
});

//What the form sends for the plan as it stands, before anything in it is touched
const form = (over = {}) => ({
    rev: 0,
    name: 'Board games',
    description: '',
    start: ahead(1),
    end: ahead(14),
    allowedWeekdays: null,
    participantIds: ['bo', 'cy'],
    hostIds: ['sam'],
    repeatWeeks: null,
    ...over
});

let server;
let base;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/plans', plansRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/plans`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    vi.clearAllMocks();
    lookups.length = 0;
    plans.clear();
    plans.set('p1', stored());
    sessionUser = { id: 'ali' };
    realUser = null;
    ctx = asHost('ali');
});

const edit = (body) =>
    fetch(`${base}/p1/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const errorOf = async (res) => (await res.json()).error;

describe('who can save an edit', () => {
    it('is whoever runs the plan, planner role or not', async () => {
        sessionUser = { id: 'sam' };
        ctx = asHost('sam', { isPlanner: false });
        expect((await edit(form({ name: 'Quiz night', hostIds: ['ali'] }))).status).toBe(200);
    });
});

describe('a form opened before someone else saved', () => {
    it('is refused with who changed the plan, and writes nothing', async () => {
        plans.set('p1', stored({ rev: 3, revBy: { id: 'sam', name: 'Sam' } }));
        const res = await edit(form({ name: 'Quiz night' }));
        expect(res.status).toBe(409);
        expect(await errorOf(res)).toBe('Sam changed this plan while you were editing. Reload to see their changes.');
        expect(db.applyPlanEdit).not.toHaveBeenCalled();
    });

    it('says so differently when it was them, somewhere else', async () => {
        plans.set('p1', stored({ rev: 1, revBy: { id: 'ali', name: 'Ali' } }));
        expect(await errorOf(await edit(form({ name: 'Quiz night' })))).toMatch(/^You changed this plan somewhere else/);
    });

    //Pathway 21
    it('lets the first of two saves from the same version through and refuses the second', async () => {
        expect((await edit(form({ name: 'Quiz night' }))).status).toBe(200);
        const second = await edit(form({ name: 'Games night' }));
        expect(second.status).toBe(409);
        expect(plans.get('p1').name).toBe('Quiz night');
        expect(db.addPlanEvent).toHaveBeenCalledTimes(1);
    });

    //A preview that came back fine and a save that lost the race to someone else's
    it('is refused when another save lands between reading the plan and writing it', async () => {
        db.applyPlanEdit.mockResolvedValueOnce(null);
        const res = await edit(form({ name: 'Quiz night' }));
        expect(res.status).toBe(409);
        expect(announceAfter).not.toHaveBeenCalled();
    });
});

describe('what an edit can do', () => {
    it('refuses a save that changes nothing', async () => {
        const res = await edit(form());
        expect(res.status).toBe(400);
        expect(await errorOf(res)).toBe('Nothing has changed yet.');
    });

    //Pathway 15
    it('does not turn a repeat on for someone without the planner role, and lets them stop one', async () => {
        sessionUser = { id: 'sam' };
        ctx = asHost('sam', { isPlanner: false });
        const set = { announce: true, date: ahead(5), time: null };
        plans.set('p1', stored({ status: 'closed', chosenDate: ahead(5), repeatWeeks: 2 }));
        expect((await edit(form({ ...set, hostIds: ['ali'], repeatWeeks: 1 }))).status).toBe(403);
        expect((await edit(form({ ...set, hostIds: ['ali'], repeatWeeks: null }))).status).toBe(200);
        expect(plans.get('p1').repeatWeeks).toBe(null);
    });

    it('does not let anyone but whoever made the plan take them off running it', async () => {
        sessionUser = { id: 'sam' };
        ctx = asHost('sam');
        const res = await edit(form({ hostIds: [], name: 'Quiz night' }));
        expect(res.status).toBe(403);
        expect(await errorOf(res)).toBe('Only whoever made this plan can stop running it.');
    });

    it('keeps whoever saves running it, and lets whoever made it take someone else off', async () => {
        await edit(form({ hostIds: [] }));
        expect(plans.get('p1').hostIds).toEqual(['ali']);
    });

    it('takes anyone running it who has left the server off, without counting that as a change', async () => {
        plans.set('p1', stored({ hostIds: ['ali', 'sam', 'gone'] }));
        expect((await edit(form())).status).toBe(400);
        await edit(form({ name: 'Quiz night' }));
        expect(plans.get('p1').hostIds).toEqual(['ali', 'sam']);
        expect(db.addPlanEvent.mock.calls[0][1].changes.map((c) => c.type)).toEqual(['name']);
    });

    it('asks Discord only about the people the plan has never had', async () => {
        await edit(form({ participantIds: ['bo', 'cy', 'di'] }));
        expect(lookups.filter((id) => id === 'bo' || id === 'cy')).toEqual([]);
        expect(plans.get('p1').participants.map((p) => p.userId)).toEqual(['bo', 'cy', 'di']);
    });

    it('takes someone off when they are left out', async () => {
        await edit(form({ participantIds: ['bo'] }));
        expect(plans.get('p1').participants.map((p) => p.userId)).toEqual(['bo']);
    });

    //1pm UTC on the 26th, which is the 27th in Auckland and still the 26th nearly everywhere else
    it('reads today as the date where the server is', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-26T13:00:00Z'));
        try {
            const on = (timeZone) => plans.set('p1', stored({ timeZone, dateRange: { start: '2026-09-20', end: '2026-10-10' } }));
            const day = form({ announce: true, date: '2026-09-26', time: null });

            on('Pacific/Auckland');
            const there = await edit(day);
            expect(there.status).toBe(400);
            expect(await errorOf(there)).toBe('That date is in the past.');

            on('Europe/London');
            expect((await edit(day)).status).toBe(200);
        } finally {
            vi.useRealTimers();
        }
    });

    it('refuses a list with nobody left on it who is in the server', async () => {
        expect(await errorOf(await edit(form({ participantIds: ['gone'] })))).toBe('None of those people are in the server.');
    });

    it('turns away a save past the daily cap without writing it', async () => {
        takeAction.mockResolvedValueOnce({ allowed: false, retryAfterHours: 3 });
        const res = await edit(form({ name: 'Quiz night' }));
        expect(res.status).toBe(429);
        expect(await errorOf(res)).toBe(`You have saved ${EDIT_LIMIT} edits today. Try again in 3 hours.`);
        expect(db.applyPlanEdit).not.toHaveBeenCalled();
    });
});

describe('a preview', () => {
    it('writes nothing, spends nothing and sends nothing', async () => {
        const res = await edit(form({ name: 'Quiz night', preview: true }));
        expect(res.status).toBe(200);
        expect(db.applyPlanEdit).not.toHaveBeenCalled();
        expect(db.addPlanEvent).not.toHaveBeenCalled();
        expect(takeAction).not.toHaveBeenCalled();
        expect(announceAfter).not.toHaveBeenCalled();
    });

    //Pathway 13
    it('leads a rename with the old name and lists only the rename', async () => {
        const body = await (await edit(form({ name: 'Quiz night', preview: true }))).json();
        expect(body.changes).toEqual([{ type: 'name', from: 'Board games', to: 'Quiz night' }]);
        expect(body.messages).toEqual([{ kind: 'post', to: 'thread', text: '**CHANGED**\n\nAli changed **Board games**:\n- now called **Quiz night**' }]);
    });

    it('names who is added and taken off, and what each of them is sent', async () => {
        const body = await (await edit(form({ participantIds: ['bo', 'di'], preview: true }))).json();
        expect(body.changes).toEqual([
            { type: 'added', names: ['Di'] },
            { type: 'removed', names: ['Cy'] }
        ]);
        expect(body.messages).toEqual([
            { kind: 'invite', to: ['Di'], text: '' },
            { kind: 'took off', to: ['Cy'], text: 'Ali took you off "Board games" in The server.' }
        ]);
    });

    it('says who a day being set reaches, loudly and quietly', async () => {
        const body = await (await edit(form({ announce: true, date: ahead(5), time: '19:00', preview: true }))).json();
        expect(body.changes[0]).toMatchObject({ type: 'set', date: ahead(5), time: '19:00' });
        expect(body.messages.map((m) => [m.kind, m.to])).toEqual([
            ['post', 'thread'],
            ['card', ['Bo', 'Cy']]
        ]);
        //Neither owed nothing before: Bo had days to fill in and Cy had not said, so a quiet save rewrites both where they sit
        expect(body.quietly).toEqual([]);
        expect(body).toMatchObject({ asked: 2, settled: 0 });
    });
});

describe('a save', () => {
    it('writes the history once, with names where there were ids, and says if it was quiet', async () => {
        await edit(form({ name: 'Quiz night', participantIds: ['bo', 'di'], quiet: true }));
        expect(db.addPlanEvent).toHaveBeenCalledWith('p1', {
            type: 'edited',
            by: 'ali',
            byName: 'Ali',
            changes: [
                { type: 'name', from: 'Board games', to: 'Quiz night' },
                { type: 'added', names: ['Di'] },
                { type: 'removed', names: ['Cy'] }
            ],
            quiet: true
        });
    });

    it('queues one announcement, with the plan as it was and what changed', async () => {
        await edit(form({ name: 'Quiz night' }));
        expect(announceAfter).toHaveBeenCalledTimes(1);
        const [planId, label, run] = announceAfter.mock.calls[0];
        expect([planId, label]).toEqual(['p1', 'edit']);

        await run(plans.get('p1'));
        const [current, , opts] = bot.announceEdit.mock.calls[0];
        expect(current.name).toBe('Quiz night');
        expect(opts).toMatchObject({ actorName: 'Ali', quiet: false, heard: [], before: { name: 'Board games' } });
        expect(opts.changes).toEqual([{ type: 'name', from: 'Board games', to: 'Quiz night' }]);
    });
});

//Ali's practice plan holds Pat and Ali, and is run by Ali and Lou
describe('editing a practice plan', () => {
    beforeEach(() => {
        plans.set('p1', stored({ practice: 'ali', hostIds: ['ali', 'practice_lou'], participants: [{ userId: 'practice_pat', in: null, invited: true }, { userId: 'ali', in: null, invited: true }] }));
    });
    const practiceForm = (over = {}) => form({ participantIds: ['practice_pat', 'ali'], hostIds: ['practice_lou'], ...over });

    it("takes more of the planner's made-up people", async () => {
        const res = await edit(practiceForm({ hostIds: [], participantIds: ['practice_pat', 'ali', 'practice_lou'], preview: true }));
        expect(res.status).toBe(200);
    });

    it('never takes a real person besides the planner', async () => {
        const res = await edit(practiceForm({ participantIds: ['practice_pat', 'ali', 'bo'] }));
        expect(res.status).toBe(400);
        expect(await errorOf(res)).toBe('A practice plan can only have your made-up people and you on it.');
        expect(db.applyPlanEdit).not.toHaveBeenCalled();
    });

    it('never comes round again', async () => {
        const res = await edit(practiceForm({ announce: true, date: ahead(3), repeatWeeks: 2 }));
        expect(res.status).toBe(400);
        expect(await errorOf(res)).toBe("A practice plan doesn't come round again.");
    });

    it('is not there for anyone else', async () => {
        sessionUser = { id: 'sam' };
        ctx = asHost('sam');
        expect((await edit(practiceForm({ name: 'Quiz night' }))).status).toBe(404);
    });

    it("is there for the planner's made-up people", async () => {
        sessionUser = { id: 'practice_lou' };
        realUser = { id: 'ali' };
        ctx = asHost('ali', { member: { displayName: 'Lou' } });
        expect((await edit(practiceForm({ name: 'Quiz night', hostIds: ['ali'] }))).status).toBe(200);
    });
});

describe('a real plan', () => {
    it('never takes anyone made up', async () => {
        const res = await edit(form({ participantIds: ['bo', 'cy', 'practice_pat'] }));
        expect(res.status).toBe(400);
        expect(await errorOf(res)).toBe('Made-up people can only go on a practice plan.');
    });

    it('is not there for anyone made up', async () => {
        sessionUser = { id: 'practice_lou' };
        realUser = { id: 'ali' };
        expect((await edit(form({ name: 'Quiz night' }))).status).toBe(404);
    });
});

describe("a practice plan's thread", () => {
    const thread = () => fetch(`${base}/p1/thread`);

    it('leads with the pin, then the rest newest first, with names for anyone on it', async () => {
        plans.set('p1', stored({ practice: 'ali', hostIds: ['ali'], participants: [{ userId: 'practice_pat', in: null, invited: true }] }));
        const body = await (await thread()).json();
        expect(body.messages.map((m) => m.content)).toEqual(['Pinned', 'Later']);
        expect(body.names).toEqual({ ali: 'Ali', practice_pat: 'Pat' });
    });

    it('is in Discord for a real plan', async () => {
        expect((await thread()).status).toBe(404);
    });

    it('is only for people on the plan', async () => {
        plans.set('p1', stored({ practice: 'ali', hostIds: ['practice_lou'], participants: [{ userId: 'practice_pat', in: null, invited: true }] }));
        expect((await thread()).status).toBe(403);
    });
});
