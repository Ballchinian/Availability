import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    What one save on the edit form sends, over a Discord that records every thread post,
    DM, card rewrite and card taken down. Ali runs the plan. Bo and Cy are on it and each
    holds a card, and Di is in the server and not on it.
*/

const posts = [];
const dms = [];
//Cards edited where they sit, and cards taken down, by person
const rewritten = [];
const deleted = [];
const joined = [];
const left = [];
const renamed = [];
const closed = new Set();

vi.mock('../../src/bot/client.js', () => {
    const thread = {
        id: 't1',
        name: 'Board games',
        archived: false,
        members: {
            add: async (id) => joined.push(id),
            remove: async (id) => left.push(id)
        },
        messages: { fetch: async (id) => ({ id, edit: async (payload) => ({ id, ...payload }) }) },
        send: async (payload) => {
            posts.push(payload);
            return { id: `post${posts.length}` };
        },
        setName: async (name) => renamed.push(name)
    };
    return {
        client: {
            users: {
                fetch: async (userId) => ({
                    send: async (payload) => {
                        if (closed.has(userId)) throw Object.assign(new Error('Cannot send'), { code: 50007 });
                        dms.push({ userId, ...payload });
                        return { id: `dm-${userId}-${dms.length}` };
                    },
                    createDM: async () => ({
                        messages: {
                            fetch: async (id) => ({
                                id,
                                edit: async (payload) => rewritten.push({ userId, id, ...payload }),
                                delete: async () => deleted.push({ userId, id })
                            })
                        }
                    })
                })
            },
            channels: { fetch: async () => thread },
            guilds: { fetch: async () => ({ name: 'The server', members: { fetch: async (id) => ({ id, displayName: id }) } }) }
        }
    };
});

const db = vi.hoisted(() => ({
    setPlanOpener: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {}),
    setDmsClosed: vi.fn(async () => {}),
    markAllInNotified: vi.fn(async () => {}),
    markProbeAllYes: vi.fn(async () => {}),
    clearPlanCard: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));
vi.mock('../../src/db/users.js', async (real) => ({ ...(await real()), getPlanningPrefs: vi.fn(async () => ({})) }));
vi.mock('../../src/db/availability.js', async (real) => ({
    ...(await real()),
    getAvailabilityForUsersInRange: vi.fn(async () => []),
    getLastUpdated: vi.fn(async () => ({}))
}));

const { announceEdit } = await import('../../src/bot/plans.js');
const { diffPlan } = await import('../../../shared/planDiff.js');

const cfg = { guildName: 'The server' };
const ids = (list) => list.map((m) => m.userId);
const buttons = (message) => (message.components || []).flatMap((row) => row.components.map((b) => b.data.custom_id || b.data.label));

const plan = (over = {}) => ({
    planId: 'p1',
    guildId: 'g1',
    threadId: 't1',
    openerMessageId: null,
    name: 'Board games',
    description: '',
    status: 'collecting',
    timeZone: 'Europe/London',
    dateRange: { start: '2026-10-01', end: '2026-10-14' },
    allowedWeekdays: null,
    chosenDate: null,
    chosenTime: null,
    probeActive: false,
    hostIds: ['ali'],
    participants: [
        { userId: 'bo', in: true, invited: true, cardMessageId: 'card-bo' },
        { userId: 'cy', in: null, invited: true, cardMessageId: 'card-cy' }
    ],
    ...over
});

//The save as the route hands it over: the plan before, what moved, and whoHears's answer
const announce = (before, after, extra = {}) =>
    announceEdit(after, cfg, { before, changes: diffPlan(before, after), actorName: 'Ali', ...extra });

beforeEach(() => {
    vi.clearAllMocks();
    for (const list of [posts, dms, rewritten, deleted, joined, left, renamed]) list.length = 0;
    closed.clear();
});

describe('a rename', () => {
    //Pathway 13
    it('is posted in the thread under the old name, DMs nobody, and rewrites every card', async () => {
        await announce(plan(), plan({ name: 'Quiz night' }));
        expect(posts.map((p) => p.content)).toEqual(['**CHANGED**\n\nAli changed **Board games**:\n- now called **Quiz night**']);
        expect(dms).toEqual([]);
        expect(rewritten.map((r) => r.userId).sort()).toEqual(['bo', 'cy']);
        expect(renamed).toEqual(['Quiz night']);
    });

    it('is posted nowhere when quiet', async () => {
        await announce(plan(), plan({ name: 'Quiz night' }), { quiet: true });
        expect(posts).toEqual([]);
        expect(dms).toEqual([]);
        expect(rewritten).toHaveLength(2);
    });
});

