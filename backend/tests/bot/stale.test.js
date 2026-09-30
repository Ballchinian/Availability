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

const { handleVote, handleUndrop } = await import('../../src/bot/plans.js');

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
        expect(shown.content).toContain('Can you make it? Tap below.');
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
