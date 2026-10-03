import { describe, it, expect } from 'vitest';
import { css, rule } from '../css.js';

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

describe('the compare grid', () => {
    //Same specificity, so whichever comes later wins
    it('rings the day with focus over the day that is picked', () => {
        expect(rule('.cday:focus-visible')).toContain('var(--heading)');
        expect(css.indexOf('\n.cday:focus-visible {')).toBeGreaterThan(css.indexOf('\n.cday.chosen {'));
    });
});
