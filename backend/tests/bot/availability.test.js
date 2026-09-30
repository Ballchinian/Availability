import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { dayChunks, pickerComponents, pickerText } from '../../src/bot/availability.js';
import { weekdayOf } from '../../src/lib/dates.js';

/*
    Mostly the parts that decide what goes on screen, which is where this can go wrong
    quietly, then a click on a picker drawn before the plan's dates moved.

    The picker starts at today, so the clock is held before every date written here.
*/

beforeAll(() => vi.setSystemTime(new Date('2026-07-01T12:00:00Z')));
afterAll(() => vi.useRealTimers());

const plan = (start, end, allowedWeekdays = null) => ({
    planId: 'ab12cd34ef',
    name: 'Board games',
    dateRange: { start, end },
    allowedWeekdays
});

describe('dayChunks', () => {
    it('keeps a short plan in one select', () => {
        const { chunks, total, cut } = dayChunks(plan('2026-08-01', '2026-08-14'));
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toHaveLength(14);
        expect(total).toBe(14);
        expect(cut).toBe(0);
    });

    //25 is Discord's cap on options in one select
    it('splits at 25 and nowhere else', () => {
        const { chunks } = dayChunks(plan('2026-08-01', '2026-09-09'));
        expect(chunks.map((c) => c.length)).toEqual([25, 15]);
    });

    it('lands exactly on the boundary without an empty select after it', () => {
        const { chunks } = dayChunks(plan('2026-08-01', '2026-08-25'));
        expect(chunks.map((c) => c.length)).toEqual([25]);
    });

    it('runs the days in order with none missing or repeated', () => {
        const { chunks } = dayChunks(plan('2026-08-01', '2026-09-09'));
        const flat = chunks.flat();
        expect(flat).toEqual([...new Set(flat)]);
        expect(flat).toEqual([...flat].sort());
        expect(flat[0]).toBe('2026-08-01');
        expect(flat[flat.length - 1]).toBe('2026-09-09');
    });

    it('only offers the weekdays a pinned plan asks about', () => {
        const { chunks, total } = dayChunks(plan('2026-08-01', '2026-08-31', [0, 6]));
        const flat = chunks.flat();
        expect(flat.every((d) => [0, 6].includes(weekdayOf(d)))).toBe(true);
        expect(total).toBe(flat.length);
    });

    /*
        Four selects is the cap, since the fifth row on a message is spent on the buttons.
        Past that the days are cut rather than paginated and the message says so.
    */
    it('cuts a plan longer than four selects and owns up to how many', () => {
        const { chunks, total, cut } = dayChunks(plan('2026-08-01', '2026-12-31'));
        expect(chunks).toHaveLength(4);
        expect(chunks.flat()).toHaveLength(100);
        expect(total).toBe(153);
        expect(cut).toBe(53);
    });

    it('never hands back a chunk Discord would refuse', () => {
        for (const end of ['2026-08-01', '2026-08-26', '2026-10-10', '2027-08-01']) {
            const { chunks } = dayChunks(plan('2026-08-01', end));
            expect(chunks.length).toBeLessThanOrEqual(4);
            for (const chunk of chunks) {
                expect(chunk.length).toBeGreaterThan(0);
                expect(chunk.length).toBeLessThanOrEqual(25);
            }
        }
    });

    //A weekday restriction that leaves nothing is refused at creation, but a picker still has to cope
    it('comes back with nothing rather than an empty select', () => {
        const { chunks, total } = dayChunks(plan('2026-08-03', '2026-08-07', [0, 6]));
        expect(chunks).toEqual([]);
        expect(total).toBe(0);
    });

    it('never offers a day that has gone', () => {
        const { chunks, total } = dayChunks(plan('2026-08-01', '2026-08-14'), '2026-08-10');
        expect(chunks.flat()).toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']);
        expect(total).toBe(5);
    });

    it('has nothing left once the last day has gone', () => {
        expect(dayChunks(plan('2026-08-01', '2026-08-14'), '2026-08-15').chunks).toEqual([]);
    });

    //Today on the plan's clock, not the machine's
    it('reads today where the plan is', () => {
        vi.setSystemTime(new Date('2026-08-09T20:00:00Z'));
        const auckland = { ...plan('2026-08-01', '2026-08-14'), timeZone: 'Pacific/Auckland' };
        expect(dayChunks(auckland).chunks.flat()[0]).toBe('2026-08-10');
        vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
    });
});

