import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import * as db from '../../src/db/plans.js';
import plansRouter from '../../src/api/routes/plans.js';
import { announceAfter } from '../../src/api/announce.js';
import { announceWhenEdit, syncPlan, leavePlan, notifyHostsDropped, applyAttendanceMove, askAgain, announceJoin, announceVote, answersMoved, addHostToThread } from '../../src/bot/plans/index.js';
import { refundAction } from '../../src/db/ratelimits.js';
import { addAnswered, setCoveredUntil, getPlanningPrefs } from '../../src/db/users.js';
import { getAvailabilityForUsersInRange, getLastUpdated } from '../../src/db/availability.js';
import { formatDay } from '../../src/lib/dates.js';
import { todayIn } from '../../src/lib/zones.js';
import { listMembers } from '../../src/lib/members.js';

/*
    The gate in front of every plan route: who is turned away, with what, and in
    which order. Everything past it is mocked, so a case that comes back 200 says
    the gate let it through and nothing about what the handler then did.
*/

//Set per case, read by the mocks below when a request comes in
let sessionUser = null;
let plannerAnswer = null;
const plans = new Map();
const lookups = [];

//Hoisted with the vi.mock calls below, which run before anything else in the file
const { stubs } = vi.hoisted(() => ({
    stubs: (...names) => Object.fromEntries(names.map((n) => [n, vi.fn()]))
}));

vi.mock('../../src/lib/session.js', () => ({
    requireUser: (req, res, next) => {
        if (!sessionUser) return res.status(401).json({ error: 'You need to log in first.' });
        req.user = sessionUser;
        next();
    }
}));

vi.mock('../../src/api/context.js', () => ({
    guildContext: vi.fn(async () => plannerAnswer)
}));

vi.mock('../../src/db/plans.js', () => ({
    getPlan: vi.fn(async (planId) => {
        lookups.push(planId);
        return plans.get(planId) || null;
    }),
    //The real one comes back null when the plan was already cancelled by the time it wrote
    markPlanCancelled: vi.fn(async (planId) => ({ ...plans.get(planId), status: 'cancelled' })),
    getCollectingPlansForUser: vi.fn(async () => []),
    ...stubs(
        'confirmParticipant',
        'setPlanChosen',
        'setPlanWhen',
        'setReminded',
        'setVoteReminded',
        'setAttendanceOverride',
        'setSentBack',
        'setAskedAgain',
        'setIn',
        'addPlanEvent',
        'addHost',
        'recordVote',
        'planEdit',
        'applyPlanEdit'
    )
}));

//The whole server list is a gateway fetch, so only that half is stood in for
vi.mock('../../src/lib/members.js', async (real) => ({
    ...(await real()),
    listMembers: vi.fn(async () => [{ id: 'guest', username: 'bo', displayName: 'Bo', avatarUrl: '' }])
}));

vi.mock('../../src/api/announce.js', () => stubs('announceAfter'));
vi.mock('../../src/bot/util.js', () => stubs('threadUrl'));
vi.mock('../../src/db/ratelimits.js', () => ({
    takeAction: vi.fn(async () => ({ allowed: true })),
    refundAction: vi.fn()
}));
vi.mock('../../src/db/guilds.js', () => ({
    getGuildConfig: vi.fn(async () => ({ guildName: 'The server', timeZone: 'Europe/London' }))
}));
vi.mock('../../src/db/availability.js', () => ({
    getAvailabilityInRange: vi.fn(async () => []),
    getAvailabilityForUsersInRange: vi.fn(async () => []),
    replaceAvailabilityInRange: vi.fn(async () => 0),
    getAvailabilitySummary: vi.fn(async () => ({ lastFilled: null, lastUpdatedAt: null })),
    getLastUpdated: vi.fn(async () => ({}))
}));
vi.mock('../../src/db/users.js', () => ({
    setCoveredUntil: vi.fn(),
    getPlanningPrefs: vi.fn(async () => ({})),
    addAnswered: vi.fn()
}));
vi.mock('../../src/bot/plans/index.js', () =>
    stubs(
        'announceOutcome',
        'announceWhenEdit',
        'remindStragglers',
        'remindVoters',
        'announceCancel',
        'leavePlan',
        'notifyHostsDropped',
        'answersMoved',
        'syncPlan',
        'applyAttendanceMove',
        'askAgain',
        'announceJoin',
        'announceVote',
        'addHostToThread',
        'announceEdit'
    )
);

//Ali made the plan, so runs it. Bo is on its guest list, and Cass is nothing to it.
const planner = { id: 'planner', displayName: 'Ali' };
const guest = { id: 'guest', displayName: 'Bo' };
const stranger = { id: 'stranger', displayName: 'Cass' };

//A server where only these people are still members, each named by their id in capitals
const serverOf = (...here) => ({
    members: {
        cache: new Map(),
        fetch: async (id) => {
            if (!here.includes(id)) throw new Error('Unknown Member');
            return { id, displayName: id.toUpperCase(), displayAvatarURL: () => '', user: { bot: false } };
        }
    }
});

const asPlanner = {
    guild: serverOf('planner', 'guest', 'stranger'),
    cfg: { guildId: 'g1', guildName: 'The server', timeZone: 'Europe/London' },
    member: { displayName: 'Ali' },
    isMember: true,
    isPlanner: true,
    canManage: false
};
//In the server with no planner role, which is all running a plan takes
const asMember = { ...asPlanner, isPlanner: false };
//What guildContext hands back when it is asked to insist on the role
const notPlanner = { error: 403, message: 'You need the planner role to do that.' };

const plan = (over = {}) => ({
    planId: 'ab12cd34ef',
    guildId: 'g1',
    name: 'Board games',
    description: '',
    status: 'collecting',
    dateRange: { start: ahead(1), end: ahead(14) },
    participants: [{ userId: 'guest', confirmed: false }],
    createdBy: 'planner',
    history: [],
    ...over
});

//Days counted off from whenever this runs, so no case goes stale as the hardcoded date passes
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ahead = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return iso(d);
};
//A day inside the default window, for the routes that set one
const inWindow = ahead(5);

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
    sessionUser = planner;
    plannerAnswer = asPlanner;
    plans.clear();
    plans.set('ab12cd34ef', plan());
});

const get = (path) => fetch(`${base}${path}`);
const post = (path, body = {}) =>
    fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });

//The announcement the last request queued, handed the plan the way the real queue rereads it
const runQueued = () => {
    const [planId, , run] = announceAfter.mock.calls.at(-1);
    return run(plans.get(planId));
};

//The routes that refuse to touch a cancelled plan, which is all of them bar the three below
const changing = ['/choose', '/attendance', '/askagain', '/remind', '/edit'];

