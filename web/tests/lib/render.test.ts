import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ConfirmPanel from '../../src/lib/compare/ConfirmPanel.svelte';
import PickPanel from '../../src/lib/compare/PickPanel.svelte';
import CompareGrid from '../../src/lib/CompareGrid.svelte';
import RepeatDates from '../../src/lib/RepeatDates.svelte';
import { repeatSeries } from '../../src/lib/calendar.js';
import type { Answer, Participant } from '../../src/lib/types.js';

/*
    The only tests here that draw anything. `render` from svelte/server takes a component to
    a string with no DOM and no new dependency, which is as close as this suite gets to
    looking at a screen. Not the compare page itself, which wants auth and the api behind it.
*/

describe('the confirmation switch', () => {
    const person = (userId: string, invited: boolean, vote: Answer | null): Participant => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: true,
        vote,
        voteReason: null,
        override: null,
        invited,
        sureUntil: null
    });
    const people = [person('a', true, 'yes'), person('b', true, null), person('c', false, null)];
    const draw = (props: Record<string, unknown>) =>
        render(ConfirmPanel, { props: { planId: 'ab12cd34ef', participants: people, onchanged: async () => {}, ...props } }).body;

    //Only the invite list counts, so the uninvited third person is not being waited on
    it('counts answers against the people still invited', () => {
        expect(draw({ active: true })).toContain('1 of 2 have answered');
    });

    it('offers to close a running one', () => {
        expect(draw({ active: true })).toContain('Stop asking');
    });

    //The whole point of the switch: a closed one still has the answers behind it
    it('says old answers are still there when it is closed', () => {
        const body = draw({ active: false });
        expect(body).toContain('Ask everyone if they can make it');
        expect(body).toContain('asking again brings them back');
    });
});

/*
    The grid is the only way to a date now, so it has to hold up on a plan nobody has
    answered, which is where the panel that used to stand in for it was reached from.
*/
describe('picking a day nobody has answered about', () => {
    const draw = (props: Record<string, unknown> = {}) =>
        render(PickPanel, {
            props: { planId: 'ab12cd34ef', selectedDate: '2026-08-12', onsaved: async () => {}, ...props }
        }).body;

    //The other way to count nobody is everyone's sure-up-to date having passed, which
    //this would otherwise blame it on
    it('says nobody has answered rather than blaming their horizons', () => {
        const body = draw({ confirmedCount: 0, totalParticipants: 3 });
        expect(body).toContain('nobody has filled their dates in');
        expect(body).not.toContain('sure-up-to date');
    });

    it('still offers to set the day', () => {
        expect(draw({ confirmedCount: 0, totalParticipants: 3 })).toContain('You can still set it');
    });

    //Narrowing to the people who can make it is nought people here, and it is the default
    it('does not offer to narrow the invite list to nobody', () => {
        expect(draw({ confirmedCount: 0, totalParticipants: 3 })).not.toContain('Just the people who can make it');
    });

    it('offers it again once somebody is free on the day', () => {
        const body = draw({
            confirmedCount: 1,
            totalParticipants: 3,
            freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] }
        });
        expect(body).toContain('Just the people who can make it');
    });
});

describe('the compare grid', () => {
    const draw = (props: Record<string, unknown>) =>
        render(CompareGrid, {
            props: {
                start: '2026-08-01',
                end: '2026-08-14',
                freeByDate: { '2026-08-05': [{ userId: 'a', hours: [] }] },
                confirmedCount: 1,
                ...props
            }
        }).body;

    /*
        Two different things: the day the plan is on, and the day being looked at. Before this
        the grid could only show the second, so scrolling the grid lost track of the first.
    */
    it('marks the set day apart from the day being looked at', () => {
        const body = draw({ chosenDate: '2026-08-05', selectedDate: '2026-08-07' });
        expect(body).toContain('isset');
        expect(body).toContain('chosen');
    });

    it('says which day is set in the accessible name too', () => {
        expect(draw({ chosenDate: '2026-08-05' })).toContain('the day this plan is set for');
    });

    it('marks nothing when no day is set', () => {
        expect(draw({ chosenDate: null })).not.toContain('isset');
    });
});

/*
    The repeat calendar. It exists to draw dates instead of writing them out, so what it
    puts on screen is the only thing worth asserting.
*/
describe('the repeat dates calendar', () => {
    const series = repeatSeries({
        repeatWeeks: 2,
        dateRange: { start: '2026-08-06', end: '2026-08-06' },
        chosenDate: '2026-08-06',
        chosenTime: null
    });
    const draw = (props: Record<string, unknown>) =>
        render(RepeatDates, { props: { first: '2026-08-06', shapes: series, ...props } }).body;

    it('opens on the month the plan itself is on', () => {
        expect(draw({})).toContain('August 2026');
    });

    it('tells the day this plan is on apart from the ones that follow', () => {
        const body = draw({});
        expect(body).toContain('Thursday 6 August 2026, this one');
        expect(body).toContain('Thursday 20 August 2026, it comes round again');
    });

    //A month at a time is the whole reason there are arrows on it
    it('draws one month, not the whole series', () => {
        expect(draw({})).not.toContain('<h4>September 2026</h4>');
    });

    it('says the series out loud for anyone who cannot see the grid', () => {
        expect(draw({})).toContain('Thursday 3 September 2026');
    });

    /*
        What the screen after a plan is made draws for a one off: the month with its day on
        it, and none of the furniture that only earns its place once there is a series.
    */
    it('marks the day on its own for a plan that does not repeat', () => {
        const body = draw({ shapes: [] });
        expect(body).toContain('Thursday 6 August 2026, this one');
        expect(body).not.toContain('Later month');
        expect(body).not.toContain('rkey');
    });

    //A plan that collected dates comes back as a window, which reads as a stretch rather than a day
    it('names the days a following window asks about', () => {
        const body = draw({
            first: '2026-08-10',
            shapes: repeatSeries({ repeatWeeks: 1, dateRange: { start: '2026-08-01', end: '2026-08-14' }, chosenDate: '2026-08-10' })
        });
        expect(body).toContain('one of the days the next one asks about');
        expect(body).toContain('the days it asks about');
    });
});