describe('a day being set', () => {
    const after = () => plan({ status: 'closed', chosenDate: '2026-10-10', probeActive: true, round: 1 });
    const heard = [{ userId: 'bo', why: 'vote' }, { userId: 'cy', why: 'changed' }];

    it('sends whoever hears a fresh card with the list on it and the yes/no, and takes the old one down', async () => {
        await announce(plan(), after(), { heard, owing: ['bo', 'cy'] });
        expect(ids(dms)).toEqual(['bo', 'cy']);
        expect(dms[0].content).toMatch(/^\*\*CHANGED\*\*/);
        expect(dms[0].content).toContain("Ali changed **Board games**:\n- it's on Sat 10 Oct 2026 now");
        expect(buttons(dms[0])).toEqual(['vote|yes|p1|r1', 'vote|no|p1|r1']);
        expect(deleted.map((d) => d.id).sort()).toEqual(['card-bo', 'card-cy']);
    });

    it('posts the list with the buttons, pinging only whoever has to answer and had no card land', async () => {
        closed.add('cy');
        await announce(plan(), after(), { heard, owing: ['bo', 'cy'] });
        expect(posts).toHaveLength(1);
        expect(posts[0].content).toMatch(/^<@cy>\n\n\*\*CHANGED\*\*/);
        expect(posts[0].allowedMentions).toEqual({ users: ['cy'] });
        expect(buttons(posts[0])).toEqual(['vote|yes|p1|r1', 'vote|no|p1|r1']);
    });

    it('rewrites the card of anyone a quiet save does not tell', async () => {
        await announce(plan(), after(), { quiet: true, heard: [{ userId: 'bo', why: 'vote' }], owing: ['bo', 'cy'] });
        expect(posts).toEqual([]);
        expect(ids(dms)).toEqual(['bo']);
        expect(rewritten.map((r) => r.userId)).toEqual(['cy']);
    });
});

describe('who is on it', () => {
    const without = () => plan({ participants: [plan().participants[0]] });

    it('tells someone taken off, takes their card down and takes them out of the thread', async () => {
        await announce(plan(), without());
        expect(dms).toEqual([{ userId: 'cy', content: 'Ali took you off "Board games" in The server.', components: [] }]);
        expect(deleted).toEqual([{ userId: 'cy', id: 'card-cy' }]);
        expect(left).toEqual(['cy']);
    });

    it('turns their card into saying so when the save is quiet, and sends nothing', async () => {
        await announce(plan(), without(), { quiet: true });
        expect(dms).toEqual([]);
        expect(rewritten.find((r) => r.userId === 'cy')).toMatchObject({ id: 'card-cy', content: 'Ali took you off "Board games" in The server.' });
        expect(left).toEqual(['cy']);
    });

    it('leaves someone taken off who still runs it in the thread', async () => {
        await announce(plan({ hostIds: ['ali', 'cy'] }), { ...without(), hostIds: ['ali', 'cy'] });
        expect(left).toEqual([]);
    });

    //Pathway 14
    it('sends someone added the invitation and nobody else anything', async () => {
        const added = plan({ participants: [...plan().participants, { userId: 'di', in: null, invited: true }] });
        await announce(plan(), added);
        expect(ids(dms)).toEqual(['di']);
        expect(dms[0].content).toMatch(/^\*\*INVITED\*\*/);
        expect(joined).toEqual(['di']);
        expect(posts).toEqual([]);
    });
});

describe('who runs it', () => {
    it('puts someone picked in the thread and tells them who picked them', async () => {
        await announce(plan(), plan({ hostIds: ['ali', 'di'] }));
        expect(joined).toEqual(['di']);
        expect(dms).toHaveLength(1);
        expect(dms[0].content).toBe('**YOU RUN THIS**\n\nAli picked you to run "Board games" in The server with them.');
    });

    it('takes someone who stops running it out of the thread, unless they are coming', async () => {
        await announce(plan({ hostIds: ['ali', 'di', 'bo'] }), plan({ hostIds: ['ali'] }));
        expect(left).toEqual(['di']);
        expect(dms).toEqual([]);
    });
});