describe('the plan gate', () => {
    /*
        Express runs a param callback before the route's own middleware, so the login
        check has to sit on the router rather than on each route or a logged out request
        would read a plan out of the database on its way to being refused.
    */
    it('turns a logged out request away before anything is looked up', async () => {
        sessionUser = null;
        const res = await get('/ab12cd34ef');
        expect(res.status).toBe(401);
        expect(lookups).toEqual([]);
    });

    it('gives a logged out request the plan name and nothing else', async () => {
        sessionUser = null;
        plans.set('ab12cd34ef', plan({ description: 'At mine, bring snacks' }));
        const res = await get('/ab12cd34ef/name');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ name: 'Board games' });
    });

    it('says so when a logged out request names a plan that is not there', async () => {
        sessionUser = null;
        const res = await get('/nosuchplan/name');
        expect(res.status).toBe(404);
    });

    it('answers for a plan that is not there', async () => {
        const res = await get('/nosuchplan');
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatch(/does not exist/);
    });

    it('looks the plan up once however many gates read it', async () => {
        const res = await post('/ab12cd34ef/choose', { date: inWindow });
        expect(res.status).toBe(200);
        expect(lookups).toEqual(['ab12cd34ef']);
    });

    it('lets whoever runs the plan change it with no planner role', async () => {
        plannerAnswer = asMember;
        const res = await post('/ab12cd34ef/choose', { date: inWindow });
        expect(res.status).toBe(200);
        expect(db.setPlanChosen).toHaveBeenCalled();
    });

    it('refuses a guest, and the route never runs', async () => {
        sessionUser = guest;
        const res = await post('/ab12cd34ef/choose', { date: inWindow });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(/whoever runs this plan/);
        expect(db.setPlanChosen).not.toHaveBeenCalled();
    });

    //The planner role starts plans. It is no way into somebody else's.
    it('refuses a planner who does not run the plan', async () => {
        sessionUser = stranger;
        for (const path of [...changing, '/repair', '/cancel']) {
            const res = await post(`/ab12cd34ef${path}`, { date: inWindow });
            expect([path, res.status]).toEqual([path, 403]);
        }
        expect(db.setPlanChosen).not.toHaveBeenCalled();
        expect(db.markPlanCancelled).not.toHaveBeenCalled();
    });

    it('goes by the list of who runs it once a plan has one, not by who made it', async () => {
        plans.set('ab12cd34ef', plan({ hostIds: ['guest'] }));
        expect((await post('/ab12cd34ef/choose', { date: inWindow })).status).toBe(403);

        sessionUser = guest;
        expect((await post('/ab12cd34ef/choose', { date: inWindow })).status).toBe(200);
    });

    it('refuses someone who runs it and has left the server', async () => {
        plannerAnswer = { ...asPlanner, member: null, isMember: false, isPlanner: false };
        const res = await post('/ab12cd34ef/choose', { date: inWindow });
        expect(res.status).toBe(403);
        expect(db.setPlanChosen).not.toHaveBeenCalled();
    });

    it('refuses a plan that was called off on every route that would change one', async () => {
        plans.set('ab12cd34ef', plan({ status: 'cancelled', chosenDate: inWindow }));
        for (const path of changing) {
            const res = await post(`/ab12cd34ef${path}`, {});
            expect([path, res.status]).toEqual([path, 409]);
        }
    });

    //Or a host with no planner role could send last month's plan back out for dates as a new one
    it('refuses a plan whose day has been on every route that would change one', async () => {
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: ahead(-2), dateRange: { start: ahead(-10), end: ahead(10) } }));
        for (const path of [...changing, '/cancel']) {
            const res = await post(`/ab12cd34ef${path}`, { date: inWindow });
            expect([path, res.status]).toEqual([path, 409]);
        }
        expect(db.applyPlanEdit).not.toHaveBeenCalled();
        expect(db.markPlanCancelled).not.toHaveBeenCalled();
    });

    it('still changes a plan whose day is today where the server is', async () => {
        const today = todayIn('Pacific/Auckland');
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: today, timeZone: 'Pacific/Auckland', dateRange: { start: today, end: today } }));
        expect((await post('/ab12cd34ef/choose', { date: today, time: '20:00' })).status).toBe(200);
    });

    //The routes that deliberately go without it
    it('still reads a cancelled plan back on compare', async () => {
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        const res = await get('/ab12cd34ef/compare');
        expect(res.status).toBe(200);
        expect((await res.json()).plan.status).toBe('cancelled');
    });

    it('still hands a cancelled plan over as a template', async () => {
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        const res = await get('/ab12cd34ef/template');
        expect(res.status).toBe(200);
        expect((await res.json()).name).toBe('Board games');
    });

    it('says yes again when the plan is already cancelled', async () => {
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        const res = await post('/ab12cd34ef/cancel');
        expect(res.status).toBe(200);
        expect(db.markPlanCancelled).not.toHaveBeenCalled();
    });

    it('tells nobody and refunds nothing when another cancel got there first', async () => {
        db.markPlanCancelled.mockResolvedValueOnce(null);
        const res = await post('/ab12cd34ef/cancel');
        expect(res.status).toBe(200);
        expect(announceAfter).not.toHaveBeenCalled();
        expect(refundAction).not.toHaveBeenCalled();
    });

    /*
        Saving availability checks the guest list before the cancelled status, so a
        stranger is turned away rather than told the plan was called off.
    */
    it('turns a stranger away before mentioning the plan is cancelled', async () => {
        sessionUser = stranger;
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        const res = await post('/ab12cd34ef/availability', { days: [] });
        expect(res.status).toBe(403);
    });

    it('lets someone on the guest list read the plan without the planner role', async () => {
        sessionUser = guest;
        plannerAnswer = asMember;
        const res = await get('/ab12cd34ef');
        expect(res.status).toBe(200);
        expect((await res.json()).plan.name).toBe('Board games');
    });

    it('keeps the plan from someone who is not on it', async () => {
        sessionUser = stranger;
        const res = await get('/ab12cd34ef');
        expect(res.status).toBe(403);
    });

    //What the site goes by to send someone on a set plan to its overview
    it('says where they stand on the plan they are reading', async () => {
        sessionUser = guest;
        expect((await (await get('/ab12cd34ef')).json()).role).toBe('guest');

        plans.set('ab12cd34ef', plan({ hostIds: ['guest'] }));
        expect((await (await get('/ab12cd34ef')).json()).role).toBe('host');
    });
});

