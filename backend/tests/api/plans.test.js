import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import * as db from '../../src/db/plans.js';
import plansRouter from '../../src/api/routes/plans.js';
import { announceAfter } from '../../src/api/announce.js';
import { announceOutcome, announceWhenEdit, announceRangeChange, announceCancel, applyConfirmations } from '../../src/bot/plans.js';

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
    ...stubs(
        'confirmParticipant',
        'setPlanChosen',
        'setPlanWhen',
        'voidPlanChoice',
        'setReminded',
        'setVoteReminded',
        'setPlanRange',
        'setPlanWeekdays',
        'addParticipants',
        'setPlanDetails',
        'setAttendanceOverride',
        'markPlanCancelled',
        'setPlanRepeat',
        'addPlanEvent'
    )
}));

vi.mock('../../src/api/announce.js', () => stubs('announceAfter'));
vi.mock('../../src/bot/util.js', () => stubs('threadUrl', 'planUrl'));
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
    getAvailabilitySummary: vi.fn(async () => ({ lastFilled: null, lastUpdatedAt: null }))
}));
vi.mock('../../src/db/users.js', () => ({
    getUserById: vi.fn(async () => ({ timeZone: 'Europe/London' })),
    setSureUntil: vi.fn(),
    getPlanningPrefs: vi.fn(async () => ({}))
}));
vi.mock('../../src/bot/plans.js', () =>
    stubs(
        'announceOutcome',
        'announceWhenEdit',
        'applyConfirmations',
        'remindStragglers',
        'remindVoters',
        'announceRangeChange',
        'announceWeekdaysChange',
        'announceCancel',
        'leavePlan',
        'announceAddition',
        'announceVoid',
        'notifyCreatorIfAllIn',
        'syncPlan',
        'applyAttendanceMove',
        'autoConfirmCoveredPlans'
    )
);

const planner = { id: 'planner', displayName: 'Ali' };
const guest = { id: 'guest', displayName: 'Bo' };
const stranger = { id: 'stranger', displayName: 'Cass' };

const asPlanner = {
    guild: { members: { fetch: async () => null } },
    cfg: { guildId: 'g1', guildName: 'The server', timeZone: 'Europe/London' },
    member: { displayName: 'Ali' },
    isMember: true,
    isPlanner: true
};
const notPlanner = { error: 403, message: 'You need the planner role to do that.' };

const plan = (over = {}) => ({
    planId: 'ab12cd34ef',
    guildId: 'g1',
    name: 'Board games',
    description: '',
    status: 'collecting',
    dateRange: { start: '2026-08-01', end: '2026-08-14' },
    participants: [{ userId: 'guest', confirmed: false }],
    createdBy: 'planner',
    history: [],
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

//The routes that refuse to touch a cancelled plan, which is all of them bar the three below
const changing = ['/choose', '/attendance', '/void', '/repeat', '/remind', '/range', '/weekdays', '/details', '/add'];

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

    it('answers for a plan that is not there', async () => {
        const res = await get('/nosuchplan');
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatch(/does not exist/);
    });

    it('looks the plan up once however many gates read it', async () => {
        const res = await post('/ab12cd34ef/repeat', { repeatWeeks: null });
        expect(res.status).toBe(200);
        expect(lookups).toEqual(['ab12cd34ef']);
    });

    it('refuses someone without the planner role, and the route never runs', async () => {
        plannerAnswer = notPlanner;
        const res = await post('/ab12cd34ef/choose', { date: '2026-08-05' });
        expect(res.status).toBe(403);
        expect(db.setPlanChosen).not.toHaveBeenCalled();
    });

    it('refuses a cancelled plan on every route that would change one', async () => {
        plans.set('ab12cd34ef', plan({ status: 'cancelled', chosenDate: '2026-08-05' }));
        for (const path of changing) {
            const res = await post(`/ab12cd34ef${path}`, {});
            expect([path, res.status]).toEqual([path, 409]);
        }
    });

    //The two planner routes that deliberately go without it
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
        plannerAnswer = notPlanner;
        const res = await get('/ab12cd34ef');
        expect(res.status).toBe(200);
        expect((await res.json()).plan.name).toBe('Board games');
    });

    it('keeps the plan from someone who is not on it', async () => {
        sessionUser = stranger;
        const res = await get('/ab12cd34ef');
        expect(res.status).toBe(403);
    });

    //The one path where the id is not the last thing in it, so the param has to still be found
    it('finds the plan behind the calendar file too', async () => {
        sessionUser = stranger;
        const res = await get('/ab12cd34ef/calendar.ics');
        expect(res.status).toBe(403);
        expect(lookups).toEqual(['ab12cd34ef']);
    });
});

