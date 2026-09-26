import { expect } from 'vitest';
import css from '../src/app.css?raw';

/*
    The stylesheet as text, for what it promises that no render test can see, since
    svelte/server draws markup and never lays anything out.
*/
export { css };

//A rule's body, found by the selector that opens it at the start of a line
export function rule(selector: string) {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
}

export function px(block: string, property: string) {
    const found = block.match(new RegExp(`\\n\\s*${property}:\\s*(\\d+)px`));
    return found ? Number(found[1]) : 0;
}

//What a rule sets a property to, whole
export function value(selector: string, property: string) {
    const found = rule(selector).match(new RegExp(`\\n\\s*${property}:\\s*([^;]+);`));
    expect(found, `${selector} sets no ${property}`).toBeTruthy();
    return found![1];
}
