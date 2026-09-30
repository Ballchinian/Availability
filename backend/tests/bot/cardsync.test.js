import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Rewriting the DM everybody holds, which is what corrects a wrong time without pinging
    seventeen people about it. Mostly these check that one person going wrong costs nobody
    else their edit, and that nothing here ever sends, since a send would ping them.
*/

//What each user's DM does when the bot reaches for it. Set per case.
const inbox = new Map();
const edits = [];
const sends = [];
const deletes = [];
//Sends, edits and deletes in the order they happened
const order = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        guilds: { fetch: async () => ({ name: 'The server' }) },
        channels: { fetch: async () => Promise.reject(new Error('no thread')) },
        users: {
            fetch: async (id) => {
                const box = inbox.get(id);
                if (!box) throw new Error('unknown user');
                return {
                    send: async (payload) => {
                        if (box.dmsOff || box.sendsOff) throw Object.assign(new Error('cannot send'), { code: 50007 });
                        sends.push({ userId: id, payload });
                        order.push(`send ${id}`);
                        return { id: `sent-${id}` };
                    },
                    createDM: async () => {
                        if (box.dmsOff) throw Object.assign(new Error('cannot send'), { code: 50007 });
                        return {
                            messages: {
                                fetch: async (messageId) => {
                                    if (box.deleted) throw Object.assign(new Error('unknown message'), { code: 10008 });
                                    if (box.wobbly) throw Object.assign(new Error('service unavailable'), { code: 0 });
                                    return {
                                        id: messageId,
                                        edit: async (payload) => {
                                            order.push(`edit ${messageId}`);
                                            return edits.push({ userId: id, messageId, payload });
                                        },
                                        delete: async () => {
                                            if (box.undeletable) throw Object.assign(new Error('missing access'), { code: 50001 });
                                            order.push(`delete ${messageId}`);
                                            deletes.push(messageId);
                                        }
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

const db = vi.hoisted(() => ({
    clearPlanCard: vi.fn(async () => {}),
    setPlanOpener: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {}),
    setDmsClosed: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));

vi.mock('../../src/db/users.js', () => ({ getPlanningPrefs: vi.fn(async () => ({})) }));

const { syncPlanCards, announceOutcome, announceWhenEdit, announceAddition, applyAttendanceMove, remindVoters, announceCancel } = await import('../../src/bot/plans.js');

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
    sends.length = 0;
    deletes.length = 0;
    order.length = 0;
    db.clearPlanCard.mockClear();
    db.setPlanCards.mockClear();
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
        expect(db.clearPlanCard).toHaveBeenCalledWith('ab12cd34ef', 'a', 'm-a');
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

/*
    Setting a day quietly. The trap being avoided is a quiet path that still sends: a fresh
    DM pings, and a ping is the one thing quiet mode exists to stop.
*/
describe('announceOutcome under quiet', () => {
    it('rewrites the cards people hold rather than sending new ones', async () => {
        for (const id of ['a', 'b']) inbox.set(id, {});
        const p = plan([person('a'), person('b')], { threadId: null });

        await announceOutcome(p, { guildName: 'The server' }, { changed: false, actorName: 'Ali', quiet: true });

        expect(sends).toHaveLength(0);
        expect(edits).toHaveLength(2);
        expect(edits[0].payload.content).toContain('7pm');
    });

    //The lead a card carries has to move on with it or the rewrite says the wrong thing
    it('moves the actor and the moved flag on without a send', async () => {
        inbox.set('a', {});
        const p = plan([person('a', { cardActor: 'Bo', cardMoved: false })], { threadId: null });

        await announceOutcome(p, { guildName: 'The server' }, { changed: true, actorName: 'Ali', quiet: true });

        expect(db.setPlanCards).toHaveBeenCalledWith(
            'ab12cd34ef',
            [{ userId: 'a', messageId: 'm-a' }],
            { actorName: 'Ali', moved: true }
        );
        expect(edits[0].payload.content).toContain('Ali moved the plan');
    });

    it('still sends when it is not asked to keep quiet', async () => {
        inbox.set('a', {});
        const p = plan([person('a')], { threadId: null });

        await announceOutcome(p, { guildName: 'The server' }, { changed: false, actorName: 'Ali' });

        expect(sends).toHaveLength(1);
        expect(edits).toHaveLength(0);
    });
});

/*
    An announcement waits its turn behind any other for the same plan, then gets the plan as
    it is by then, which a later save may have moved on from what it was queued to say.
*/
describe('announcing a plan that has moved on since', () => {
    const cfg = { guildName: 'The server' };

    it('says nothing about a day that has been taken back', async () => {
        inbox.set('a', {});
        const p = plan([person('a')], { status: 'collecting', chosenDate: null, chosenTime: null });

        await announceOutcome(p, cfg, { changed: false, actorName: 'Ali' });

        expect(sends).toHaveLength(0);
        expect(db.setPlanCards).not.toHaveBeenCalled();
    });

    it('rewrites the cards but sends no update once a later save put the time back', async () => {
        inbox.set('a', {});
        const p = plan([person('a')]);

        await announceWhenEdit(p, cfg, { actorName: 'Ali', was: { time: '19:00', note: 'meet at the station' } });

        expect(sends).toHaveLength(0);
        expect(edits).toHaveLength(1);
    });

    it('sends no time update for a plan with no day any more', async () => {
        inbox.set('a', {});
        const p = plan([person('a')], { status: 'collecting', chosenDate: null, chosenTime: null });

        await announceWhenEdit(p, cfg, { actorName: 'Ali', was: { time: '19:00', note: null } });

        expect(sends).toHaveLength(0);
    });

    it('leaves out anyone added who has left the plan again', async () => {
        inbox.set('a', {});
        inbox.set('b', {});

        await announceAddition(plan([person('a', { cardMessageId: null })]), ['a', 'b'], 'Ali');

        expect(sends.map((s) => s.userId)).toEqual(['a']);
    });
});

//Their old card says "NOT THIS ONE" and has no buttons, so rewriting it would never ask them
describe('inviting someone left off the day', () => {
    const invited = () => plan([person('a', { cardMessageId: 'm-old' })], { probeActive: true });

    it('sends them the yes/no as a new DM and keeps hold of it', async () => {
        inbox.set('a', {});
        const reached = await applyAttendanceMove(invited(), 'invite', 'a');

        expect(reached).toBe(true);
        expect(sends).toHaveLength(1);
        expect(sends[0].payload.content).toContain('Can you make it? Tap below.');
        expect(sends[0].payload.components).toHaveLength(1);
        expect(db.setPlanCards).toHaveBeenCalledWith('ab12cd34ef', [{ userId: 'a', messageId: 'sent-a' }], { actorName: '' });
        //The NOT THIS ONE card goes, or it sits above the yes/no saying the opposite
        expect(deletes).toEqual(['m-old']);
    });

    //Ali set the day, which is not the same as Ali inviting them
    it('names nobody as having set it', async () => {
        inbox.set('a', {});
        await applyAttendanceMove(invited(), 'invite', 'a');
        expect(sends[0].payload.content).not.toContain('Ali');
    });

    it('says so when their DMs are closed', async () => {
        inbox.set('a', { dmsOff: true });
        expect(await applyAttendanceMove(invited(), 'invite', 'a')).toBe(false);
        expect(sends).toHaveLength(0);
    });

    it('sends nothing for any other move', async () => {
        inbox.set('a', {});
        expect(await applyAttendanceMove(invited(), 'cant', 'a')).toBeNull();
        expect(sends).toHaveLength(0);
    });
});

/*
    One card per person carries live buttons. Anything loud sends a fresh one and takes the
    old one down, so a DM from before the change cannot be pressed as if it were current.
*/
describe('a fresh card over an old one', () => {
    const asking = (over = {}) => plan([person('a', over)], { probeActive: true });

    it('takes the old card down once the new one has landed', async () => {
        inbox.set('a', {});
        await announceOutcome(asking(), { guildName: 'The server' }, { changed: true, actorName: 'Ali' });

        expect(deletes).toEqual(['m-a']);
        expect(order.indexOf('send a')).toBeLessThan(order.indexOf('delete m-a'));
        expect(db.setPlanCards).toHaveBeenCalledWith('ab12cd34ef', [{ userId: 'a', messageId: 'sent-a' }], { actorName: 'Ali', moved: true });
    });

    it('leaves the old card with no buttons when Discord will not delete it', async () => {
        inbox.set('a', { undeletable: true });
        await announceOutcome(asking(), { guildName: 'The server' }, { changed: true, actorName: 'Ali' });

        expect(deletes).toEqual([]);
        expect(edits).toEqual([{ userId: 'a', messageId: 'm-a', payload: { content: "There's a newer message about this plan.", components: [] } }]);
    });

    //The old card is the only thing they have, so it is kept and brought up to the new day
    it('keeps and rewrites the old card when the new one cannot be sent', async () => {
        inbox.set('a', { sendsOff: true });
        await announceOutcome(asking(), { guildName: 'The server' }, { changed: true, actorName: 'Ali' });

        expect(deletes).toEqual([]);
        expect(edits.map((e) => e.messageId)).toEqual(['m-a']);
        expect(edits[0].payload.content).toContain('7pm');
    });

    it('sends a reminder as the card itself, buttons and all', async () => {
        inbox.set('a', {});
        await remindVoters(asking(), 'Ali');

        expect(sends).toHaveLength(1);
        expect(sends[0].payload.content).toContain('Ali is still waiting to hear whether you can make it.');
        expect(sends[0].payload.content).toContain('Can you make it? Tap below.');
        expect(sends[0].payload.components).toHaveLength(1);
        expect(deletes).toEqual(['m-a']);
        //A reminder is nobody setting anything, so the lead the card had stays on record
        expect(db.setPlanCards).toHaveBeenCalledWith('ab12cd34ef', [{ userId: 'a', messageId: 'sent-a' }], { keepLead: true });
    });

    it('sends a moved time as the card, keeping their answer on it', async () => {
        inbox.set('a', {});
        await announceWhenEdit(asking({ vote: 'yes' }), { guildName: 'The server' }, { actorName: 'Bo', was: { time: '18:00', note: 'meet at the station' } });

        expect(sends).toHaveLength(1);
        expect(sends[0].payload.content).toContain('Bo changed it: it starts at 7pm now.');
        expect(sends[0].payload.content).toContain("You're down as coming.");
        expect(deletes).toEqual(['m-a']);
    });

    it('says who called it off on the card that replaces theirs', async () => {
        inbox.set('a', {});
        await announceCancel(plan([person('a')], { status: 'cancelled' }), 'Ali');

        expect(sends[0].payload.content).toContain('Ali called off "Camping" in The server.');
        expect(sends[0].payload.components).toEqual([]);
        expect(deletes).toEqual(['m-a']);
    });
});