/*
    What "plan another like this" copies. The gate above covers who can ask for one, so
    these are about what comes back.
*/
describe('a plan as a template', () => {
    //Nobody else could run the new one, and the create form would only have to drop them
    it('leaves out anyone who ran it and has left the server', async () => {
        plans.set('ab12cd34ef', plan({ hostIds: ['planner', 'sam', 'guest'] }));
        const body = await (await get('/ab12cd34ef/template')).json();
        expect(body.hostIds).toEqual(['planner', 'guest']);
    });

    //Every day, which is how a plan with no restriction is stored and what the picker wants back
    it('says null rather than seven days when the plan asks about all of them', async () => {
        const body = await (await get('/ab12cd34ef/template')).json();
        expect(body.allowedWeekdays).toBe(null);
        expect(body.description).toBe('');
    });

    //Starting another like it is starting a plan
    it('takes the planner role', async () => {
        plannerAnswer = notPlanner;
        const res = await get('/ab12cd34ef/template');
        expect(res.status).toBe(403);
    });

    it('is kept from a planner who is not on the plan', async () => {
        sessionUser = stranger;
        const res = await get('/ab12cd34ef/template');
        expect(res.status).toBe(403);
    });

    it('goes to a planner on the guest list', async () => {
        sessionUser = guest;
        expect((await get('/ab12cd34ef/template')).status).toBe(200);
    });
});

/*
    Which of the two things the choose route does. Picking the day the plan is already on
    used to run through setPlanChosen, which wipes every vote, takes the confirmation down
    and rebuilds the invite list, so editing the time cost a planner the round they were
    halfway through.
*/
describe('choosing the day a plan is already on', () => {
    const setPlan = (over = {}) =>
        plan({
            status: 'closed',
            chosenDate: inWindow,
            chosenTime: '19:00',
            chosenNote: 'meet at the station',
            ...over
        });

    it('edits the time without touching anything else', async () => {
        plans.set('ab12cd34ef', setPlan());
        const res = await post('/ab12cd34ef/choose', { date: inWindow, time: '20:00' });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ edited: true, changed: false, chosenTime: '20:00' });
        //The whole point: the call that clears the round is not made
        expect(db.setPlanChosen).not.toHaveBeenCalled();
    });

    /*
        What a plan is about is one field now, changed on the edit form. A note an older plan
        still holds is carried through here rather than read off the request, or moving the
        time would quietly take a line off the pin that nothing on this route is about.
    */
    it('carries a stored note through untouched', async () => {
        plans.set('ab12cd34ef', setPlan());
        await post('/ab12cd34ef/choose', { date: inWindow, time: '20:00', note: 'somewhere else' });
        expect(db.setPlanWhen).toHaveBeenCalledWith('ab12cd34ef', '20:00', 'meet at the station', { id: 'planner', name: 'Ali' });
    });

    it('refuses an update that changes nothing', async () => {
        plans.set('ab12cd34ef', setPlan());
        const res = await post('/ab12cd34ef/choose', { date: inWindow, time: '19:00' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/Nothing changed/);
        expect(db.setPlanWhen).not.toHaveBeenCalled();
    });

    //A different day is a real move and still starts the round again
    it('still clears the round when the day actually moves', async () => {
        plans.set('ab12cd34ef', setPlan());
        const res = await post('/ab12cd34ef/choose', { date: ahead(6), time: '19:00' });

        expect(await res.json()).toMatchObject({ changed: true });
        expect(db.setPlanChosen).toHaveBeenCalled();
        expect(db.setPlanWhen).not.toHaveBeenCalled();
    });

    //A plan still collecting has no day to be already on, however the date lines up
    it('treats a first pick as a set rather than an edit', async () => {
        plans.set('ab12cd34ef', plan({ chosenDate: null }));
        await post('/ab12cd34ef/choose', { date: inWindow, time: '19:00' });
        expect(db.setPlanChosen).toHaveBeenCalled();
        expect(db.setPlanWhen).not.toHaveBeenCalled();
    });
});

describe('narrowing the list to the people who can make it', () => {
    //Nothing reaches them, and their card keeps I'm coming for a change of mind
    it('keeps anyone who said Not for me on it', async () => {
        plans.set('ab12cd34ef', plan({ participants: [{ userId: 'ann', in: true }, { userId: 'bo', in: true }, { userId: 'cy', in: false }] }));
        await post('/ab12cd34ef/choose', { date: inWindow, inviteMode: 'attending', attendingIds: ['ann'] });
        expect(db.setPlanChosen).toHaveBeenCalledWith('ab12cd34ef', inWindow, null, null, ['ann', 'cy'], { id: 'planner', name: 'Ali' });
    });
});

/*
    The request's own copy of the plan is out of date by the time a slow announcement ahead of
    it finishes, so the queue hands over a fresh one and the route has to use that.
*/
describe('queued announcements', () => {
    it('announce the plan they are handed rather than the one the request saw', async () => {
        const range = { start: ahead(1), end: ahead(20) };
        plans.set('ab12cd34ef', plan({ status: 'closed', dateRange: range, chosenDate: ahead(5), chosenTime: '19:00' }));
        await post('/ab12cd34ef/choose', { date: ahead(5), time: '20:00' });

        const [planId, label, run] = announceAfter.mock.calls.at(-1);
        expect([planId, label]).toEqual(['ab12cd34ef', 'when edit']);

        const later = plan({ status: 'closed', dateRange: range, chosenDate: ahead(5), chosenTime: '21:00' });
        await run(later);
        expect(announceWhenEdit.mock.calls.at(-1)[0]).toBe(later);
    });
});

/*
    The retry that did not exist. announceAfter runs the Discord side after the response and
    only logs a failure, so an outage used to leave the plan set, the database right and not
    a word sent anywhere.
*/
describe('fixing up Discord by hand', () => {
    const held = (n) =>
        Array.from({ length: n }, (_, i) => ({ userId: `p${i}`, confirmed: false, cardMessageId: `m${i}` }));

    it('says how many DMs it managed against how many are out there', async () => {
        plans.set('ab12cd34ef', plan({ threadId: 't1', participants: held(3) }));
        syncPlan.mockResolvedValue(2);

        const res = await post('/ab12cd34ef/repair');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, cards: 2, holders: 3, thread: true });
    });

    //Nobody has a card on a plan whose DMs all went out before the bot started remembering them
    it('counts nobody when nobody is holding one', async () => {
        plans.set('ab12cd34ef', plan({ participants: [{ userId: 'guest', confirmed: false }] }));
        syncPlan.mockResolvedValue(0);

        expect(await (await post('/ab12cd34ef/repair')).json()).toMatchObject({ cards: 0, holders: 0, thread: false });
    });

    //The one case this is for: saying it worked when Discord never answered would be worse than useless
    it('admits it when Discord will not answer', async () => {
        syncPlan.mockRejectedValue(new Error('discord is down'));
        const res = await post('/ab12cd34ef/repair');

        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/would not answer/);
    });
});

