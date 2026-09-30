import { describe, it, expect, beforeEach, vi } from 'vitest';
import { todayIn } from '../../src/lib/zones.js';
import { shiftDate } from '../../src/lib/dates.js';

/*
    The one DM that tells whoever runs a plan they can pick a day. It goes once everyone
    still on the plan is in and has a calendar answering every day of it, whoever pressed
    save on this plan and whoever did not.
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
const db = vi.hoisted(() => ({ markAllInNotified: vi.fn(async () => {}), setDmsClosed: vi.fn(async () => {}) }));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
const prefs = vi.hoisted(() => ({ rows: {} }));
vi.mock('../../src/db/users.js', async (real) => ({ ...(await real()), getPlanningPrefs: vi.fn(async () => prefs.rows) }));

const { notifyCreatorIfAllIn } = await import('../../src/bot/plans.js');

const ahead = (n) => shiftDate(todayIn('Europe/London'), n);
const plan = (participants, over = {}) => ({
    planId: 'p1',
    guildId: 'g1',
    name: 'Board games',
    createdBy: 'ali',
    status: 'collecting',
    timeZone: 'Europe/London',
    dateRange: { start: ahead(2), end: ahead(4) },
    allowedWeekdays: null,
    participants,
    ...over
});
//A calendar that answers the plan's three days
const answers = { coveredUntil: ahead(10), answered: [], timeZone: 'Europe/London' };

beforeEach(() => {
    vi.clearAllMocks();
    dms.length = 0;
    prefs.rows = { bo: answers, cy: answers };
});

describe('telling whoever runs a plan that everyone is in', () => {
    it('goes once everyone is in with a calendar that answers every day, saved on this plan or not', async () => {
        await notifyCreatorIfAllIn(plan([{ userId: 'bo', in: true }, { userId: 'cy', confirmed: true }]));

        expect(db.markAllInNotified).toHaveBeenCalledWith('p1');
        expect(dms).toHaveLength(1);
        expect(dms[0].userId).toBe('ali');
        expect(dms[0].content).toBe('**EVERYONE IS IN**\n\nEveryone has answered "Board games" in The server, so you can pick a day now.');
    });

    it('leaves out anyone who said it is not for them', async () => {
        await notifyCreatorIfAllIn(plan([{ userId: 'bo', in: true }, { userId: 'cy', in: false }]));
        expect(dms).toHaveLength(1);
    });

    it('waits on someone who has not said', async () => {
        await notifyCreatorIfAllIn(plan([{ userId: 'bo', in: true }, { userId: 'cy', in: null }]));
        expect(dms).toEqual([]);
    });

    it('waits on someone in with days still to fill', async () => {
        prefs.rows.cy = { ...answers, coveredUntil: ahead(3) };
        await notifyCreatorIfAllIn(plan([{ userId: 'bo', in: true }, { userId: 'cy', in: true }]));
        expect(dms).toEqual([]);
        expect(db.markAllInNotified).not.toHaveBeenCalled();
    });

    it('says nothing when everyone is out', async () => {
        await notifyCreatorIfAllIn(plan([{ userId: 'bo', in: false }]));
        expect(dms).toEqual([]);
    });

    it('goes once a round', async () => {
        await notifyCreatorIfAllIn(plan([{ userId: 'bo', in: true }], { allInNotifiedAt: new Date() }));
        expect(dms).toEqual([]);
    });
});