/*
    What "plan another like this" copies. The gate above covers who can ask for one, so
    these are about what comes back, and the dates never being in it is the point.
*/
describe('a plan as a template', () => {
    it('carries the name, the description, the days and the crowd', async () => {
        plans.set(
            'ab12cd34ef',
            plan({
                description: 'Bring snacks',
                allowedWeekdays: [0, 6],
                participants: [{ userId: 'guest' }, { userId: 'planner' }]
            })
        );
        const res = await get('/ab12cd34ef/template');
        expect(await res.json()).toEqual({
            name: 'Board games',
            description: 'Bring snacks',
            allowedWeekdays: [0, 6],
            participantIds: ['guest', 'planner']
        });
    });

    //A new plan wants a new window, so nothing about when this one ran comes over
    it('carries no dates at all', async () => {
        plans.set('ab12cd34ef', plan({ chosenDate: '2026-08-05', repeatWeeks: 2 }));
        const body = await (await get('/ab12cd34ef/template')).json();
        expect(Object.keys(body).sort()).toEqual(['allowedWeekdays', 'description', 'name', 'participantIds']);
    });

    //Every day, which is how a plan with no restriction is stored and what the picker wants back
    it('says null rather than seven days when the plan asks about all of them', async () => {
        const body = await (await get('/ab12cd34ef/template')).json();
        expect(body.allowedWeekdays).toBe(null);
        expect(body.description).toBe('');
    });

    it('is planner only', async () => {
        plannerAnswer = notPlanner;
        const res = await get('/ab12cd34ef/template');
        expect(res.status).toBe(403);
    });
});

/*
    Which of the two things the choose route does. Picking the day the plan is already on
    used to run through setPlanChosen, which wipes every vote, takes the confirmation down
    and rebuilds the invite list, so editing a note cost a planner the round they were
    halfway through.
*/
describe('choosing the day a plan is already on', () => {
    const setPlan = (over = {}) =>
        plan({
            status: 'closed',
            chosenDate: '2026-08-05',
            chosenTime: '19:00',
            chosenNote: 'meet at the station',
            ...over
        });

    it('edits the time and note without touching anything else', async () => {
        plans.set('ab12cd34ef', setPlan());
        const res = await post('/ab12cd34ef/choose', { date: '2026-08-05', time: '20:00', note: 'meet at the station' });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ edited: true, changed: false, chosenTime: '20:00' });
        expect(db.setPlanWhen).toHaveBeenCalledWith('ab12cd34ef', '20:00', 'meet at the station');
        //The whole point: the call that clears the round is not made
        expect(db.setPlanChosen).not.toHaveBeenCalled();
    });

    it('clears the note when it is emptied rather than leaving the old one', async () => {
        plans.set('ab12cd34ef', setPlan());
        await post('/ab12cd34ef/choose', { date: '2026-08-05', time: '19:00', note: '' });
        expect(db.setPlanWhen).toHaveBeenCalledWith('ab12cd34ef', '19:00', null);
    });

    //An invite list rebuilt on an update is how somebody put on the board by hand falls off it
    it('ignores the invite narrowing entirely', async () => {
        plans.set('ab12cd34ef', setPlan());
        await post('/ab12cd34ef/choose', {
            date: '2026-08-05',
            time: '20:00',
            inviteMode: 'attending',
            attendingIds: ['guest']
        });
        expect(db.setPlanChosen).not.toHaveBeenCalled();
    });

    it('refuses an update that changes nothing', async () => {
        plans.set('ab12cd34ef', setPlan());
        const res = await post('/ab12cd34ef/choose', { date: '2026-08-05', time: '19:00', note: 'meet at the station' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/Nothing changed/);
        expect(db.setPlanWhen).not.toHaveBeenCalled();
    });

    //A different day is a real move and still starts the round again
    it('still clears the round when the day actually moves', async () => {
        plans.set('ab12cd34ef', setPlan());
        const res = await post('/ab12cd34ef/choose', { date: '2026-08-06', time: '19:00' });

        expect(await res.json()).toMatchObject({ changed: true });
        expect(db.setPlanChosen).toHaveBeenCalled();
        expect(db.setPlanWhen).not.toHaveBeenCalled();
    });

    //A plan still collecting has no day to be already on, however the date lines up
    it('treats a first pick as a set rather than an edit', async () => {
        plans.set('ab12cd34ef', plan({ chosenDate: null }));
        await post('/ab12cd34ef/choose', { date: '2026-08-05', time: '19:00' });
        expect(db.setPlanChosen).toHaveBeenCalled();
        expect(db.setPlanWhen).not.toHaveBeenCalled();
    });
});

