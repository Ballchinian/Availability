import { describe, it, expect } from 'vitest';
import { answersOn, newlyCovered, coverageOf } from '../../src/lib/coverage.js';
import { todayIn } from '../../src/lib/zones.js';
import { shiftDate } from '../../src/lib/dates.js';

//Counted off today on the far side of the world, so no plan here has started anywhere yet
const ahead = (days) => shiftDate(todayIn('Etc/GMT+12'), days);

const plan = (planId, start, end, over = {}) => ({
    planId,
    name: planId,
    timeZone: 'Europe/London',
    dateRange: { start, end },
    allowedWeekdays: null,
    participants: [{ userId: 'bo', confirmed: false, in: null }],
    ...over
});

const london = (coveredUntil, answered = []) => ({ coveredUntil, answered, timeZone: 'Europe/London' });

describe('answersOn', () => {
    it('takes the window, the answers and today off the plan and the person', () => {
        const p = plan('a', ahead(3), ahead(6), { allowedWeekdays: [0, 6] });
        const answers = answersOn(p, london(ahead(4), [{ start: ahead(5), end: ahead(6), allowedWeekdays: null }]), p.participants[0]);

        expect(answers).toMatchObject({
            window: { start: ahead(3), end: ahead(6), allowedWeekdays: [0, 6] },
            coveredUntil: ahead(4),
            answered: [{ start: ahead(5), end: ahead(6), allowedWeekdays: null }],
            today: todayIn('Europe/London'),
            sentBack: null
        });
        expect(answers.theirDays).toBeUndefined();
    });

    it('reads someone with no record as having answered nothing', () => {
        expect(coverageOf(answersOn(plan('a', ahead(3), ahead(4)), undefined)).state).toBe('none');
    });

    /*
        Auckland is at least eleven hours ahead of London, so a whole day there starts on
        the London day before and runs into the next. Only a date past both answers it.
    */
    it('answers a day on another clock only once every day of theirs it touches is covered', () => {
        const p = plan('a', ahead(10), ahead(10), { timeZone: 'Pacific/Auckland' });
        expect(coverageOf(answersOn(p, london(ahead(9)))).state).toBe('none');
        expect(coverageOf(answersOn(p, london(ahead(10)))).state).toBe('covered');
    });

    it('lets a window they saved answer the day by its name, whatever the clocks', () => {
        const p = plan('a', ahead(10), ahead(10), { timeZone: 'Pacific/Auckland' });
        const saved = london(null, [{ start: ahead(10), end: ahead(10), allowedWeekdays: null }]);
        expect(coverageOf(answersOn(p, saved)).state).toBe('covered');
    });
});

describe('newlyCovered', () => {
    const plans = [plan('inside', ahead(3), ahead(5)), plan('past', ahead(3), ahead(40)), plan('had', ahead(1), ahead(2))];

    it('names the plans a save finished answering', () => {
        expect(newlyCovered(plans, 'bo', london(ahead(2)), london(ahead(30)))).toEqual([{ planId: 'inside', name: 'inside' }]);
    });

    it('leaves out a plan they have said is not for them', () => {
        const out = [plan('inside', ahead(3), ahead(5), { participants: [{ userId: 'bo', in: false }] })];
        expect(newlyCovered(out, 'bo', london(null), london(ahead(30)))).toEqual([]);
    });

    it('leaves out a plan the person is not on', () => {
        expect(newlyCovered(plans, 'cy', london(null), london(ahead(30)))).toEqual([]);
    });

    //Their calendar does not answer for them there until they go over the dates again
    it('leaves out a plan they were sent back on', () => {
        const back = [plan('inside', ahead(3), ahead(5), { participants: [{ userId: 'bo', in: true, sentBack: { byName: 'Ali' } }] })];
        expect(newlyCovered(back, 'bo', london(null), london(ahead(30)))).toEqual([]);
    });
});
