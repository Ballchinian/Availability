import { describe, it, expect, beforeEach } from 'vitest';
import { carryOverAnswers } from '../../src/db/mongo.js';
import { coverageOf, standing } from '../../../shared/coverage.js';
import { today, shiftDate } from '../../src/lib/dates.js';

/*
    Plans saved before Phase B, carried over on boot. The database is two arrays behind
    just enough of a query matcher for the filters this sends: equality, $gte, $exists,
    $elemMatch and one arrayFilter.
*/

const day = (n) => shiftDate(today(), n);

function valueAt(doc, path) {
    return path.split('.').reduce((v, k) => v?.[k], doc);
}

function matches(doc, filter) {
    return Object.entries(filter).every(([path, want]) => {
        const value = valueAt(doc, path);
        if (want && typeof want === 'object') {
            if ('$gte' in want) return value >= want.$gte;
            if ('$exists' in want) return (value !== undefined) === want.$exists;
            if ('$elemMatch' in want) return Array.isArray(value) && value.some((el) => matches(el, want.$elemMatch));
        }
        return value === want;
    });
}

let plans;
let users;

const database = {
    collection: (name) =>
        name === 'plans'
            ? {
                find: (filter) => ({ toArray: async () => structuredClone(plans.filter((p) => matches(p, filter))) }),
                updateMany: async (filter, update, { arrayFilters }) => {
                    const only = Object.fromEntries(Object.entries(arrayFilters[0]).map(([k, v]) => [k.replace(/^p\./, ''), v]));
                    for (const plan of plans.filter((p) => matches(p, filter))) {
                        for (const el of plan.participants.filter((q) => matches(q, only))) el.in = update.$set['participants.$[p].in'];
                    }
                }
            }
            : {
                findOne: async ({ userId }) => structuredClone(users.find((u) => u.userId === userId) || null),
                updateOne: async (filter, update, { upsert = false } = {}) => {
                    const doc = users.find((u) => u.userId === filter.userId);
                    if (!doc) {
                        if (upsert) users.push({ userId: filter.userId, ...update.$setOnInsert });
                        return { upsertedCount: upsert ? 1 : 0 };
                    }
                    if (JSON.stringify(doc.answered ?? null) !== JSON.stringify(filter.answered)) return { modifiedCount: 0 };
                    Object.assign(doc, update.$set);
                    return { modifiedCount: 1 };
                }
            }
};

const window = { start: day(1), end: day(14) };

beforeEach(() => {
    users = [{ userId: 'ali', guilds: ['g1'] }];
    plans = [
        {
            planId: 'p1',
            status: 'collecting',
            dateRange: window,
            allowedWeekdays: null,
            participants: [
                { userId: 'ali', confirmed: true },
                { userId: 'bo', confirmed: false }
            ]
        }
    ];
});

const participant = (planId, userId) => plans.find((p) => p.planId === planId).participants.find((p) => p.userId === userId);

describe('carrying plans from before Phase B over', () => {
    it('reads someone who filled in an open plan as in, done', async () => {
        await carryOverAnswers(database);

        const ali = users.find((u) => u.userId === 'ali');
        expect(ali.answered).toEqual([{ ...window, allowedWeekdays: null }]);
        const coverage = coverageOf({ window, answered: ali.answered, today: today() });
        expect(standing(participant('p1', 'ali'), coverage)).toBe('done');
    });

    it('writes in down, since sending the plan back for dates will clear confirmed', async () => {
        await carryOverAnswers(database);
        expect(participant('p1', 'ali').in).toBe(true);
        expect(participant('p1', 'bo').in).toBeUndefined();
        expect(standing(participant('p1', 'bo'), { state: 'none' })).toBe('not-said');
    });

    it('gives a record to someone who has only used /free', async () => {
        plans[0].participants.push({ userId: 'cass', confirmed: true });
        await carryOverAnswers(database);
        expect(users.find((u) => u.userId === 'cass').answered).toHaveLength(1);
    });

    it('counts a yes on a set day as in, with no window to answer', async () => {
        plans.push({ planId: 'p2', status: 'closed', chosenDate: day(3), dateRange: { start: day(3), end: day(3) }, participants: [{ userId: 'dee', vote: 'yes' }] });
        await carryOverAnswers(database);
        expect(participant('p2', 'dee').in).toBe(true);
        expect(users.find((u) => u.userId === 'dee')).toBeUndefined();
    });

    it('gives no window for a plan whose days have all gone', async () => {
        plans[0].dateRange = { start: day(-20), end: day(-5) };
        await carryOverAnswers(database);
        expect(users.find((u) => u.userId === 'ali').answered).toBeUndefined();
        expect(participant('p1', 'ali').in).toBe(true);
    });

    //Confirmed before a window grew is not an answer about the days it grew by
    it('leaves alone anyone whose in is already written', async () => {
        plans[0].participants = [{ userId: 'ali', confirmed: true, in: true }];
        await carryOverAnswers(database);
        expect(users.find((u) => u.userId === 'ali').answered).toBeUndefined();
    });

    it('finds nothing to do the second time', async () => {
        await carryOverAnswers(database);
        const after = structuredClone({ plans, users });
        expect(await carryOverAnswers(database)).toBe(0);
        expect({ plans, users }).toEqual(after);
    });
});
