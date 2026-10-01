import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    Who runs a plan, written against plans held in an array, with enough of Mongo's
    matching and array operators to run what db/plans.js sends. A field that is missing
    stays missing until something sets it, since that is what a plan from before hosts is.
*/

const rows = vi.hoisted(() => []);

vi.mock('../../src/db/mongo.js', () => {
    //A dotted key into an array reads every element's, the way 'participants.userId' does
    const at = (doc, key) => key.split('.').reduce((v, k) => (Array.isArray(v) ? v.map((x) => x?.[k]) : v?.[k]), doc);
    const matches = (doc, filter) =>
        Object.entries(filter).every(([key, want]) => {
            if (key === '$or') return want.some((f) => matches(doc, f));
            if (key === '$and') return want.every((f) => matches(doc, f));
            const have = at(doc, key);
            if (want && typeof want === 'object') {
                if ('$exists' in want) return (have !== undefined) === want.$exists;
                if ('$gte' in want) return have != null && have >= want.$gte;
                if ('$lt' in want) return have != null && have < want.$lt;
            }
            return Array.isArray(have) ? have.includes(want) : have === want;
        });
    //Sorting and capping are Mongo's own, so the chain is only walked
    const found = (filter) => {
        const cursor = {
            sort: () => cursor,
            limit: () => cursor,
            toArray: async () => structuredClone(rows.filter((doc) => matches(doc, filter)))
        };
        return cursor;
    };
    const pulled = (item, want) => {
        if (!want || typeof want !== 'object') return item === want;
        if ('$in' in want) return want.$in.includes(item);
        return Object.entries(want).every(([k, v]) => item?.[k] === v);
    };
    const apply = (doc, update) => {
        Object.assign(doc, structuredClone(update.$set || {}));
        for (const [key, want] of Object.entries(update.$pull || {})) {
            if (Array.isArray(doc[key])) doc[key] = doc[key].filter((item) => !pulled(item, want));
        }
        for (const [key, value] of Object.entries(update.$addToSet || {})) {
            doc[key] = [...new Set([...(doc[key] || []), value])];
        }
    };
    return {
        collections: { plans: 'plans' },
        col: () => ({
            findOne: async (filter) => structuredClone(rows.find((doc) => matches(doc, filter)) || null),
            find: found,
            updateOne: async (filter, update) => {
                const doc = rows.find((d) => matches(d, filter));
                if (doc) apply(doc, update);
            },
            updateMany: async (filter, update) => {
                for (const doc of rows.filter((d) => matches(d, filter))) apply(doc, update);
            }
        })
    };
});

const { addHost, getActivePlansForUser, getFinishedPlansForUser } = await import('../../src/db/plans.js');

const plan = (planId, over = {}) => ({ planId, guildId: 'g1', createdBy: 'ali', status: 'collecting', participants: [{ userId: 'bo' }], ...over });
const hostsOf = (planId) => rows.find((p) => p.planId === planId).hostIds;
const ids = (plans) => plans.map((p) => p.planId).sort();

beforeEach(() => rows.splice(0, rows.length));

//My plans and Past plans, which have to find a plan for the people who run it as well as its guests
describe('the plans someone is on', () => {
    beforeEach(() => {
        rows.push(
            plan('old'),
            plan('listed', { hostIds: ['ali', 'sam'] }),
            //Ali made it and has since come off the list of who runs it
            plan('handed-on', { hostIds: ['sam'] }),
            plan('set', { hostIds: ['sam'], status: 'closed', chosenDate: '2026-10-10' }),
            plan('been', { hostIds: ['sam'], status: 'closed', chosenDate: '2026-09-01' }),
            plan('off', { status: 'cancelled' })
        );
    });

    it('finds a plan for a guest', async () => {
        expect(ids(await getActivePlansForUser('bo', '2026-10-01'))).toEqual(['handed-on', 'listed', 'old', 'set']);
    });

    it('finds the plans someone runs without being a guest of them', async () => {
        expect(ids(await getActivePlansForUser('sam', '2026-10-01'))).toEqual(['handed-on', 'listed', 'set']);
    });

    it('reads a plan from before hosts as run by whoever made it, and only those', async () => {
        expect(ids(await getActivePlansForUser('ali', '2026-10-01'))).toEqual(['listed', 'old']);
    });

    it('splits the finished ones off the same way', async () => {
        expect(ids(await getFinishedPlansForUser('sam', '2026-10-01'))).toEqual(['been']);
        expect(ids(await getFinishedPlansForUser('ali', '2026-10-01'))).toEqual(['off']);
        expect(ids(await getFinishedPlansForUser('bo', '2026-10-01'))).toEqual(['been', 'off']);
    });
});

describe('taking a plan on', () => {
    it('adds them to whoever already runs it', async () => {
        rows.push(plan('p1', { hostIds: ['ali'] }));
        await addHost('p1', 'sam');
        expect(hostsOf('p1')).toEqual(['ali', 'sam']);
    });

    //Adding to no list at all would leave the plan run by the newcomer alone
    it('writes down whoever made a plan from before hosts first', async () => {
        rows.push(plan('p1'));
        await addHost('p1', 'sam');
        expect(hostsOf('p1')).toEqual(['ali', 'sam']);
    });

    it('takes anyone who has left the server off the list', async () => {
        rows.push(plan('p1', { hostIds: ['ali', 'jo'] }));
        await addHost('p1', 'sam', ['ali']);
        expect(hostsOf('p1')).toEqual(['jo', 'sam']);
    });

    it('puts both on when two people take it on together', async () => {
        rows.push(plan('p1'));
        await Promise.all([addHost('p1', 'sam'), addHost('p1', 'jo')]);
        expect([...hostsOf('p1')].sort()).toEqual(['ali', 'jo', 'sam']);
    });

    it('adds nobody twice', async () => {
        rows.push(plan('p1', { hostIds: ['ali', 'sam'] }));
        await addHost('p1', 'sam');
        expect(hostsOf('p1')).toEqual(['ali', 'sam']);
    });

    it('has nothing to add to for a plan that has gone', async () => {
        expect(await addHost('nope', 'sam')).toBe(null);
    });
});
