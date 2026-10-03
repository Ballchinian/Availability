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
//The planner behind a made-up person, while viewing as one
let realUser = null;
let ctx = null;
const lookups = [];

vi.mock('../../src/lib/session.js', () => ({
    requireUser: (req, res, next) => {
        req.user = sessionUser;
        req.realUser = realUser || sessionUser;
        next();
    }
}));
//Pat and Lou are Ali's made-up people, Kim is Sam's
const madeUp = vi.hoisted(() => [
    { id: 'practice_pat', ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: false },
    { id: 'practice_lou', ownerId: 'ali', guildId: 'g1', displayName: 'Lou', planner: true },
    { id: 'practice_kim', ownerId: 'sam', guildId: 'g1', displayName: 'Kim', planner: false }
]);
vi.mock('../../src/db/practice.js', () => ({
    getPracticePerson: async (id) => madeUp.find((p) => p.id === id) || null,
    getPracticePeople: async (ownerId, guildId) => madeUp.filter((p) => p.ownerId === ownerId && p.guildId === guildId),
    getPracticePeopleById: async (ids) => madeUp.filter((p) => ids.includes(p.id))
}));
vi.mock('../../src/api/context.js', () => ({ guildContext: vi.fn(async () => ctx) }));
const db = vi.hoisted(() => ({
    createPlan: vi.fn(async (fields) => ({ planId: 'ab12cd34ef', ...fields })),
    setPlanChosen: vi.fn(async (planId) => ({ planId }))
}));
vi.mock('../../src/db/plans.js', () => db);
const bot = vi.hoisted(() => ({ announcePlan: vi.fn(), announceSetPlan: vi.fn(), notifyHostsPicked: vi.fn() }));
vi.mock('../../src/bot/plans.js', () => bot);
const queued = vi.hoisted(() => ({ announceAfter: vi.fn() }));
vi.mock('../../src/api/announce.js', () => queued);
vi.mock('../../src/bot/util.js', () => ({ planUrl: (planId) => `https://site/#/plan/${planId}` }));
vi.mock('../../src/db/ratelimits.js', () => ({ takeAction: vi.fn(async () => ({ allowed: true })) }));

const { default: guildsRouter } = await import('../../src/api/routes/guilds.js');

const inServer = new Map([['ali', false], ['sam', false], ['jo', false], ['bo', false], ['robo', true]]);
const guild = {
    id: 'g1',
    members: {
        cache: new Map(),
        fetch: async (id) => {
            lookups.push(id);
            if (!inServer.has(id)) throw new Error('Unknown Member');
            return { id, user: { bot: inServer.get(id), username: id }, displayName: id, displayAvatarURL: () => '' };
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
    realUser = null;
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

//The thread never says why they are in it, so each of them is DMed once, after the plan is announced
describe('telling the people picked to run it', () => {
    //What the queue runs, by label, each with the plan as it stands by then
    const jobs = () => queued.announceAfter.mock.calls.map(([, label, run]) => ({ label, run }));

    it('comes after the announcement, from whoever made the plan', async () => {
        await start(form({ hostIds: ['sam'] }));
        expect(jobs().map((j) => j.label)).toEqual(['announce', 'hosts picked']);

        const current = { planId: 'ab12cd34ef', hostIds: ['ali', 'sam'] };
        await jobs()[1].run(current);
        expect(bot.notifyHostsPicked).toHaveBeenCalledWith(current, 'ali');
    });

    it('comes for a plan made with its day set too', async () => {
        await start(form({ announce: true, date: ahead(5), hostIds: ['sam'] }));
        expect(jobs().map((j) => j.label)).toEqual(['set-plan announce', 'hosts picked']);
    });
});

//Coming round is always the day it was on some weeks later, which a plan finding its day does not have yet
describe('a repeat on a new plan', () => {
    it('is kept on a plan made with its day, as set by whoever made it', async () => {
        await start(form({ announce: true, date: ahead(5), repeatWeeks: 2 }));
        expect(made()).toMatchObject({ repeatWeeks: 2, repeatBy: { id: 'ali', name: 'Ali' } });
    });

    it('is not kept on a plan asking about dates', async () => {
        await start(form({ repeatWeeks: 2 }));
        expect(made().repeatWeeks).toBe(null);
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

//A plan holding anyone made up is for practice, and holds only that planner's made-up people and them
describe('a practice plan', () => {
    const { MIXED } = { MIXED: 'A practice plan can only have your made-up people and you on it.' };

    it('is what naming made-up people starts, for the planner, never coming round', async () => {
        const res = await start(form({ participantIds: ['practice_pat', 'ali'], hostIds: ['practice_lou'], announce: true, date: ahead(4), repeatWeeks: 2 }));
        expect(res.status).toBe(200);
        expect(made()).toMatchObject({ practice: 'ali', participantIds: ['practice_pat', 'ali'], hostIds: ['ali', 'practice_lou'], repeatWeeks: null });
        expect(lookups).toEqual(['ali']);
    });

    it('is not one for a real plan, whatever the form says', async () => {
        await start(form({ practice: 'ali' }));
        expect(made().practice).toBe(null);
    });

    it('never has a real person on it besides the planner', async () => {
        const res = await start(form({ participantIds: ['practice_pat', 'bo'] }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(MIXED);
        expect(db.createPlan).not.toHaveBeenCalled();
    });

    it("never has someone else's made-up people", async () => {
        const res = await start(form({ participantIds: ['practice_pat', 'practice_kim'] }));
        expect(res.status).toBe(400);
        expect(db.createPlan).not.toHaveBeenCalled();
    });

    it('is any plan a made-up planner starts, for the planner behind them', async () => {
        sessionUser = { id: 'practice_lou' };
        realUser = { id: 'ali' };
        ctx = { ...asPlanner, member: { displayName: 'Lou' }, practice: madeUp[1] };
        await start(form({ participantIds: ['practice_pat'] }));
        expect(made()).toMatchObject({ practice: 'ali', createdBy: 'practice_lou', hostIds: ['practice_lou'], participantIds: ['practice_pat'] });
    });

    it('cannot hold a real person a made-up planner names', async () => {
        sessionUser = { id: 'practice_lou' };
        realUser = { id: 'ali' };
        ctx = { ...asPlanner, member: { displayName: 'Lou' }, practice: madeUp[1] };
        expect((await start(form({ participantIds: ['bo'] }))).status).toBe(400);
    });
});

describe('who the picker offers for practice', () => {
    const offered = async (query = '') => (await (await fetch(`${base}/g1/members${query}`)).json()).members.map((m) => m.id);

    it('is the planner and their made-up people when they ask for it', async () => {
        expect(await offered('?practice=1')).toEqual(['ali', 'practice_pat', 'practice_lou']);
    });

    it('is the same for someone made up, whatever they ask', async () => {
        sessionUser = { id: 'practice_lou' };
        realUser = { id: 'ali' };
        ctx = { ...asPlanner, member: { displayName: 'Lou' }, practice: madeUp[1] };
        expect(await offered()).toEqual(['ali', 'practice_pat', 'practice_lou']);
    });
});
