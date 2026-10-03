import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Deleting a channel that plan threads were made under. Discord may not send a thread
    delete for each thread that goes with it, so the plans are cleared off the channel
    delete, cards and all, the same as deleting one thread by hand.
*/

const edits = [];
const dms = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        users: {
            fetch: async (userId) => ({
                send: async (content) => dms.push({ userId, content }),
                createDM: async () => ({
                    messages: { fetch: async (id) => ({ id, edit: async (payload) => edits.push({ userId, id, payload }) }) }
                })
            })
        }
    }
}));

const store = vi.hoisted(() => ({ cfg: null, gone: [] }));
const db = vi.hoisted(() => ({
    deletePlansUnderChannel: vi.fn(async () => store.gone),
    clearPlanCard: vi.fn(async () => {})
}));
const guilds = vi.hoisted(() => ({
    getGuildConfig: vi.fn(async () => store.cfg),
    markSetupBroken: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans/index.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', async (real) => ({ ...(await real()), ...guilds }));

const { onChannelDelete } = await import('../../src/bot/cleanup.js');

const plan = (planId, holders) => ({
    planId,
    guildId: 'g1',
    threadId: `thread-${planId}`,
    name: `Plan ${planId}`,
    status: 'collecting',
    timeZone: 'Europe/London',
    dateRange: { start: '2026-08-01', end: '2026-08-14' },
    participants: holders.map(([userId, cardMessageId]) => ({ userId, cardMessageId }))
});

//No guild on the fake channel, so the paused notice has nowhere to go but the DM
const channel = (id) => ({ id, guildId: 'g1', guild: null });

beforeEach(() => {
    vi.clearAllMocks();
    edits.length = 0;
    dms.length = 0;
    store.cfg = { guildName: 'The server', plansChannelId: 'c2', setupBy: 'owner' };
    store.gone = [plan('p1', [['ali', 'm1']]), plan('p2', [['bo', 'm2'], ['cass', null]])];
});

describe('deleting the plans channel', () => {
    it('clears its plans, counting ones from before the channel was stored on them', async () => {
        await onChannelDelete(channel('c2'));

        expect(db.deletePlansUnderChannel).toHaveBeenCalledWith('g1', 'c2', { unknownParent: true });
        expect(edits.map((e) => e.id).sort()).toEqual(['m1', 'm2']);
        for (const { payload } of edits) {
            expect(payload.content).toMatch(/"Plan p\d" in The server was deleted/);
            expect(payload.components).toEqual([]);
        }
    });

    it('still says planning is paused', async () => {
        await onChannelDelete(channel('c2'));
        expect(guilds.markSetupBroken).toHaveBeenCalledWith('g1');
        expect(dms.map((d) => d.userId)).toEqual(['owner']);
    });
});

describe('deleting a channel a rerun of /setup moved away from', () => {
    it('clears the plans made under it and nothing it cannot place', async () => {
        await onChannelDelete(channel('c1'));

        expect(db.deletePlansUnderChannel).toHaveBeenCalledWith('g1', 'c1', { unknownParent: false });
        expect(edits.map((e) => e.id).sort()).toEqual(['m1', 'm2']);
    });

    it('leaves the setup alone and tells nobody planning is paused', async () => {
        await onChannelDelete(channel('c1'));
        expect(guilds.markSetupBroken).not.toHaveBeenCalled();
        expect(dms).toEqual([]);
    });
});

describe('deleting a channel in a server that was never set up', () => {
    it('only clears plans recorded under it', async () => {
        store.cfg = null;
        store.gone = [];
        await onChannelDelete(channel('c9'));

        expect(db.deletePlansUnderChannel).toHaveBeenCalledWith('g1', 'c9', { unknownParent: false });
        expect(edits).toEqual([]);
        expect(guilds.markSetupBroken).not.toHaveBeenCalled();
    });
});
