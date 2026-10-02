import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { todayIn } from '../../src/lib/zones.js';
import { shiftDate } from '../../src/lib/dates.js';
import { MAX_PARTICIPANTS } from '../../src/lib/limits.js';

/*
    Starting a plan, as far as who ends up running it. Ali starts them. Sam and Jo are
    in the server without the planner role, Bo is who gets invited, and Robo is a bot.
*/

let sessionUser = null;
let ctx = null;
const lookups = [];

vi.mock('../../src/lib/session.js', () => ({
    requireUser: (req, res, next) => {
        req.user = sessionUser;
        next();
    }
}));
vi.mock('../../src/api/context.js', () => ({ guildContext: vi.fn(async () => ctx) }));
const db = vi.hoisted(() => ({
    createPlan: vi.fn(async (fields) => ({ planId: 'ab12cd34ef', ...fields })),
    setPlanChosen: vi.fn(async (planId) => ({ planId }))
}));
vi.mock('../../src/db/plans.js', () => db);
vi.mock('../../src/bot/plans.js', () => ({ announcePlan: vi.fn(), announceSetPlan: vi.fn() }));
vi.mock('../../src/api/announce.js', () => ({ announceAfter: vi.fn() }));
vi.mock('../../src/bot/util.js', () => ({ planUrl: (planId) => `https://site/#/plan/${planId}` }));
vi.mock('../../src/db/ratelimits.js', () => ({ takeAction: vi.fn(async () => ({ allowed: true })) }));

const { default: guildsRouter } = await import('../../src/api/routes/guilds.js');

const inServer = new Map([['ali', false], ['sam', false], ['jo', false], ['bo', false], ['robo', true]]);
const guild = {
    members: {
        cache: new Map(),
        fetch: async (id) => {
            lookups.push(id);
            if (!inServer.has(id)) throw new Error('Unknown Member');
            return { id, user: { bot: inServer.get(id) } };
        }
    }
};
const asPlanner = {
    guild,
    cfg: { guildId: 'g1', guildName: 'The server', timeZone: 'Europe/London' },
    member: { displayName: 'Ali' },
    isMember: true,
    isPlanner: true,
    canManage: false
};

const ahead = (days) => shiftDate(todayIn('Europe/London'), days);
const form = (over = {}) => ({ name: 'Board games', start: ahead(3), end: ahead(9), participantIds: ['bo'], ...over });

let server;
let base;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/guilds', guildsRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/guilds`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    vi.clearAllMocks();
    lookups.length = 0;
    sessionUser = { id: 'ali' };
    ctx = asPlanner;
});

const start = (body) =>
    fetch(`${base}/g1/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const made = () => db.createPlan.mock.calls[0][0];

describe('who runs a new plan', () => {
    it('is whoever made it, when nobody else is picked', async () => {
        expect((await start(form())).status).toBe(200);
        expect(made().hostIds).toEqual(['ali']);
    });

    it('is them and everyone they picked, in the order picked', async () => {
        await start(form({ hostIds: ['sam', 'jo'] }));
        expect(made().hostIds).toEqual(['ali', 'sam', 'jo']);
    });

    //Running a plan and coming to it are two lists, and neither feeds the other
    it('leaves someone picked to run it off the guest list', async () => {
        await start(form({ hostIds: ['sam'] }));
        expect(made().participantIds).toEqual(['bo']);
    });

    it('takes no planner role to be picked', async () => {
        await start(form({ hostIds: ['bo'] }));
        expect(made().hostIds).toEqual(['ali', 'bo']);
    });

    it('holds whoever made it once, even when the form names them', async () => {
        await start(form({ hostIds: ['sam', 'ali'] }));
        expect(made().hostIds).toEqual(['ali', 'sam']);
    });

    it('leaves out a bot and anyone not in the server', async () => {
        const res = await start(form({ hostIds: ['robo', 'gone', 'sam'] }));
        expect(made().hostIds).toEqual(['ali', 'sam']);
        expect((await res.json()).dropped).toBe(2);
    });

    //The page says "N people were no longer in the server", which is people and not picks
    it('counts someone who has left once, however many lists they were on', async () => {
        const res = await start(form({ participantIds: ['bo', 'gone'], hostIds: ['gone', 'sam'] }));
        expect(await res.json()).toMatchObject({ invited: 1, dropped: 1 });
    });

    it('reads anything that is not a list as nobody picked', async () => {
        await start(form({ hostIds: 'sam' }));
        expect(made().hostIds).toEqual(['ali']);
    });

    //Each id Discord has to be asked about is a round trip, so the list is turned away before any
    it('turns away more people than a plan can hold, without looking any of them up', async () => {
        const res = await start(form({ hostIds: Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, i) => `x${i}`) }));
        expect(res.status).toBe(400);
        expect(lookups).toEqual([]);
        expect(db.createPlan).not.toHaveBeenCalled();
    });

    it('never takes who made it from the form', async () => {
        await start(form({ createdBy: 'sam' }));
        expect(made()).toMatchObject({ createdBy: 'ali', hostIds: ['ali'] });
    });

    it('holds for a plan made with its day already set', async () => {
        await start(form({ announce: true, date: ahead(5), hostIds: ['sam'] }));
        expect(made().hostIds).toEqual(['ali', 'sam']);
    });
});

describe('starting a plan without the planner role', () => {
    //Running someone else's plan is all Sam can do. Starting one is the planner's.
    it('is refused', async () => {
        sessionUser = { id: 'sam' };
        ctx = { ...asPlanner, isPlanner: false, member: { displayName: 'Sam' } };

        const res = await start(form());
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(/planner role/);
        expect(db.createPlan).not.toHaveBeenCalled();
    });
});
