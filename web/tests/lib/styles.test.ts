import { describe, it, expect } from 'vitest';
import css from '../../src/app.css?raw';

/*
    What the stylesheet promises that no render test can see, read straight out
    of it, since svelte/server draws markup and never lays anything out.
*/
function rule(selector: string) {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
}

function px(block: string, property: string) {
    const found = block.match(new RegExp(`\\n\\s*${property}:\\s*(\\d+)px`));
    return found ? Number(found[1]) : 0;
}

describe('the hours clock', () => {
    it('is a target of at least 24px', () => {
        const clock = rule('.clock');
        expect(Math.max(px(clock, 'height'), px(clock, 'min-height'))).toBeGreaterThanOrEqual(24);
    });

    it('sits under its day rather than on top of it', () => {
        expect(rule('.clock')).not.toContain('position: absolute');
    });
});
