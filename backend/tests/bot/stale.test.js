import { describe, it, expect, beforeEach, vi } from 'vitest';
import { today, shiftDate } from '../../src/lib/dates.js';

/*
    Buttons pressed after the moment for them has gone. Each case is a DM press, so a
    refusal replaces the buttons in place, and the thing worth asserting is what was
    not written.
*/

const store = vi.hoisted(() => ({ plan: null }));
const db = vi.hoisted(() => ({
    getPlan: vi.fn(async () => store.plan && { ...store.plan }),
    recordVote: vi.fn(async () => store.plan),
    addParticipants: vi.fn(async () => store.plan),
    addPlanEvent: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));
vi.mock('../../src/bot/client.js', () => ({
    client: {
        channels: { fetch: async () => Promise.reject(new Error('unknown channel')) },
        users: { fetch: async () => Promise.reject(new Error('unknown user')) },
        guilds: { fetch: async () => Promise.reject(new Error('unknown guild')) }
    }
}));

const { handleVote } = await import('../../src/bot/plans.js');

function press(customId) {
    return { customId, user: { id: 'bo', username: 'bo' }, inGuild: () => false, update: vi.fn(async () => {}) };
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
