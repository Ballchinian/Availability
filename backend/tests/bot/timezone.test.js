import { describe, it, expect } from 'vitest';
import { clockMovedLine, suggestZones } from '../../src/bot/timezone.js';

/*
    The one sentence both halves of a clock change say, the reply to whoever moved it
    and the notice everybody else reads. It is the part people misread, so it is worth
    it being the same words in both places and worth those words being right.
*/

describe('clockMovedLine', () => {
    it('says nothing about plans on a server that has none', () => {
        expect(clockMovedLine(0, 'Asia/Tokyo')).toBe('');
    });

    //Read out loud: the old copy said "The one plan here keep the time written on them"
    it('reads as one plan for one plan', () => {
        const line = clockMovedLine(1, 'Asia/Tokyo');

        expect(line).toContain('The one plan here keeps the time written on it');
        expect(line).not.toContain('keep the time');
    });

    it('reads as many for many, and counts them', () => {
        const line = clockMovedLine(4, 'Asia/Tokyo');

        expect(line).toContain('All 4 plans here keep the time written on them');
    });

    //The reassurance itself: a plan does not move, what its time means does
    it('names the new clock as what 8pm now means', () => {
        expect(clockMovedLine(2, 'Asia/Tokyo')).toContain('still at 8pm, now 8pm Asia/Tokyo');
    });
});

describe('suggestZones', () => {
    it('offers something for an empty box, so the option is findable at all', () => {
        expect(suggestZones('').length).toBeGreaterThan(0);
    });

    //Discord takes 25 and silently drops the rest
    it('never offers more than Discord will show', () => {
        expect(suggestZones('a').length).toBeLessThanOrEqual(25);
    });

    it('finds a zone from the middle of its name, and sorts a typed continent first', () => {
        expect(suggestZones('lond')).toContain('Europe/London');
        expect(suggestZones('new_y')).toContain('America/New_York');
        expect(suggestZones('europe/')[0].startsWith('Europe/')).toBe(true);
    });
});
