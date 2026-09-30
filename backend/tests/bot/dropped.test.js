import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    The DMs whoever set a plan up gets when someone drops out, says it is not for them or
    comes back in, and the names handed back, which is all the site has to go on when it
    tells the person who heard.
*/

const dms = [];
const closed = new Set();
let members = {};

vi.mock('../../src/bot/client.js', () => ({
    client: {
        users: {
            fetch: async (userId) => ({
                send: async (text) => {
                    if (closed.has(userId)) throw new Error('Cannot send messages to this user');
                    dms.push({ userId, text });
                    return { id: `dm-${userId}` };
                }
            })
        },
        guilds: {
            fetch: async () => ({
                members: {
                    fetch: async (userId) => {
                        if (!members[userId]) throw new Error('Unknown Member');
                        return { displayName: members[userId] };
                    }
                }
            })
        }
    }
}));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));

const { notifyCreatorDropped, announceJoin } = await import('../../src/bot/plans.js');

const plan = { planId: 'p1', guildId: 'g1', name: 'Board games', createdBy: 'planner' };

beforeEach(() => {
    dms.length = 0;
    closed.clear();
    members = { planner: 'Ali', guest: 'Bo' };
});

describe('telling whoever set it up that someone dropped out', () => {
    it('DMs them and hands back their name as told', async () => {
        const result = await notifyCreatorDropped(plan, 'guest', 'Away that week');

        expect(result).toEqual({ told: ['Ali'], missed: [] });
        expect(dms).toHaveLength(1);
        expect(dms[0].userId).toBe('planner');
        expect(dms[0].text).toContain('Bo dropped out of "Board games" in The server.');
        expect(dms[0].text).toContain('Reason: Away that week');
    });

    it('hands their name back as missed when their DMs are closed', async () => {
        closed.add('planner');
        expect(await notifyCreatorDropped(plan, 'guest', null)).toEqual({ told: [], missed: ['Ali'] });
    });

    it('still reaches them after they leave the server, without a name to give', async () => {
        delete members.planner;
        expect(await notifyCreatorDropped(plan, 'guest', null)).toEqual({ told: ['whoever set it up'], missed: [] });
    });

    it('tells nobody when the one dropping out set it up', async () => {
        expect(await notifyCreatorDropped(plan, 'planner', null)).toEqual({ told: [], missed: [] });
        expect(dms).toEqual([]);
    });
});

describe('telling whoever set it up about a count me in or not for me', () => {
    const answered = (value) => ({ ...plan, status: 'collecting', participants: [{ userId: 'guest', in: value }, { userId: 'cy', in: null }] });

    it('says who is out and why, and hands back who heard', async () => {
        const result = await announceJoin(answered(false), 'guest', null, 'Away that week');

        expect(result).toEqual({ told: ['Ali'], missed: [] });
        expect(dms).toHaveLength(1);
        expect(dms[0].text.content).toBe(`**SOMEONE CANNOT MAKE IT**\n\nBo can't make "Board games" in The server.\nReason: Away that week`);
    });

    it('says nothing new to someone already told they were out', async () => {
        expect(await announceJoin(answered(false), 'guest', false, 'Changed the reason')).toEqual({ told: [], missed: [] });
        expect(dms).toEqual([]);
    });

    it('says when someone who was out is in after all', async () => {
        await announceJoin(answered(true), 'guest', false);
        expect(dms.map((d) => d.text)).toEqual(['**BACK IN**\n\nBo is in for "Board games" in The server after all.']);
    });

    it('says nothing when someone just says they are in', async () => {
        await announceJoin(answered(true), 'guest', null);
        expect(dms).toEqual([]);
    });
});
