import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    What goes out when a plan is announced or a day is set, over a Discord that records
    every thread post and DM. A set day always asks who can make it and a new plan always
    DMs, so nothing a caller passes can turn either off.
*/

const posts = [];
const dms = [];
let made = 0;

vi.mock('../../src/bot/client.js', () => {
    const thread = (id) => ({
        id,
        archived: false,
        members: { add: async () => {} },
        messages: { fetch: async (messageId) => ({ id: messageId, edit: async (payload) => payload }) },
        send: async (payload) => {
            posts.push({ threadId: id, ...payload });
            return { id: `post${posts.length}` };
        }
    });
    return {
        client: {
            users: {
                fetch: async (userId) => ({
                    send: async (payload) => {
                        dms.push({ userId, ...payload });
                        return { id: `dm-${userId}` };
                    }
                })
            },
            channels: { fetch: async (id) => thread(id) },
            guilds: {
                fetch: async () => ({
                    name: 'The server',
                    channels: {
                        fetch: async (channelId) => ({ id: channelId, threads: { create: async () => thread(`t${++made}`) } })
                    }
                })
            }
        }
    };
});

const store = vi.hoisted(() => ({ plan: null }));
const db = vi.hoisted(() => ({
    setPlanThread: vi.fn(async () => {}),
    setPlanOpener: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {}),
    setProbe: vi.fn(async (planId, { active, threadMessageId }) => {
        store.plan.probeActive = active;
        if (threadMessageId !== undefined) store.plan.probeThreadMessageId = threadMessageId;
        return { ...store.plan };
    })
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/users.js', async (real) => ({ ...(await real()), getPlanningPrefs: vi.fn(async () => ({})) }));

const { announcePlan, announceSetPlan, announceOutcome } = await import('../../src/bot/plans.js');

const cfg = { guildName: 'The server', plansChannelId: 'c2' };
const buttons = (message) => (message.components || []).flatMap((row) => row.components.map((b) => b.data.custom_id));
const guests = ['ali', 'bo'];

const collecting = () => ({
    planId: 'p1',
    guildId: 'g1',
    threadId: null,
    openerMessageId: null,
    name: 'Board games',
    description: '',
    status: 'collecting',
    timeZone: 'Europe/London',
    dateRange: { start: '2026-08-01', end: '2026-08-14' },
    chosenDate: null,
    probeActive: false,
    participants: guests.map((userId) => ({ userId, invited: true }))
});

//As setPlanChosen leaves it: closed on the day, and asking
const setDay = (over = {}) => ({
    ...collecting(),
    status: 'closed',
    chosenDate: '2026-08-08',
    chosenTime: null,
    probeActive: true,
    probeThreadMessageId: null,
    ...over
});

beforeEach(() => {
    vi.clearAllMocks();
    posts.length = 0;
    dms.length = 0;
    made = 0;
});

describe('announcing a plan with its day already set', () => {
    beforeEach(() => (store.plan = setDay()));

    it('posts the yes/no in the thread and keeps it as the one to tally', async () => {
        await announceSetPlan(store.plan, cfg, 'Ali');

        const asking = posts.filter((p) => buttons(p).includes('vote|yes|p1'));
        expect(asking).toHaveLength(1);
        expect(db.setProbe).toHaveBeenCalledWith('p1', { active: true, threadMessageId: `post${posts.indexOf(asking[0]) + 1}` });
    });

    it('DMs every guest the same buttons', async () => {
        await announceSetPlan(store.plan, cfg, 'Ali');

        expect(dms.map((d) => d.userId).sort()).toEqual(guests);
        for (const dm of dms) expect(buttons(dm)).toEqual(['vote|yes|p1', 'vote|no|p1']);
    });
});

describe('announcing a plan that is collecting dates', () => {
    it('DMs every guest', async () => {
        store.plan = collecting();
        await announcePlan(store.plan, cfg, 'Ali');
        expect(dms.map((d) => d.userId).sort()).toEqual(guests);
    });
});

describe('setting a day on a running plan', () => {
    beforeEach(() => (store.plan = setDay({ threadId: 'thread1' })));

    it('posts the yes/no in the thread, mentioning the guests', async () => {
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });

        expect(posts).toHaveLength(1);
        expect(buttons(posts[0])).toEqual(['vote|yes|p1', 'vote|no|p1']);
        expect(posts[0].allowedMentions).toEqual({ users: guests });
        expect(db.setProbe).toHaveBeenCalledWith('p1', { active: true, threadMessageId: 'post1' });
    });

    it('still posts the yes/no when quiet, but mentions and DMs nobody', async () => {
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali', quiet: true });

        expect(posts).toHaveLength(1);
        expect(buttons(posts[0])).toEqual(['vote|yes|p1', 'vote|no|p1']);
        expect(posts[0].allowedMentions).toEqual({ parse: [] });
        expect(posts[0].content).not.toContain('<@');
        expect(dms).toEqual([]);
    });
});

describe('opening a plan thread', () => {
    it('stores the channel the thread was made under', async () => {
        store.plan = collecting();
        await announcePlan(store.plan, cfg, 'Ali');
        expect(db.setPlanThread).toHaveBeenCalledWith('p1', 't1', 'c2');
    });

    it('does the same for a plan announced with its day already set', async () => {
        store.plan = setDay();
        await announceSetPlan(store.plan, cfg, 'Ali');
        expect(db.setPlanThread).toHaveBeenCalledWith('p1', 't1', 'c2');
    });
});
