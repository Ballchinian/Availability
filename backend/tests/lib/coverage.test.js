import { describe, it, expect } from 'vitest';
import { askedDays, datesPassed, answeredOn, coverageOf, daysToFill, toFillRuns, inOf, standing, owes, askLine, nextStep } from '../../../shared/coverage.js';
import { shiftDate } from '../../../shared/dates.js';

//Mon 7 to Fri 11 Sep 2026
const week = { start: '2026-09-07', end: '2026-09-11', allowedWeekdays: null };
//The two weekends in Tue 1 to Mon 14 Sep
const weekends = { start: '2026-09-01', end: '2026-09-14', allowedWeekdays: [0, 6] };

const covered = { state: 'covered', daysLeft: 0, lastCovered: '2026-09-11', total: 5 };
const partial = { state: 'partial', daysLeft: 3, lastCovered: '2026-09-08', total: 5 };
const none = { state: 'none', daysLeft: 5, lastCovered: null, total: 5 };

describe('askedDays', () => {
    it('lists every day of the window', () => {
        expect(askedDays(week)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
    });

    it('keeps to the weekdays a plan is pinned to', () => {
        expect(askedDays(weekends)).toEqual(['2026-09-05', '2026-09-06', '2026-09-12', '2026-09-13']);
    });

    it('is empty with no window', () => {
        expect(askedDays()).toEqual([]);
    });
});

describe('datesPassed', () => {
    it('holds off until the last day of the window has gone', () => {
        expect(datesPassed(week, '2026-09-06')).toBe(false);
        expect(datesPassed(week, '2026-09-11')).toBe(false);
        expect(datesPassed(week, '2026-09-12')).toBe(true);
    });

    //The window runs on to Mon 14, and the last day it asks about is Sun 13
    it('goes by the last day a pinned plan asks about, not the end of its window', () => {
        expect(datesPassed(weekends, '2026-09-13')).toBe(false);
        expect(datesPassed(weekends, '2026-09-14')).toBe(true);
    });
});

describe('answeredOn', () => {
    it('answers a day inside a saved window', () => {
        expect(answeredOn('2026-09-08', { answered: [week] })).toBe(true);
    });

    //A weekends-only plan's page never asked about the Monday in the middle of it
    it('leaves out the weekdays a saved window never asked about', () => {
        expect(answeredOn('2026-09-07', { answered: [weekends] })).toBe(false);
    });

    it('answers up to and including coveredUntil', () => {
        expect(answeredOn('2026-09-10', { coveredUntil: '2026-09-10' })).toBe(true);
        expect(answeredOn('2026-09-11', { coveredUntil: '2026-09-10' })).toBe(false);
    });

    it('answers nothing for someone who has saved nothing', () => {
        expect(answeredOn('2026-09-10')).toBe(false);
        expect(answeredOn('2026-09-10', { coveredUntil: null, answered: null })).toBe(false);
    });
});

describe('coverageOf', () => {
    it('is covered when coveredUntil reaches past the window', () => {
        expect(coverageOf({ window: week, coveredUntil: '2026-09-30' })).toEqual(covered);
    });

    it('is partial when coveredUntil stops inside it', () => {
        expect(coverageOf({ window: week, coveredUntil: '2026-09-08' })).toEqual(partial);
    });

    it('is none with nothing saved', () => {
        expect(coverageOf({ window: week })).toEqual(none);
    });

    it('counts only the pinned weekdays still to fill', () => {
        expect(coverageOf({ window: weekends, coveredUntil: '2026-09-07' })).toEqual({
            state: 'partial',
            daysLeft: 2,
            lastCovered: '2026-09-06',
            total: 4
        });
    });

    it('ignores the days before today', () => {
        expect(coverageOf({ window: week, today: '2026-09-09' })).toMatchObject({ state: 'none', daysLeft: 3, total: 3 });
    });

    //Filled in up to yesterday says nothing about the days still to come
    it('reads a calendar that stops before today as answering nothing', () => {
        expect(coverageOf({ window: week, coveredUntil: '2026-09-08', today: '2026-09-09' }).state).toBe('none');
    });

    it('takes the union of saved windows', () => {
        const halves = [
            { start: '2026-09-07', end: '2026-09-08' },
            { start: '2026-09-09', end: '2026-09-11' }
        ];
        expect(coverageOf({ window: week, answered: halves }).state).toBe('covered');
    });

    it('takes the union of saved windows and coveredUntil', () => {
        const rest = [{ start: '2026-09-09', end: '2026-09-11' }];
        expect(coverageOf({ window: week, coveredUntil: '2026-09-08', answered: rest }).state).toBe('covered');
    });

    it('counts a gap between two saved windows as a day left', () => {
        const gap = [
            { start: '2026-09-07', end: '2026-09-08' },
            { start: '2026-09-10', end: '2026-09-11' }
        ];
        expect(coverageOf({ window: week, answered: gap })).toEqual({
            state: 'partial',
            daysLeft: 1,
            lastCovered: '2026-09-08',
            total: 5
        });
    });

    it('has no lastCovered when the first day still to come is unanswered', () => {
        const back = [{ start: '2026-09-10', end: '2026-09-11' }];
        expect(coverageOf({ window: week, answered: back })).toEqual({
            state: 'partial',
            daysLeft: 3,
            lastCovered: null,
            total: 5
        });
    });

    it('reads as none for this plan while someone is sent back, however much is saved', () => {
        const sentBack = { byName: 'Ali', at: new Date(), was: { in: true } };
        expect(coverageOf({ window: week, coveredUntil: '2026-09-30', answered: [week], sentBack })).toEqual(none);
    });

    /*
        Someone a clock ahead of the server has the server's Friday running into their
        Saturday, so a calendar that ends on their Friday leaves part of it unsaid. The
        plan's own page asks about the plan's dates by name, so saving it answers them.
    */
    describe('across clocks', () => {
        const ahead = (d) => [d, shiftDate(d, 1)];

        it('needs coveredUntil to reach every day of theirs a plan day touches', () => {
            expect(coverageOf({ window: week, coveredUntil: '2026-09-11', theirDays: ahead })).toEqual({
                state: 'partial',
                daysLeft: 1,
                lastCovered: '2026-09-10',
                total: 5
            });
            expect(coverageOf({ window: week, coveredUntil: '2026-09-12', theirDays: ahead }).state).toBe('covered');
        });

        it('lets a window saved on the plan page answer the plan by date', () => {
            expect(coverageOf({ window: week, answered: [week], theirDays: ahead }).state).toBe('covered');
        });
    });
});

describe('daysToFill', () => {
    it('lists the days coverageOf counts as left, from today on', () => {
        const gap = [{ start: '2026-09-07', end: '2026-09-07' }];
        expect(daysToFill({ window: week, answered: gap, today: '2026-09-08', coveredUntil: '2026-09-09' })).toEqual(['2026-09-10', '2026-09-11']);
    });

    it('keeps to the pinned weekdays', () => {
        expect(daysToFill({ window: weekends, coveredUntil: '2026-09-07' })).toEqual(['2026-09-12', '2026-09-13']);
    });

    it('lists every day while someone is sent back', () => {
        expect(daysToFill({ window: week, coveredUntil: '2026-09-30', sentBack: { byName: 'Ali' } })).toEqual(askedDays(week));
    });
});

describe('toFillRuns', () => {
    it('breaks a run where a day is answered, from today on', () => {
        const middle = [{ start: '2026-09-09', end: '2026-09-09' }];
        expect(toFillRuns({ window: week, answered: middle, today: '2026-09-08' })).toEqual([
            ['2026-09-08', '2026-09-08'],
            ['2026-09-10', '2026-09-11']
        ]);
    });

    it('runs across the days a pinned window skips', () => {
        expect(toFillRuns({ window: weekends })).toEqual([['2026-09-05', '2026-09-13']]);
    });

    it('has nothing for a covered window', () => {
        expect(toFillRuns({ window: week, coveredUntil: '2026-09-11' })).toEqual([]);
    });
});

describe('askLine', () => {
    it('gives the free count when the calendar answers it all', () => {
        expect(askLine(covered, { free: 3, updated: '2026-09-01' })).toBe(
            "Your calendar (last updated Tue 1 Sep) already answers this: you're free on 3 of the 5 days."
        );
    });

    it('says so before they answer when they are free on none of the days', () => {
        expect(askLine(covered, { free: 0, updated: '2026-09-01' })).toBe(
            "Your calendar (last updated Tue 1 Sep) already answers this: you're not free on any of the 5 days."
        );
    });

    it('leaves the date out when there is no record of the last save', () => {
        expect(askLine(covered, { free: 2 })).toBe("Your calendar already answers this: you're free on 2 of the 5 days.");
    });

    it('reads naturally for a plan with one day left to ask about', () => {
        const one = { state: 'covered', daysLeft: 0, lastCovered: '2026-09-11', total: 1 };
        expect(askLine(one, { free: 1 })).toBe("Your calendar already answers this: you're free that day.");
        expect(askLine(one, { free: 0 })).toBe("Your calendar already answers this: you're not free that day.");
    });

    it('says how far the calendar reaches and how many days follow', () => {
        expect(askLine(partial)).toBe('Your calendar answers up to Tue 8 Sep, so there are 3 days after that to fill in.');
    });

    it('says is 1 day, not are 1 days', () => {
        const oneLeft = { state: 'partial', daysLeft: 1, lastCovered: '2026-09-10', total: 5 };
        expect(askLine(oneLeft)).toBe('Your calendar answers up to Thu 10 Sep, so there is 1 day after that to fill in.');
    });

    it('counts instead when the answered days are not at the front', () => {
        const back = { state: 'partial', daysLeft: 3, lastCovered: null, total: 5 };
        expect(askLine(back)).toBe('Your calendar answers 2 of the 5 days, so there are 3 left to fill in.');
    });

    it('asks for dates when the calendar answers none of it', () => {
        expect(askLine(none)).toBe('Then fill in your dates.');
    });

    it('is blank once every day it asked about has gone', () => {
        expect(askLine({ state: 'covered', daysLeft: 0, lastCovered: null, total: 0 })).toBe('');
    });

    it('tells someone already in only what is left to do', () => {
        expect(askLine(covered, { free: 3, updated: '2026-09-01', joined: true })).toBe('');
        expect(askLine(partial, { joined: true })).toBe('Your calendar answers up to Tue 8 Sep, so there are 3 days after that to fill in.');
        expect(askLine(none, { joined: true })).toBe('Now fill in your dates.');
    });

    it('has no link in any line', () => {
        for (const c of [covered, partial, none]) expect(askLine(c, { free: 1 })).not.toMatch(/https?:|\{link\}/);
    });
});

describe('inOf', () => {
    it('reads the answer when there is one', () => {
        expect(inOf({ in: true })).toBe(true);
        expect(inOf({ in: false })).toBe(false);
        expect(inOf({ in: null, confirmed: true })).toBe(null);
    });

    it('reads someone saved before the question as in once they filled in or said yes', () => {
        expect(inOf({ confirmed: true })).toBe(true);
        expect(inOf({ confirmed: false, vote: 'yes' })).toBe(true);
    });

    it('never reads someone saved before the question as out', () => {
        expect(inOf({ confirmed: false })).toBe(null);
        expect(inOf({ confirmed: false, vote: 'no' })).toBe(null);
    });
});

describe('standing', () => {
    it('puts someone who has not said in the first group', () => {
        expect(standing({ in: null }, covered)).toBe('not-said');
    });

    it('splits the people who are in by what their calendar answers', () => {
        expect(standing({ in: true }, covered)).toBe('done');
        expect(standing({ in: true }, partial)).toBe('days-left');
        expect(standing({ in: true }, none)).toBe('no-dates');
    });

    it('puts someone who is out in the last group whatever their calendar says', () => {
        expect(standing({ in: false }, covered)).toBe('out');
    });

    it('reads a participant confirmed before the question as in, done', () => {
        expect(standing({ confirmed: true }, covered)).toBe('done');
    });
});

describe('owes', () => {
    it('owes an answer before they say', () => {
        expect(owes({ in: null }, covered)).toBe('answer');
    });

    it('owes days while in and short of them', () => {
        expect(owes({ in: true }, partial)).toBe('days');
        expect(owes({ in: true }, none)).toBe('days');
    });

    it('owes nothing once done or out', () => {
        expect(owes({ in: true }, covered)).toBe(null);
        expect(owes({ in: false }, none)).toBe(null);
    });
});

/*
    The button on a plan's card, and the same line in /mylink. One thing each, the one
    the plan is most waiting on from that person.
*/
describe('nextStep', () => {
    const finding = (over = {}) => ({ status: 'collecting', role: 'guest', onList: true, standing: 'not-said', daysLeft: 0, movedBack: false, datesPassed: false, answer: null, invited: true, readyToPick: false, ...over });
    const set = (over = {}) => finding({ status: 'closed', standing: null, ...over });
    const overview = { label: 'Overview', page: 'overview', asks: false };

    it('asks someone who has not said whether they are in', () => {
        expect(nextStep(finding())).toEqual({ label: "Say if you're in", page: 'plan', asks: true });
    });

    it('says how many days someone in has left, one or many', () => {
        expect(nextStep(finding({ standing: 'days-left', daysLeft: 3 }))).toEqual({ label: 'Fill in 3 days', page: 'plan', asks: true });
        expect(nextStep(finding({ standing: 'days-left', daysLeft: 1 })).label).toBe('Fill in 1 day');
    });

    it('sends someone in with nothing answered to their dates', () => {
        expect(nextStep(finding({ standing: 'no-dates', daysLeft: 14 }))).toEqual({ label: 'Fill in your dates', page: 'plan', asks: true });
    });

    //Sent back reads as no dates yet, and the button says why they are being asked
    it('tells someone moved back to go over their dates again', () => {
        expect(nextStep(finding({ standing: 'no-dates', movedBack: true })).label).toBe('Go over your dates again');
    });

    it('asks someone on a set day who has not answered whether they are coming', () => {
        expect(nextStep(set())).toEqual({ label: "Say if you're coming", page: 'overview', asks: true });
    });

    it('tells whoever runs a plan to pick the day once everyone has answered', () => {
        expect(nextStep(finding({ role: 'host', standing: 'done', readyToPick: true }))).toEqual({ label: 'Pick the day', page: 'overview', asks: true });
        expect(nextStep(finding({ role: 'host', onList: false, standing: null, readyToPick: true })).label).toBe('Pick the day');
    });

    /*
        With no day left to answer, everyone in reads as done and whoever has not said
        still reads as not said, so this has to come before either is acted on.
    */
    describe('once the dates it asked about have passed', () => {
        it('sends whoever runs it to ask about new dates, whatever else is owed', () => {
            const ask = { label: 'Ask about new dates', page: 'dates', asks: true };
            expect(nextStep(finding({ role: 'host', onList: false, standing: null, datesPassed: true }))).toEqual(ask);
            expect(nextStep(finding({ role: 'host', standing: 'done', readyToPick: true, datesPassed: true }))).toEqual(ask);
            expect(nextStep(finding({ role: 'host', standing: 'not-said', datesPassed: true }))).toEqual(ask);
        });

        it('has a guest wait, with nothing asked of them', () => {
            const wait = { label: 'Waiting for new dates', page: 'overview', asks: false };
            expect(nextStep(finding({ datesPassed: true }))).toEqual(wait);
            expect(nextStep(finding({ standing: 'no-dates', movedBack: true, datesPassed: true }))).toEqual(wait);
        });
    });

    it('is the overview for everything else', () => {
        const rest = [
            finding({ standing: 'done' }),
            finding({ standing: 'out' }),
            finding({ onList: false, standing: null }),
            set({ answer: 'yes' }),
            set({ answer: 'no' }),
            set({ invited: false }),
            set({ onList: false, invited: false }),
            { status: 'cancelled', onList: true, answer: null, invited: true }
        ];
        for (const row of rest) expect(nextStep(row)).toEqual(overview);
    });

    it('asks nothing on a plan that is over', () => {
        expect(nextStep(set({ over: true }))).toEqual(overview);
        expect(nextStep(finding({ over: true }))).toEqual(overview);
    });
});
