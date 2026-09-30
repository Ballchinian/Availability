import { describe, it, expect, beforeEach, vi } from 'vitest';
import { today, shiftDate } from '../../src/lib/dates.js';

/*
    Buttons pressed after the moment for them has gone. Each case is a DM press, so a
    refusal replaces the buttons in place, and the thing worth asserting is what was
    not written.
*/

const store = vi.hoisted(() => ({ plan: null, members: [] }));
const db = vi.hoisted(() => ({
    getPlan: vi.fn(async () => store.plan && { ...store.plan }),
    recordVote: vi.fn(async () => store.plan),
    addParticipants: vi.fn(async () => store.plan),
    addPlanEvent: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));
vi.mock('../../src/bot/client.js', () => ({
    client: {
        channels: { fetch: async () => Promise.reject(new Error('unknown channel')) },
        users: { fetch: async () => Promise.reject(new Error('unknown user')) },
        guilds: {
            fetch: async () => ({
                members: {
                    cache: new Map(),
                    fetch: async (id) => (store.members.includes(id) ? { id, user: { bot: false } } : Promise.reject(new Error('Unknown Member')))
                }
            })
        }
    }
}));

const { handleVote, handleVoteModal, handleUndrop } = await import('../../src/bot/plans.js');

function press(customId, message = null) {
    return { customId, message, user: { id: 'bo', username: 'bo' }, inGuild: () => false, update: vi.fn(async () => {}), showModal: vi.fn(async () => {}) };
}

const setPlan = (chosenDate) => ({
    planId: 'ab12cd34ef',
    guildId: 'g1',
    name: 'Board games',
    status: 'closed',
    probeActive: true,
    chosenDate,
    dateRange: { start: chosenDate, end: chosenDate },
    timeZone: 'Europe/London',
    participants: [{ userId: 'bo', invited: true, vote: null }]
});

beforeEach(() => vi.clearAllMocks());

describe('a vote on a day that has been and gone', () => {
    it('is refused and changes nothing', async () => {
        store.plan = setPlan(shiftDate(today(), -2));
        const click = press('vote|yes|ab12cd34ef');

        await handleVote(click);

        expect(click.update.mock.calls[0][0].content).toMatch(/has been and gone/);
        expect(db.recordVote).not.toHaveBeenCalled();
    });

    it('still counts while the day is ahead', async () => {
        store.plan = setPlan(shiftDate(today(), 3));
        await handleVote(press('vote|yes|ab12cd34ef')).catch(() => {});
        expect(db.recordVote).toHaveBeenCalled();
    });
});

describe('undoing a drop out', () => {
    //Dropped out, so no longer on the guest list
    const dropped = (over = {}) => ({ ...setPlan(shiftDate(today(), 3)), participants: [], ...over });

    beforeEach(() => {
        store.members = ['bo'];
    });

    it('puts someone still in the server back on', async () => {
        store.plan = dropped();
        await handleUndrop(press('undrop|ab12cd34ef')).catch(() => {});
        expect(db.addParticipants).toHaveBeenCalledWith('ab12cd34ef', ['bo']);
    });

    it('turns away someone who has left the server', async () => {
        store.plan = dropped();
        store.members = [];
        const click = press('undrop|ab12cd34ef');

        await handleUndrop(click);

        expect(click.update.mock.calls[0][0].content).toMatch(/not in the server/);
        expect(db.addParticipants).not.toHaveBeenCalled();
    });

    it('turns them away once the day has gone', async () => {
        store.plan = dropped({ chosenDate: shiftDate(today(), -2) });
        const click = press('undrop|ab12cd34ef');

        await handleUndrop(click);

        expect(click.update.mock.calls[0][0].content).toMatch(/nothing to rejoin/);
        expect(db.addParticipants).not.toHaveBeenCalled();
    });

    it('turns them away from a cancelled plan', async () => {
        store.plan = dropped({ status: 'cancelled' });
        await handleUndrop(press('undrop|ab12cd34ef'));
        expect(db.addParticipants).not.toHaveBeenCalled();
    });
});

/*
    A card that should have been taken down when a newer one went out. The newer one may say
    a different time, so a yes from here could be a yes to something that no longer stands.
*/
describe('a press on a card older than the one on record', () => {
    const holding = () => ({ ...setPlan(shiftDate(today(), 3)), participants: [{ userId: 'bo', invited: true, vote: null, cardMessageId: 'newer' }] });

    it('answers with the card as it is now and writes nothing', async () => {
        store.plan = holding();
        const click = press('vote|yes|ab12cd34ef', { id: 'older' });

        await handleVote(click);

        const shown = click.update.mock.calls[0][0];
        expect(shown.content).toContain('Can you make it?');
        expect(shown.components).toHaveLength(1);
        expect(db.recordVote).not.toHaveBeenCalled();
        expect(click.showModal).not.toHaveBeenCalled();
    });

    //The one they pressed is where they are looking, so it is the one kept live
    it('makes the message they pressed their card', async () => {
        store.plan = holding();
        await handleVote(press('vote|no|ab12cd34ef', { id: 'older' }));
        expect(db.setPlanCards).toHaveBeenCalledWith('ab12cd34ef', [{ userId: 'bo', messageId: 'older' }], { keepLead: true });
    });

    it('counts a press on the card on record as ever', async () => {
        store.plan = holding();
        await handleVote(press('vote|yes|ab12cd34ef', { id: 'newer' })).catch(() => {});
        expect(db.recordVote).toHaveBeenCalled();
    });
});

/*
    Every yes/no button carries the round it was sent in. Before rounds, a poll left over
    from the day before a move voted on the new day.
*/
describe('a press from a round the plan has moved on from', () => {
    const moved = () => ({
        ...setPlan(shiftDate(today(), 3)),
        round: 2,
        pastVotes: [{ date: '2026-09-12', round: 1, votes: [] }],
        participants: [{ userId: 'bo', invited: true, vote: null, cardMessageId: 'card' }]
    });
    const inThread = (customId) => ({ ...press(customId), inGuild: () => true, reply: vi.fn(async () => {}) });

    it('is refused in the thread with the day it was about, and changes nothing', async () => {
        store.plan = moved();
        const click = inThread('vote|yes|ab12cd34ef|r1');

        await handleVote(click);

        expect(click.reply.mock.calls[0][0].content).toBe('That was about Sat 12 Sep 2026; the plan has moved.');
        expect(db.recordVote).not.toHaveBeenCalled();
    });

    //A DM has no private reply, so the card itself says it and shows where things are now
    it('turns the card back into the current one in a DM, saying why', async () => {
        store.plan = moved();
        const click = press('vote|no|ab12cd34ef|r1', { id: 'card' });

        await handleVote(click);

        const shown = click.update.mock.calls[0][0];
        expect(shown.content).toContain('That was about Sat 12 Sep 2026; the plan has moved.');
        expect(shown.components[0].components[0].data.custom_id).toBe('vote|yes|ab12cd34ef|r2');
        expect(click.showModal).not.toHaveBeenCalled();
        expect(db.recordVote).not.toHaveBeenCalled();
    });

    it('is refused when the reason box comes back after the day moved', async () => {
        store.plan = moved();
        const submit = { ...press('votemodal|ab12cd34ef|r1'), fields: { getTextInputValue: () => '' } };

        await handleVoteModal(submit);

        expect(db.recordVote).not.toHaveBeenCalled();
    });

    it('says only that the day moved when the round is too old to name', async () => {
        store.plan = { ...moved(), pastVotes: [] };
        const click = inThread('vote|yes|ab12cd34ef|r1');
        await handleVote(click);
        expect(click.reply.mock.calls[0][0].content).toBe('That was about an earlier day; the plan has moved.');
    });

    //What went out before rounds carries none: good while the day has not moved, refused once it has
    it('counts a press with no round on a plan still on its first day, and refuses it after a move', async () => {
        store.plan = { ...setPlan(shiftDate(today(), 3)) };
        await handleVote(inThread('vote|yes|ab12cd34ef')).catch(() => {});
        expect(db.recordVote).toHaveBeenCalledTimes(1);

        store.plan = moved();
        await handleVote(inThread('vote|yes|ab12cd34ef'));
        expect(db.recordVote).toHaveBeenCalledTimes(1);
    });

    it('counts a press from the round the plan is on', async () => {
        store.plan = moved();
        await handleVote(inThread('vote|yes|ab12cd34ef|r2')).catch(() => {});
        expect(db.recordVote).toHaveBeenCalled();
    });
});
