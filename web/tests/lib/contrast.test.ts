import { describe, it, expect } from 'vitest';
import { css, value } from '../css.js';
import { contrast, type Rgb } from '../../src/lib/contrast.js';
import { fillColor, fillTextStyle } from '../../src/lib/heatmap.js';
import { HOUR_COUNT } from '../../src/lib/hours.js';

/*
    The palette held to WCAG AA, read out of app.css so a colour changed there is
    measured here: 4.5:1 for text, 3:1 for the edge a control is found by.
*/
const TEXT = 4.5;
const EDGE = 3;

const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
const tokens = Object.fromEntries([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

//The first colour in a value as the eye gets it, an rgba laid over what it sits on
function paint(text: string, under: Rgb = [0, 0, 0]): Rgb {
    const token = text.match(/var\((--[\w-]+)\)/);
    if (token) return paint(tokens[token[1]], under);
    const hex = text.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)?.[1];
    if (hex) {
        const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
        return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
    }
    const rgb = text.match(/rgba?\(([^)]+)\)/);
    if (rgb) {
        const [r, g, b, a = 1] = rgb[1].split(',').map(Number);
        return [r, g, b].map((c, i) => c * a + under[i] * (1 - a)) as Rgb;
    }
    throw new Error(`no colour in ${text}`);
}

const page = paint('var(--bg)');
const panel = paint('var(--panel)');

describe('the palette', () => {
    it('finds the tokens', () => {
        expect(Object.keys(tokens)).toContain('--control-border');
    });

    it.each([
        ['--text', TEXT],
        ['--heading', TEXT],
        ['--muted', TEXT],
        ['--link', TEXT],
        ['--control-border', EDGE],
        //The focus ring
        ['--accent', EDGE]
    ])('%s holds on the page and on a panel', (token, least) => {
        const colour = paint(`var(${token})`);
        expect(contrast(colour, page)).toBeGreaterThanOrEqual(least);
        expect(contrast(colour, panel)).toBeGreaterThanOrEqual(least);
    });

    it('keeps white readable on a primary button', () => {
        expect(contrast([255, 255, 255], paint('var(--accent)'))).toBeGreaterThanOrEqual(TEXT);
    });
});

describe('rules drawing their own colours', () => {
    it.each([
        ['.rday', 'color', panel, TEXT],
        ['.day.out', 'color', page, TEXT],
        ['.cday.dim', 'color', page, TEXT],
        ['.cday.dim', 'border', page, EDGE],
        ['.day.far', 'border-color', page, EDGE],
        ['.danger-btn', 'border-color', panel, EDGE],
        ['.danger-btn', 'color', panel, TEXT],
        ['.error', 'color', panel, TEXT],
        ['.good', 'color', panel, TEXT]
    ])('%s %s', (selector, property, under, least) => {
        expect(contrast(paint(value(selector, property), under), under)).toBeGreaterThanOrEqual(least);
    });

    it('keeps a far day readable on its hatching', () => {
        const hatch = paint(value('.day.far', 'background'), page);
        expect(contrast(paint(value('.day.far', 'color')), hatch)).toBeGreaterThanOrEqual(TEXT);
    });

    //A day with one hour kept, the darkest fill a marked day gets, is barely off the page by itself
    it.each([
        ['.day.free', 'border-color'],
        ['.cday', 'border']
    ])('%s stands its edge off the page even on the darkest fill', (selector, property) => {
        const darkest = paint(fillColor(1, HOUR_COUNT));
        expect(contrast(paint(value(selector, property), darkest), page)).toBeGreaterThanOrEqual(EDGE);
    });
});

describe('controls', () => {
    it.each([
        '.day',
        '.hour',
        '.ghost',
        '.chip',
        '.bchip',
        '.quick',
        '.wday',
        '.col-head .search',
        '.field textarea',
        ".pick-panel input[type='time']",
        ".horizon-row input[type='date']"
    ])('%s is edged in --control-border', (selector) => {
        expect(value(selector, 'border')).toContain('var(--control-border)');
    });
});

//Every step a day can take on either grid, since both shade by whole hours out of 24
describe('text on the heatmap', () => {
    it.each(Array.from({ length: HOUR_COUNT + 1 }, (_, h) => h))('reads at %i hours', (hours) => {
        const style = fillTextStyle(hours, HOUR_COUNT);
        const fill = paint(style.match(/background:([^;]+)/)![1]);
        //White is what both grids draw unless the style says otherwise
        const text = paint(style.match(/;color:([^;]+)/)?.[1] ?? '#fff');
        expect(contrast(text, fill)).toBeGreaterThanOrEqual(TEXT);
    });
});
