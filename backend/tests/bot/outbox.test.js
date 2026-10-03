import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    The outbox: what the bot sends anyone made up, and posts in a practice plan's thread,
    kept on the site instead of sent. Ali is real and made the practice plan. Pat is made up.
*/

//Real DMs, every thread Discord was asked for, and every user and channel it was asked about
const dms = [];
const created = [];
const asked = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        users: {
            fetch: async (userId) => {
                asked.push(`user ${userId}`);
                return {
                    send: async (payload) => {
                        dms.push({ userId, ...payload });
                        return { id: `dm-${userId}` };
                    },
                    createDM: async () => ({ messages: { fetch: async (id) => ({ id, edit: async () => {}, delete: async () => {} }) } })
                };
            }
        },
        channels: {
            fetch: async (id) => {
                asked.push(`channel ${id}`);
                throw new Error('no such channel');
            }
        },
        guilds: {
            fetch: async () => ({
                name: 'The server',
                channels: { fetch: async (id) => ({ id, threads: { create: async (o) => created.push(o) } }) }
            })
        }
    }
}));

//The collection, as a list
const rows = vi.hoisted(() => []);
vi.mock('../../src/db/outbox.js', () => ({
    addToOutbox: async ({ planId, to, content = '', components = [] }) => {
        const row = { id: `m${rows.length + 1}`, planId, to, content, components, pinned: false, at: new Date(), editedAt: null };
        rows.push(row);
        return { ...row };
    },
    getOutboxMessage: async (id) => rows.find((r) => r.id === id) || null,
    editOutboxMessage: async (id, patch) => {
        const row = rows.find((r) => r.id === id);
        if (!row) return null;
        Object.assign(row, patch, { editedAt: new Date() });
        return { ...row };
    },
    deleteOutboxMessage: async (id) => {
        const at = rows.findIndex((r) => r.id === id);
        if (at >= 0) rows.splice(at, 1);
    },
    pinOutboxMessage: async (id) => {
        const row = rows.find((r) => r.id === id);
        if (row) row.pinned = true;
    }
}));

