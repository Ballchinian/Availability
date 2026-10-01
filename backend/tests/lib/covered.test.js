import { describe, it, expect } from 'vitest';
import { answersOn, newlyCovered, coverageOf, rowFor, everyoneAnswered } from '../../src/lib/coverage.js';
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

//Ali runs these and Bo is a guest. A calendar reaching ahead(30) answers every day of them.
describe('where someone stands on a plan', () => {
    const run = (participants, over = {}) => plan('a', ahead(3), ahead(6), { createdBy: 'ali', status: 'collecting', participants, ...over });
    const all = london(ahead(30));

    it('reads a guest who has not said as on the list with everything to answer', () => {
        expect(rowFor(run([{ userId: 'bo', in: null }]), 'bo', {})).toEqual({
            role: 'guest',
            onList: true,
            standing: 'not-said',
            daysLeft: 4,
            movedBack: false,
            answer: null,
            invited: true,
            readyToPick: false
        });
    });

    it('counts the days someone in still has to fill', () => {
        const row = rowFor(run([{ userId: 'bo', in: true }]), 'bo', { bo: london(ahead(4)) });
        expect(row).toMatchObject({ standing: 'days-left', daysLeft: 2 });
    });

    //Nothing to answer for themselves, so nothing stands for them
    it('reads someone who runs a plan they are not a guest of as on no list', () => {
        expect(rowFor(run([{ userId: 'bo', in: null }]), 'ali', {})).toMatchObject({ role: 'host', onList: false, standing: null, invited: false });
    });

    it('says a host moved them back, which reads as no dates yet', () => {
        const row = rowFor(run([{ userId: 'bo', in: true, sentBack: { byName: 'Ali' } }]), 'bo', { bo: all });
        expect(row).toMatchObject({ movedBack: true, standing: 'no-dates' });
    });

    it('lets whoever runs it pick the day once everyone left on it has answered', () => {
        const crowd = [{ userId: 'bo', in: true }, { userId: 'cy', in: true }, { userId: 'di', in: false }];
        expect(rowFor(run(crowd), 'ali', { bo: all, cy: all }).readyToPick).toBe(true);
        expect(rowFor(run(crowd), 'ali', { bo: all, cy: london(ahead(4)) }).readyToPick).toBe(false);
        //A guest never picks it, however many have answered
        expect(rowFor(run(crowd), 'bo', { bo: all, cy: all }).readyToPick).toBe(false);
    });

    it('has nobody to hear from on a plan everyone said no to', () => {
        expect(everyoneAnswered(run([{ userId: 'bo', in: false }]), {})).toBe(false);
    });

    describe('once the day is set', () => {
        const set = (bo) => run([{ userId: 'bo', in: true, ...bo }], { status: 'closed', chosenDate: ahead(4) });

        it('has no answer for someone who has not said', () => {
            expect(rowFor(set({}), 'bo', {})).toMatchObject({ standing: null, answer: null, invited: true, readyToPick: false });
        });

        it('takes a call made on the board over their own answer', () => {
            expect(rowFor(set({ vote: 'no', override: 'yes' }), 'bo', {}).answer).toBe('yes');
            expect(rowFor(set({ vote: 'no' }), 'bo', {}).answer).toBe('no');
        });

        //Nothing is sent to them and nobody waits on them, so they are not asked here either
        it('reads someone who said it was not for them as not coming', () => {
            expect(rowFor(set({ in: false }), 'bo', {}).answer).toBe('no');
        });

        it('says when they were left off the day', () => {
            expect(rowFor(set({ invited: false }), 'bo', {}).invited).toBe(false);
        });
    });
});