describe('times and days on the plan clock', () => {
    it('refuses a time that is not one', async () => {
        const res = await post('/ab12cd34ef/choose', { date: inWindow, time: '25:99' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/between 00:00 and 23:59/);
        expect(db.setPlanChosen).not.toHaveBeenCalled();
    });

    //1pm UTC on the 26th, which is the 27th in Auckland and still the 26th nearly everywhere else
    it('reads today as the date where the server is when the day is picked off the grid', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-26T13:00:00Z'));
        try {
            const on = (timeZone) => plans.set('ab12cd34ef', plan({ timeZone, dateRange: { start: '2026-09-20', end: '2026-10-10' } }));

            on('Pacific/Auckland');
            const there = await post('/ab12cd34ef/choose', { date: '2026-09-26' });
            expect(there.status).toBe(400);
            expect((await there.json()).error).toMatch(/in the past/);
            expect(db.setPlanChosen).not.toHaveBeenCalled();

            on('Europe/London');
            const here = await post('/ab12cd34ef/choose', { date: '2026-09-26' });
            expect(here.status).toBe(200);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('saving dates on the plan page', () => {
    beforeEach(() => (sessionUser = guest));

    //What answers every other plan over the same days, pinned weekdays and all
    it('records the plan window as answered', async () => {
        plans.set('ab12cd34ef', plan({ allowedWeekdays: [0, 6] }));
        db.confirmParticipant.mockResolvedValueOnce(plans.get('ab12cd34ef'));

        const res = await post('/ab12cd34ef/availability', { days: [] });

        expect(res.status).toBe(200);
        expect(addAnswered).toHaveBeenCalledWith('guest', { start: ahead(1), end: ahead(14), allowedWeekdays: [0, 6] });
    });

    it('saves the date their calendar answers up to, and clears it when told to', async () => {
        db.confirmParticipant.mockResolvedValue(plans.get('ab12cd34ef'));

        await post('/ab12cd34ef/availability', { days: [], coveredUntil: ahead(30) });
        expect(setCoveredUntil).toHaveBeenLastCalledWith('guest', ahead(30));

        await post('/ab12cd34ef/availability', { days: [], coveredUntil: null });
        expect(setCoveredUntil).toHaveBeenLastCalledWith('guest', null);
    });

    //A page from before the field sends none, and must not wipe the one they have
    it('leaves it alone when the save says nothing about it', async () => {
        db.confirmParticipant.mockResolvedValueOnce(plans.get('ab12cd34ef'));
        await post('/ab12cd34ef/availability', { days: [], sureUntil: ahead(30), autoConfirm: true });
        expect(setCoveredUntil).not.toHaveBeenCalled();
    });

    it('names the other plans the save answered, and never this one', async () => {
        const other = plan({ planId: 'zz98yx76wv', name: 'Pub quiz', dateRange: { start: ahead(3), end: ahead(5) } });
        db.getCollectingPlansForUser.mockResolvedValueOnce([plans.get('ab12cd34ef'), other]);
        getPlanningPrefs.mockResolvedValueOnce({}).mockResolvedValueOnce({ guest: { coveredUntil: ahead(20), answered: [], timeZone: 'Europe/London' } });
        db.confirmParticipant.mockResolvedValueOnce(plans.get('ab12cd34ef'));

        const body = await (await post('/ab12cd34ef/availability', { days: [], coveredUntil: ahead(20) })).json();
        expect(body.answers).toEqual([{ planId: 'zz98yx76wv', name: 'Pub quiz' }]);
    });

    //Every card they hold says how much is left, and a plan it finished may now be all in
    it('brings this plan and every other one they are finding a day for up to date', async () => {
        db.getCollectingPlansForUser.mockResolvedValueOnce([plans.get('ab12cd34ef'), plan({ planId: 'zz98yx76wv' })]);
        db.confirmParticipant.mockResolvedValueOnce(plans.get('ab12cd34ef'));
        await post('/ab12cd34ef/availability', { days: [] });
        expect(answersMoved).toHaveBeenCalledWith('guest', ['ab12cd34ef', 'zz98yx76wv']);
    });
});

describe('where someone stands on the plan page', () => {
    beforeEach(() => (sessionUser = guest));

    it('asks if they are in, with what their calendar already answers', async () => {
        const body = await (await get('/ab12cd34ef')).json();
        expect(body).toMatchObject({ in: null, inReason: null, ask: 'Then fill in your dates.' });
        expect(body.toFill).toHaveLength(14);
    });

    it('leaves out the days their calendar answers', async () => {
        getPlanningPrefs.mockResolvedValueOnce({ guest: { coveredUntil: ahead(10), answered: [], timeZone: null } });
        const body = await (await get('/ab12cd34ef')).json();
        expect(body.toFill).toEqual([ahead(11), ahead(12), ahead(13), ahead(14)]);
        expect(body.ask).toBe(`Your calendar answers up to ${formatDay(ahead(10))}, so there are 4 days after that to fill in.`);
    });

    it('reads someone from before the question as in when they had filled in', async () => {
        plans.set('ab12cd34ef', plan({ participants: [{ userId: 'guest', confirmed: true }] }));
        expect((await (await get('/ab12cd34ef')).json()).in).toBe(true);
    });

    it('asks nothing on a plan that has its day', async () => {
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: inWindow }));
        expect(await (await get('/ab12cd34ef')).json()).toMatchObject({ ask: '', toFill: [] });
    });

    it('hands the new line back after a save, which answers every day of the plan', async () => {
        const saved = plan({ participants: [{ userId: 'guest', confirmed: true, in: true }] });
        db.confirmParticipant.mockResolvedValueOnce(saved);
        getPlanningPrefs
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ guest: { answered: [{ start: ahead(1), end: ahead(14), allowedWeekdays: null }] } });

        const body = await (await post('/ab12cd34ef/availability', { days: [] })).json();
        expect(body).toMatchObject({ in: true, ask: '', toFill: [] });
    });
});