/*
    toJSON is where discord.js runs its own validation, so building the real components
    and asking for it is the cheapest way to find a cap that has been broken. Without
    this the first sign would be a send failing in front of somebody.
*/
describe('pickerComponents', () => {
    const build = (p, free = []) => pickerComponents(p, dayChunks(p).chunks, new Set(free)).map((row) => row.toJSON());

    it('builds something Discord would take for a short plan', () => {
        const rows = build(plan('2026-08-01', '2026-08-14'));
        expect(rows).toHaveLength(2);
        expect(rows[0].components[0].options).toHaveLength(14);
        expect(rows[1].components).toHaveLength(3);
    });

    it('ends on a button to the page, where the hours and the rest of the days go', () => {
        const link = build(plan('2026-08-01', '2026-08-14')).at(-1).components.at(-1);
        expect(link.label).toBe('Add my dates');
        expect(link.url).toMatch(/#\/plan\/ab12cd34ef$/);
    });

    //Five rows is the cap on a message, four of days and one of buttons
    it('never builds more rows than a message can hold', () => {
        expect(build(plan('2026-08-01', '2026-12-31'))).toHaveLength(5);
    });

    it('ticks the days already saved and leaves the rest alone', () => {
        const rows = build(plan('2026-08-01', '2026-08-14'), ['2026-08-03', '2026-08-04']);
        const picked = rows[0].components[0].options.filter((o) => o.default).map((o) => o.value);
        expect(picked).toEqual(['2026-08-03', '2026-08-04']);
    });

    //Zero, so emptying a list is how somebody says they are free on none of these
    it('lets a list be emptied and lets all of it be taken', () => {
        const select = build(plan('2026-08-01', '2026-08-14'))[0].components[0];
        expect(select.min_values).toBe(0);
        expect(select.max_values).toBe(14);
    });

    it('carries the chunk each select answers for, by index and by its first and last day', () => {
        const rows = build(plan('2026-08-01', '2026-09-09'));
        expect(rows[0].components[0].custom_id).toBe('free|day|ab12cd34ef|0|2026-08-01|2026-08-25');
        expect(rows[1].components[0].custom_id).toBe('free|day|ab12cd34ef|1|2026-08-26|2026-09-09');
    });

    it('carries the whole span on the two buttons', () => {
        const buttons = build(plan('2026-08-01', '2026-09-09')).at(-1).components.filter((b) => b.custom_id);
        expect(buttons.map((b) => b.custom_id)).toEqual([
            'free|all|ab12cd34ef|2026-08-01|2026-09-09',
            'free|none|ab12cd34ef|2026-08-01|2026-09-09'
        ]);
    });

    it('keeps every id inside the hundred characters an id gets', () => {
        for (const row of build(plan('2026-08-01', '2026-12-31'))) {
            for (const component of row.components) expect((component.custom_id || '').length).toBeLessThanOrEqual(100);
        }
    });
});

describe('pickerText', () => {
    it('says where they stand out of what they were asked', () => {
        expect(pickerText(plan('2026-08-01', '2026-08-14'), 5, 14, 0)).toContain('**5** of the 14 days');
    });

    it('reads properly for a plan asking about one day', () => {
        expect(pickerText(plan('2026-08-01', '2026-08-01'), 0, 1, 0)).toContain('of the 1 day this plan asks about');
    });

    //The cut days are the one case where the page is not optional, so it says so
    it('says how many days are only on the page', () => {
        expect(pickerText(plan('2026-08-01', '2026-12-31'), 3, 100, 53)).toContain('the other 53 are on the page');
    });

    //The button carries the link, so the text never does
    it('says the page is for hours when everything fitted, with no link in the text', () => {
        const text = pickerText(plan('2026-08-01', '2026-08-14'), 3, 14, 0);
        expect(text).toContain('Hours go on the page.');
        expect(text).not.toMatch(/https?:\/\//);
    });
});
