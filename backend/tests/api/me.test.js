import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { todayIn } from '../../src/lib/zones.js';
import { shiftDate } from '../../src/lib/dates.js';
import { nextStep } from '../../src/lib/coverage.js';

/*
    My plans as the site is sent it: each plan with where this person stands on it and
    who else runs it. Ali made these, Sam runs them with him, and Bo is a guest.
*/

let sessionUser = null;
const live = [];
const over = [];
//Who is still in the server, by the name they go by there
const inServer = new Map();

vi.mock('../../src/lib/session.js', () => ({
    requireUser: (req, res, next) => {
        req.user = sessionUser;
        next();
    }
}));
vi.mock('../../src/bot/client.js', () => ({
    client: {
        guilds: {
            cache: new Map(),
            fetch: async () => ({
                members: {
                    cache: new Map(),
                    fetch: async (id) => {
                        if (!inServer.has(id)) throw new Error('Unknown Member');
                        return { id, displayName: inServer.get(id) };
                    }
                }
            })
        }
    }
}));
vi.mock('../../src/bot/cleanup.js', () => ({ computeUserGuilds: vi.fn() }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfigs: vi.fn(async () => [{ guildId: 'g1', guildName: 'The server', setupComplete: true }]) }));
vi.mock('../../src/db/practice.js', () => ({
    getPracticePerson: vi.fn(async (id) => (id === 'practice_a' ? { id, ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: true } : null))
}));
vi.mock('../../src/db/plans.js', () => ({
    getActivePlansForUser: vi.fn(async () => live),
    getFinishedPlansForUser: vi.fn(async () => over)
}));
const users = vi.hoisted(() => ({ getPlanningPrefs: vi.fn(async () => ({})), getUserById: vi.fn(), setUserGuilds: vi.fn(), setUserTimeZone: vi.fn() }));
vi.mock('../../src/db/users.js', () => users);

const { default: meRouter } = await import('../../src/api/routes/me.js');

const ahead = (days) => shiftDate(todayIn('Europe/London'), days);
const plan = (planId, over = {}) => ({
    planId,
    guildId: 'g1',
    name: planId,
    status: 'collecting',
    timeZone: 'Europe/London',
    dateRange: { start: ahead(3), end: ahead(6) },
    createdBy: 'ali',
    hostIds: ['ali', 'sam'],
    participants: [{ userId: 'bo', in: null }],
    ...over
});

let server;
let base;