describe('count me in or not for me on the site', () => {
    beforeEach(() => {
        sessionUser = guest;
        //Writes the answer onto the stored plan, the way the real one does
        db.setIn.mockImplementation(async (planId, userId, value, reason) => {
            const was = plans.get(planId);
            const next = { ...was, participants: was.participants.map((p) => (p.userId === userId ? { ...p, in: value, inReason: reason } : p)) };
            plans.set(planId, next);
            return next;
        });
    });

    it('records a no with its reason, and says who was told', async () => {
        announceAfter.mockImplementationOnce(async (planId, label, run) => run(plans.get(planId)));
        announceJoin.mockResolvedValueOnce({ told: ['Ali'], missed: [] });

        const res = await post('/ab12cd34ef/join', { in: false, reason: `  ${'x'.repeat(250)}  ` });

        expect(res.status).toBe(200);
        expect(db.setIn).toHaveBeenCalledWith('ab12cd34ef', 'guest', false, 'x'.repeat(200));
        expect(announceJoin).toHaveBeenCalledWith(expect.objectContaining({ planId: 'ab12cd34ef' }), 'guest', null, 'x'.repeat(200));
        expect(await res.json()).toMatchObject({ ok: true, in: false, inReason: 'x'.repeat(200), told: ['Ali'], missed: [] });
    });

    it('hands back the line for someone now in', async () => {
        const body = await (await post('/ab12cd34ef/join', { in: true })).json();
        expect(body).toMatchObject({ in: true, ask: 'Now fill in your dates.', told: [], missed: [] });
        expect(body.toFill).toHaveLength(14);
    });

    it('drops any reason sent with a yes', async () => {
        await post('/ab12cd34ef/join', { in: true, reason: 'ignored' });
        expect(db.setIn).toHaveBeenCalledWith('ab12cd34ef', 'guest', true, null);
    });

    it('passes on where they stood before, so coming back in can be told apart', async () => {
        plans.set('ab12cd34ef', plan({ participants: [{ userId: 'guest', in: false }] }));
        announceAfter.mockImplementationOnce(async (planId, label, run) => run(plans.get(planId)));
        await post('/ab12cd34ef/join', { in: true });
        expect(announceJoin).toHaveBeenCalledWith(expect.anything(), 'guest', false, null);
    });

    it('refuses an answer that is neither', async () => {
        const res = await post('/ab12cd34ef/join', { in: 'yes' });
        expect(res.status).toBe(400);
        expect(db.setIn).not.toHaveBeenCalled();
    });

    it('refuses once the plan has its day, or has been called off', async () => {
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: inWindow }));
        expect((await post('/ab12cd34ef/join', { in: true })).status).toBe(409);
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        expect((await post('/ab12cd34ef/join', { in: true })).status).toBe(409);
        expect(db.setIn).not.toHaveBeenCalled();
    });

    it('refuses someone not on the plan', async () => {
        sessionUser = stranger;
        expect((await post('/ab12cd34ef/join', { in: true })).status).toBe(403);
    });
});

/*
    I'm coming or Can't make it from the overview, the same answer the DM's buttons give.
    Bo is on the day's list and has not said.
*/
describe('answering for a set day on the site', () => {
    const set = (bo = {}, over = {}) =>
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: inWindow, probeActive: true, participants: [{ userId: 'guest', ...bo }], ...over }));
    const queue = () => announceAfter.mockImplementationOnce(async (planId, label, run) => run(plans.get(planId)));

    beforeEach(() => {
        sessionUser = guest;
        set();
    });

    it('records a yes, and brings Discord in line with it', async () => {
        queue();
        const res = await post('/ab12cd34ef/vote', { vote: 'yes', reason: 'ignored' });

        expect(res.status).toBe(200);
        expect(db.recordVote).toHaveBeenCalledWith('ab12cd34ef', 'guest', 'yes', null);
        expect(announceVote).toHaveBeenCalledWith(expect.objectContaining({ planId: 'ab12cd34ef' }), 'guest', null, null);
        expect(await res.json()).toEqual({ ok: true, vote: 'yes', told: [], missed: [] });
    });

    it('records a no with its reason, and says who was told', async () => {
        queue();
        announceVote.mockResolvedValueOnce({ told: ['Ali'], missed: ['Sam'] });
        const res = await post('/ab12cd34ef/vote', { vote: 'no', reason: `  ${'x'.repeat(250)} ` });

        expect(db.recordVote).toHaveBeenCalledWith('ab12cd34ef', 'guest', 'no', 'x'.repeat(200));
        expect(await res.json()).toEqual({ ok: true, vote: 'no', told: ['Ali'], missed: ['Sam'] });
    });

    //Whoever runs the plan is only told about a no that is new
    it('passes on what they had said before', async () => {
        set({ vote: 'no' });
        queue();
        await post('/ab12cd34ef/vote', { vote: 'no' });
        expect(announceVote).toHaveBeenCalledWith(expect.anything(), 'guest', 'no', null);
    });

    it('refuses an answer that is neither', async () => {
        expect((await post('/ab12cd34ef/vote', { vote: 'maybe' })).status).toBe(400);
        expect(db.recordVote).not.toHaveBeenCalled();
    });

    it('refuses a plan with no day yet, one called off and one whose day has been', async () => {
        plans.set('ab12cd34ef', plan());
        expect((await post('/ab12cd34ef/vote', { vote: 'yes' })).status).toBe(409);
        set({}, { status: 'cancelled' });
        expect((await post('/ab12cd34ef/vote', { vote: 'yes' })).status).toBe(409);
        set({}, { chosenDate: ahead(-2) });
        expect((await post('/ab12cd34ef/vote', { vote: 'yes' })).status).toBe(409);
        expect(db.recordVote).not.toHaveBeenCalled();
    });

    it('refuses someone left off the day', async () => {
        set({ invited: false });
        const res = await post('/ab12cd34ef/vote', { vote: 'yes' });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/not on the list for this date/);
    });

    it('refuses someone not on the plan, whoever runs it included', async () => {
        sessionUser = planner;
        expect((await post('/ab12cd34ef/vote', { vote: 'yes' })).status).toBe(403);
        expect(db.recordVote).not.toHaveBeenCalled();
    });
});

describe('dropping out on the site', () => {
    beforeEach(() => (sessionUser = guest));

    it('DMs whoever runs it, the same as the button in the DM', async () => {
        notifyHostsDropped.mockResolvedValueOnce({ told: ['Ali'], missed: [] });
        const res = await post('/ab12cd34ef/leave');

        expect(res.status).toBe(200);
        expect(leavePlan).toHaveBeenCalledWith(expect.objectContaining({ planId: 'ab12cd34ef' }), 'guest', 'Bo');
        expect(notifyHostsDropped).toHaveBeenCalledWith(expect.objectContaining({ planId: 'ab12cd34ef' }), 'guest', null);
        expect(await res.json()).toEqual({ ok: true, told: ['Ali'], missed: [] });
    });

    it('claims nobody was told when telling them fell over', async () => {
        notifyHostsDropped.mockRejectedValueOnce(new Error('no database'));
        const res = await post('/ab12cd34ef/leave');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, told: [], missed: [] });
    });

    it('tells nobody about someone who was never on it', async () => {
        sessionUser = stranger;
        const res = await post('/ab12cd34ef/leave');

        expect(res.status).toBe(403);
        expect(notifyHostsDropped).not.toHaveBeenCalled();
    });

    it('leaves a plan that is over as it was', async () => {
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: ahead(-2) }));
        expect((await post('/ab12cd34ef/leave')).status).toBe(409);
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        expect((await post('/ab12cd34ef/leave')).status).toBe(409);
        expect(leavePlan).not.toHaveBeenCalled();
    });
});