const db = vi.hoisted(() => ({
    setPlanThread: vi.fn(async () => {}),
    setPlanOpener: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {}),
    setDmsClosed: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/users.js', async (real) => ({ ...(await real()), getPlanningPrefs: vi.fn(async () => ({})) }));
vi.mock('../../src/db/availability.js', async (real) => ({
    ...(await real()),
    getAvailabilityForUsersInRange: vi.fn(async () => []),
    getLastUpdated: vi.fn(async () => ({}))
}));

const { userFor, channelFor } = await import('../../src/bot/outbox.js');
const { pinMessage } = await import('../../src/bot/util.js');
const { announcePlan, announceSetPlan, syncPlan, announceCancel, remindStragglers } = await import('../../src/bot/plans.js');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = await import('discord.js');

beforeEach(() => {
    vi.clearAllMocks();
    rows.length = 0;
    dms.length = 0;
    created.length = 0;
    asked.length = 0;
});

describe('a DM to someone made up', () => {
    const row = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('join|yes|p1').setLabel('Count me in').setStyle(ButtonStyle.Success));

    it('is kept, buttons and all, as the JSON Discord would have been sent', async () => {
        const user = await userFor('practice_pat', 'p1');
        const sent = await user.send({ content: 'Hello', components: [row()] });
        expect(rows).toEqual([expect.objectContaining({ id: sent.id, planId: 'p1', to: 'practice_pat', content: 'Hello' })]);
        expect(rows[0].components).toEqual([{ type: 1, components: [expect.objectContaining({ type: 2, custom_id: 'join|yes|p1', label: 'Count me in', style: 3 })] }]);
    });

    it('is edited where it sits, keeping whatever the edit leaves out', async () => {
        const user = await userFor('practice_pat', 'p1');
        const { id } = await user.send({ content: 'Hello', components: [row()] });
        const found = await (await user.createDM()).messages.fetch(id);
        await found.edit({ content: 'Hello again' });
        expect(rows[0]).toMatchObject({ content: 'Hello again', components: [expect.anything()] });
        expect(rows[0].editedAt).not.toBe(null);
    });

    it('can be deleted', async () => {
        const user = await userFor('practice_pat', 'p1');
        const { id } = await user.send('Hello');
        await (await (await user.createDM()).messages.fetch(id)).delete();
        expect(rows).toEqual([]);
    });

    //The code syncPlanCards reads as "they deleted it"
    it("is not found among anyone else's, the way Discord says so", async () => {
        const { id } = await (await userFor('practice_pat', 'p1')).send('Hello');
        const other = await userFor('practice_lou');
        await expect((await other.createDM()).messages.fetch(id)).rejects.toMatchObject({ code: 10008 });
    });

    it('is never one to someone real', async () => {
        await (await userFor('ali', 'p1')).send({ content: 'Hello' });
        expect(dms).toEqual([{ userId: 'ali', content: 'Hello' }]);
        expect(rows).toEqual([]);
    });
});

describe("a practice plan's thread", () => {
    it('keeps its posts, and pins them', async () => {
        const thread = await channelFor('outbox_p1');
        const post = await thread.send({ content: 'Pinned' });
        await pinMessage(post);
        expect(rows).toEqual([expect.objectContaining({ planId: 'p1', to: 'thread', content: 'Pinned', pinned: true })]);
        expect((await thread.messages.fetch(post.id)).content).toBe('Pinned');
    });

    it('asks Discord about a real thread', async () => {
        await expect(channelFor('123')).rejects.toThrow('no such channel');
    });
});

describe('announcing a practice plan', () => {
    const plan = (over = {}) => ({
        planId: 'p1',
        guildId: 'g1',
        practice: 'ali',
        threadId: null,
        openerMessageId: null,
        name: 'Fire drill',
        description: '',
        status: 'collecting',
        timeZone: 'Europe/London',
        dateRange: { start: '2026-08-01', end: '2026-08-14' },
        chosenDate: null,
        probeActive: false,
        participants: ['ali', 'practice_pat'].map((userId) => ({ userId, invited: true })),
        ...over
    });
    const cfg = { guildName: 'The server', plansChannelId: 'c2' };

    it('opens its thread on the site, pinning the opener there, and asks Discord for none', async () => {
        await announcePlan(plan(), cfg, 'Ali');
        expect(created).toEqual([]);
        expect(db.setPlanThread).toHaveBeenCalledWith('p1', 'outbox_p1', null);
        const opener = rows.find((r) => r.to === 'thread');
        expect(opener).toMatchObject({ pinned: true });
        expect(opener.content).toContain('New plan: **Fire drill**');
        expect(db.setPlanOpener).toHaveBeenCalledWith('p1', opener.id);
    });

    it('keeps the made-up person their card, and DMs the planner for real', async () => {
        await announcePlan(plan(), cfg, 'Ali');
        const card = rows.find((r) => r.to === 'practice_pat');
        expect(card.content).toContain('Ali added you to the plan "Fire drill" in The server');
        expect(card.components[0].components.map((b) => b.custom_id)).toEqual(['join|yes|p1', 'join|no|p1']);
        //Open the thread goes to the overview, where its thread is drawn
        expect(card.components[1].components.map((b) => b.url)).toContain('http://localhost:3000/#/plan/p1/overview');
        expect(dms.map((d) => d.userId)).toEqual(['ali']);
    });

    it('does the same with its day set', async () => {
        await announceSetPlan(plan({ status: 'closed', chosenDate: '2026-08-08', probeActive: true }), cfg, 'Ali');
        expect(created).toEqual([]);
        expect(rows.find((r) => r.to === 'thread').content).toContain('**Fire drill** is set for');
        expect(rows.find((r) => r.to === 'practice_pat').components[0].components.map((b) => b.custom_id)).toEqual(['vote|yes|p1|r0', 'vote|no|p1|r0']);
    });
});

//Pathway test 33: the client is never asked about anyone made up or a practice thread, through a plan's whole life
describe('discord, through a practice plan from start to called off', () => {
    it('is asked about the planner and nobody else', async () => {
        const plan = {
            planId: 'p1',
            guildId: 'g1',
            practice: 'ali',
            hostIds: ['ali', 'practice_lou'],
            threadId: null,
            openerMessageId: null,
            name: 'Fire drill',
            description: '',
            status: 'collecting',
            timeZone: 'Europe/London',
            dateRange: { start: '2026-08-01', end: '2026-08-14' },
            chosenDate: null,
            probeActive: false,
            participants: ['ali', 'practice_pat'].map((userId) => ({ userId, invited: true }))
        };
        await announcePlan(plan, { guildName: 'The server', plansChannelId: 'c2' }, 'Ali');
        const opened = { ...plan, threadId: 'outbox_p1', openerMessageId: rows.find((r) => r.to === 'thread').id };
        const withCards = { ...opened, participants: opened.participants.map((p) => ({ ...p, cardMessageId: p.userId === 'ali' ? 'dm-ali' : rows.find((r) => r.to === p.userId).id })) };
        await remindStragglers(withCards, 'Ali');
        await syncPlan(withCards);
        await announceCancel({ ...withCards, status: 'cancelled' }, 'Ali');

        expect(created).toEqual([]);
        expect(asked.every((a) => a === 'user ali')).toBe(true);
        expect(rows.some((r) => r.to === 'thread' && r.content.includes('CALLED OFF'))).toBe(true);
        expect(rows.some((r) => r.to === 'practice_pat' && r.content.includes('CALLED OFF'))).toBe(true);
    });
});
