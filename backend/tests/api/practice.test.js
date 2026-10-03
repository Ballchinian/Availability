import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';

/*
    A planner's made-up people. Ali plans in g1 and not in g2. The people themselves sit in
    a list standing in for the collection, and the limit is the real one.
*/

let sessionUser = null;
const stored = [];
//Where the requester plans, by server
const planner = new Map();

vi.mock('../../src/lib/session.js', () => ({
    requireUser: (req, res, next) => {
        req.user = sessionUser;
        next();
    }
}));
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