describe('the overview', () => {
    beforeEach(() => {
        plans.set(
            'ab12cd34ef',
            plan({
                timeZone: 'Europe/London',
                participants: [
                    { userId: 'ann', confirmed: true, in: true },
                    { userId: 'bo', confirmed: false, in: true },
                    { userId: 'cy', confirmed: true, in: false, inReason: 'Away' },
                    { userId: 'di', confirmed: false, in: null }
                ]
            })
        );
        getPlanningPrefs.mockResolvedValueOnce({
            ann: { timeZone: 'Europe/London', coveredUntil: ahead(20), answered: [] },
            bo: { timeZone: 'Europe/London', coveredUntil: null, answered: [] },
            cy: { timeZone: 'Europe/London', coveredUntil: ahead(20), answered: [] }
        });
    });

    //Bo's day comes off My calendar with no answer date, so it is not an answer yet
    it('counts only people who are in, on the days their answer reaches', async () => {
        getAvailabilityForUsersInRange.mockResolvedValueOnce([
            { userId: 'ann', date: ahead(3), hours: [] },
            { userId: 'bo', date: ahead(4), hours: [] }
        ]);
        const body = await (await get('/ab12cd34ef/compare')).json();

        expect(getAvailabilityForUsersInRange.mock.calls[0][0]).toEqual(['ann', 'bo']);
        expect(body.freeByDate).toEqual({ [ahead(3)]: [{ userId: 'ann', hours: [] }] });
    });

    it('names who set a repeat, and nobody on a plan that does not repeat', async () => {
        plans.set('ab12cd34ef', { ...plans.get('ab12cd34ef'), repeatWeeks: 2, repeatBy: { id: 'planner', name: 'Ali' } });
        expect((await (await get('/ab12cd34ef/compare')).json()).plan.repeatBy).toBe('Ali');
        plans.set('ab12cd34ef', { ...plans.get('ab12cd34ef'), repeatWeeks: null });
        expect((await (await get('/ab12cd34ef/compare')).json()).plan.repeatBy).toBe(null);
    });

    it('hands the edit form the version it opened on, who made the plan and who runs it', async () => {
        plans.set('ab12cd34ef', { ...plans.get('ab12cd34ef'), rev: 4, hostIds: ['planner', 'gone'] });
        const body = await (await get('/ab12cd34ef/compare')).json();
        expect(body.plan).toMatchObject({ rev: 4, createdBy: 'planner' });
        expect(body.hostIds).toEqual(['planner']);
    });

    it('says where each person stands', async () => {
        const body = await (await get('/ab12cd34ef/compare')).json();
        const by = Object.fromEntries(body.participants.map((p) => [p.userId, p]));

        expect(by.ann).toMatchObject({ in: true, standing: 'done', daysLeft: 0, coveredUntil: ahead(20), unanswered: [] });
        expect(by.bo).toMatchObject({ in: true, standing: 'no-dates', daysLeft: 14, unanswered: [[ahead(1), ahead(14)]] });
        expect(by.cy).toMatchObject({ in: false, inReason: 'Away', standing: 'out', unanswered: [] });
        expect(by.di).toMatchObject({ in: null, standing: 'not-said', coveredUntil: null });
    });
});

/*
    The same route for a guest. They see where everyone stands, and none of what a host
    works from: reasons, calls made on the board, who moved whom, whose DMs are closed.
*/
describe('what a guest is shown on the overview', () => {
    const named = {
        ...asMember,
        guild: { members: { fetch: async (id) => ({ displayName: id.toUpperCase(), displayAvatarURL: () => '' }) } }
    };
    const london = { timeZone: 'Europe/London', coveredUntil: ahead(20), answered: [] };
    const on = (over = {}) =>
        plans.set(
            'ab12cd34ef',
            plan({
                timeZone: 'Europe/London',
                hostIds: ['planner', 'sam'],
                participants: [
                    { userId: 'guest', in: true },
                    { userId: 'ann', in: true, sentBack: { byName: 'Ali', was: { in: true } }, dmsClosed: true },
                    { userId: 'cy', in: false, inReason: 'Away' }
                ],
                history: [{ type: 'voided', at: new Date(), by: 'planner', byName: 'Ali', from: ahead(3), reason: 'Rain' }],
                ...over
            })
        );
    const read = async () => (await get('/ab12cd34ef/compare')).json();
    const byId = (body) => Object.fromEntries(body.participants.map((p) => [p.userId, p]));

    beforeEach(() => {
        sessionUser = guest;
        plannerAnswer = named;
        on();
    });

    it('is read with no planner role, and says where they stand on it', async () => {
        const res = await get('/ab12cd34ef/compare');
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ role: 'guest', isPlanner: false, youAreIn: true });
    });

    it('is kept from someone who is not on the plan, planner or not', async () => {
        sessionUser = stranger;
        plannerAnswer = { ...named, isPlanner: true };
        const res = await get('/ab12cd34ef/compare');
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(/not on this plan/);
    });

    it('is kept from someone who has left the server', async () => {
        plannerAnswer = { ...named, isMember: false };
        expect((await get('/ab12cd34ef/compare')).status).toBe(403);
    });

    it('names whoever runs it, and keeps their ids for whoever runs it', async () => {
        const body = await read();
        expect(body.hosts).toEqual(['PLANNER', 'SAM']);
        expect(body.hostIds).toBeUndefined();
    });

    it('leaves out the reasons and everything a host works from', async () => {
        getLastUpdated.mockResolvedValueOnce({ ann: new Date('2026-09-28T10:00:00Z') });
        const body = await read();
        const by = byId(body);

        expect(by.cy).toMatchObject({ in: false, standing: 'out', inReason: null });
        expect(by.ann).toMatchObject({ standing: 'no-dates', sentBack: null, dmsClosed: false, updatedAt: null, coveredUntil: null });
        expect(body.history[0]).toMatchObject({ type: 'voided', byName: 'Ali' });
        expect(body.history[0]).not.toHaveProperty('reason');
        //Never asked for, so the answer queued above is still there for the host below
        expect(getLastUpdated).not.toHaveBeenCalled();

        sessionUser = planner;
        const full = await read();
        expect(byId(full).cy.inReason).toBe('Away');
        expect(byId(full).ann).toMatchObject({ sentBack: { byName: 'Ali' }, dmsClosed: true, updatedAt: '2026-09-28T10:00:00.000Z' });
        expect(full.history[0].reason).toBe('Rain');
        expect(full.role).toBe('host');
    });

    //Their column on the board is the call, and whether it was their own answer is the host's business
    it('folds a call made on the board into where the person stands', async () => {
        on({
            status: 'closed',
            chosenDate: inWindow,
            participants: [{ userId: 'guest', vote: 'no', voteReason: 'Working', override: 'yes' }, { userId: 'ann', vote: 'yes' }]
        });
        const body = await read();
        expect(byId(body).guest).toMatchObject({ vote: 'yes', voteReason: null, override: null });
        expect(body.you).toEqual({ vote: 'no', invited: true });
    });

    describe('and the days', () => {
        beforeEach(() => {
            getPlanningPrefs.mockResolvedValueOnce({ guest: london, ann: london });
            getAvailabilityForUsersInRange.mockResolvedValueOnce([
                { userId: 'guest', date: ahead(3), hours: [] },
                { userId: 'ann', date: ahead(3), hours: [18, 19] },
                { userId: 'ann', date: ahead(4), hours: [] }
            ]);
        });

        it('come by name on a plan made since guests could see them', async () => {
            on({ guestsSeeDays: true });
            const body = await read();

            expect(body.seesDays).toBe(true);
            expect(body.freeByDate[ahead(3)]).toEqual([{ userId: 'guest', hours: [] }, { userId: 'ann', hours: [18, 19] }]);
            expect(byId(body).ann.unanswered).toEqual([[ahead(1), ahead(14)]]);
            expect(body).not.toHaveProperty('unansweredCounts');
        });

        //People on those answered expecting only the planner to see
        it('come as counts, with no names, on a plan from before', async () => {
            const body = await read();

            expect(body.seesDays).toBe(false);
            expect(body.freeByDate).toEqual({
                [ahead(3)]: [{ userId: 'free0', hours: [] }, { userId: 'free1', hours: [18, 19] }],
                [ahead(4)]: [{ userId: 'free0', hours: [] }]
            });
            expect(body.participants.map((p) => p.unanswered)).toEqual([[], [], []]);
            //Ann was sent back, so every day is still hers to answer, bar the two she shows as free on
            expect(Object.keys(body.unansweredCounts)).toHaveLength(12);
            expect(body.unansweredCounts[ahead(1)]).toBe(1);
            expect(body.unansweredCounts).not.toHaveProperty(ahead(3));
        });

        it('come by name to whoever runs it, on a plan of any age', async () => {
            sessionUser = planner;
            const body = await read();
            expect(body.seesDays).toBe(true);
            expect(body.freeByDate[ahead(4)]).toEqual([{ userId: 'ann', hours: [] }]);
        });
    });
});

