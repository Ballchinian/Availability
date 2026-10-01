import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    The DMs everyone who runs a plan gets when someone drops out, says it is not for them
    or comes back in, and the names handed back, which is all the site has to go on when
    it tells the person who heard.
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

const { notifyHostsDropped, announceJoin } = await import('../../src/bot/plans.js');

const plan = { planId: 'p1', guildId: 'g1', name: 'Board games', createdBy: 'planner' };

beforeEach(() => {
    dms.length = 0;
    closed.clear();
    members = { planner: 'Ali', guest: 'Bo', sam: 'Sam' };
});

describe('telling whoever runs it that someone dropped out', () => {
    it('DMs them and hands back their name as told', async () => {
        const result = await notifyHostsDropped(plan, 'guest', 'Away that week');

        expect(result).toEqual({ told: ['Ali'], missed: [] });
        expect(dms).toHaveLength(1);
        expect(dms[0].userId).toBe('planner');
        expect(dms[0].text).toContain('Bo dropped out of "Board games" in The server.');
        expect(dms[0].text).toContain('Reason: Away that week');
    });

    it('hands their name back as missed when their DMs are closed', async () => {
        closed.add('planner');
        expect(await notifyHostsDropped(plan, 'guest', null)).toEqual({ told: [], missed: ['Ali'] });
    });

    it('still reaches them after they leave the server, without a name to give', async () => {
        delete members.planner;
        expect(await notifyHostsDropped(plan, 'guest', null)).toEqual({ told: ['whoever runs it'], missed: [] });
    });

    it('tells nobody when the one dropping out is the only one running it', async () => {
        expect(await notifyHostsDropped(plan, 'planner', null)).toEqual({ told: [], missed: [] });
        expect(dms).toEqual([]);
    });

    describe('on a plan more than one person runs', () => {
        const shared = { ...plan, hostIds: ['planner', 'sam'] };

        it('tells every one of them, named in the order they run it', async () => {
            expect(await notifyHostsDropped(shared, 'guest', null)).toEqual({ told: ['Ali', 'Sam'], missed: [] });
            expect(dms.map((d) => d.userId).sort()).toEqual(['planner', 'sam']);
            expect(dms[0].text).toBe(dms[1].text);
        });

        it('says which of them the DM could not reach', async () => {
            closed.add('sam');
            expect(await notifyHostsDropped(shared, 'guest', null)).toEqual({ told: ['Ali'], missed: ['Sam'] });
        });

        it('tells the others when the one dropping out runs it too', async () => {
            expect(await notifyHostsDropped(shared, 'sam', null)).toEqual({ told: ['Ali'], missed: [] });
            expect(dms.map((d) => d.userId)).toEqual(['planner']);
        });

        //Whoever made it is no longer one of them, so hears nothing
        it('goes by who runs it now, not by who made it', async () => {
            expect(await notifyHostsDropped({ ...plan, hostIds: ['sam'] }, 'guest', null)).toEqual({ told: ['Sam'], missed: [] });
            expect(dms.map((d) => d.userId)).toEqual(['sam']);
        });
    });
});

describe('telling whoever runs it about a count me in or not for me', () => {
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
