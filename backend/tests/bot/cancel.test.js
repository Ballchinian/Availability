import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Calling a plan off from Discord. /cancel is for whoever runs the plan, asked when it
    is run and again when its button is pressed. The button waits in the same queue as
    the site's saves, so it cannot land halfway through one of their announcements.
*/

const sends = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        channels: { fetch: async () => Promise.reject(new Error('no thread')) },
        users: { fetch: async (userId) => ({ send: async (payload) => sends.push({ userId, payload }) }) }
    }
}));

const store = vi.hoisted(() => new Map());
const db = vi.hoisted(() => ({
    getPlan: vi.fn(async (planId) => store.get(planId) || null),
    getPlanByThread: vi.fn(async (threadId) => (threadId === 't1' ? store.get('ab12cd34ef') : null)),
    //The real one comes back null when the plan was already cancelled
    markPlanCancelled: vi.fn(async (planId) => {
        const plan = store.get(planId);
        if (!plan || plan.status === 'cancelled') return null;
        store.set(planId, { ...plan, status: 'cancelled' });
        return store.get(planId);
    }),
    addPlanEvent: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/ratelimits.js', () => ({ refundAction: vi.fn(async () => {}) }));

const { handleCancel, handlePlanComponent } = await import('../../src/bot/plans.js');
const { announceAfter } = await import('../../src/api/announce.js');

const press = (userId = 'ali') => ({
    customId: 'cancel|yes|ab12cd34ef',
    user: { id: userId, username: userId },
    member: { displayName: 'Ali' },
    update: vi.fn(async () => {}),
    editReply: vi.fn(async () => {})
});

//Ali made the plan, so runs it. Bo is on its guest list.
const command = (userId = 'ali', channelId = 't1') => ({
    channelId,
    user: { id: userId },
    inGuild: () => true,
    reply: vi.fn(async () => {})
});
const said = (interaction) => interaction.reply.mock.calls[0][0];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    vi.clearAllMocks();
    sends.length = 0;
    store.clear();
    store.set('ab12cd34ef', {
        planId: 'ab12cd34ef',
        guildId: 'g1',
        threadId: null,
        name: 'Board games',
        status: 'closed',
        createdBy: 'ali',
        participants: [{ userId: 'bo' }, { userId: 'cass' }]
    });
});

describe('the /cancel command', () => {
    it('asks whoever runs the plan to confirm, with no planner role looked for', async () => {
        const run = command();
        await handleCancel(run);
        expect(said(run).content).toMatch(/Call off \*\*Board games\*\*\?/);
        expect(said(run).components[0].components.map((b) => b.data.custom_id)).toEqual(['cancel|yes|ab12cd34ef', 'cancel|no']);
    });

    //Nothing on the confirm shows it, and the next one never coming is the part to know
    it('says calling off a plan that repeats stops it coming round', async () => {
        store.set('ab12cd34ef', { ...store.get('ab12cd34ef'), repeatWeeks: 2 });
        const run = command();
        await handleCancel(run);
        expect(said(run).content).toMatch(/^Call off \*\*Board games\*\*, and stop it coming round again\? /);
    });

    it('is not for a guest', async () => {
        const run = command('bo');
        await handleCancel(run);
        expect(said(run).content).toBe('Only whoever runs this plan can call it off.');
        expect(said(run).components).toBeUndefined();
    });

    it('goes by who runs the plan now, not by who made it', async () => {
        store.set('ab12cd34ef', { ...store.get('ab12cd34ef'), hostIds: ['cass'] });
        const made = command('ali');
        await handleCancel(made);
        expect(said(made).content).toMatch(/Only whoever runs this plan/);

        const runs = command('cass');
        await handleCancel(runs);
        expect(said(runs).components).toHaveLength(1);
    });

    it('has nothing to call off once the day has been', async () => {
        store.set('ab12cd34ef', { ...store.get('ab12cd34ef'), chosenDate: '2020-01-04', timeZone: 'Europe/London' });
        const run = command();
        await handleCancel(run);
        expect(said(run).content).toBe('"Board games" was on Sat 4 Jan 2020, so there is nothing left to call off.');
    });

    it('says where it goes when it is run outside a plan thread', async () => {
        const run = command('ali', 'general');
        await handleCancel(run);
        expect(said(run).content).toMatch(/inside a plan thread/);
    });
});

describe('the /cancel button', () => {
    //The question can sit there while they are taken off the plan, or handed the button by someone else
    it('asks again who runs the plan when it is pressed', async () => {
        const click = press('bo');
        await handlePlanComponent(click);

        expect(db.markPlanCancelled).not.toHaveBeenCalled();
        expect(sends).toEqual([]);
        expect(click.editReply).toHaveBeenCalledWith({ content: 'Only whoever runs this plan can call it off.' });
    });

    it('says so when the plan has gone', async () => {
        store.clear();
        const click = press();
        await handlePlanComponent(click);
        expect(click.editReply).toHaveBeenCalledWith({ content: 'That plan is no longer around.' });
    });

    it('waits for a site announcement already sending and drops any still waiting', async () => {
        let release;
        announceAfter('ab12cd34ef', 'details edit', () => new Promise((resolve) => (release = resolve)));
        const outcome = vi.fn();
        announceAfter('ab12cd34ef', 'outcome post', outcome);

        const click = press();
        const done = handlePlanComponent(click);
        await settle();
        expect(sends).toEqual([]);
        expect(click.editReply).not.toHaveBeenCalled();

        release();
        await done;
        expect(outcome).not.toHaveBeenCalled();
        expect(sends.map((s) => s.userId).sort()).toEqual(['bo', 'cass']);
        expect(sends[0].payload.content).toMatch(/Ali called off "Board games"/);
        expect(click.editReply).toHaveBeenCalledWith({ content: expect.stringMatching(/^Done/) });
    });

    it('tells nobody a second time when it was already called off', async () => {
        store.set('ab12cd34ef', { ...store.get('ab12cd34ef'), status: 'cancelled' });
        const click = press();

        await handlePlanComponent(click);

        expect(sends).toEqual([]);
        expect(click.editReply).toHaveBeenCalledWith({ content: expect.stringMatching(/already called off/) });
    });
});