beforeAll(async () => {
    const app = express();
    app.use('/api/me', meRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/me`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    vi.clearAllMocks();
    live.length = 0;
    over.length = 0;
    inServer.clear();
    for (const [id, name] of [['ali', 'Ali'], ['sam', 'Sam'], ['bo', 'Bo']]) inServer.set(id, name);
    sessionUser = { id: 'bo' };
});

const read = async () => (await fetch(`${base}/plans`)).json();

describe('my plans', () => {
    it('tells a guest where they stand and who runs it', async () => {
        live.push(plan('cinema'));
        const [row] = (await read()).plans;

        expect(row).toMatchObject({
            planId: 'cinema',
            guildName: 'The server',
            role: 'guest',
            hosts: ['Ali', 'Sam'],
            onList: true,
            standing: 'not-said',
            daysLeft: 4,
            movedBack: false,
            readyToPick: false,
            mine: false
        });
    });

    it('tells someone who runs it who the others are, and leaves their own name out', async () => {
        sessionUser = { id: 'sam' };
        live.push(plan('cinema'));
        const [row] = (await read()).plans;

        expect(row).toMatchObject({ role: 'host', hosts: ['Ali'], onList: false, inIt: false, standing: null, mine: true });
    });

    it('names nobody who has left the server', async () => {
        inServer.delete('ali');
        live.push(plan('cinema'));
        expect((await read()).plans[0].hosts).toEqual(['Sam']);
    });

    it('reads a plan from before hosts as run by whoever made it', async () => {
        sessionUser = { id: 'ali' };
        const old = plan('cinema');
        delete old.hostIds;
        live.push(old);
        expect((await read()).plans[0]).toMatchObject({ role: 'host', hosts: [] });
    });

    //Everyone's answers decide it, so theirs are read too, in the one query
    it('says the day can be picked once everyone on a plan they run has answered', async () => {
        sessionUser = { id: 'sam' };
        live.push(plan('cinema', { participants: [{ userId: 'bo', in: true }] }));
        users.getPlanningPrefs.mockResolvedValueOnce({ bo: { coveredUntil: ahead(30), answered: [], timeZone: 'Europe/London' } });

        expect((await read()).plans[0].readyToPick).toBe(true);
        expect(users.getPlanningPrefs).toHaveBeenCalledTimes(1);
        expect(users.getPlanningPrefs.mock.calls[0][0].sort()).toEqual(['bo', 'sam']);
    });

    it('reads nobody else on a plan they are only a guest of', async () => {
        live.push(plan('cinema', { participants: [{ userId: 'bo', in: null }, { userId: 'cy', in: true }] }));
        await read();
        expect(users.getPlanningPrefs).toHaveBeenCalledWith(['bo']);
    });

    it('says whether they have answered for a set day', async () => {
        live.push(plan('bowling', { status: 'closed', chosenDate: ahead(4), participants: [{ userId: 'bo', vote: 'yes' }] }));
        expect((await read()).plans[0]).toMatchObject({ answer: 'yes', invited: true, standing: null });
    });

    it('keeps a set plan from a guest left off the day, and not from whoever runs it', async () => {
        const narrowed = plan('bowling', {
            status: 'closed',
            chosenDate: ahead(4),
            participants: [{ userId: 'bo', invited: false }, { userId: 'sam', invited: false }]
        });
        live.push(narrowed);
        expect((await read()).plans).toEqual([]);

        sessionUser = { id: 'sam' };
        expect((await read()).plans).toHaveLength(1);
    });

    it('sends the finished ones the same way, apart', async () => {
        over.push(plan('been', { status: 'closed', chosenDate: ahead(-3) }));
        const body = await read();
        expect(body.plans).toEqual([]);
        expect(body.past[0]).toMatchObject({ planId: 'been', role: 'guest', hosts: ['Ali', 'Sam'] });
    });

    //Still a live plan, and what it wants is new dates from whoever runs it
    it('says when the dates a plan asked about have all gone, to its guests and whoever runs it', async () => {
        live.push(plan('cinema', { dateRange: { start: ahead(-14), end: ahead(-10) } }), plan('picnic'));
        const guest = (await read()).plans;
        expect(guest.map((row) => row.datesPassed)).toEqual([true, false]);
        expect(nextStep(guest[0])).toMatchObject({ label: 'Waiting for new dates', page: 'overview' });

        sessionUser = { id: 'sam' };
        const [host] = (await read()).plans;
        expect(host.datesPassed).toBe(true);
        expect(nextStep(host)).toMatchObject({ label: 'Ask about new dates', page: 'dates' });
    });
});

//Discord has never heard of a made-up person, so their one server comes off the record of them
describe("a made-up person's servers", () => {
    it('is the server they were made for, planner or not as they were made', async () => {
        sessionUser = { id: 'practice_a' };
        const { guilds } = await (await fetch(`${base}/guilds`)).json();
        expect(guilds).toEqual([{ guildId: 'g1', guildName: 'The server', iconUrl: null, setupComplete: true, isPlanner: true }]);
        expect(users.getUserById).not.toHaveBeenCalled();
    });
});

describe('practice plans on my plans', () => {
    it('are kept off the list of the planner they are for, and handed over on their own', async () => {
        sessionUser = { id: 'ali' };
        live.push(plan('cinema'), plan('drill', { practice: 'ali' }));
        const body = await read();
        expect(body.plans.map((p) => p.planId)).toEqual(['cinema']);
        expect(body.practice.map((p) => p.planId)).toEqual(['drill']);
    });

    it('are the whole list for someone made up', async () => {
        sessionUser = { id: 'practice_a' };
        live.push(plan('drill', { practice: 'ali', participants: [{ userId: 'practice_a', in: null }] }));
        const body = await read();
        expect(body.plans.map((p) => p.planId)).toEqual(['drill']);
        expect(body.practice).toEqual([]);
    });
});
