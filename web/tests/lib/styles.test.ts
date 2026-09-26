import { describe, it, expect } from 'vitest';
import { css, rule, px, value } from '../css.js';

describe('the hours clock', () => {
    it('is a target of at least 24px', () => {
        const clock = rule('.clock');
        expect(Math.max(px(clock, 'height'), px(clock, 'min-height'))).toBeGreaterThanOrEqual(24);
    });

    it('sits under its day rather than on top of it', () => {
        expect(rule('.clock')).not.toContain('position: absolute');
    });
});

//The small buttons, whose padding alone came to 15 to 22px
describe('small targets', () => {
    it.each(['.link-btn', '.quick', '.move-row .ghost', '.uninvited .ghost'])('%s is at least 24px tall', (selector) => {
        expect(px(rule(selector), 'min-height')).toBeGreaterThanOrEqual(24);
    });
});

describe('opacity', () => {
    /*
        It fades the text inside along with everything else, which is how a dim compare
        day sat at 2.8:1. A disabled control is let off contrast, so only that may use it.
    */
    it('fades nothing but a disabled control', () => {
        const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
        const faded = [...plain.matchAll(/opacity:/g)].map((m) => {
            const open = plain.lastIndexOf('{', m.index);
            const before = Math.max(plain.lastIndexOf('{', open - 1), plain.lastIndexOf('}', open - 1));
            return plain.slice(before + 1, open).trim();
        });
        expect(faded.filter((s) => !s.split(',').every((part) => part.trim().endsWith(':disabled')))).toEqual([]);
    });
});

describe('picked states', () => {
    it.each([".tabs a[aria-current='page']", '.wday.on', '.repeat-row .ghost:has(:checked)'])('%s is bold as well as coloured', (selector) => {
        expect(Number(value(selector, 'font-weight'))).toBeGreaterThanOrEqual(600);
    });
});

//Measured at 320px wide, where these were the only two things that ran past the panel
describe('reflow', () => {
    it('keeps a row of tools inside the panel, however long a label', () => {
        expect(value('.tools > *', 'max-width')).toBe('100%');
    });

    it("takes Chrome's own margin off the miss slider", () => {
        expect(value(".miss input[type='range']", 'margin-inline')).toBe('0');
    });
});

describe('the compare grid', () => {
    //Same specificity, so whichever comes later wins
    it('rings the day with focus over the day that is picked', () => {
        expect(rule('.cday:focus-visible')).toContain('var(--heading)');
        expect(css.indexOf('\n.cday:focus-visible {')).toBeGreaterThan(css.indexOf('\n.cday.chosen {'));
    });
});