/*
    Quiet forces off everything that would reach somebody who is not already looking. What
    it never turns off is the rewriting, which is why a quiet fix still leaves everyone
    holding a correct DM.
*/
describe('quiet mode', () => {
    const flagsOf = (fn) => fn.mock.calls.at(-1).at(-1);

    it('silences the range change both ways', async () => {
        await post('/ab12cd34ef/range', { start: '2026-08-02', end: '2026-08-20', quiet: true });
        announceAfter.mock.calls.at(-1)[1]();
        expect(flagsOf(announceRangeChange)).toMatchObject({ post: false, dm: false });
    });

    //A ticked box and quiet mode cannot both win, or the page and the server disagree
    it('beats a box the panel left ticked', async () => {
        await post('/ab12cd34ef/range', { start: '2026-08-02', end: '2026-08-20', quiet: true, post: true, dm: true });
        announceAfter.mock.calls.at(-1)[1]();
        expect(flagsOf(announceRangeChange)).toMatchObject({ post: false, dm: false });
    });

    it('leaves a request that says nothing about it as loud as ever', async () => {
        await post('/ab12cd34ef/range', { start: '2026-08-02', end: '2026-08-20' });
        announceAfter.mock.calls.at(-1)[1]();
        expect(flagsOf(announceRangeChange)).toMatchObject({ post: true, dm: true });
    });

    it('silences a cancel when it is asked to', async () => {
        await post('/ab12cd34ef/cancel', { quiet: true });
        announceAfter.mock.calls.at(-1)[1]();
        expect(flagsOf(announceCancel)).toMatchObject({ post: false, dm: false });
    });

    it('carries through to setting a day', async () => {
        await post('/ab12cd34ef/choose', { date: '2026-08-05', quiet: true });
        announceAfter.mock.calls.at(-1)[1]();
        expect(flagsOf(announceOutcome)).toMatchObject({ quiet: true });
    });

    it('carries through to an edit of the time or note', async () => {
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: '2026-08-05', chosenTime: '19:00' }));
        await post('/ab12cd34ef/choose', { date: '2026-08-05', time: '20:00', quiet: true });
        announceAfter.mock.calls.at(-1)[1]();
        expect(flagsOf(announceWhenEdit)).toMatchObject({ quiet: true });
    });

    //The confirmation reads it as "do not mention anyone", since the poll itself still has to exist
    it('stops a first confirmation mentioning the invite list', async () => {
        plans.set('ab12cd34ef', plan({ status: 'closed', chosenDate: '2026-08-05', probeActive: false }));
        applyConfirmations.mockResolvedValue({ revived: false });
        await post('/ab12cd34ef/confirmations', { active: true, quiet: true });
        expect(applyConfirmations.mock.calls.at(-1).at(-1)).toMatchObject({ mention: false });
    });
});