//Adding people to a running plan needs the list, and whoever runs it may hold no planner role
describe('the member list for a plan', () => {
    it('goes to whoever runs it, planner role or not', async () => {
        plannerAnswer = asMember;
        const res = await get('/ab12cd34ef/members');
        expect(res.status).toBe(200);
        expect((await res.json()).members).toEqual([{ id: 'guest', username: 'bo', displayName: 'Bo', avatarUrl: '' }]);
        expect(listMembers).toHaveBeenCalledWith(asMember.guild);
    });

    it('is kept from a guest, and from a planner who does not run it', async () => {
        sessionUser = guest;
        expect((await get('/ab12cd34ef/members')).status).toBe(403);
        sessionUser = stranger;
        expect((await get('/ab12cd34ef/members')).status).toBe(403);
        expect(listMembers).not.toHaveBeenCalled();
    });

    it('says so when Discord will not hand the list over', async () => {
        listMembers.mockRejectedValueOnce(new Error('rate limited'));
        const res = await get('/ab12cd34ef/members');
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/member list/);
    });
});

/*
    Taking a plan on. Ali made this one and has left the server, so nobody runs it. Cass
    has nothing to do with it but holds the planner role.
*/
describe('taking a plan on', () => {
    const orphaned = { ...asPlanner, guild: serverOf('guest', 'stranger'), member: { displayName: 'Cass' } };

    beforeEach(() => {
        sessionUser = stranger;
        plannerAnswer = orphaned;
    });

    it('lets a planner take on a plan nobody is left running, and writes it into the history', async () => {
        const res = await post('/ab12cd34ef/takeon');

        expect(res.status).toBe(200);
        //Ali comes off the list, having left
        expect(db.addHost).toHaveBeenCalledWith('ab12cd34ef', 'stranger', ['planner'], expect.objectContaining({ id: 'stranger' }));
        expect(db.addPlanEvent).toHaveBeenCalledWith('ab12cd34ef', { type: 'tookon', by: 'stranger', byName: 'Cass' });
    });

    it('puts them in the plan thread', async () => {
        await post('/ab12cd34ef/takeon');
        await runQueued();
        expect(addHostToThread).toHaveBeenCalledWith(expect.objectContaining({ planId: 'ab12cd34ef' }), 'stranger');
    });

    it('refuses a planner while someone who runs it is still in the server', async () => {
        plannerAnswer = { ...orphaned, guild: serverOf('planner', 'stranger') };
        const res = await post('/ab12cd34ef/takeon');
        expect(res.status).toBe(403);
        expect(db.addHost).not.toHaveBeenCalled();
    });

    it('takes the planner role', async () => {
        plannerAnswer = { ...orphaned, isPlanner: false };
        expect((await post('/ab12cd34ef/takeon')).status).toBe(403);
        expect(db.addHost).not.toHaveBeenCalled();
    });

    //The way in on a plan being misused, so it waits on nobody leaving
    it('lets someone who can manage the server step in on any plan, and leaves whoever runs it on the list', async () => {
        plannerAnswer = { ...orphaned, isPlanner: false, canManage: true, guild: serverOf('planner', 'stranger') };
        expect((await post('/ab12cd34ef/takeon')).status).toBe(200);
        expect(db.addHost).toHaveBeenCalledWith('ab12cd34ef', 'stranger', [], expect.objectContaining({ id: 'stranger' }));
    });

    it('says yes again to someone who already runs it, and writes nothing', async () => {
        sessionUser = planner;
        plannerAnswer = asPlanner;
        expect((await post('/ab12cd34ef/takeon')).status).toBe(200);
        expect(db.addHost).not.toHaveBeenCalled();
        expect(db.addPlanEvent).not.toHaveBeenCalled();
    });

    it('refuses a plan that is over', async () => {
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        expect((await post('/ab12cd34ef/takeon')).status).toBe(409);
        expect(db.addHost).not.toHaveBeenCalled();
    });

    //A stranger who cannot take it on learns nothing about it, called off or not
    it('turns away someone who could not take it on before saying the plan is over', async () => {
        plans.set('ab12cd34ef', plan({ status: 'cancelled' }));
        plannerAnswer = { ...orphaned, isPlanner: false };
        expect((await post('/ab12cd34ef/takeon')).status).toBe(403);
    });

    describe('on the overview', () => {
        const read = async () => (await get('/ab12cd34ef/compare')).json();

        it('is offered to a planner who is not on the plan, with the name and nothing else of it', async () => {
            const body = await read();
            expect(body).toEqual({ plan: { planId: 'ab12cd34ef', name: 'Board games', guildName: 'The server' }, role: null, canTakeOn: true, hosts: [] });
        });

        it('is offered to a guest who is a planner, on top of what a guest sees', async () => {
            sessionUser = guest;
            const body = await read();
            expect(body).toMatchObject({ role: 'guest', canTakeOn: true, hosts: [] });
            expect(body.participants).toHaveLength(1);
        });

        it('is not offered while someone still runs it, or to whoever does', async () => {
            plannerAnswer = { ...orphaned, guild: serverOf('planner', 'guest', 'stranger') };
            expect((await get('/ab12cd34ef/compare')).status).toBe(403);

            sessionUser = guest;
            expect(await read()).toMatchObject({ canTakeOn: false, hosts: ['PLANNER'] });

            sessionUser = planner;
            expect(await read()).toMatchObject({ role: 'host', canTakeOn: false });
        });

        it('names who runs it to someone stepping in with manage server', async () => {
            plannerAnswer = { ...orphaned, isPlanner: false, canManage: true, guild: serverOf('planner', 'stranger') };
            expect(await read()).toMatchObject({ role: null, canTakeOn: true, hosts: ['PLANNER'] });
        });
    });
});

