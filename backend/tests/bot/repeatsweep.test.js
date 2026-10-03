import { describe, it, expect, beforeEach, vi } from 'vitest';
import { today, shiftDate } from '../../src/lib/dates.js';

/*
    The sweep against a plans collection held in a Map, with Discord standing in as
    announce functions that can be told to fall over.
*/

const fake = vi.hoisted(() => {
    const plans = new Map();
    return {
        plans,
        createFails: false,
        db: {
            getPlan: async (id) => plans.get(id) || null,
            getPlansDueToRepeat: async (before) =>
                [...plans.values()].filter((p) => p.repeatWeeks && !p.repeatedInto && p.status === 'closed' && p.chosenDate < before),
            getPlansNeedingRepair: async () => [...plans.values()].filter((p) => p.needsRepair),
            claimForRepeat: async (id, next) => {
                const p = plans.get(id);
                if (p.repeatedInto) return false;
                p.repeatedInto = next;
                return true;
            },
            releaseRepeatClaim: async (id) => {
                plans.get(id).repeatedInto = null;
            },
            createPlan: async (fields) => {
                if (fake.createFails) throw new Error('database went away');
                const doc = { ...fields, participants: fields.participantIds.map((userId) => ({ userId })), status: 'collecting', threadId: null };
                plans.set(doc.planId, doc);
                return doc;
            },
            setPlanChosen: async (id, date) => Object.assign(plans.get(id), { chosenDate: date, status: 'closed' }),
            setPlanRepeat: async (id, weeks) => {
                plans.get(id).repeatWeeks = weeks;
            },
            setNeedsRepair: async (id, on) => {
                plans.get(id).needsRepair = on;
            },
            addPlanEvent: async (id, event) => {
                (plans.get(id).history ||= []).push(event);
            }
        }
    };
});

vi.mock('../../src/db/plans/index.js', () => fake.db);
vi.mock('../../src/db/mongo.js', () => ({ isMongoReady: () => true }));
vi.mock('../../src/db/guilds.js', () => ({
    getGuildConfig: async () => ({ setupComplete: true, plansChannelId: 'c1', plannerRoleId: 'planners', timeZone: 'Europe/London' })
}));

