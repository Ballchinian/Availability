import { describe, it, expect, beforeEach, vi } from 'vitest';
import { today, shiftDate } from '../../src/lib/dates.js';

/*
    What Discord hears when someone answers for a set day on the site: the same notes
    to whoever runs the plan that the buttons on a DM set off, to every one of them.
    Ali and Sam run this plan, and Bo and Cy are on it.
*/

const dms = [];
vi.mock('../../src/bot/client.js', () => ({
    client: {
        users: {
            fetch: async (userId) => ({
                send: async (payload) => {
                    dms.push({ userId, ...(typeof payload === 'string' ? { content: payload } : payload) });
                    return { id: `dm-${userId}` };
                }
            })
        },
        guilds: {
            fetch: async () => ({ members: { fetch: async (id) => ({ displayName: { ali: 'Ali', sam: 'Sam', bo: 'Bo', cy: 'Cy' }[id] }) } })
        }
    }
}));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));
const db = vi.hoisted(() => ({ markProbeAllYes: vi.fn(async () => {}), setDmsClosed: vi.fn(async () => {}) }));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));

const { announceVote } = await import('../../src/bot/plans.js');

const day = shiftDate(today(), 3);
const plan = (bo, cy = { vote: 'yes' }) => ({
    planId: 'p1',
    guildId: 'g1',
    name: 'Board games',
    createdBy: 'ali',
    hostIds: ['ali', 'sam'],
    status: 'closed',
    probeActive: true,
    chosenDate: day,
    timeZone: 'Europe/London',
    participants: [{ userId: 'bo', invited: true, ...bo }, { userId: 'cy', invited: true, ...cy }]
});

beforeEach(() => {
    vi.clearAllMocks();
    dms.length = 0;
});

describe("a can't make it from the site", () => {
    it('tells everyone who runs the plan, with the reason, and hands back who heard', async () => {
        const heard = await announceVote(plan({ vote: 'no', voteReason: 'Working late' }), 'bo', null, 'Working late');

        expect(heard).toEqual({ told: ['Ali', 'Sam'], missed: [] });
        expect(dms.map((d) => d.userId).sort()).toEqual(['ali', 'sam']);
        expect(dms[0].content).toMatch(/^\*\*SOMEONE CANNOT MAKE IT\*\*\n\nBo cannot make "Board games" in The server on .+\.\nReason: Working late$/);
        expect(dms[0].components[0].components[0].data.label).toBe('Open the overview');
    });

    it('says when no reason was given, and nothing about a vote still going', async () => {
        await announceVote(plan({ vote: 'no' }), 'bo', 'yes', null);
        expect(dms[0].content).toMatch(/\nThey did not give a reason\.$/);
        expect(dms[0].content).not.toMatch(/vote is still going/);
    });

    it('tells nobody a second time about a no already on record', async () => {
        expect(await announceVote(plan({ vote: 'no' }), 'bo', 'no', 'Changed the reason')).toEqual({ told: [], missed: [] });
        expect(dms).toEqual([]);
    });
});

describe("an I'm coming from the site", () => {
    it('tells everyone who runs the plan once that makes everybody', async () => {
        await announceVote(plan({ vote: 'yes' }), 'bo', null);

        expect(db.markProbeAllYes).toHaveBeenCalledWith('p1');
        expect(dms.map((d) => d.userId).sort()).toEqual(['ali', 'sam']);
        expect(dms[0].content).toMatch(/^\*\*EVERYONE IS COMING\*\*/);
    });

    it('tells nobody while someone has still to answer', async () => {
        await announceVote(plan({ vote: 'yes' }, { vote: null }), 'bo', null);
        expect(dms).toEqual([]);
    });
});

it('has nothing to say about someone who is no longer on the plan', async () => {
    expect(await announceVote(plan({ vote: 'no' }), 'gone', null)).toEqual({ told: [], missed: [] });
    expect(dms).toEqual([]);
});
