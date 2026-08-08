import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    The confirmation as a switch. The claim worth pinning is that closing and reopening
    costs nobody their answer, and that a reopen revives the poll already in the thread
    rather than posting a second one on top of it.
*/

const channels = new Map();
const edits = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        channels: { fetch: async (id) => channels.get(id) || Promise.reject(new Error('unknown channel')) },
        users: {
            fetch: async (id) => ({
                createDM: async () => ({
                    messages: {
                        fetch: async (messageId) => ({
                            id: messageId,
                            edit: async (payload) => edits.push({ userId: id, payload })
                        })
                    }
                })
            })
        }
    }
}));

//The stored plan, so setProbe writes and later reads agree the way the real one does
const store = vi.hoisted(() => ({ plan: null }));
const db = vi.hoisted(() => ({
    setProbe: vi.fn(async (planId, { active, threadMessageId }) => {
        store.plan.probeActive = active;
        if (threadMessageId !== undefined) store.plan.probeThreadMessageId = threadMessageId;
        return { ...store.plan };
    }),
    setPlanOpener: vi.fn(async () => {}),
    clearPlanCard: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));

const { applyConfirmations } = await import('../../src/bot/plans.js');

function fakeThread(held = []) {
    const log = [];
    const messages = new Map(
        held.map((id) => [id, { id, edit: async (payload) => (log.push({ edit: id, payload }), { id, ...payload }) }])
    );
    return {
        log,
        archived: false,
        send: async (payload) => {
            const id = `new${log.length}`;
            log.push({ send: id, payload });
            return { id, ...payload };
        },
        messages: {
            fetch: async (id) => {
                const found = messages.get(id);
                if (!found) throw new Error('unknown message');
                return found;
            }
        }
    };
}

const plan = (over = {}) => ({
    planId: 'ab12cd34ef',
    guildId: 'g1',
    threadId: 't1',
    name: 'Camping',
    description: '',
    dateRange: { start: '2026-08-01', end: '2026-08-30' },
    status: 'closed',
    chosenDate: '2026-08-12',
    chosenTime: '19:00',
    chosenNote: null,
    timeZone: 'Europe/London',
    probeActive: false,
    probeThreadMessageId: 'pr1',
    participants: [
        { userId: 'a', invited: true, vote: 'yes', cardMessageId: 'm-a' },
        { userId: 'b', invited: true, vote: 'no', cardMessageId: 'm-b' },
        { userId: 'c', invited: true, vote: null, cardMessageId: 'm-c' }
    ],
    ...over
});

const ids = (payload) => payload.components.flatMap((row) => row.components.map((b) => b.data.custom_id));

beforeEach(() => {
    channels.clear();
    edits.length = 0;
    db.setProbe.mockClear();
    store.plan = null;
});

describe('closing a confirmation', () => {
    beforeEach(() => (store.plan = plan({ probeActive: true })));

    it('leaves every answer exactly where it was', async () => {
        channels.set('t1', fakeThread(['pr1']));
        const { plan: after } = await applyConfirmations(store.plan, false);

        expect(after.participants.map((p) => p.vote)).toEqual(['yes', 'no', null]);
        expect(after.probeActive).toBe(false);
    });

    /*
        Reopening needs something to revive or it posts a second poll. What actually keeps
        the id is setProbe being asked without one, so that is the assertion: the mock
        below stands in for the db and pinning the mock would pin nothing.
    */
    it('keeps hold of the message it was on', async () => {
        channels.set('t1', fakeThread(['pr1']));
        await applyConfirmations(store.plan, false);

        expect(db.setProbe).toHaveBeenCalledWith('ab12cd34ef', { active: false });
        expect(store.plan.probeThreadMessageId).toBe('pr1');
    });

    it('takes the buttons off the thread message but keeps its tally', async () => {
        const thread = fakeThread(['pr1']);
        channels.set('t1', thread);
        await applyConfirmations(store.plan, false);

        const edited = thread.log.find((e) => e.edit).payload;
        expect(edited.components).toEqual([]);
        expect(edited.content).toContain('Confirmations are closed.');
        expect(edited.content).toContain('1 coming');
    });

    //Otherwise three people are left holding a button that answers "that is closed now"
    it('takes the buttons off everyone card too', async () => {
        channels.set('t1', fakeThread(['pr1']));
        await applyConfirmations(store.plan, false);

        expect(edits).toHaveLength(3);
        for (const e of edits) expect(e.payload.components).toEqual([]);
    });
});

describe('opening a confirmation', () => {
    it('revives the poll already in the thread rather than posting another', async () => {
        store.plan = plan();
        const thread = fakeThread(['pr1']);
        channels.set('t1', thread);

        const { revived } = await applyConfirmations(store.plan, true);

        expect(revived).toBe(true);
        expect(thread.log.some((e) => e.send)).toBe(false);
        expect(ids(thread.log.find((e) => e.edit).payload)).toEqual(['vote|yes|ab12cd34ef', 'vote|no|ab12cd34ef']);
    });

    it('brings back the answers that were already on it', async () => {
        store.plan = plan();
        const thread = fakeThread(['pr1']);
        channels.set('t1', thread);

        await applyConfirmations(store.plan, true);

        const edited = thread.log.find((e) => e.edit).payload;
        expect(edited.content).toContain('1 coming');
        expect(edited.content).toContain("1 can't make it");
        expect(edited.content).toContain('1 yet to answer');
    });

    it('puts the buttons back on every card, with each answer still on it', async () => {
        store.plan = plan();
        channels.set('t1', fakeThread(['pr1']));
        await applyConfirmations(store.plan, true);

        const a = edits.find((e) => e.userId === 'a').payload;
        const c = edits.find((e) => e.userId === 'c').payload;
        expect(a.content).toContain("You're down as coming.");
        expect(c.content).toContain('Can you make it? Tap below.');
        expect(ids(c)).toEqual(['vote|yes|ab12cd34ef', 'vote|no|ab12cd34ef']);
    });

    //A plan that never had one: this is news, so it goes up mentioning the invite list
    it('posts a fresh poll with mentions when the plan has never had one', async () => {
        store.plan = plan({ probeThreadMessageId: null });
        const thread = fakeThread([]);
        channels.set('t1', thread);

        const { revived } = await applyConfirmations(store.plan, true);

        expect(revived).toBe(false);
        const sent = thread.log.find((e) => e.send).payload;
        expect(sent.content).toContain('<@a>');
        expect(sent.allowedMentions).toEqual({ users: ['a', 'b', 'c'] });
        expect(store.plan.probeThreadMessageId).toBe('new0');
    });

    it('posts that first poll without mentions when it is asked to keep quiet', async () => {
        store.plan = plan({ probeThreadMessageId: null });
        const thread = fakeThread([]);
        channels.set('t1', thread);

        await applyConfirmations(store.plan, true, { mention: false });

        const sent = thread.log.find((e) => e.send).payload;
        expect(sent.content).not.toContain('<@a>');
        expect(sent.allowedMentions).toEqual({ parse: [] });
    });
});
