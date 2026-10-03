import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    deletePlansUnderChannel over plans held in an array, with enough of a query matcher
    to run its filter. A field asked for as null matches one that is missing, as in Mongo,
    which is how plans from before threadParentId existed are found.
*/

const rows = vi.hoisted(() => []);

vi.mock('../../src/db/mongo.js', () => {
    const value = (doc, key) => doc[key] ?? null;
    const matches = (doc, filter) =>
        Object.entries(filter).every(([key, want]) => {
            if (key === '$or') return want.some((f) => matches(doc, f));
            if (want && typeof want === 'object' && '$ne' in want) return value(doc, key) !== want.$ne;
            if (want && typeof want === 'object' && '$in' in want) return want.$in.includes(value(doc, key));
            return value(doc, key) === want;
        });
    return {
        collections: { plans: 'plans' },
        col: () => ({
            find: (filter) => ({ toArray: async () => rows.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) }),
            deleteMany: async (filter) => {
                const keep = rows.filter((doc) => !matches(doc, filter));
                rows.splice(0, rows.length, ...keep);
            }
        })
    };
});

const { deletePlansUnderChannel } = await import('../../src/db/plans/index.js');

const ids = (plans) => plans.map((p) => p.planId).sort();

beforeEach(() => {
    rows.splice(0, rows.length,
        { planId: 'under', guildId: 'g1', threadId: 't1', threadParentId: 'c1' },
        { planId: 'elsewhere', guildId: 'g1', threadId: 't2', threadParentId: 'c2' },
        //Threaded before the parent was stored, one with the field and one without
        { planId: 'old', guildId: 'g1', threadId: 't3', threadParentId: null },
        { planId: 'older', guildId: 'g1', threadId: 't4' },
        //Never got a thread, so it was never under any channel
        { planId: 'threadless', guildId: 'g1', threadId: null, threadParentId: null },
        { planId: 'other-server', guildId: 'g2', threadId: 't5', threadParentId: 'c1' }
    );
});

describe('deletePlansUnderChannel', () => {
    it('takes only the plans whose threads were made under that channel', async () => {
        const gone = await deletePlansUnderChannel('g1', 'c1');
        expect(ids(gone)).toEqual(['under']);
        expect(ids(rows)).toEqual(['elsewhere', 'old', 'older', 'other-server', 'threadless']);
    });

    it('also takes plans with no parent stored when asked, but not ones with no thread', async () => {
        const gone = await deletePlansUnderChannel('g1', 'c1', { unknownParent: true });
        expect(ids(gone)).toEqual(['old', 'older', 'under']);
        expect(ids(rows)).toEqual(['elsewhere', 'other-server', 'threadless']);
    });

    it('hands back nothing and deletes nothing for a channel with no plans', async () => {
        const gone = await deletePlansUnderChannel('g1', 'c9');
        expect(gone).toEqual([]);
        expect(rows).toHaveLength(6);
    });
});
