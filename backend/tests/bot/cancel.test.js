import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Calling a plan off from the /cancel button. It waits in the same queue as the site's
    saves, so it cannot land halfway through one of their announcements.
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
    //The real one comes back null when the plan was already cancelled
    markPlanCancelled: vi.fn(async (planId) => {
        const plan = store.get(planId);
        if (!plan || plan.status === 'cancelled') return null;
        store.set(planId, { ...plan, status: 'cancelled' });
        return store.get(planId);
    }),
    addPlanEvent: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/ratelimits.js', () => ({ refundAction: vi.fn(async () => {}) }));

const { handlePlanComponent } = await import('../../src/bot/plans.js');
const { announceAfter } = await import('../../src/api/announce.js');

const press = () => ({
    customId: 'cancel|yes|ab12cd34ef',
    user: { id: 'ali', username: 'ali' },
    member: { displayName: 'Ali' },
    update: vi.fn(async () => {}),
    editReply: vi.fn(async () => {})
});

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

describe('the /cancel button', () => {
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
        expect(sends[0].payload).toMatch(/Ali called off "Board games"/);
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
