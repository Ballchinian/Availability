import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ConfirmPanel from '../../src/lib/compare/ConfirmPanel.svelte';
import CompareGrid from '../../src/lib/CompareGrid.svelte';
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
        expect(draw({ active: true })).toContain('Close the confirmations');
    });

    //The whole point of the switch: a closed one still has the answers behind it
    it('says old answers are still there when it is closed', () => {
        const body = draw({ active: false });
        expect(body).toContain('Ask everyone to confirm');
        expect(body).toContain('reopening brings them back');
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
