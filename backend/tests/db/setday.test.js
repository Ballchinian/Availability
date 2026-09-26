import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { todayIn } from '../../src/lib/zones.js';
import { shiftDate } from '../../../shared/dates.js';

/*
    A set day always asks who can make it. setPlanChosen switches the asking on with the
    day, and askOnSetDays switches it on at boot for plans set before that was so.
*/

const writes = vi.hoisted(() => []);

vi.mock('../../src/db/mongo.js', async (real) => ({
    ...(await real()),
    col: () => ({
        updateOne: async (filter, update, options) => writes.push({ filter, update, options }),
        findOne: async () => null
    })
}));

const { setPlanChosen } = await import('../../src/db/plans.js');
const { askOnSetDays } = await vi.importActual('../../src/db/mongo.js');

describe('setPlanChosen', () => {
    beforeEach(() => (writes.length = 0));

    it('asks everyone about the day', async () => {
        await setPlanChosen('p1', '2026-08-08');
        expect(writes[0].update.$set).toMatchObject({ status: 'closed', chosenDate: '2026-08-08', probeActive: true });
    });

    it('asks the people kept on a narrowed list too', async () => {
        await setPlanChosen('p1', '2026-08-08', null, null, ['ali']);
        expect(writes[0].update.$set.probeActive).toBe(true);
    });
});

//Plans in an array, and enough of a query matcher to run the filters askOnSetDays sends
function fakeDatabase(rows) {
    const value = (doc, key) => doc[key] ?? null;
    const matches = (doc, filter) =>
        Object.entries(filter).every(([key, want]) => {
            const have = value(doc, key);
            if (want && typeof want === 'object') {
                if ('$ne' in want) return have !== want.$ne;
                if ('$gte' in want) return have !== null && have >= want.$gte;
                if ('$in' in want) return want.$in.includes(have);
            }
            return have === want;
        });
    const plans = {
        find: (filter) => ({ toArray: async () => rows.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) }),
        updateMany: async (filter, update) => {
            for (const doc of rows.filter((d) => matches(d, filter))) Object.assign(doc, update.$set);
        }
    };
    return { collection: () => plans };
}

describe('askOnSetDays', () => {
    const london = 'Europe/London';
    const ahead = (days) => shiftDate(todayIn(london), days);
    const set = (planId, over = {}) => ({ planId, status: 'closed', chosenDate: ahead(3), timeZone: london, probeActive: false, ...over });
    const asking = (rows) => rows.filter((p) => p.probeActive === true).map((p) => p.planId).sort();

    afterEach(() => vi.useRealTimers());

    it('asks on a set day still to come, with the flag off or never written', async () => {
        const rows = [set('off'), set('missing')];
        delete rows[1].probeActive;
        await askOnSetDays(fakeDatabase(rows));
        expect(asking(rows)).toEqual(['missing', 'off']);
    });

    it('leaves a day that has been, a plan still collecting and one called off', async () => {
        const rows = [
            set('gone', { chosenDate: ahead(-2) }),
            { planId: 'collecting', status: 'collecting', chosenDate: null, timeZone: london },
            set('cancelled', { status: 'cancelled' })
        ];
        await askOnSetDays(fakeDatabase(rows));
        expect(asking(rows)).toEqual([]);
    });

    //Late morning in London is already tomorrow in Kiritimati, so the same date has been there
    it('reads today on the clock of each plan', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-26T11:00:00Z'));
        const rows = [
            set('london', { chosenDate: '2026-09-26' }),
            set('kiritimati', { chosenDate: '2026-09-26', timeZone: 'Pacific/Kiritimati' })
        ];
        await askOnSetDays(fakeDatabase(rows));
        expect(asking(rows)).toEqual(['london']);
    });

    it('finds nothing left to do on the next boot', async () => {
        const rows = [set('p1')];
        expect(await askOnSetDays(fakeDatabase(rows))).toBe(1);
        expect(await askOnSetDays(fakeDatabase(rows))).toBe(0);
    });
});
