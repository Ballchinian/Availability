import { describe, it, expect } from 'vitest';
import { dayLabel, dayChunks, pickerComponents, pickerText } from '../../src/bot/availability.js';
import { weekdayOf } from '../../src/lib/dates.js';

/*
    Only the parts that decide what goes on screen, which is where this can go wrong
    quietly: a chunk that moved would write somebody's answer onto the wrong dates, since
    the index is all the button id carries.
*/

const plan = (start, end, allowedWeekdays = null) => ({
    planId: 'ab12cd34ef',
    name: 'Board games',
    dateRange: { start, end },
    allowedWeekdays
});

describe('dayLabel', () => {
    it('reads as a day someone can recognise', () => {
        expect(dayLabel('2026-08-12')).toBe('Wed 12 Aug');
        expect(dayLabel('2026-01-01')).toBe('Thu 1 Jan');
        expect(dayLabel('2026-12-31')).toBe('Thu 31 Dec');
    });

    it('drops the leading zero a stored date carries', () => {
        expect(dayLabel('2026-08-05')).toBe('Wed 5 Aug');
    });

    //Every label goes on a select option, which Discord caps at 100 characters
    it('stays well inside what an option can hold', () => {
        expect(dayLabel('2026-09-30').length).toBeLessThanOrEqual(100);
    });
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
        expect(rows[1].components).toHaveLength(2);
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

    it('carries the chunk index each select answers for', () => {
        const rows = build(plan('2026-08-01', '2026-09-09'));
        expect(rows[0].components[0].custom_id).toBe('free|day|ab12cd34ef|0');
        expect(rows[1].components[0].custom_id).toBe('free|day|ab12cd34ef|1');
    });

    it('keeps every id inside the hundred characters an id gets', () => {
        for (const row of build(plan('2026-08-01', '2026-12-31'))) {
            for (const component of row.components) expect(component.custom_id.length).toBeLessThanOrEqual(100);
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

    //The cut days are the one case where the link is not optional, so it leads with them
    it('points at the page when there are days it could not show', () => {
        const text = pickerText(plan('2026-08-01', '2026-12-31'), 3, 100, 53);
        expect(text).toContain('53 more');
        expect(text).toContain('ab12cd34ef');
    });

    it('still offers the page when everything fitted', () => {
        expect(pickerText(plan('2026-08-01', '2026-08-14'), 3, 14, 0)).toContain('ab12cd34ef');
    });
});
