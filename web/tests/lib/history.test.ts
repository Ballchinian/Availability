import { describe, it, expect } from 'vitest';
import { describeEvent, hasActor, timeAgo } from '../../src/lib/history.js';
import type { PlanEvent } from '../../src/lib/types.js';

const base = { at: '2026-08-05T18:00:00.000Z', by: '1', byName: 'Ethan' };

describe('describeEvent', () => {
    it('says a plan started', () => {
        expect(describeEvent({ ...base, type: 'created' })).toBe('started the plan');
    });

    it('reads a set day, with and without a time', () => {
        expect(describeEvent({ ...base, type: 'chosen', date: '2026-08-12', time: '19:30', probe: false })).toBe(
            'set the day to 12/08/2026 at 7:30pm'
        );
        expect(describeEvent({ ...base, type: 'chosen', date: '2026-08-12', time: null, probe: false })).toBe(
            'set the day to 12/08/2026'
        );
    });

    it('mentions the confirmation round when one was started with it', () => {
        expect(describeEvent({ ...base, type: 'chosen', date: '2026-08-12', time: null, probe: true })).toBe(
            'set the day to 12/08/2026, and asked everyone to confirm'
        );
    });

    //The whole point of 8.6: a day that moved twice should say what it moved off
    it('names the day a move came off', () => {
        expect(
            describeEvent({ ...base, type: 'moved', from: '2026-08-12', date: '2026-08-19', time: null, probe: false })
        ).toBe('moved the day from 12/08/2026 to 19/08/2026');
    });

    it('carries a reason for calling a day off, and copes without one', () => {
        expect(describeEvent({ ...base, type: 'voided', from: '2026-08-12', reason: 'the venue fell through' })).toBe(
            'called off 12/08/2026, because the venue fell through'
        );
        expect(describeEvent({ ...base, type: 'voided', from: '2026-08-12', reason: null })).toBe('called off 12/08/2026');
    });

    it('reads a range change', () => {
        expect(describeEvent({ ...base, type: 'range', start: '2026-08-01', end: '2026-08-31' })).toBe(
            'changed the dates to 01/08/2026 to 31/08/2026'
        );
    });

    //One press moved several things, so one line says all of them rather than three lines saying one each
    it('reads a trip back out for dates as a single line', () => {
        const went = { ...base, type: 'dates' as const, start: '2026-09-01', end: '2026-09-30', reopened: true };
        expect(describeEvent({ ...went, allowedWeekdays: null, added: 0 })).toBe(
            'went back out for dates, 01/09/2026 to 30/09/2026'
        );
        expect(describeEvent({ ...went, allowedWeekdays: [0, 6], added: 2 })).toBe(
            'went back out for dates, 01/09/2026 to 30/09/2026, weekends only, and added 2 people'
        );
    });

    /*
        describeWeekdays says nothing at all when there is no restriction, which is right
        in a line of its own and useless mid sentence, so this one supplies the words.
    */
    it('spells out a weekday change, including dropping the restriction', () => {
        expect(describeEvent({ ...base, type: 'weekdays', allowedWeekdays: [0, 6] })).toBe(
            'changed the days asked about to weekends'
        );
        expect(describeEvent({ ...base, type: 'weekdays', allowedWeekdays: null })).toBe(
            'changed the days asked about to every day'
        );
    });

    it('tells a rename apart from a description edit', () => {
        expect(describeEvent({ ...base, type: 'details', renamed: true })).toBe('edited the title and description');
        expect(describeEvent({ ...base, type: 'details', renamed: false })).toBe('edited the description');
    });

    it('counts people one at a time properly', () => {
        expect(describeEvent({ ...base, type: 'added', count: 1 })).toBe('added 1 person');
        expect(describeEvent({ ...base, type: 'added', count: 3 })).toBe('added 3 people');
    });

    it('tells the two nudges apart', () => {
        expect(describeEvent({ ...base, type: 'reminded', kind: 'availability', count: 2 })).toBe(
            'nudged 2 people for their dates'
        );
        expect(describeEvent({ ...base, type: 'reminded', kind: 'vote', count: 1 })).toBe(
            'nudged 1 person who had not answered'
        );
    });

    it('covers coming and going', () => {
        expect(describeEvent({ ...base, type: 'left' })).toBe('dropped out');
        expect(describeEvent({ ...base, type: 'rejoined' })).toBe('came back to the plan');
        expect(describeEvent({ ...base, type: 'cancelled' })).toBe('cancelled the plan');
    });

    it('reads a repeat being set and being stopped', () => {
        expect(describeEvent({ ...base, type: 'repeat', repeatWeeks: 2 })).toBe('set this to come round every other week');
        expect(describeEvent({ ...base, type: 'repeat', repeatWeeks: 1 })).toBe('set this to come round every week');
        expect(describeEvent({ ...base, type: 'repeat', repeatWeeks: null })).toBe('stopped this coming round again');
    });

    //Every branch returns, so a new event type is a build error rather than a blank line
    it('says something for every type there is', () => {
        const types: PlanEvent['type'][] = [
            'created', 'chosen', 'moved', 'voided', 'range', 'dates', 'weekdays',
            'details', 'added', 'left', 'rejoined', 'reminded', 'repeat', 'repeated', 'cancelled'
        ];
        for (const type of types) {
            const event = {
                ...base, type,
                date: '2026-08-12', time: null, probe: false, from: '2026-08-01',
                start: '2026-08-01', end: '2026-08-31', allowedWeekdays: null,
                renamed: false, count: 1, added: 0, reopened: true, kind: 'vote', repeatWeeks: 2, planId: 'ab12cd34ef'
            } as PlanEvent;
            expect(describeEvent(event)).toBeTruthy();
        }
    });
});

describe('hasActor', () => {
    /*
        Coming round again is the one thing on a plan nobody did, so the panel leaves the
        name off and the sentence carries its own subject instead.
    */
    it('leaves the name off the line the sweep wrote', () => {
        expect(hasActor({ ...base, type: 'repeated', planId: 'ab12cd34ef' })).toBe(false);
        expect(describeEvent({ ...base, type: 'repeated', planId: 'ab12cd34ef' })).toBe('This one came round again as a new plan');
    });

    it('keeps it on everything a person did', () => {
        expect(hasActor({ ...base, type: 'created' })).toBe(true);
        expect(hasActor({ ...base, type: 'repeat', repeatWeeks: 2 })).toBe(true);
    });
});

describe('timeAgo', () => {
    const now = new Date('2026-08-05T18:00:00.000Z');
    const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms).toISOString(), now);

    it('rounds the last minute down to just now', () => {
        expect(ago(0)).toBe('just now');
        expect(ago(59_000)).toBe('just now');
    });

    it('counts minutes, hours and days', () => {
        expect(ago(60_000)).toBe('1 minute ago');
        expect(ago(90 * 60_000)).toBe('1 hour ago');
        expect(ago(3 * 86_400_000)).toBe('3 days ago');
    });

    //Past a week a count of days stops being something anyone can place
    it('gives the date itself once it is over a week old', () => {
        expect(ago(8 * 86_400_000)).toMatch(/^on \d{2}\/\d{2}\/\d{4}$/);
    });

    it('does not go negative on a stamp a moment in the future', () => {
        expect(timeAgo(new Date(now.getTime() + 5_000).toISOString(), now)).toBe('just now');
    });

    it('is blank for a stamp it cannot read', () => {
        expect(timeAgo('not a date', now)).toBe('');
    });
});
