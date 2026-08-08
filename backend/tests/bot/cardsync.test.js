import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Rewriting the DM everybody holds, which is what corrects a wrong time without pinging
    seventeen people about it. Mostly these check that one person going wrong costs nobody
    else their edit, and that nothing here ever sends, since a send would ping them.
*/

//What each user's DM does when the bot reaches for it. Set per case.
const inbox = new Map();
const edits = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        channels: { fetch: async () => Promise.reject(new Error('no thread')) },
        users: {
            fetch: async (id) => {
                const box = inbox.get(id);
                if (!box) throw new Error('unknown user');
                return {
                    createDM: async () => {
                        if (box.dmsOff) throw Object.assign(new Error('cannot send'), { code: 50007 });
                        return {
                            messages: {
                                fetch: async (messageId) => {
                                    if (box.deleted) throw Object.assign(new Error('unknown message'), { code: 10008 });
                                    if (box.wobbly) throw Object.assign(new Error('service unavailable'), { code: 0 });
                                    return {
                                        id: messageId,
                                        edit: async (payload) => edits.push({ userId: id, messageId, payload })
                                    };
                                }
                            }
                        };
                    }
                };
            }
        }
    }
}));

const db = vi.hoisted(() => ({ clearPlanCard: vi.fn(async () => {}), setProbe: vi.fn(async () => {}), setPlanOpener: vi.fn(async () => {}) }));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));

const { syncPlanCards } = await import('../../src/bot/plans.js');

const person = (userId, over = {}) => ({
    userId,
    invited: true,
    vote: null,
    cardMessageId: `m-${userId}`,
    cardActor: 'Ali',
    cardMoved: false,
    ...over
});

const plan = (participants, over = {}) => ({
    planId: 'ab12cd34ef',
    guildId: 'g1',
    threadId: null,
    name: 'Camping',
    description: 'a weekend away',
    dateRange: { start: '2026-08-01', end: '2026-08-30' },
    status: 'closed',
    chosenDate: '2026-08-12',
    chosenTime: '19:00',
    chosenNote: 'meet at the station',
    timeZone: 'Europe/London',
    probeActive: false,
    participants,
    ...over
});

beforeEach(() => {
    inbox.clear();
    edits.length = 0;
    db.clearPlanCard.mockClear();
});

describe('syncPlanCards', () => {
    it('edits every card it is holding and never sends one', async () => {
        for (const id of ['a', 'b', 'c']) inbox.set(id, {});
        const done = await syncPlanCards(plan([person('a'), person('b'), person('c')]));

        expect(done).toBe(3);
        expect(edits).toHaveLength(3);
        expect(edits.map((e) => e.messageId).sort()).toEqual(['m-a', 'm-b', 'm-c']);
        //The new time is the whole reason for the pass
        expect(edits[0].payload.content).toContain('7pm');
        expect(edits[0].payload.content).toContain('meet at the station');
    });

    //Nobody to reach and nothing to spend a config lookup on
    it('does nothing at all when nobody is holding a card', async () => {
        const done = await syncPlanCards(plan([person('a', { cardMessageId: null })]));
        expect(done).toBe(0);
        expect(edits).toHaveLength(0);
    });

    //Why each edit is swallowed alone: fanOut rethrows the first failure once it settles
    it('keeps going when one person has DMs closed', async () => {
        inbox.set('a', {});
        inbox.set('b', { dmsOff: true });
        inbox.set('c', {});

        const done = await syncPlanCards(plan([person('a'), person('b'), person('c')]));

        expect(done).toBe(2);
        expect(edits.map((e) => e.userId).sort()).toEqual(['a', 'c']);
    });

    it('keeps going when somebody has left and cannot be fetched at all', async () => {
        inbox.set('a', {});
        const done = await syncPlanCards(plan([person('a'), person('gone')]));
        expect(done).toBe(1);
    });

    //Otherwise every later pass spends a call finding out the same thing
    it('forgets a card whose message has really gone', async () => {
        inbox.set('a', { deleted: true });
        await syncPlanCards(plan([person('a')]));
        expect(db.clearPlanCard).toHaveBeenCalledWith('ab12cd34ef', 'a');
    });

    //A blip is not a deletion: forgetting here would cost somebody their DM for good
    it('keeps a card whose message merely failed to load', async () => {
        inbox.set('a', { wobbly: true });
        await syncPlanCards(plan([person('a')]));
        expect(db.clearPlanCard).not.toHaveBeenCalled();
    });

    it('leaves somebody their own answer rather than asking again', async () => {
        inbox.set('a', {});
        inbox.set('b', {});
        await syncPlanCards(plan([person('a', { vote: 'yes' }), person('b')], { probeActive: true }));

        const a = edits.find((e) => e.userId === 'a').payload.content;
        const b = edits.find((e) => e.userId === 'b').payload.content;
        expect(a).toContain("You're down as coming.");
        expect(b).toContain('Can you make it? Tap below.');
    });

    it('tells somebody narrowed off the list that they are not on this one', async () => {
        inbox.set('a', {});
        await syncPlanCards(plan([person('a', { invited: false })]));
        expect(edits[0].payload.content).toContain('not on the list for this one');
        expect(edits[0].payload.components).toEqual([]);
    });

    it('says a cancelled plan is off rather than leaving them down as coming', async () => {
        inbox.set('a', {});
        await syncPlanCards(plan([person('a')], { status: 'cancelled' }));
        expect(edits[0].payload.content).toContain('is off');
        expect(edits[0].payload.content).not.toContain('7pm');
        expect(edits[0].payload.components).toEqual([]);
    });
});
