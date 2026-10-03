import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';

/*
    A planner's made-up people. Ali plans in g1 and not in g2. The people themselves sit in
    a list standing in for the collection, and the limit is the real one.
*/

let sessionUser = null;
//Set while viewing as someone made up
let realUser = null;
const issued = [];
const stored = [];
//Where the requester plans, by server
const planner = new Map();

vi.mock('../../src/lib/session.js', () => ({
    requireUser: (req, res, next) => {
        req.user = sessionUser;
        req.realUser = realUser || sessionUser;
        next();
    },
    loadSession: async () => (sessionUser ? { user: sessionUser, real: realUser || sessionUser, tv: 3, ended: null } : null),
    issueSession: (res, user, tv, real = null) => issued.push({ user, tv, real })
}));
vi.mock('../../src/db/users.js', () => ({ getTokenVersion: async () => 3 }));
vi.mock('../../src/api/context.js', () => ({
    guildContext: vi.fn(async (guildId, userId, { requirePlanner = false } = {}) => {
        if (!planner.has(guildId)) return { error: 404, message: 'I am not in that server.' };
        const isPlanner = planner.get(guildId);
        if (requirePlanner && !isPlanner) return { error: 403, message: 'You need the planner role to do that.' };
        return { cfg: { guildId, guildName: guildId === 'g1' ? 'The server' : 'Other' }, isMember: true, isPlanner };
    })
}));
vi.mock('../../src/db/practice.js', async () => {
    const { PRACTICE_LIMIT } = await import('../../src/lib/practice.js');
    return {
        getPracticePeople: vi.fn(async (ownerId) => stored.filter((p) => p.ownerId === ownerId)),
        getPracticePerson: vi.fn(async (id) => stored.find((p) => p.id === id) || null),
        addPracticePerson: vi.fn(async (person) => {
            if (stored.filter((p) => p.ownerId === person.ownerId && p.guildId === person.guildId).length >= PRACTICE_LIMIT) return null;
            stored.push(person);
            return person;
        }),
        removePracticePerson: vi.fn(async (id) => {
            stored.splice(stored.findIndex((p) => p.id === id), 1);
            return true;
        })
    };
});
const plans = vi.hoisted(() => ({ removeUserFromGuildPlans: vi.fn(async () => []) }));
vi.mock('../../src/db/plans.js', () => plans);
const availability = vi.hoisted(() => ({ deleteAllForUser: vi.fn(async () => {}) }));
vi.mock('../../src/db/availability.js', () => availability);
const bot = vi.hoisted(() => ({ afterLeaving: vi.fn(async () => {}) }));
const outbox = vi.hoisted(() => [
    { id: 'm2', planId: 'p1', to: 'practice_a', content: 'Hello <@ali>', components: [], pinned: false, at: new Date('2026-10-02'), editedAt: null },
    { id: 'm1', planId: 'p1', to: 'practice_a', content: 'Earlier', components: [], pinned: false, at: new Date('2026-10-01'), editedAt: null }
]);
vi.mock('../../src/db/outbox.js', async (real) => ({
    ...(await real()),
    getOutbox: vi.fn(async (to) => outbox.filter((m) => m.to === to)),
    deleteOutboxFor: vi.fn(async () => {})
}));
vi.mock('../../src/bot/plans.js', () => bot);

const { default: practiceRouter } = await import('../../src/api/routes/practice.js');

let server;
let base;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/practice', practiceRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/practice`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    vi.clearAllMocks();
    stored.length = 0;
    planner.clear();
    planner.set('g1', true);
    planner.set('g2', false);
    sessionUser = { id: 'ali', displayName: 'Ali' };
    realUser = null;
    issued.length = 0;
});

const add = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('making someone up', () => {
    it('makes them for the server, with an id Discord would never hand out', async () => {
        const res = await add({ guildId: 'g1', displayName: '  Pat  ', planner: true });
        const { person } = await res.json();

        expect(res.status).toBe(200);
        expect(person).toMatchObject({ guildId: 'g1', guildName: 'The server', displayName: 'Pat', planner: true });
        expect(person.id).toMatch(/^practice_[0-9a-zA-Z]{10}$/);
        expect(stored[0]).toMatchObject({ ownerId: 'ali', guildId: 'g1' });
    });

    it('takes the planner role where they are made', async () => {
        const res = await add({ guildId: 'g2', displayName: 'Pat' });
        expect(res.status).toBe(403);
        expect(stored).toHaveLength(0);
    });

    it('wants a name, and not a long one', async () => {
        expect((await add({ guildId: 'g1', displayName: '   ' })).status).toBe(400);
        const long = await add({ guildId: 'g1', displayName: 'x'.repeat(33) });
        expect((await long.json()).error).toBe('Keep the name to 32 characters.');
    });

    it('stops at ten in a server', async () => {
        for (let i = 0; i < 10; i++) expect((await add({ guildId: 'g1', displayName: `P${i}` })).status).toBe(200);
        const res = await add({ guildId: 'g1', displayName: 'One more' });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('You have 10 made-up people in The server already.');
    });

    it('is a planner only when asked for in so many words', async () => {
        const { person } = await (await add({ guildId: 'g1', displayName: 'Pat', planner: 'yes' })).json();
        expect(person.planner).toBe(false);
    });
});

