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
                if ('$in' in want) return want.$in.includes(have);
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

const { addHost, getActivePlansForUser, getFinishedPlansForUser, getLivePlansForUser, removeUserFromGuildPlans } = await import('../../src/db/plans/index.js');
const { hostIdsOf } = await import('../../src/lib/hosts.js');
const { canTakeOn } = await import('../../src/api/roles.js');

const plan = (planId, over = {}) => ({
    planId,
    guildId: 'g1',
    createdBy: 'ali',
    status: 'collecting',
    dateRange: { start: '2026-10-05', end: '2026-10-09' },
    participants: [{ userId: 'bo' }],
    ...over
});
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

    //What /mylink lists: one server's, for guests and whoever runs them alike
    it('finds the same plans within one server', async () => {
        rows.push(plan('elsewhere', { guildId: 'g2', hostIds: ['sam'] }));
        expect(ids(await getLivePlansForUser('g1', 'sam', '2026-10-01'))).toEqual(['handed-on', 'listed', 'set']);
        expect(ids(await getLivePlansForUser('g2', 'sam', '2026-10-01'))).toEqual(['elsewhere']);
        expect(ids(await getLivePlansForUser('g1', 'bo', '2026-10-11'))).toEqual(['handed-on', 'listed', 'old']);
    });

    it('splits the finished ones off the same way', async () => {
        expect(ids(await getFinishedPlansForUser('sam', '2026-10-01'))).toEqual(['been']);
        expect(ids(await getFinishedPlansForUser('ali', '2026-10-01'))).toEqual(['off']);
        expect(ids(await getFinishedPlansForUser('bo', '2026-10-01'))).toEqual(['been', 'off']);
    });

    /*
        A plan whose dates went by with no day picked. It stays on for thirty days, for
        whoever runs it to ask about new ones, and the day after that it never got a day.
    */
    describe('with no day and its dates gone', () => {
        beforeEach(() => {
            rows.splice(0, rows.length);
            rows.push(
                plan('ten-ago', { hostIds: ['sam'], dateRange: { start: '2026-09-14', end: '2026-09-21' } }),
                plan('thirty-ago', { hostIds: ['sam'], dateRange: { start: '2026-08-25', end: '2026-09-01' } }),
                plan('thirty-one-ago', { hostIds: ['sam'], dateRange: { start: '2026-08-24', end: '2026-08-31' } })
            );
        });

        it('is still on for thirty days, for its guests and whoever runs it', async () => {
            expect(ids(await getActivePlansForUser('sam', '2026-10-01'))).toEqual(['ten-ago', 'thirty-ago']);
            expect(ids(await getActivePlansForUser('bo', '2026-10-01'))).toEqual(['ten-ago', 'thirty-ago']);
            expect(ids(await getLivePlansForUser('g1', 'bo', '2026-10-01'))).toEqual(['ten-ago', 'thirty-ago']);
        });

        it('is over the day after, and in neither list twice', async () => {
            expect(ids(await getFinishedPlansForUser('sam', '2026-10-01'))).toEqual(['thirty-one-ago']);
            expect(ids(await getFinishedPlansForUser('bo', '2026-10-02'))).toEqual(['thirty-ago', 'thirty-one-ago']);
            expect(ids(await getActivePlansForUser('bo', '2026-10-02'))).toEqual(['ten-ago']);
        });
    });
});

describe('someone leaving the server', () => {
    const stored = (planId) => rows.find((p) => p.planId === planId);

    it('comes off the guest list of every plan there, and no other server', async () => {
        rows.push(plan('p1', { participants: [{ userId: 'bo' }, { userId: 'cy' }] }), plan('p2', { guildId: 'g2' }));
        await removeUserFromGuildPlans('g1', 'bo');

        expect(stored('p1').participants).toEqual([{ userId: 'cy' }]);
        expect(stored('p2').participants).toEqual([{ userId: 'bo' }]);
    });

    it('stops running the plans they ran, and the others who run them carry on', async () => {
        rows.push(plan('p1', { hostIds: ['ali', 'sam'] }));
        await removeUserFromGuildPlans('g1', 'sam');
        expect(hostIdsOf(stored('p1'))).toEqual(['ali']);
    });

    //Left as it was, a plan with no list would go on reading as run by whoever made it
    it('leaves a plan from before hosts run by nobody when whoever made it goes', async () => {
        rows.push(plan('p1'));
        await removeUserFromGuildPlans('g1', 'ali');

        expect(stored('p1').hostIds).toEqual([]);
        expect(hostIdsOf(stored('p1'))).toEqual([]);
    });

    it('lets a planner take on a plan the last person running it has left', async () => {
        rows.push(plan('p1', { hostIds: ['ali'] }));
        const [left] = await removeUserFromGuildPlans('g1', 'ali');

        const planner = { isMember: true, isPlanner: true, canManage: false };
        expect(canTakeOn(left, 'cass', planner, hostIdsOf(left))).toBe(true);
    });

    it('does not touch who runs a plan from before hosts when a guest goes', async () => {
        rows.push(plan('p1'));
        await removeUserFromGuildPlans('g1', 'bo');
        expect(stored('p1')).not.toHaveProperty('hostIds');
    });

    it('hands back the plans they were on as they now stand, and only those', async () => {
        rows.push(plan('p1'), plan('p2', { hostIds: ['bo'], participants: [] }), plan('p3', { participants: [{ userId: 'cy' }] }));
        const left = await removeUserFromGuildPlans('g1', 'bo');

        expect(ids(left)).toEqual(['p1', 'p2']);
        expect(left.find((p) => p.planId === 'p1').participants).toEqual([]);
        expect(left.find((p) => p.planId === 'p2').hostIds).toEqual([]);
    });

    it('has nothing to do for someone on no plans', async () => {
        rows.push(plan('p1'));
        expect(await removeUserFromGuildPlans('g1', 'cass')).toEqual([]);
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
