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
            const have = at(doc, key);
            if (want && typeof want === 'object' && '$exists' in want) return (have !== undefined) === want.$exists;
            return Array.isArray(have) ? have.includes(want) : have === want;
        });
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
            find: (filter) => ({ toArray: async () => structuredClone(rows.filter((doc) => matches(doc, filter))) }),
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

const { addHost } = await import('../../src/db/plans.js');

const plan = (planId, over = {}) => ({ planId, guildId: 'g1', createdBy: 'ali', participants: [{ userId: 'bo' }], ...over });
const hostsOf = (planId) => rows.find((p) => p.planId === planId).hostIds;

beforeEach(() => rows.splice(0, rows.length));

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