//Who is in the server, and whether each holds the planner role. Nobody is cached, so every look is a fetch.
const server = vi.hoisted(() => ({ members: new Map(), down: false, left: false }));
vi.mock('../../src/bot/client.js', () => ({
    client: {
        guilds: {
            fetch: async () => {
                if (server.left) throw Object.assign(new Error('Unknown Guild'), { code: 10004 });
                return {
                    members: {
                        cache: new Map(),
                        fetch: async (id) => {
                            if (server.down) throw new Error('Service Unavailable');
                            if (!server.members.has(id)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                            return { id, roles: { cache: new Set(server.members.get(id) ? ['planners'] : []) } };
                        }
                    }
                };
            }
        }
    }
}));

const discord = vi.hoisted(() => ({ announceSetPlan: vi.fn(), announcePlan: vi.fn(), syncPlan: vi.fn() }));
vi.mock('../../src/bot/plans/index.js', () => discord);

const { sweepRepeats } = await import('../../src/bot/repeat.js');

const lastWeek = shiftDate(today(), -7);

beforeEach(() => {
    fake.plans.clear();
    fake.createFails = false;
    server.members.clear();
    server.members.set('ali', true).set('sam', false);
    server.down = false;
    server.left = false;
    fake.plans.set('first', {
        planId: 'first',
        guildId: 'g1',
        name: 'Board games',
        createdBy: 'ali',
        participants: [{ userId: 'ali' }, { userId: 'bo' }],
        status: 'closed',
        dateRange: { start: lastWeek, end: lastWeek },
        chosenDate: lastWeek,
        chosenTime: null,
        chosenNote: null,
        repeatWeeks: 2,
        repeatedInto: null,
        timeZone: 'Europe/London'
    });
    for (const fn of Object.values(discord)) fn.mockReset();
});

const repeats = () => [...fake.plans.values()].filter((p) => p.repeatedFrom === 'first');

describe('a repeat whose announcement fails', () => {
    it('is made once, however many sweeps follow', async () => {
        discord.announceSetPlan.mockRejectedValue(new Error('Discord is down'));

        await sweepRepeats();
        await sweepRepeats();
        await sweepRepeats();

        expect(repeats()).toHaveLength(1);
        expect(fake.plans.get('first').repeatedInto).toBe(repeats()[0].planId);
    });

    it('is announced again by the next sweep, and stops being retried once that lands', async () => {
        discord.announceSetPlan.mockRejectedValueOnce(new Error('Discord is down'));

        await sweepRepeats();
        expect(repeats()[0].needsRepair).toBe(true);

        await sweepRepeats();
        expect(discord.announceSetPlan).toHaveBeenCalledTimes(2);
        expect(repeats()[0].needsRepair).toBe(false);

        await sweepRepeats();
        expect(discord.announceSetPlan).toHaveBeenCalledTimes(2);
    });

    it('is synced rather than announced again once it has a thread', async () => {
        discord.announceSetPlan.mockImplementationOnce(async (plan) => {
            fake.plans.get(plan.planId).threadId = 't1';
            throw new Error('DMs failed');
        });

        await sweepRepeats();
        await sweepRepeats();

        expect(discord.announceSetPlan).toHaveBeenCalledTimes(1);
        expect(discord.syncPlan).toHaveBeenCalledTimes(1);
    });
});

describe('a repeat that was never made', () => {
    it('lets the claim go so the next sweep makes it', async () => {
        fake.createFails = true;
        await sweepRepeats();
        expect(repeats()).toHaveLength(0);
        expect(fake.plans.get('first').repeatedInto).toBe(null);

        fake.createFails = false;
        await sweepRepeats();
        expect(repeats()).toHaveLength(1);
    });
});

//Ali made the first one and holds the planner role. Sam runs it with him and does not.
describe('who runs the next one', () => {
    const first = () => fake.plans.get('first');

    it('is everyone who ran this one', async () => {
        first().hostIds = ['ali', 'sam'];
        await sweepRepeats();
        expect(repeats()[0].hostIds).toEqual(['ali', 'sam']);
    });

    it('says who set it coming round, the same as the one before', async () => {
        first().repeatBy = { id: 'ali', name: 'Ali' };
        await sweepRepeats();
        expect(repeats()[0].repeatBy).toEqual({ id: 'ali', name: 'Ali' });
    });

    it('is whoever made it, on a plan from before anyone else could', async () => {
        await sweepRepeats();
        expect(repeats()[0].hostIds).toEqual(['ali']);
    });

    //Left to createPlan's default, whoever made the first one would run every plan after it for good
    it('leaves out anyone who has left the server, whoever made the first one included', async () => {
        first().hostIds = ['ali', 'sam'];
        server.members.delete('ali');
        server.members.set('sam', true);

        await sweepRepeats();
        expect(repeats()[0]).toMatchObject({ createdBy: 'ali', hostIds: ['sam'] });
    });

    it('takes only one of them to still hold the planner role', async () => {
        first().hostIds = ['sam', 'ali'];
        await sweepRepeats();
        expect(repeats()).toHaveLength(1);
    });
});

describe('a repeat nobody who runs it could start', () => {
    const first = () => fake.plans.get('first');

    it('stops, with a line in the history, and makes nothing', async () => {
        first().hostIds = ['ali', 'sam'];
        server.members.set('ali', false);

        expect(await sweepRepeats()).toBe(0);
        expect(repeats()).toHaveLength(0);
        expect(first()).toMatchObject({ repeatWeeks: null, repeatedInto: null });
        expect(first().history.map((e) => e.type)).toEqual(['repeatended']);
    });

    it('stops the same way once everyone who ran it has left', async () => {
        server.members.clear();
        await sweepRepeats();
        expect(first().repeatWeeks).toBe(null);
        expect(first().history.map((e) => e.type)).toEqual(['repeatended']);
    });

    //Read as everyone having left, an outage would end every repeat that fell due during it
    it('is left for the next sweep while Discord cannot say who is there', async () => {
        server.down = true;
        await sweepRepeats();
        expect(repeats()).toHaveLength(0);
        expect(first().repeatWeeks).toBe(2);
        expect(first().history).toBeUndefined();

        server.down = false;
        await sweepRepeats();
        expect(repeats()).toHaveLength(1);
    });

    it('stops without a word once the bot is out of the server', async () => {
        server.left = true;
        await sweepRepeats();
        expect(first().repeatWeeks).toBe(null);
        expect(first().history).toBeUndefined();
    });
});