describe('the list', () => {
    it('is only their own, and only where they still plan', async () => {
        stored.push(
            { id: 'practice_a', ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: false },
            { id: 'practice_b', ownerId: 'ali', guildId: 'g2', displayName: 'Lou', planner: false },
            { id: 'practice_c', ownerId: 'sam', guildId: 'g1', displayName: 'Kim', planner: true }
        );
        const { people } = await (await fetch(base)).json();
        expect(people).toEqual([{ id: 'practice_a', guildId: 'g1', guildName: 'The server', displayName: 'Pat', planner: false }]);
    });
});

describe('removing someone', () => {
    beforeEach(() => {
        stored.push({ id: 'practice_a', ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: false });
    });

    it('takes them off their plans and clears their calendar', async () => {
        const left = { planId: 'p1', status: 'collecting', dateRange: { start: '2099-01-01', end: '2099-01-09' } };
        plans.removeUserFromGuildPlans.mockResolvedValueOnce([left]);

        const res = await fetch(`${base}/practice_a`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(stored).toHaveLength(0);
        expect(plans.removeUserFromGuildPlans).toHaveBeenCalledWith('g1', 'practice_a', { id: 'ali', name: 'Ali' });
        expect(bot.afterLeaving).toHaveBeenCalledWith(left);
        expect(availability.deleteAllForUser).toHaveBeenCalledWith('practice_a');
    });

    it('needs no planner role', async () => {
        planner.set('g1', false);
        expect((await fetch(`${base}/practice_a`, { method: 'DELETE' })).status).toBe(200);
    });

    it("is never someone else's", async () => {
        sessionUser = { id: 'sam', displayName: 'Sam' };
        expect((await fetch(`${base}/practice_a`, { method: 'DELETE' })).status).toBe(404);
        expect(stored).toHaveLength(1);
    });
});

describe('viewing as someone made up', () => {
    const pat = { id: 'practice_a', ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: false };
    const as = (id) => fetch(`${base}/as/${id}`, { method: 'POST' });

    beforeEach(() => {
        stored.push(pat);
    });

    it('signs the session in as them, with the planner behind it', async () => {
        const res = await as('practice_a');
        expect(res.status).toBe(200);
        expect(issued).toEqual([{ user: { id: 'practice_a', username: '', displayName: 'Pat', avatar: '' }, tv: 3, real: sessionUser }]);
    });

    it("is never someone else's made-up person", async () => {
        sessionUser = { id: 'sam', displayName: 'Sam' };
        expect((await as('practice_a')).status).toBe(404);
        expect(issued).toHaveLength(0);
    });

    it('takes the planner role in their server', async () => {
        planner.set('g1', false);
        expect((await as('practice_a')).status).toBe(403);
        expect(issued).toHaveLength(0);
    });

    //Switching from one to the next goes by who is really there
    it('moves straight on to another of theirs', async () => {
        stored.push({ ...pat, id: 'practice_b', displayName: 'Lou' });
        realUser = { id: 'ali', displayName: 'Ali' };
        sessionUser = { id: 'practice_a', displayName: 'Pat' };
        expect((await as('practice_b')).status).toBe(200);
        expect(issued[0].real).toEqual(realUser);
    });

    it('goes back to the planner', async () => {
        realUser = { id: 'ali', displayName: 'Ali' };
        sessionUser = { id: 'practice_a', displayName: 'Pat' };
        const res = await fetch(`${base}/back`, { method: 'POST' });
        expect(await res.json()).toEqual({ user: realUser, real: null });
        expect(issued).toEqual([{ user: realUser, tv: 3, real: null }]);
    });

    it('makes and removes people as the planner while viewing as one', async () => {
        realUser = { id: 'ali', displayName: 'Ali' };
        sessionUser = { id: 'practice_a', displayName: 'Pat' };
        await add({ guildId: 'g1', displayName: 'Kim' });
        expect(stored.at(-1).ownerId).toBe('ali');
    });
});

describe('the messages of someone made up', () => {
    it('are what the bot kept for them, newest first, with the names they could mention', async () => {
        stored.push({ id: 'practice_a', ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: false });
        realUser = { id: 'ali', displayName: 'Ali' };
        sessionUser = { id: 'practice_a', displayName: 'Pat' };
        const body = await (await fetch(`${base}/messages`)).json();
        expect(body.messages.map((m) => m.id)).toEqual(['m2', 'm1']);
        expect(body.messages[0]).toEqual({ id: 'm2', planId: 'p1', content: 'Hello <@ali>', components: [], pinned: false, at: '2026-10-02T00:00:00.000Z', editedAt: null });
        expect(body.names).toEqual({ ali: 'Ali', practice_a: 'Pat' });
    });

    it('are nothing for someone real', async () => {
        expect(await (await fetch(`${base}/messages`)).json()).toEqual({ messages: [], names: {} });
    });
});