describe('asking one person again', () => {
    const queue = () => announceAfter.mockImplementationOnce(async (planId, label, run) => run(plans.get(planId)));

    beforeEach(() =>
        plans.set('ab12cd34ef', plan({ participants: [{ userId: 'ann', in: true }, { userId: 'di', in: null }, { userId: 'cy', in: false }] }))
    );

    //Their calendar stops answering, so they go over their dates again
    it('sends back someone in, and DMs them', async () => {
        queue();
        askAgain.mockResolvedValueOnce(true);
        const res = await post('/ab12cd34ef/askagain', { userId: 'ann' });

        expect(await res.json()).toEqual({ ok: true, dm: true });
        expect(db.setAskedAgain).toHaveBeenCalledWith('ab12cd34ef', 'ann', expect.objectContaining({ byName: 'Ali', was: { in: true } }));
        expect(askAgain).toHaveBeenCalledWith(expect.objectContaining({ planId: 'ab12cd34ef' }), 'ann', 'Ali');
    });

    it('asks someone who has not said without sending them back', async () => {
        const res = await post('/ab12cd34ef/askagain', { userId: 'di' });
        expect(await res.json()).toEqual({ ok: true, dm: false });
        expect(db.setAskedAgain).toHaveBeenCalledWith('ab12cd34ef', 'di', null);
    });

    it('never DMs someone who said it was not for them', async () => {
        const res = await post('/ab12cd34ef/askagain', { userId: 'cy' });
        expect(res.status).toBe(400);
        expect(db.setAskedAgain).not.toHaveBeenCalled();
    });

    it('asks each person once a day at most', async () => {
        plans.set('ab12cd34ef', plan({ participants: [{ userId: 'ann', in: true, askedAgainAt: new Date(Date.now() - 3 * 3600000) }] }));
        const res = await post('/ab12cd34ef/askagain', { userId: 'ann' });
        expect(res.status).toBe(429);
        expect((await res.json()).error).toMatch(/in 21 hours/);
    });

    it('points a set day at the board', async () => {
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: inWindow, participants: [{ userId: 'ann', in: true }] }));
        const res = await post('/ab12cd34ef/askagain', { userId: 'ann' });
        expect(res.status).toBe(409);
    });
});

describe('the attendance board', () => {
    const set = (participants) =>
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: inWindow, probeActive: true, participants }));
    //The queue run for real, so the route sees what the announcement handed back
    const queue = () => announceAfter.mockImplementationOnce(async (planId, label, run) => run(plans.get(planId)));

    beforeEach(() => set([{ userId: 'ann', invited: false }, { userId: 'bo', invited: true }]));

    it('invites someone left off the day with no answer, and says the DM landed', async () => {
        queue();
        applyAttendanceMove.mockResolvedValueOnce(true);
        const res = await post('/ab12cd34ef/attendance', { userId: 'ann', status: 'invite' });

        expect(await res.json()).toEqual({ ok: true, dm: true });
        expect(db.setAttendanceOverride).toHaveBeenCalledWith('ab12cd34ef', 'ann', null, { reinvite: true });
        expect(applyAttendanceMove).toHaveBeenCalledWith(expect.objectContaining({ planId: 'ab12cd34ef' }), 'invite', 'ann', 'Ali', { rewrite: false });
    });

    //The queue swallows a failure and hands back nothing
    it('does not claim one when sending it fell over', async () => {
        const res = await post('/ab12cd34ef/attendance', { userId: 'ann', status: 'invite' });
        expect(await res.json()).toEqual({ ok: true, dm: false });
    });

    //A planner's yes standing in for an answer nobody was ever asked for
    it('no longer lets someone in by marking them as coming', async () => {
        const res = await post('/ab12cd34ef/attendance', { userId: 'ann', status: 'coming' });

        expect(res.status).toBe(400);
        expect(db.setAttendanceOverride).not.toHaveBeenCalled();
    });

    it('refuses to invite someone already invited', async () => {
        const res = await post('/ab12cd34ef/attendance', { userId: 'bo', status: 'invite' });

        expect(res.status).toBe(400);
        expect(db.setAttendanceOverride).not.toHaveBeenCalled();
    });

    it('still moves someone invited without inviting anyone', async () => {
        const res = await post('/ab12cd34ef/attendance', { userId: 'bo', status: 'coming' });

        expect(await res.json()).toEqual({ ok: true });
        expect(db.setAttendanceOverride).toHaveBeenCalledWith('ab12cd34ef', 'bo', 'yes', { reinvite: false });
    });

    describe('sending someone back', () => {
        const yes = { vote: 'yes', voteReason: null, votedAt: null, override: null };
        const back = { byName: 'Ali', at: new Date().toISOString(), was: yes };

        it('keeps what they said and clears it, rewriting their card', async () => {
            set([{ userId: 'bo', invited: true, vote: 'yes' }]);
            queue();
            await post('/ab12cd34ef/attendance', { userId: 'bo', status: 'waiting' });

            expect(db.setSentBack).toHaveBeenCalledWith('ab12cd34ef', 'bo', expect.objectContaining({ byName: 'Ali', was: yes }), null);
            expect(applyAttendanceMove.mock.calls[0][4]).toEqual({ rewrite: true });
        });

        it('turns away someone already waiting', async () => {
            const res = await post('/ab12cd34ef/attendance', { userId: 'bo', status: 'waiting' });
            expect(res.status).toBe(400);
            expect(db.setSentBack).not.toHaveBeenCalled();
        });

        it('puts back exactly what they had when moved to the column they left', async () => {
            set([{ userId: 'bo', invited: true, sentBack: back }]);
            await post('/ab12cd34ef/attendance', { userId: 'bo', status: 'coming' });
            expect(db.setSentBack).toHaveBeenCalledWith('ab12cd34ef', 'bo', null, yes);
            expect(db.setAttendanceOverride).not.toHaveBeenCalled();
        });

        //Their own yes stays under the call, so the board can still say what they said
        it('lays the new column over what they had anywhere else', async () => {
            set([{ userId: 'bo', invited: true, sentBack: back }]);
            await post('/ab12cd34ef/attendance', { userId: 'bo', status: 'cant' });
            expect(db.setSentBack).toHaveBeenCalledWith('ab12cd34ef', 'bo', null, { ...yes, override: 'no' });
        });
    });
});
