import { describe, it, expect } from 'vitest';
import { REPEAT_WEEKS, describeRepeat } from '../../src/lib/format.js';

/*
    Both the create form and the compare panel offer exactly this list, and the backend
    refuses anything not on it, so a value only one side knows about would be a plan that
    could be made and then not described.
*/

describe('REPEAT_WEEKS', () => {
    it('is whole weeks, so a repeat lands on the same weekday', () => {
        expect(REPEAT_WEEKS.every((w) => Number.isInteger(w) && w > 0)).toBe(true);
    });

    it('offers every one of them a name', () => {
        for (const weeks of REPEAT_WEEKS) expect(describeRepeat(weeks)).toBeTruthy();
    });
});

describe('describeRepeat', () => {
    it('says the two common ones the way people do', () => {
        expect(describeRepeat(1)).toBe('every week');
        expect(describeRepeat(2)).toBe('every other week');
    });

    it('counts the rest out', () => {
        expect(describeRepeat(4)).toBe('every 4 weeks');
    });

    //A one off has nothing to say, which is what lets the callers drop the phrase entirely
    it('says nothing at all for a plan that does not repeat', () => {
        expect(describeRepeat(null)).toBe('');
        expect(describeRepeat(0)).toBe('');
        expect(describeRepeat()).toBe('');
    });
});
