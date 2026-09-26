import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Deleting a plan's thread by hand. Everyone holding a DM card is left with a line saying
    the plan went, and no buttons, rather than an invite that answers into nothing.
*/

const edits = [];
const fetched = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        users: {
            fetch: async (userId) => {
                fetched.push(userId);
                return {
                    createDM: async () => ({
                        messages: { fetch: async (id) => ({ id, edit: async (payload) => edits.push({ userId, id, payload }) }) }
                    })
                };
            }
        }
    }
}));

const store = vi.hoisted(() => ({ plan: null }));
const db = vi.hoisted(() => ({
    getPlanByThread: vi.fn(async () => store.plan),
    deletePlan: vi.fn(async () => {}),
    clearPlanCard: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', async (real) => ({ ...(await real()), getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));

const { onThreadDelete } = await import('../../src/bot/cleanup.js');

beforeEach(() => {
    vi.clearAllMocks();
    edits.length = 0;
    fetched.length = 0;
    store.plan = {
        planId: 'ab12cd34ef',
        guildId: 'g1',
        threadId: 't1',
        name: 'Board games',
        status: 'collecting',
        dateRange: { start: '2026-08-01', end: '2026-08-14' },
        participants: [
            { userId: 'ali', cardMessageId: 'm1' },
            { userId: 'bo', cardMessageId: 'm2' },
            //Never got a card, so there is nothing of theirs to rewrite
            { userId: 'cass', cardMessageId: null }
        ]
    };
});

describe('deleting a plan thread', () => {
    it('deletes the plan and takes the buttons off every card', async () => {
        await onThreadDelete({ id: 't1' });

        expect(db.deletePlan).toHaveBeenCalledWith('ab12cd34ef');
        expect(edits.map((e) => e.id).sort()).toEqual(['m1', 'm2']);
        for (const { payload } of edits) {
            expect(payload.content).toMatch(/"Board games" in The server was deleted/);
            expect(payload.components).toEqual([]);
        }
        expect(fetched).not.toContain('cass');
    });

    it('leaves a thread that was never a plan alone', async () => {
        store.plan = null;
        await onThreadDelete({ id: 'elsewhere' });
        expect(db.deletePlan).not.toHaveBeenCalled();
        expect(edits).toEqual([]);
    });
});
