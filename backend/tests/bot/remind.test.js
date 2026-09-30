import { describe, it, expect, beforeEach, vi } from 'vitest';
import { todayIn } from '../../src/lib/zones.js';
import { shiftDate } from '../../src/lib/dates.js';

/*
    The nudge a planner sends. It goes to whoever the plan is still waiting on and nobody
    else, and the card under it says what each of them has left to do.
*/

const dms = [];
vi.mock('../../src/bot/client.js', () => ({
    client: {
        users: {
            fetch: async (userId) => ({
                send: async (payload) => {
                    dms.push({ userId, ...payload });
                    return { id: `dm-${userId}` };
                }
            })
        }
    }
}));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), setPlanCards: vi.fn(async () => {}), setDmsClosed: vi.fn(async () => {}) }));
const prefs = vi.hoisted(() => ({ rows: {} }));
vi.mock('../../src/db/users.js', async (real) => ({ ...(await real()), getPlanningPrefs: vi.fn(async () => prefs.rows) }));
vi.mock('../../src/db/availability.js', async (real) => ({
    ...(await real()),
    getAvailabilityForUsersInRange: vi.fn(async () => []),
    getLastUpdated: vi.fn(async () => ({}))
}));

const { remindStragglers, remindVoters } = await import('../../src/bot/plans.js');

const ahead = (n) => shiftDate(todayIn('Europe/London'), n);
const plan = (participants, over = {}) => ({
    planId: 'p1',
    guildId: 'g1',
    name: 'Board games',
    createdBy: 'ali',
    status: 'collecting',
    timeZone: 'Europe/London',
    dateRange: { start: ahead(2), end: ahead(6) },
    allowedWeekdays: null,
    participants,
    ...over
});
const calendar = (coveredUntil) => ({ coveredUntil, answered: [], timeZone: 'Europe/London' });
const sentTo = () => dms.map((d) => d.userId).sort();
const card = (userId) => dms.find((d) => d.userId === userId).content;

beforeEach(() => {
    dms.length = 0;
    prefs.rows = {};
});

describe('nudging a plan still finding its day', () => {
    const crowd = [
        { userId: 'done', in: true },
        { userId: 'short', in: true },
        { userId: 'quiet', in: null },
        { userId: 'out', in: false }
    ];

    beforeEach(() => {
        prefs.rows = { done: calendar(ahead(10)), short: calendar(ahead(4)), quiet: calendar(ahead(10)), out: calendar(null) };
    });

    it('reaches whoever it is still waiting on, and not whoever is done or out', async () => {
        expect(await remindStragglers(plan(crowd), 'Ali')).toBe(2);
        expect(sentTo()).toEqual(['quiet', 'short']);
    });

    it('tells each of them what they still owe', async () => {
        await remindStragglers(plan(crowd), 'Ali');
        expect(card('quiet')).toContain("Ali is still waiting to hear if you're in.");
        expect(card('quiet')).toMatch(/Are you in\? Your calendar already answers this/);
        expect(card('short')).toContain('Ali is still waiting on your dates.');
        expect(card('short')).toContain(`You're in. Your calendar answers up to`);
    });

    //Their calendar does not answer for them while they are sent back, so they owe it all
    it('opens with who moved someone back, and nothing about who is waiting', async () => {
        const back = { userId: 'done', in: null, sentBack: { byName: 'Sam', at: new Date(), was: { in: true } } };
        await remindStragglers(plan([back]), 'Ali');
        expect(card('done')).toContain('Sam moved you back to waiting for "Board games".');
        expect(card('done')).not.toContain('Ali is still waiting');
    });

    it('sends nothing when nobody owes anything', async () => {
        expect(await remindStragglers(plan([{ userId: 'done', in: true }]), 'Ali')).toBe(0);
        expect(dms).toEqual([]);
    });
});

describe('nudging about a set day', () => {
    const day = (participants) => plan(participants, { status: 'closed', chosenDate: ahead(3), probeActive: true });

    it('leaves out whoever said it was not for them before the day was set', async () => {
        await remindVoters(day([{ userId: 'bo', invited: true }, { userId: 'out', invited: true, in: false }]), 'Ali');
        expect(sentTo()).toEqual(['bo']);
    });

    it('opens with who moved someone back', async () => {
        await remindVoters(day([{ userId: 'bo', invited: true, sentBack: { byName: 'Sam' } }]), 'Ali');
        expect(card('bo')).toContain('Sam moved you back to waiting for "Board games".');
    });
});
