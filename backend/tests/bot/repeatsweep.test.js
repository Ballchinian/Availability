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
            setPlanRepeat: async () => {},
            setNeedsRepair: async (id, on) => {
                plans.get(id).needsRepair = on;
            },
            addPlanEvent: async () => {}
        }
    };
});

vi.mock('../../src/db/plans.js', () => fake.db);
vi.mock('../../src/db/mongo.js', () => ({ isMongoReady: () => true }));
vi.mock('../../src/db/guilds.js', () => ({
    getGuildConfig: async () => ({ setupComplete: true, plansChannelId: 'c1', timeZone: 'Europe/London' })
}));

const discord = vi.hoisted(() => ({ announceSetPlan: vi.fn(), announcePlan: vi.fn(), syncPlan: vi.fn() }));
vi.mock('../../src/bot/plans.js', () => discord);

const { sweepRepeats } = await import('../../src/bot/repeat.js');

const lastWeek = shiftDate(today(), -7);

beforeEach(() => {
    fake.plans.clear();
    fake.createFails = false;
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
