import { describe, it, expect } from 'vitest';
import { readPlanForm } from '../../src/api/planForm.js';
import { shiftDate } from '../../src/lib/dates.js';

const TODAY = '2026-10-03';
const ahead = (days) => shiftDate(TODAY, days);

const collect = (over = {}) => ({ name: 'Pub quiz', start: ahead(1), end: ahead(14), participantIds: ['bo'], ...over });
const announce = (over = {}) => ({ name: 'Pub quiz', announce: true, date: ahead(7), participantIds: ['bo'], ...over });

//A plan already running, whose window began last week and ended yesterday
const running = { dateRange: { start: ahead(-7), end: ahead(-1) }, chosenDate: null };

const read = (body, plan = null) => readPlanForm(body, { today: TODAY, plan });

describe('reading a plan off the form', () => {
    it('hands back a plan asking about a window', () => {
        expect(read(collect({ description: '  Upstairs ', allowedWeekdays: [0, 6], hostIds: ['sam'] }))).toEqual({
            form: {
                name: 'Pub quiz',
                description: 'Upstairs',
                participantIds: ['bo'],
                hostIds: ['sam'],
                repeatWeeks: null,
                set: false,
                window: { start: ahead(1), end: ahead(14) },
                allowedWeekdays: [0, 6]
            }
        });
    });

    it('hands back a plan with its day', () => {
        expect(read(announce({ time: '19:30', repeatWeeks: 2 })).form).toMatchObject({ set: true, date: ahead(7), time: '19:30', repeatWeeks: 2 });
    });

    it('needs a name and someone to invite', () => {
        expect(read(collect({ name: '  ' })).error).toBe('Give the plan a name.');
        expect(read(collect({ participantIds: [] })).error).toBe('Pick at least one person to invite.');
    });

    it('refuses a repeat it does not offer', () => {
        expect(read(announce({ repeatWeeks: 3 })).error).toBe('That is not a repeat I can do.');
    });

    it('refuses a time that is not one', () => {
        expect(read(announce({ time: '25:99' })).error).toMatch(/00:00 and 23:59/);
    });

    it('refuses days that fall nowhere in the window', () => {
        expect(read(collect({ start: ahead(1), end: ahead(2), allowedWeekdays: [3] })).error).toMatch(/None of the days/);
    });
});

describe('a new plan', () => {
    it('starts tomorrow at the earliest', () => {
        expect(read(collect({ start: TODAY })).error).toMatch(/tomorrow or later/);
    });

    it('can be set for today', () => {
        expect(read(announce({ date: TODAY })).form.date).toBe(TODAY);
        expect(read(announce({ date: ahead(-1) })).error).toBe('That date is in the past.');
    });
});

describe('a plan being edited', () => {
    it('keeps a window that has gone when it is left as it was', () => {
        expect(read(collect({ start: ahead(-7), end: ahead(-1) }), running).form.window).toEqual({ start: ahead(-7), end: ahead(-1) });
    });

    it('can stretch a window on from a start that has gone', () => {
        expect(read(collect({ start: ahead(-7), end: ahead(7) }), running).form.window).toEqual({ start: ahead(-7), end: ahead(7) });
    });

    it('can start a window today, but no earlier unless it already did', () => {
        expect(read(collect({ start: TODAY, end: ahead(7) }), running).form.window.start).toBe(TODAY);
        expect(read(collect({ start: ahead(-3), end: ahead(7) }), running).error).toMatch(/today or later/);
    });

    it('refuses a new window that has already been', () => {
        expect(read(collect({ start: ahead(-7), end: ahead(-2) }), running).error).toBe('That whole range is in the past.');
    });

    //Only reached on a plan whose day is today on its own clock and yesterday's somewhere else
    it('keeps the day it is already on', () => {
        expect(read(announce({ date: ahead(-1) }), { ...running, chosenDate: ahead(-1) }).form.date).toBe(ahead(-1));
    });
});
