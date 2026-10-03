import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import ClockNote from '../../src/lib/ClockNote.svelte';
import PickPanel, { invitees } from '../../src/lib/compare/PickPanel.svelte';
import CancelPanel from '../../src/lib/compare/CancelPanel.svelte';
import RemindPanel from '../../src/lib/compare/RemindPanel.svelte';
import RepairPanel from '../../src/lib/compare/RepairPanel.svelte';
import Standing from '../../src/lib/compare/Standing.svelte';
import AnswerBoard, { owing, askAside, askedLine, updatedLine } from '../../src/lib/compare/AnswerBoard.svelte';
import PlanOverview, { planState, repeatLine } from '../../src/lib/compare/PlanOverview.svelte';
import TakeOn from '../../src/lib/compare/TakeOn.svelte';
import YourAnswer from '../../src/lib/compare/YourAnswer.svelte';
import Status, { invalidIf } from '../../src/lib/Status.svelte';
import CompareGrid from '../../src/lib/CompareGrid.svelte';
import DayCompare from '../../src/lib/compare/DayCompare.svelte';
import AttendanceBoard, { invitedLine } from '../../src/lib/compare/AttendanceBoard.svelte';
import MemberPicker from '../../src/lib/MemberPicker.svelte';
import EditReview from '../../src/lib/EditReview.svelte';
import RangeField from '../../src/lib/RangeField.svelte';
import DayGrid from '../../src/lib/DayGrid.svelte';
import TimePicker from '../../src/lib/TimePicker.svelte';
import RepeatDates from '../../src/lib/RepeatDates.svelte';
import RepeatField from '../../src/lib/RepeatField.svelte';
import WeekdayPicker from '../../src/lib/WeekdayPicker.svelte';
import PersonDialog, { daysOf, daysLine, daysSpoken } from '../../src/lib/PersonDialog.svelte';
import PlanCards from '../../src/lib/PlanCards.svelte';
import PlanList from '../../src/lib/PlanList.svelte';
import StartPlan from '../../src/lib/StartPlan.svelte';
import Practice from '../../src/lib/Practice.svelte';
import Home, { sortPlans } from '../../src/routes/Home.svelte';
import { belongsOnOverview } from '../../src/routes/Availability.svelte';
import Terms from '../../src/routes/Terms.svelte';
import Privacy from '../../src/routes/Privacy.svelte';
import { auth } from '../../src/lib/auth.svelte.js';
import { isoFromNow, repeatSeries } from '../../src/lib/calendar.js';
import { formatDate, formatLong, listNames } from '../../src/lib/format.js';
import type { ComparePlan, CompareScreen, EditPreview, Member, Participant, PlanScreen, UserGuild, UserPlan } from '../../src/lib/types.js';
import type { FreePerson } from '../../src/lib/overlap.js';

/*
    The only tests here that draw anything. `render` from svelte/server takes a component to
    a string with no DOM and no new dependency, which is as close as this suite gets to
    looking at a screen. Not the routes themselves, which want auth and the api behind them.
*/

//The router reads window.location as it loads, and nothing drawn here goes anywhere
vi.mock('svelte-spa-router', () => ({ replace: async () => {}, push: async () => {} }));

//The clock the device is on, which is all ClockNote asks the browser
const device = vi.hoisted(() => ({ zone: 'America/New_York' }));
vi.mock('../../src/lib/zone.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/lib/zone.js')>()),
    browserZone: () => device.zone
}));

//Every day that can be picked or marked is a button, and a day that is out is a span
const buttons = (body: string) => (body.match(/<button/g) || []).length;
//The days in the tab order, each as far as its name
const stops = (body: string) =>
    [...body.matchAll(/<button class="c?day[^"]*"[^>]*>/g)].filter((m) => m[0].includes('tabindex="0"')).map((m) => m[0].slice(0, m[0].indexOf('"', m[0].indexOf('aria-label="') + 12) + 1));

/*
    The grid is the only way to a date now, so it has to hold up on a plan nobody has
    answered, which is where the panel that used to stand in for it was reached from.
*/
describe('picking a day nobody has answered about', () => {
    const draw = (props: Record<string, unknown> = {}) =>
        render(PickPanel, {
            props: { planId: 'ab12cd34ef', selectedDate: '2026-08-12', onsaved: async () => {}, ...props }
        }).body;

    it('still offers to set the day', () => {
        expect(draw({ inCount: 0, totalParticipants: 3 })).toContain('Set it to Wed 12 Aug 2026');
    });

    //Narrowing to the people who can make it is nought people here, and it is the default
    it('does not offer to narrow the invite list to nobody', () => {
        expect(draw({ inCount: 0, totalParticipants: 3 })).not.toContain('Just the people who can make it');
    });

    it('offers it again once somebody is free on the day', () => {
        const body = draw({
            inCount: 1,
            totalParticipants: 3,
            freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] }
        });
        expect(body).toContain('Just the people who can make it');
    });

    it('asks who is still invited as a set of radios under a legend', () => {
        const body = draw({
            inCount: 1,
            totalParticipants: 3,
            freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] }
        });
        expect(body).toMatch(/<fieldset><legend class="lbl">Who is still invited\?<\/legend>\s*<label class="check"><input type="radio"/);
        expect(body).not.toContain('radiogroup');
    });

});

/*
    The grid's colouring and the slider already say how a day came out, and the people
    under the day give their hours, so the line that answers a click is the day alone.
*/
describe('the day picked', () => {
    const draw = (freeByDate: Record<string, FreePerson[]>, inCount: number) =>
        bare(render(PickPanel, { props: { planId: 'ab12cd34ef', selectedDate: '2026-08-12', inCount, freeByDate, onsaved: async () => {} } }).body);

    it.each([
        ['a day that works', { '2026-08-12': [{ userId: 'a', hours: [17, 18, 19] }] }, 1],
        ['a day someone is missing from', { '2026-08-12': [{ userId: 'a', hours: [] }] }, 3],
        ['a day nobody has answered', {}, 0]
    ])('is said as the day alone on %s', (_, free, joined) => {
        expect(draw(free, joined)).toContain('<span role="status"><strong>Wed 12 Aug 2026</strong></span>');
    });

    it('lists who is free with their hours', () => {
        expect(draw({ '2026-08-12': [{ userId: 'a', hours: [17, 18, 19] }] }, 1)).toContain('Someone: 5pm to 8pm');
    });
});

/*
    The line above the set button. Quiet mode and the invite list decide who hears about a
    date and how, and they are nowhere near each other, so what they come to together is
    the only thing worth asserting here.
*/
describe('what setting a day says it will do', () => {
    const onPlan: Participant[] = ['a', 'b', 'c'].map((userId) => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: true,
        vote: null,
        voteReason: null,
        override: null,
        invited: true
    }));

    const draw = (props: Record<string, unknown> = {}) =>
        render(PickPanel, {
            props: {
                planId: 'ab12cd34ef',
                selectedDate: '2026-08-12',
                inCount: 0,
                totalParticipants: 3,
                onsaved: async () => {},
                ...props
            }
        }).body;

    it('names the yes/no in the thread and the DMs on a plain set', () => {
        expect(draw()).toContain('Posts the yes/no in the thread, pings 3 people and DMs them the same buttons.');
    });

    //A set day always asks, so there is nothing to tick
    it('never offers to leave the yes/no out', () => {
        expect(draw()).not.toContain('Ask everyone if they can make it');
    });

    //The radios and the box already show who comes off, so only the people pinged are counted
    it('counts who it pings when it narrows, and no one else', () => {
        const body = draw({ inCount: 1, freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] } });
        expect(body).toContain('pings 1 person and DMs them the same buttons.');
        expect(body).not.toContain('come off the list');
    });

    //Nothing changing to the answers is what anyone expects, so it goes unsaid
    it('says only who hears when only the time or note is changing', () => {
        const body = draw({ participants: onPlan, chosen: { date: '2026-08-12', time: '', note: '' } });
        expect(body).toContain('DMs 3 people to say what changed.');
        expect(body).not.toContain('stand');
    });

    /*
        The list is not touched by an edit to the day it is already on, so the people free
        on that day are not a narrowing. Counting them as one had it promise fewer DMs than
        it sends.
    */
    it('counts everyone still invited on an edit, not just whoever is free that day', () => {
        const body = draw({
            participants: onPlan,
            inCount: 1,
            freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] },
            chosen: { date: '2026-08-12', time: '', note: '' }
        });
        expect(body).toContain('DMs 3 people to say what changed');
        expect(body).not.toContain('come off the list');
    });

    //Narrowed once already, so an edit reaches the two left on the list rather than all three
    it('counts the list as it already stands when some are off it', () => {
        const body = draw({
            participants: [onPlan[0], onPlan[1], { ...onPlan[2], invited: false }],
            chosen: { date: '2026-08-12', time: '', note: '' }
        });
        expect(body).toContain('DMs 2 people to say what changed');
    });
});

/*
    Most people who have not answered just have not got round to it, and would say yes once
    there is a day, so narrowing keeps them unless the planner says otherwise.
*/
describe('keeping the people who have not answered', () => {
    const person = (userId: string, confirmed: boolean): Participant => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed,
        vote: null,
        voteReason: null,
        override: null,
        invited: true
    });
    //Ann is free, Bo and Cy are not, Di and Ed never filled in
    const crowd = [person('ann', true), person('bo', true), person('cy', true), person('di', false), person('ed', false)];
    const draw = (props: Record<string, unknown> = {}) =>
        render(PickPanel, {
            props: {
                planId: 'ab12cd34ef',
                selectedDate: '2026-08-12',
                participants: crowd,
                inCount: 3,
                totalParticipants: 5,
                freeByDate: { '2026-08-12': [{ userId: 'ann', hours: [] }] },
                onsaved: async () => {},
                ...props
            }
        }).body;

    it('asks them too, ticked to start', () => {
        expect(draw()).toMatch(/<label class="check sub"><input type="checkbox"[^>]* checked[^>]*\/?> Ask the 2 who haven't answered this day too<\/label>/);
    });

    it('counts them among the people pinged', () => {
        expect(draw()).toContain('pings 3 people');
    });

    it('names them', () => {
        expect(draw()).toContain("Haven't answered this day: DI, ED.");
    });

    it('keeps them while ticked and lets them go when not', () => {
        expect(invitees(['ann'], ['di', 'ed'], true)).toEqual(['ann', 'di', 'ed']);
        expect(invitees(['ann'], ['di', 'ed'], false)).toEqual(['ann']);
    });

    it('is not there when everyone has answered', () => {
        const body = draw({ participants: crowd.slice(0, 3), totalParticipants: 3, inCount: 3 });
        expect(body).not.toContain('answered this day too');
        expect(body).not.toContain("Haven't answered");
    });

    //Editing the day the plan is already on never touches the list
    it('is not there on the day the plan is already on', () => {
        expect(draw({ chosen: { date: '2026-08-12', time: '', note: '' } })).not.toContain('answered this day too');
    });

    it('says one person in the singular', () => {
        expect(draw({ participants: crowd.slice(0, 4), totalParticipants: 4 })).toContain("Ask the 1 who hasn't answered this day too");
    });

    //Bo is in but his answer stops short of the day, and Cy said it's not for her
    it('goes by what each person has answered, and leaves anyone out off both lists', () => {
        const body = draw({
            participants: [
                { ...crowd[0], in: true },
                { ...crowd[1], in: true },
                { ...crowd[2], in: false },
                { ...crowd[3], in: null }
            ],
            inCount: 2,
            totalParticipants: 4,
            unansweredByDate: { '2026-08-12': ['bo'] }
        });
        expect(body).toContain("Haven't answered this day: BO, DI.");
        expect(body).not.toContain('Not free on this day');
        expect(body).toContain("Ask the 2 who haven't answered this day too");
        expect(body).toContain('pings 3 people');
    });

    it('never counts anyone out among the people pinged', () => {
        const withOut = [crowd[0], crowd[1], { ...crowd[2], in: false }];
        //Nobody free, so nothing to narrow to and the whole list stays on
        expect(draw({ participants: withOut, totalParticipants: 3, freeByDate: {} })).toContain('pings 2 people');
        expect(draw({ participants: withOut, totalParticipants: 3, chosen: { date: '2026-08-12', time: '', note: '' } })).toContain('DMs 2 people');
    });
});

describe('the compare grid', () => {
    const draw = (props: Record<string, unknown>) =>
        render(CompareGrid, {
            props: {
                start: '2026-08-01',
                end: '2026-08-14',
                freeByDate: { '2026-08-05': [{ userId: 'a', hours: [] }] },
                inCount: 1,
                ...props
            }
        }).body;

    /*
        Two different things: the day the plan is on, and the day being looked at. Before this
        the grid could only show the second, so scrolling the grid lost track of the first.
    */
    it('is one Tab stop, on the day being looked at', () => {
        expect(stops(draw({ selectedDate: '2026-08-07' }))).toEqual([expect.stringContaining(formatLong('2026-08-07'))]);
    });

    it('is on its first day before any is picked', () => {
        expect(stops(draw({}))).toEqual([expect.stringContaining(formatLong('2026-08-01'))]);
    });

    it('marks the set day apart from the day being looked at', () => {
        const body = draw({ chosenDate: '2026-08-05', selectedDate: '2026-08-07' });
        expect(body).toContain('isset');
        expect(body).toContain('chosen');
    });

    it('says which day is set in the accessible name too', () => {
        expect(draw({ chosenDate: '2026-08-05' })).toContain('the day this plan is set for');
    });

    it('counts only the people in who have answered a day, and says how many have not', () => {
        const body = draw({ inCount: 3, missAllowed: 1, unansweredByDate: { '2026-08-05': ['b'] } });
        expect(body).toContain(`${formatLong('2026-08-05')}: 1 of 2 free, 24h in common, 1 hasn't answered it`);
    });

    it('marks nothing when no day is set', () => {
        expect(draw({ chosenDate: null })).not.toContain('isset');
        expect(draw({ chosenDate: null })).not.toContain('class="tick"');
    });

    //The ring alone is 1.24:1 on a bright day, so the set day carries a tick in its text colour
    it('ticks the set day', () => {
        const body = draw({ chosenDate: '2026-08-05' });
        expect(body.match(/class="tick"/g)).toHaveLength(1);
        expect(body).toMatch(/class="num">5(<!--[^>]*-->)?<svg class="tick"/);
    });

    //The server refuses a day before today, so the grid does not offer one
    it('draws the days before today as out', () => {
        expect(buttons(draw({ today: '2026-08-06' }))).toBe(9);
    });

    it('keeps every day on a grid that is only looked back at', () => {
        expect(buttons(draw({ today: null }))).toBe(14);
    });

    it('gives the hours in common on each day that has any', () => {
        const body = draw({ freeByDate: { '2026-08-05': [{ userId: 'a', hours: [17, 18] }] } });
        expect(body).toContain('<span class="shared">2h</span>');
        expect(body.match(/<span class="shared"><\/span>/g)).toHaveLength(13);
    });

    //A title the same as the name gets read out a second time as the description
    it('says each day once', () => {
        expect(draw({})).not.toContain('title=');
    });

    it('says the arrows move it, off the screen, where it is read out on the way in', () => {
        expect(draw({})).toMatch(/<p class="offscreen" id="([^"]+)">Arrow keys move between days\.<\/p>\s*<div class="grid-wrap" role="group" aria-describedby="\1"/);
    });

    //Under "Everyone's days" on the compare page, straight under the h1 on the dates screen
    it('heads its months one level under wherever it sits', () => {
        expect(draw({})).toMatch(/<h3>August 2026(<!---->)?<\/h3>/);
        expect(draw({ level: 2 })).toMatch(/<h2>August 2026(<!---->)?<\/h2>/);
    });
});

//Counted off today, since the grid reads the clock itself
describe('the fill-in grid', () => {
    const draw = (selection: Record<string, number[]> = {}) =>
        render(DayGrid, { props: { start: isoFromNow(-3, 'day'), end: isoFromNow(3, 'day'), selection } }).body;

    it('locks the days already gone', () => {
        expect(buttons(draw())).toBe(4);
    });

    it('picks out the days still to answer, on screen and by name', () => {
        const left = isoFromNow(2, 'day');
        const body = render(DayGrid, { props: { start: isoFromNow(0, 'day'), end: isoFromNow(3, 'day'), toFill: [left] } }).body;
        expect(body.match(/class="day is-new"/g)).toHaveLength(1);
        expect(body).toContain(`aria-label="${formatLong(left)}, still to answer"`);
    });

    it('says which days are past the date the calendar answers up to', () => {
        const body = render(DayGrid, { props: { start: isoFromNow(0, 'day'), end: isoFromNow(3, 'day'), coveredUntil: isoFromNow(2, 'day') } }).body;
        expect(body).toContain(`aria-label="${formatLong(isoFromNow(3, 'day'))}, not counted as your answer"`);
        expect(body.match(/not counted as your answer/g)).toHaveLength(1);
    });

    //Both pages it is on have only their h1 above it
    it('heads its months at h2', () => {
        const body = draw();
        expect(body).toMatch(/<h2 style="[^"]*">/);
        expect(body).not.toContain('<h3');
    });

    //A clock button rides on every free day, so one clock means the day gone is not drawn as free
    it('leaves a day gone out even when it was marked free', () => {
        expect(buttons(draw({ [isoFromNow(-1, 'day')]: [], [isoFromNow(1, 'day')]: [] }))).toBe(5);
    });

    //Each clock as its name and the words on it, with the drawing taken out
    const clocks = (body: string) =>
        [...body.matchAll(/<button class="clock"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({
            name: m[1],
            shown: m[2].replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<!--.*?-->/g, '').trim(),
            drawn: m[2].includes('<svg') && m[2].includes('aria-hidden="true"')
        }));

    it('names a clock on part of a day by the hours it shows first', () => {
        const day = isoFromNow(1, 'day');
        const [clock] = clocks(draw({ [day]: [17, 18, 19, 20, 21] }));
        expect(clock.shown).toBe('5h');
        expect(clock.name).toBe(`5h, set hours for ${formatLong(day)}, free 5pm to 10pm`);
        expect(clock.drawn).toBe(true);
    });

    it('shows only the clock on a day free all of it', () => {
        const day = isoFromNow(1, 'day');
        const [clock] = clocks(draw({ [day]: [] }));
        expect(clock.shown).toBe('');
        expect(clock.name).toBe(`Set hours for ${formatLong(day)}, free all day`);
        expect(clock.drawn).toBe(true);
    });

    //Two years of days was up to 730 stops, and the arrows move between them instead
    it('is one Tab stop, on the first day that can be marked', () => {
        const body = draw();
        expect(stops(body)).toEqual([`<button class="day" aria-label="${formatLong(isoFromNow(0, 'day'))}"`]);
    });

    it('puts only the clock under that day in the tab order', () => {
        const body = draw({ [isoFromNow(0, 'day')]: [], [isoFromNow(1, 'day')]: [] });
        const inOrder = [...body.matchAll(/<button class="clock"[^>]*>/g)].filter((m) => m[0].includes('tabindex="0"'));
        expect(inOrder).toHaveLength(1);
        expect(inOrder[0][0]).toContain(formatLong(isoFromNow(0, 'day')));
    });

    it('says how a keyboard gets round, off the screen, where it is read out on the way in', () => {
        const body = draw();
        expect(body).toMatch(/<p class="offscreen" id="([^"]+)">Arrow keys move between days\. Shift\+Enter marks the stretch[^<]*<\/p>[\s\S]*role="group" aria-describedby="\1"/);
    });

    //A brush left from a last visit would quietly narrow every day marked in the next
    it('starts every visit giving new days all day, with nothing to say so', () => {
        const body = draw({ [isoFromNow(1, 'day')]: [17, 18] });
        expect(body).not.toContain('New days get');
        expect(bare(body)).toMatch(silent);
    });

    //The brightness and the clocks read for themselves, and each day's name already says the rest
    it('explains nothing on the screen', () => {
        const body = draw({ [isoFromNow(1, 'day')]: [17, 18] });
        expect(body).not.toContain('Brighter means');
        expect(body).not.toContain('title=');
    });
});

//Drawn as it opens, since showModal and every tap after it need a browser
describe('the hours picker', () => {
    const draw = (hours: number[]) => render(TimePicker, { props: { date: '2026-08-05', hours } }).body;
    const lit = (body: string) => (body.match(/aria-pressed="true"/g) || []).length;

    it('lights every hour on a day free all day', () => {
        const body = draw([]);
        expect(lit(body)).toBe(24);
        expect(body).toContain('Free all day. Tap or drag across hours to take them off.');
    });

    it('lights only the hours kept on part of a day', () => {
        const body = draw([17, 18]);
        expect(lit(body)).toBe(2);
        expect(body).toContain('Free 5pm to 7pm.');
    });
});

/*
    The repeat calendar. It exists to draw dates instead of writing them out, so what it
    puts on screen is the only thing worth asserting.
*/
describe('the repeat dates calendar', () => {
    const series = repeatSeries({
        repeatWeeks: 2,
        dateRange: { start: '2026-08-06', end: '2026-08-06' },
        chosenDate: '2026-08-06',
        chosenTime: null
    });
    const draw = (props: Record<string, unknown>) =>
        render(RepeatDates, { props: { first: '2026-08-06', shapes: series, ...props } }).body;

    it('opens on the month the plan itself is on', () => {
        expect(draw({})).toContain('August 2026');
    });

    it('tells the day this plan is on apart from the ones that follow', () => {
        const body = draw({});
        expect(body).toContain('Thursday 6 August 2026, this one');
        expect(body).toContain('Thursday 20 August 2026, it comes round again');
    });

    //A month at a time is the whole reason there are arrows on it
    it('draws one month, not the whole series', () => {
        const body = draw({});
        expect(body).toContain('<p class="month">August 2026</p>');
        expect(body).not.toContain('<p class="month">September 2026</p>');
    });

    it('says the series out loud for anyone who cannot see the grid', () => {
        expect(draw({})).toContain('Thursday 3 September 2026');
    });

    /*
        What the screen after a plan is made draws for a one off: the month with its day on
        it, and none of the furniture that only earns its place once there is a series.
    */
    it('marks the day on its own for a plan that does not repeat', () => {
        const body = draw({ shapes: [] });
        expect(body).toContain('Thursday 6 August 2026, this one');
        expect(body).not.toContain('Later month');
        expect(body).not.toContain('rkey');
    });
});

/*
    The repeat picker on the form. What it has to get right is when there is a day
    for a series to count off at all: without one the sweep makes nothing, and a calendar
    drawn anyway would be promising dates from a day that does not exist.
*/
describe('the repeat picker', () => {
    const draw = (props: Record<string, unknown> = {}) => render(RepeatField, { props }).body;

    it('offers the intervals whether or not a day is set', () => {
        expect(draw()).toContain('one off');
        expect(draw()).toContain('every other week');
    });

    it('draws where the interval lands once there is a day to count from', () => {
        expect(draw({ weeks: 2, from: '2026-08-06' })).toContain('Thursday 20 August 2026, it comes round again');
    });

    //Nothing is made until this plan has a day of its own, so there is nothing honest to draw
    it('draws no calendar while the plan is still looking for a day', () => {
        expect(draw({ weeks: 2, from: null })).not.toContain('rcal');
    });

    it('draws no calendar for a one off', () => {
        expect(draw({ weeks: null, from: '2026-08-06' })).not.toContain('rcal');
    });

    //One of five, so a screen reader hears a group of radios and which one is picked
    it('offers the intervals as radios under a legend', () => {
        const body = draw({ weeks: 2 });
        expect(body).toContain('<legend class="lbl">Does this come round again?</legend>');
        expect(body.match(/type="radio"/g)).toHaveLength(4);
        expect(body).toMatch(/value="2" checked[^>]*\/>every other week/);
        expect(body).not.toContain('<button');
    });

    //Running a plan takes no planner role, and making plans come round again does
    it('leaves someone without the planner role only a one off', () => {
        const body = draw({ weeks: null, canStart: false });
        expect(body).toMatch(/value="1"[^>]*disabled[^>]*\/>every week/);
        expect(body).toMatch(/value="4"[^>]*disabled[^>]*\/>every 4 weeks/);
        expect(body).not.toMatch(/disabled[^>]*\/>one off/);
        expect(body).toContain('Only someone with the planner role can make it come round again.');
        expect(draw({ weeks: 2 })).not.toContain('planner role');
    });

    //A plan already coming round is not asked again, only offered the end of it
    it('says how a plan already repeating comes round, with one box to make this the last', () => {
        const body = draw({ weeks: 2, was: 2, by: 'Ali', from: '2026-08-06' });
        expect(body).toContain('<legend class="lbl">Comes round again</legend>');
        expect(body).toContain('Every other week, set by Ali.');
        expect(body).not.toContain('type="radio"');
        expect(body.match(/type="checkbox"/g)).toHaveLength(1);
        expect(body).toContain('Make this the last time it comes round');
        expect(body).not.toMatch(/type="checkbox"[^>]*checked/);
        expect(body).toContain('rcal');
    });

    it('ticks the box and draws nothing once it is the last', () => {
        const body = draw({ weeks: null, was: 2, from: '2026-08-06' });
        expect(body).toMatch(/type="checkbox"[^>]*checked/);
        expect(body).not.toContain('rcal');
    });

    //Sent back out for dates, it keeps coming round, and has no day yet to count from
    it('says a plan finding its day comes round once it has one', () => {
        expect(draw({ weeks: 1, was: 1 })).toContain('Every week, once it has a day.');
    });

    //Stopping is open to whoever runs it, planner or not
    it('lets someone without the planner role make it the last', () => {
        const body = draw({ weeks: 2, was: 2, canStart: false });
        expect(body).not.toMatch(/type="checkbox"[^>]*disabled/);
        expect(body).not.toContain('planner role');
    });
});

//"Call it off" is the one name for this, on the site and in Discord alike
describe('the call it off panel', () => {
    it('names the button for what it does', () => {
        const body = render(CancelPanel, { props: { planId: 'ab12cd34ef', oncancelled: () => {} } }).body;
        expect(body).toContain('Call it off</button>');
        expect(body).not.toContain('It is off');
    });

    //Calling a plan off always tells everyone, so there is nothing to choose
    it('asks nothing about who to tell', () => {
        const body = render(CancelPanel, { props: { planId: 'ab12cd34ef', oncancelled: () => {} } }).body;
        expect(body).not.toContain('type="checkbox"');
    });
});

describe('the clock note', () => {
    const draw = (props: Record<string, unknown>) => render(ClockNote, { props: { zone: 'Europe/London', ...props } }).body;

    it('says what the set time comes to on the reader clock', () => {
        device.zone = 'America/New_York';
        const body = draw({ date: '2026-09-12', time: '19:00' });
        expect(body).toContain('That is 7pm on');
        expect(body).toContain('2pm on Sat 12 Sep 2026');
        expect(body).not.toContain(' are on ');
    });

    it('carries the time over midnight onto the day it lands on', () => {
        device.zone = 'Asia/Tokyo';
        expect(draw({ date: '2026-09-12', time: '23:30' })).toContain('7:30am on Sun 13 Sep 2026');
    });

    //Reykjavik stays on GMT all year, so it agrees with London in January and not in July
    it('asks the two clocks about the day itself', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
        device.zone = 'Atlantic/Reykjavik';
        try {
            const body = draw({ date: '2026-07-12', time: '19:00' });
            expect(body).toContain('Europe/London (GMT+1)');
            expect(body).toContain('6pm on Sun 12 Jul 2026');
            expect(draw({ date: '2027-01-10', time: '19:00' })).not.toContain('<p');
        } finally {
            vi.useRealTimers();
        }
    });

    it('still names the clock for a page of times', () => {
        device.zone = 'America/New_York';
        expect(draw({ what: 'The days and hours here' })).toContain('The days and hours here are on');
    });

    it('says nothing to someone already on the plan clock', () => {
        device.zone = 'Europe/London';
        expect(draw({ date: '2026-09-12', time: '19:00' })).not.toContain('<p');
    });
});

//My plans and Past plans draw the same card, and only Past plans says it in the past tense
describe('a plan card', () => {
    const day = isoFromNow(3, 'day');
    //A guest who has not said, on a plan still finding its day
    const card = (over: Partial<UserPlan> = {}): UserPlan => ({
        planId: 'ab12cd34ef',
        name: 'Pub quiz',
        guildName: 'Friends',
        status: 'collecting',
        start: day,
        end: isoFromNow(9, 'day'),
        chosenDate: null,
        chosenTime: null,
        timeZone: 'Europe/London',
        inIt: true,
        filledIn: false,
        mine: false,
        role: 'guest',
        hosts: ['Ali'],
        repeatWeeks: null,
        onList: true,
        standing: 'not-said',
        daysLeft: 0,
        movedBack: false,
        datesPassed: false,
        answer: null,
        invited: true,
        readyToPick: false,
        ...over
    });
    const set: Partial<UserPlan> = { status: 'closed', start: day, end: day, chosenDate: day, standing: null };
    const draw = (plan: UserPlan, over = false) => bare(render(PlanCards, { props: { plans: [plan], over } }).body);
    //The card's one button, as what it says and where it goes
    const button = (body: string) => {
        const found = [...body.matchAll(/<a class="ghost action" href="([^"]+)">([^<]+)<\/a>/g)];
        expect(found).toHaveLength(1);
        return [found[0][2], found[0][1]];
    };
    const here = '#/plan/ab12cd34ef';

    it.each<[string, Partial<UserPlan>, string, string]>([
        ['someone who has not said', {}, "Say if you're in", here],
        ['someone in with days left', { standing: 'days-left', daysLeft: 3 }, 'Fill in 3 days', here],
        ['someone in with no dates yet', { standing: 'no-dates', daysLeft: 7 }, 'Fill in your dates', here],
        ['someone moved back', { standing: 'no-dates', movedBack: true }, 'Go over your dates again', here],
        ['someone who has not answered a set day', set, "Say if you're coming", `${here}/overview`],
        ['whoever runs a plan everyone has answered', { role: 'host', standing: 'done', readyToPick: true }, 'Pick the day', `${here}/overview`],
        ['whoever runs a plan whose dates have passed', { role: 'host', standing: 'done', datesPassed: true }, 'Ask about new dates', `${here}/dates`],
        ['a guest of a plan whose dates have passed', { datesPassed: true }, 'Waiting for new dates', `${here}/overview`],
        ['someone who has answered every day', { standing: 'done' }, 'Overview', `${here}/overview`],
        ['someone who is coming on a set day', { ...set, answer: 'yes' }, 'Overview', `${here}/overview`]
    ])('gives %s the one button for what is next', (_, where, label, href) => {
        expect(button(draw(card(where)))).toEqual([label, href]);
    });

    it('links its title to the overview, whatever the button says', () => {
        expect(draw(card())).toContain(`<a class="name" href="${here}/overview">Pub quiz</a>`);
    });

    it('says where the plan has got to under its name', () => {
        expect(draw(card())).toContain(`Friends · finding a day, ${formatDate(day)} to ${formatDate(isoFromNow(9, 'day'))}`);
        expect(draw(card({ datesPassed: true }))).toContain('Friends · the dates it asked about have passed');
        expect(draw(card(set))).toContain(`Friends · set for ${formatDate(day)}`);
    });

    it('says it in the past tense on Past plans, and asks nothing of anyone there', () => {
        const been = draw(card(set), true);
        expect(been).toContain(`Friends · was on ${formatDate(day)}`);
        expect(button(been)).toEqual(['Overview', `${here}/overview`]);
        expect(draw(card({ status: 'cancelled' }), true)).toContain('Friends · called off');
    });

    //Thirty days after its dates went by with no day picked, which is when it moves to Past plans
    it('says a plan that never got a day never got one', () => {
        const body = draw(card({ role: 'host', datesPassed: true }), true);
        expect(body).toContain('Friends · never got a day');
        expect(button(body)).toEqual(['Overview', `${here}/overview`]);
    });

    describe('tags', () => {
        const tag = (text: string) => `<span class="tag">${text}</span>`;

        it('name who else runs a plan, to someone who runs it', () => {
            expect(draw(card({ role: 'host', hosts: ['Sam', 'Jo'] }))).toContain(tag('You run this with Sam and Jo'));
            expect(draw(card({ ...set, role: 'host', hosts: ['Sam'] }), true)).toContain(tag('You ran this with Sam'));
        });

        it('are not there for a guest, or for someone who runs it alone', () => {
            expect(draw(card())).not.toContain('class="tag');
            expect(draw(card({ role: 'host', hosts: [] }))).not.toContain('class="tag');
        });

        //Nothing is made until a plan has had its day, so before then there is no date to give
        it('say how often a plan comes round, and when next once it has its day', () => {
            expect(draw(card({ ...set, repeatWeeks: 2 }))).toContain(tag(`Repeats every other week · next ${formatDate(isoFromNow(17, 'day'))}`));
            expect(draw(card({ repeatWeeks: 1 }))).toContain(tag('Repeats every week'));
        });

        //It comes round on the day it found, not as another window
        it('give the next date for a plan that found its day by asking, too', () => {
            expect(draw(card({ ...set, end: isoFromNow(9, 'day'), repeatWeeks: 2 }))).toContain(tag(`Repeats every other week · next ${formatDate(isoFromNow(17, 'day'))}`));
        });

        it('say nothing of a repeat on Past plans, where the next one is a card of its own', () => {
            expect(draw(card({ ...set, repeatWeeks: 2 }), true)).not.toContain('Repeats');
        });
    });

    //For the few minutes a deploy takes, when a plan comes with none of where they stand and only whoever made it gets its overview
    describe('from a backend older than the site', () => {
        const old = (over: Partial<UserPlan> = {}): UserPlan => ({
            planId: 'ab12cd34ef',
            name: 'Pub quiz',
            guildName: 'Friends',
            status: 'collecting',
            start: day,
            end: isoFromNow(9, 'day'),
            chosenDate: null,
            chosenTime: null,
            timeZone: 'Europe/London',
            inIt: true,
            filledIn: false,
            mine: false,
            ...over
        });

        it('sends a guest to their dates, by the title and the button alike', () => {
            const body = draw(old());
            expect(button(body)).toEqual(['Fill in your dates', here]);
            expect(body).toContain(`<a class="name" href="${here}">Pub quiz</a>`);
            expect(button(draw(old({ filledIn: true })))).toEqual(['Overview', here]);
        });

        it('sends whoever made it to the overview', () => {
            const body = draw(old({ mine: true, inIt: false }));
            expect(button(body)).toEqual(['Overview', `${here}/overview`]);
            expect(body).toContain(`<a class="name" href="${here}/overview">Pub quiz</a>`);
        });
    });

    it('sorts whatever is waiting on them first, then the rest still finding a day, then the days set, soonest first', () => {
        const plans = [
            card({ planId: 'set-later', ...set, chosenDate: isoFromNow(9, 'day'), answer: 'yes' }),
            card({ planId: 'answered', standing: 'done' }),
            card({ planId: 'set-sooner', ...set, answer: 'yes' }),
            card({ planId: 'coming', ...set, chosenDate: isoFromNow(5, 'day') }),
            card({ planId: 'waiting', datesPassed: true }),
            card({ planId: 'in' })
        ];
        expect(sortPlans(plans).map((p) => p.planId)).toEqual(['in', 'coming', 'answered', 'waiting', 'set-sooner', 'set-later']);
    });
});

//My plans shows no list of servers, so this button is the only way a planner starts a plan from the site
describe('the start a plan button', () => {
    const guild = (guildId: string, over: Partial<UserGuild> = {}): UserGuild => ({
        guildId,
        guildName: `Server ${guildId}`,
        iconUrl: null,
        setupComplete: true,
        isPlanner: true,
        ...over
    });
    const draw = (guilds: UserGuild[]) => render(StartPlan, { props: { guilds } }).body;

    it('is not there for someone who plans nowhere', () => {
        const body = draw([guild('1', { isPlanner: false }), guild('2', { setupComplete: false })]);
        expect(body).not.toContain('Start a plan');
    });

    it('goes straight to the form when there is one server to plan in', () => {
        const body = draw([guild('1'), guild('2', { isPlanner: false })]);
        expect(body).toMatch(/<a [^>]*href="#\/g\/1"[^>]*>Start a plan<\/a>/);
        expect(body).not.toContain('<button');
        expect(body).not.toContain('Server 2');
    });

    it('asks which server first when there are several, and starts closed', () => {
        const body = draw([guild('1'), guild('2'), guild('3', { setupComplete: false })]);
        expect(body).toMatch(/<button [^>]*aria-expanded="false"[^>]*aria-controls="start-in"/);
        expect(body).toMatch(/<div id="start-in"[^>]* hidden/);
        expect(body).toContain('href="#/g/1"');
        expect(body).toContain('href="#/g/2"');
        expect(body).not.toContain('Server 3');
    });
});

//Made-up people are a planner's, made for a server they plan in
describe('the practice section', () => {
    const guild = (guildId: string, over: Partial<UserGuild> = {}): UserGuild => ({
        guildId,
        guildName: `Server ${guildId}`,
        iconUrl: null,
        setupComplete: true,
        isPlanner: true,
        ...over
    });
    const draw = (guilds: UserGuild[]) => render(Practice, { props: { guilds } }).body;

    it('is not there for someone who plans nowhere', () => {
        expect(draw([guild('1', { isPlanner: false }), guild('2', { setupComplete: false })]).replace(/<!--[^>]*-->/g, '')).toBe('');
    });

    it('asks only for a name and the planner role with one server to make them for', () => {
        const body = draw([guild('1'), guild('2', { isPlanner: false })]);
        expect(body).toContain('<h2>Practice</h2>');
        expect(body).toContain('<label for="practice-name">Name</label>');
        expect(body).toContain('Has the planner role');
        expect(body).not.toContain('<select');
    });

    it('asks which server when there are several', () => {
        const body = draw([guild('1'), guild('2'), guild('3', { setupComplete: false })]);
        expect(body).toContain('<label for="practice-guild">Server</label>');
        expect(body).toContain('Server 2');
        expect(body).not.toContain('Server 3');
    });
});

describe('the attendance board', () => {
    const person = (userId: string, vote: Participant['vote']): Participant => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: true,
        vote,
        voteReason: null,
        override: null,
        invited: true
    });
    const draw = (extra: Participant[] = []) =>
        render(AttendanceBoard, {
            props: {
                planId: 'ab12cd34ef',
                chosenDate: '2026-08-12',
                participants: [person('a', 'yes'), person('b', null), ...extra],
                onmoved: async () => {}
            }
        }).body;

    //Under the page's "Where it stands", so a level down from it rather than two
    it('heads each column one level under the section it sits in', () => {
        const body = draw();
        expect(body).toContain('<h3>Coming (1)</h3>');
        expect(body).not.toContain('<h4');
    });

    //A chip opens a row of moves under it, so it says whether that row is showing
    it('says a chip opens something, and starts shut', () => {
        const body = draw();
        expect(body.match(/<button[^>]*class="bchip"[^>]*aria-expanded="false"/g)).toHaveLength(2);
        expect(body).not.toContain('move-row');
    });

    //Kept on the list for a change of mind, but nothing asks them, so they are not waited on
    it("puts someone who said it is not for them under can't make it, with their reason", () => {
        const body = bare(draw([{ ...person('c', null), in: false, inReason: 'Away' }]));
        expect(body).toContain("<h3>Waiting to answer (1)</h3>");
        expect(body).toContain("<h3>Can't make it (1)</h3>");
        expect(body).toMatch(/>C\s+<span class="muted small">\(said it's not for them\)<\/span>\s*<span class="muted small">\(Away\)<\/span>/);
    });

    it('says who moved someone back to waiting', () => {
        const body = bare(draw([{ ...person('c', null), sentBack: { byName: 'Ali' } }]));
        expect(body).toMatch(/data-user="c"[^>]*>C\s+<span class="muted small">\(moved back by Ali\)<\/span>/);
    });

    it('heads the people left off the day like the columns, with nothing else said', () => {
        const body = draw([{ ...person('c', null), invited: false }]);
        expect(body).toMatch(/<div class="uninvited"><h3>Not invited to this date \(1\)<\/h3>\s*<ul>/);
        expect(body).not.toContain('no ping and no DM');
    });

    //Named to match "Not invited to this date", and it asks them rather than answering for them
    it('invites someone left off the day', () => {
        const body = draw([{ ...person('c', null), invited: false }]);
        expect(body).toMatch(/<button class="ghost" data-user="c"[^>]*>Invite them<\/button>/);
        expect(body).not.toContain('Let them come');
    });

    it('says the yes/no reached them only when the DM landed', () => {
        expect(invitedLine('Ann', true)).toBe('Invited Ann. They have the yes/no in their DMs.');
        expect(invitedLine('Ann', false)).not.toContain('in their DMs');
        expect(invitedLine('Ann', false)).toContain('thread');
    });

    //Nothing else on the page can show it, and it says where they can still be reached
    it('says whose DMs are closed beside their name, in a column or off the day', () => {
        const body = draw([{ ...person('c', null), dmsClosed: true }, { ...person('d', null), invited: false, dmsClosed: true }]);
        expect(body.match(/\(DMs closed, only reachable in the thread\)/g)).toHaveLength(2);
        //A space at the start of an {#if} is dropped, which read out as "Jo(DMs closed"
        expect(body.replace(/<[^>]*>/g, '')).not.toMatch(/\S\(DMs closed/);
        expect(draw()).not.toContain('DMs closed');
    });
});

/*
    A set plan's page is the yes/no page however it got its day. One that collected dates
    first kept "3 of 4 have filled in their dates" under the nudge, which read as if the
    nudge were chasing dates.
*/
describe('where a set plan stands', () => {
    const person = (userId: string, over: Partial<Participant> = {}): Participant => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: false,
        vote: null,
        voteReason: null,
        override: null,
        invited: true,
        ...over
    });
    const screen = (start: string, end: string, participants: Participant[]): CompareScreen => ({
        plan: {
            planId: 'ab12cd34ef',
            name: 'Bowling',
            description: '',
            start,
            end,
            status: 'closed',
            allowedWeekdays: null,
            guildName: 'The server',
            chosenDate: '2026-08-12',
            chosenTime: '19:00',
            chosenNote: null,
            timeZone: 'America/New_York',
            guildId: 'g1',
            probeActive: true,
            repeatWeeks: null,
            repeatedFrom: null,
            repeatedInto: null,
            threadUrl: null
        },
        participants,
        youAreIn: false,
        confirmedCount: participants.filter((p) => p.confirmed).length,
        totalParticipants: participants.length,
        freeByDate: {},
        history: []
    });
    const draw = (data: CompareScreen) =>
        bare(render(Standing, { props: { planId: 'ab12cd34ef', data, onmoved: async () => {} } }).body);

    const collected = screen('2026-08-01', '2026-08-30', [
        person('ann', { confirmed: true, vote: 'yes' }),
        person('bo', { confirmed: true }),
        person('cy'),
        person('di', { confirmed: true, invited: false })
    ]);
    const setFromTheStart = screen('2026-08-12', '2026-08-12', [person('ann', { vote: 'yes' }), person('bo'), person('cy')]);

    it('draws the same page either way, apart from the not-invited list', () => {
        const withList = draw(collected);
        expect(withList).toContain('class="uninvited"');
        expect(withList.replace(/<div class="uninvited">[\s\S]*?<\/ul><\/div>/, '')).toBe(draw(setFromTheStart));
    });

    it('says nothing about filling in dates', () => {
        expect(draw(collected)).not.toContain('filled in their dates');
    });

    it('says who the nudge reaches', () => {
        expect(draw(collected)).toContain('Nudge the 2 still to answer');
    });
});

describe('the member picker', () => {
    const members: Member[] = ['ann', 'bob', 'cat'].map((id) => ({ id, username: id, displayName: id.toUpperCase(), avatarUrl: '' }));
    const draw = (selectedIds: string[]) => render(MemberPicker, { props: { members, selectedIds } }).body;

    //Which column someone is in says whether they are invited, so both say how many they hold
    it('counts both columns in words', () => {
        const body = draw(['bob']);
        expect(body).toContain('Members (2)');
        expect(body).toContain('Invited (1)');
    });

    //The name alone does not say which way a press sends them
    it('names each chip for what pressing it does', () => {
        const body = draw(['bob']);
        expect(body).toContain('aria-label="Add ANN"');
        expect(body).toContain('aria-label="Remove BOB"');
        expect(body).not.toContain('title=');
    });

    //The placeholder goes the moment anyone types, and some readers never say it at all
    it('names the search box', () => {
        expect(draw([])).toMatch(/<label class="offscreen" for="([^"]+)-search">Search members<\/label>\s*<input id="\1-search"/);
    });

    it('names each list by the head over it', () => {
        const body = draw(['bob']);
        expect(body).toMatch(/<span id="([^"]+)-pool">Members \(2\)<\/span>[\s\S]*<ul class="list" aria-labelledby="\1-pool"/);
        expect(body).toMatch(/<span id="([^"]+)-chosen">Invited \(1\)<\/span>[\s\S]*<ul class="list drop" aria-labelledby="\1-chosen"/);
    });

    //The create form's second one, for who else runs the plan, where "Add" and "Invited" would say the wrong thing
    describe('given words of its own', () => {
        const body = render(MemberPicker, {
            props: {
                members,
                selectedIds: ['bob'],
                chosenHead: 'Running it with you',
                addName: (name: string) => `Have ${name} run it too`,
                removeName: (name: string) => `Stop ${name} running it`,
                bulk: false
            }
        }).body;

        it('heads the picked column with them, and still counts it', () => {
            expect(body).toMatch(/<span id="([^"]+)-chosen">Running it with you \(1\)<\/span>[\s\S]*<ul class="list drop" aria-labelledby="\1-chosen"/);
            expect(body).not.toContain('Invited');
        });

        it('names each chip with them', () => {
            expect(body).toContain('aria-label="Have ANN run it too"');
            expect(body).toContain('aria-label="Stop BOB running it"');
        });

        //Nobody hands a whole server the running of a plan
        it('has no Add all or Clear', () => {
            expect(body).not.toContain('Add all');
            expect(body).not.toContain('Clear');
            expect(draw(['bob'])).toContain('Add all');
        });
    });

    //Whoever made a plan runs it until they say otherwise, which nobody else can say for them
    it('draws someone who stays picked as no button, with why', () => {
        const body = render(MemberPicker, { props: { members, selectedIds: ['bob', 'cat'], locked: ['bob'], lockedName: 'made the plan' } }).body;
        expect(body).not.toContain('aria-label="Remove BOB"');
        expect(body).toMatch(/<span class="chip selected fixed">[\s\S]*?BOB[\s\S]*?made the plan<\/span>/);
        expect(body).toContain('aria-label="Remove CAT"');
    });
});

describe('the review before an edit is saved', () => {
    const review: EditPreview = {
        changes: [
            { type: 'name', from: 'Pub quiz', to: 'Quiz night' },
            { type: 'day', from: '2026-10-10', date: '2026-10-17', time: '19:00' },
            { type: 'removed', names: ['Jo'] }
        ],
        settled: 0,
        asked: 5,
        messages: [
            { kind: 'post', to: 'thread', text: "**CHANGED**\n\nAli changed **Pub quiz**:\n- now called **Quiz night**\n- it's on Sat 17 Oct 2026 at 7pm now" },
            { kind: 'card', to: ['Ann', 'Bo'], text: "Ali changed **Pub quiz**:\n- now called **Quiz night**\n- it's on Sat 17 Oct 2026 at 7pm now" },
            { kind: 'took off', to: ['Jo'], text: 'Ali took you off "Pub quiz" in The server.' }
        ],
        quietly: [{ name: 'Ann', why: 'cleared' }]
    };
    const body = render(EditReview, { props: { review, onsave: () => {}, onback: () => {} } }).body;

    it('lists what the save changes', () => {
        expect(body).toContain('Name: Quiz night, was Pub quiz');
        expect(body).toContain('Moved to Sat 17 Oct 2026 at 7pm, from Sat 10 Oct 2026: 5 will be asked');
        expect(body).toContain('Taking Jo off');
    });

    //The post and the line on top of each card say the same thing, so it is drawn once
    it('shows the thread post once, with everyone it reaches by DM, as Discord draws it', () => {
        expect(body).toContain('In the thread, and on top of the DM to Ann and Bo:');
        expect(body.match(/now called/g)).toHaveLength(1);
        expect(body.replace(/<!--[^>]*-->/g, '')).toContain('<ul><li>now called <strong>Quiz night</strong></li>');
    });

    it('says what goes to someone taken off', () => {
        expect(body).toContain('To Jo:');
        expect(body).toContain('Ali took you off');
    });

    it('names the save for the biggest thing it does, and describes saving quietly by who still hears', () => {
        expect(body).toContain('Save and move it to Sat 17 Oct');
        const quiet = body.match(/aria-describedby="([^"]+)"[^>]*>\s*Save quietly/);
        expect(quiet).not.toBeNull();
        expect(body).toMatch(new RegExp(`id="${quiet![1]}">[^<]*Ann is still DMed, since the day they answered for has moved\\.`));
    });

    it('takes focus on a heading of its own', () => {
        expect(body).toContain('<h2 tabindex="-1">What this changes</h2>');
    });
});

describe('the date range', () => {
    it('groups the spans and the two dates under a legend', () => {
        const body = render(RangeField, { props: {} }).body;
        expect(body).toMatch(/^(<!--[^>]*-->)?<fieldset class="field"><legend class="group-label">Which dates should I ask about\?<\/legend>/);
        expect(body).not.toContain('role="group"');
    });
});

describe('the weekday picker', () => {
    it('says whether each day is on, since the colour is all that shows it', () => {
        const body = render(WeekdayPicker, { props: { dayOn: [true, false, true, true, true, true, true] } }).body;
        expect(body).toContain('aria-pressed="false">Mo</button>');
        expect(body).toContain('aria-pressed="true">Tu</button>');
    });

    //"Mo" is what shows, and still what is said first, so voice control finds it
    it('names each day in full', () => {
        const body = render(WeekdayPicker, { props: {} }).body;
        expect(body).toContain('aria-label="Monday"');
        expect(body).toContain('aria-label="Sunday"');
    });
});

describe('the miss slider', () => {
    const fourIn: Participant[] = ['a', 'b', 'c', 'd'].map((userId) => ({
        userId,
        displayName: userId,
        avatarUrl: '',
        confirmed: true,
        in: true,
        vote: null,
        voteReason: null,
        override: null,
        invited: true
    }));
    const draw = () =>
        render(DayCompare, {
            props: { planId: 'ab12cd34ef', start: '2026-08-01', end: '2026-08-14', participants: fourIn, totalParticipants: 4, timeZone: 'Europe/London', onsaved: async () => {} }
        }).body;

    //A name with the value in it changes every step, and some readers say the whole label again each time
    it('says its value as the value, not in its name', () => {
        const body = draw();
        expect(body).toContain('aria-valuetext="nobody"');
        expect(body).toContain('<strong aria-hidden="true">0</strong>');
    });

    //Each day shows its count and its hours, and tapping one says why it is dim
    it('explains nothing about the grid under it', () => {
        expect(draw()).not.toContain('Brighter means');
    });
});

describe('the nudge', () => {
    const waiting = ['ann', 'bo'].map((userId) => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: false,
        vote: null,
        voteReason: null,
        override: null,
        invited: true
    }));

    //The column above names them, so the button only says how many it reaches
    it('says how many it reaches and names nobody', () => {
        const body = render(RemindPanel, { props: { planId: 'ab12cd34ef', waiting } }).body;
        expect(body).toContain('Nudge the 2 still to answer');
        expect(body).not.toContain('Still out');
    });
});

describe('who has answered before there is a day', () => {
    const person = (userId: string, over: Partial<Participant> = {}): Participant => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: false,
        vote: null,
        voteReason: null,
        override: null,
        invited: true,
        ...over
    });
    const crowd = [
        person('ann', { in: true, standing: 'done', updatedAt: new Date(Date.now() - 2 * 86400000).toISOString() }),
        person('bo', { in: true, standing: 'days-left', daysLeft: 3 }),
        person('cy', { in: true, standing: 'no-dates', sentBack: { byName: 'Ali' } }),
        person('di', { in: null, standing: 'not-said', dmsClosed: true }),
        person('ed', { in: false, standing: 'out', inReason: 'Away' })
    ];
    const draw = (props: Record<string, unknown> = {}) =>
        bare(render(AnswerBoard, { props: { planId: 'ab12cd34ef', participants: crowd, onmoved: async () => {}, ...props } }).body);
    //Each column as far as the next one, and the names in it in the order they are drawn
    const columns = (body: string) => body.split('<div class="bcol">').slice(1);
    const namesIn = (column: string) => [...column.matchAll(/<(?:button|span) class="b(?:chip|static)"[^>]*>([A-Z]+)/g)].map((m) => m[1]);

    it('heads each of the three columns with how many are in it, and says so when one has nobody', () => {
        const body = draw({ participants: crowd.slice(0, 2) });
        expect(body).toContain('<h3>Answered every day (1)</h3>');
        expect(body).toContain('<h3>Still to answer (1)</h3>');
        expect(body).toMatch(/<h3>Can't make it \(0\)<\/h3>\s*<ul>\s*<li class="bempty">Nobody here\.<\/li><\/ul>/);
    });

    it('puts each standing in the right column, whoever has not said leading the ones still to answer', () => {
        const [answered, owed, out] = columns(draw());
        expect(answered).toContain('<h3>Answered every day (1)</h3>');
        expect(namesIn(answered)).toEqual(['ANN']);
        expect(owed).toContain('<h3>Still to answer (3)</h3>');
        expect(namesIn(owed)).toEqual(['DI', 'BO', 'CY']);
        expect(out).toContain("<h3>Can't make it (1)</h3>");
        expect(namesIn(out)).toEqual(['ED']);
    });

    it('says what each one still owes beside their name, then what the column cannot', () => {
        const body = draw();
        expect(body).toMatch(/>ANN\s+<span class="muted small">calendar updated 2 days ago<\/span>/);
        expect(body).toMatch(/>BO\s+<span class="muted small">3 days left<\/span>/);
        expect(body).toMatch(/>CY\s+<span class="muted small">no dates yet, moved back by Ali<\/span>/);
        expect(body).toMatch(/>DI\s+<span class="muted small">hasn't said if they're in, DMs closed, only reachable in the thread<\/span>/);
        expect(draw({ participants: [person('bo', { in: true, standing: 'days-left', daysLeft: 1 })] })).toContain('1 day left');
    });

    //One column holds both kinds now, so the line goes by the person and not by where they are listed
    it('says what asking again does to that person', () => {
        expect(askAside(crowd[3])).toBe("I'll DM them now. They can answer whenever they like.");
        for (const joined of crowd.slice(0, 3)) expect(askAside(joined)).toBe("I'll DM them now. Their calendar stops counting here until they save again.");
    });

    //They get no DMs at all, so there is nothing to ask, and only whoever runs the plan sees why
    it('gives someone who said no their reason and nothing to press', () => {
        const body = draw();
        expect(body).toMatch(/<span class="bstatic">ED\s+<span class="muted small">Away<\/span><\/span>/);
        expect(body.match(/class="bchip"/g)).toHaveLength(4);
    });

    it('offers nothing on a plan that was called off', () => {
        expect(draw({ readOnly: true })).not.toContain('bchip');
    });

    //With nothing else to do to them, the name itself is the way to their days
    it('leaves a name as the way to their days once nothing can be asked, for anyone whose days can be seen', () => {
        const body = draw({ readOnly: true, viewable: new Set(['ann']) });
        expect(body).toMatch(/<button class="bchip" data-user="ann" aria-haspopup="dialog">ANN/);
        expect(body.match(/class="bchip"/g)).toHaveLength(1);
        expect(body).not.toContain('aria-expanded');
    });

    //The press on a name already opens the row for whoever runs the plan, so their days are a button in it
    it('keeps a name opening its row for whoever runs the plan', () => {
        const body = draw({ viewable: new Set(['ann', 'bo', 'cy']) });
        expect(body.match(/aria-expanded="false"/g)).toHaveLength(4);
        expect(body).not.toContain('aria-haspopup');
    });

    it('nudges whoever still has to say or fill in days', () => {
        expect(owing(crowd).map((p) => p.userId)).toEqual(['bo', 'cy', 'di']);
    });

    it('reads an older backend by who filled in', () => {
        const old = [person('ann', { confirmed: true }), person('bo')];
        expect(owing(old).map((p) => p.userId)).toEqual(['bo']);
    });

    it('claims the DM only when it landed', () => {
        expect(askedLine('Ann', true)).toBe('Asked Ann again. I DMed them.');
        expect(askedLine('Ann', false)).toBe("Asked Ann again, but I couldn't DM them. They can still answer in the thread.");
    });

    it('says how long since a calendar was saved', () => {
        expect([0, 1, 5].map(updatedLine)).toEqual(['calendar updated today', 'calendar updated yesterday', 'calendar updated 5 days ago']);
        expect(updatedLine(null)).toBe('');
    });
});

//Svelte's markers for where a block starts and ends, which say nothing about what shows
const bare = (html: string) => html.replace(/<!--[^>]*-->/g, '');
//Both regions there and both empty
const silent = /<p class="[^"]*silent"[^>]*><span role="alert"><\/span><span role="status"><\/span><\/p>/;

describe('a status line', () => {
    const draw = (props: Record<string, unknown>) => bare(render(Status, { props: { class: 'status', ...props } }).body);

    it('reads an error out straight away', () => {
        const body = draw({ msg: 'That went wrong.', error: true });
        expect(body).toContain('<span role="alert">That went wrong.</span><span role="status"></span>');
        expect(body).toMatch(/class="status error"/);
    });

    it('reads a result out once the reader is free', () => {
        expect(draw({ msg: 'Saved.' })).toContain('<span role="alert"></span><span role="status">Saved.</span>');
    });

    it('is there with nothing to say, taking no room', () => {
        expect(draw({})).toMatch(silent);
    });

    //A failed submit sends focus here, and a field at fault points here for its description
    it('can take focus and be pointed at', () => {
        expect(draw({ id: 'form-error' })).toMatch(/<p class="status silent" id="form-error" tabindex="-1">/);
    });
});

describe('a field at fault', () => {
    it('is marked invalid and described by the error line', () => {
        expect(invalidIf(true, 'form-error')).toEqual({ 'aria-invalid': true, 'aria-describedby': 'form-error' });
    });

    it('carries nothing once it is not', () => {
        expect(invalidIf(false, 'form-error')).toEqual({});
    });

    it('marks only the date the range error is about', () => {
        const body = render(RangeField, { props: { fault: 'end', errorId: 'form-error' } }).body;
        expect(body).toMatch(/<input id="end"[^>]*aria-invalid="true" aria-describedby="form-error"/);
        expect(body).not.toMatch(/<input id="start"[^>]*aria-invalid/);
    });
});

//A live region that arrives with its text already in it often goes unread, so each is there first
describe('the status line on each panel', () => {
    const planId = 'ab12cd34ef';
    const done = async () => {};
    const panels: [string, () => string][] = [
        ['the board', () => render(AttendanceBoard, { props: { planId, chosenDate: '2026-08-12', onmoved: done } }).body],
        ['calling it off', () => render(CancelPanel, { props: { planId, oncancelled: () => {} } }).body],
        ['the picked day', () => render(PickPanel, { props: { planId, selectedDate: '2026-08-12', onsaved: done } }).body],
        ['the nudge', () => render(RemindPanel, { props: { planId } }).body],
        ['the repair', () => render(RepairPanel, { props: { planId } }).body],
        ['taking it on', () => render(TakeOn, { props: { planId, ontaken: done } }).body]
    ];

    it.each(panels)('%s', (_, draw) => {
        expect(bare(draw())).toMatch(silent);
    });
});

//Picking a day on the grid leaves focus on the grid, so the panel's first line is read out from there
describe('the line a picked day opens with', () => {
    const draw = (selectedDate: string | null) =>
        bare(
            render(PickPanel, {
                props: {
                    planId: 'ab12cd34ef',
                    selectedDate,
                    inCount: 1,
                    totalParticipants: 1,
                    freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] },
                    onsaved: async () => {}
                }
            }).body
        );

    it('is being watched before any day is picked', () => {
        const body = draw(null);
        expect(body).toMatch(silent);
        expect(body).not.toContain('pick-panel');
    });
});

describe('the front door', () => {
    //A move from another page sends focus to the h1, so it cannot wait for the plans
    it('names the page while the plans are still loading', () => {
        auth.loaded = true;
        auth.user = { id: 'u1', username: 'ann', displayName: 'Ann', avatar: '' };
        try {
            expect(bare(render(Home).body)).toMatch(/<h1>My plans<\/h1>\s*<p class="muted">Loading your plans\.\.\.<\/p>/);
        } finally {
            auth.loaded = false;
            auth.user = null;
        }
    });
});

//What the legal pages promise has to be what the site does
describe('the terms', () => {
    const body = render(Terms).body;

    it('never says a planner can take someone off a plan', () => {
        expect(body).not.toMatch(/remove you/i);
    });

    it("says being left off a day's list keeps you on the plan", () => {
        expect(body).toMatch(/leave you off that day's list/);
        expect(body).toMatch(/you stay on the plan/);
    });

    it('says dropping out tells whoever runs the plan', () => {
        expect(body).toMatch(/Whoever runs the plan gets a DM saying you did/);
    });

    it('speaks as we rather than as the Service', () => {
        expect(body).not.toContain('the Service');
    });
});

describe('the privacy policy', () => {
    const body = render(Privacy).body;

    it('names the time zone it keeps', () => {
        expect(body).toMatch(/<strong>Your time zone:<\/strong> the one your browser reports/);
    });

    it("keeps a plan's history and the DMs it can rewrite on the list", () => {
        expect(body).toMatch(/last 100 events/);
        expect(body).toMatch(/<strong>The bot's DMs:<\/strong>/);
    });

    it('keeps the answers for the last three days a plan has been on', () => {
        expect(body).toMatch(/kept for the last three days the plan has\s+been on/);
    });

    it('keeps whether your DMs were closed, and says who sees it', () => {
        expect(body).toMatch(/whether your DMs were closed the last time it\s+tried, so the overview can show whoever runs the plan/);
    });

    it('says who can see your days: whoever runs the plan, and its guests with no reasons', () => {
        expect(body).toMatch(/<h2>Who can see your days<\/h2>\s*<p>\s*Whoever runs a plan sees the most/);
        expect(body).toMatch(/the planner who made it, and anyone in the server they\s+picked to run it with them/);
        expect(body).toMatch(/Having the planner role doesn't let anyone into a plan they aren't on/);
        expect(body).toMatch(/Everyone else on the plan can open its overview too/);
        expect(body).toMatch(/They never see a reason/);
    });

    it('says who else can end up running a plan, and that it shows', () => {
        expect(body).toMatch(/A planner can\s+once nobody who runs it is left in the server/);
        expect(body).toMatch(/someone who can manage the server can at any\s+time/);
        expect(body).toMatch(/It goes in the plan's history/);
    });

    //People on those answered expecting only the planner to see
    it('says a plan from before guests could see days keeps the names off them', () => {
        expect(body).toMatch(/A plan made\s+before guests could see that stays as it was/);
        expect(body).toMatch(/and nobody's name/);
    });

    it('says the bot DMs the people on a plan', () => {
        expect(body).toMatch(/DMs the people invited to a plan/);
    });

    it('says a deleted thread or channel takes its plan with it', () => {
        expect(body).toMatch(/A plan is deleted when its thread is deleted,\s+or the channel holding its thread is/);
    });

    it('says what is left once you share no server with the bot', () => {
        expect(body).toMatch(/cut down to\s+your Discord ID and the logout number/);
    });

    it('uses the words the rest of the site does', () => {
        expect(body).toMatch(/who has\s+filled in their dates/);
        expect(body).not.toContain('confirmed');
        expect(body).not.toContain('the Service');
    });
});

//What a save names as now answered, each one a way to its page
describe('a list of plans', () => {
    const link = (planId: string) => ({ planId, name: planId.toUpperCase() });
    const draw = (ids: string[]) => render(PlanList, { props: { plans: ids.map(link) } }).body.replace(/<!--[^>]*-->/g, '');

    it('reads as a sentence however many there are', () => {
        expect(draw(['a'])).toBe('<a href="#/plan/a">A</a>');
        expect(draw(['a', 'b'])).toBe('<a href="#/plan/a">A</a> and <a href="#/plan/b">B</a>');
        expect(draw(['a', 'b', 'c'])).toBe('<a href="#/plan/a">A</a>, <a href="#/plan/b">B</a> and <a href="#/plan/c">C</a>');
    });
});

//Old DMs and My plans both link a set plan to the page that asks for dates, which has none left to ask for
describe('the page of a plan that has its day', () => {
    const page = (status: string, role?: 'host' | 'guest') => ({ plan: { status }, role }) as PlanScreen;

    it('hands over to the overview, for a guest and for whoever runs it', () => {
        expect(belongsOnOverview(page('closed', 'guest'))).toBe(true);
        expect(belongsOnOverview(page('closed', 'host'))).toBe(true);
    });

    it('stays where it is while the plan is finding its day, or was called off', () => {
        expect(belongsOnOverview(page('collecting', 'guest'))).toBe(false);
        expect(belongsOnOverview(page('cancelled', 'guest'))).toBe(false);
    });
});

//The line under a plan's name: what kind of plan it is, and where it has got to
describe('the state of a plan', () => {
    const plan = (over: Partial<ComparePlan> = {}) =>
        ({ status: 'collecting', start: '2026-08-05', end: '2026-08-19', chosenDate: null, chosenTime: null, ...over }) as ComparePlan;
    const set = { status: 'closed' as const, chosenDate: '2026-08-12', chosenTime: '19:00' };

    it('says a plan is still finding its day, and between when', () => {
        expect(planState(plan(), '2026-08-01')).toBe('Finding a day, Wed 5 Aug 2026 to Wed 19 Aug 2026');
        expect(planState(plan(), '2026-08-19')).toBe('Finding a day, Wed 5 Aug 2026 to Wed 19 Aug 2026');
    });

    //It is still a live plan: whoever runs it can ask about new dates
    it('says when every day it asked about has gone', () => {
        expect(planState(plan(), '2026-08-20')).toBe('The dates it asked about have passed');
        //Weekends only, and Sun 16 is the last one before the window ends on Wed 19
        expect(planState(plan({ allowedWeekdays: [0, 6] }), '2026-08-17')).toBe('The dates it asked about have passed');
    });

    it('says the day a plan is set for, with its time when it has one', () => {
        expect(planState(plan(set), '2026-08-01')).toBe('Set for Wed 12 Aug 2026 at 7pm');
        expect(planState(plan({ ...set, chosenTime: null }), '2026-08-12')).toBe('Set for Wed 12 Aug 2026');
    });

    it('says a day that has been in the past tense', () => {
        expect(planState(plan(set), '2026-08-13')).toBe('Was on Wed 12 Aug 2026 at 7pm');
    });

    it('says a plan was called off, and what day it had if it had one', () => {
        expect(planState(plan({ status: 'cancelled' }), '2026-08-01')).toBe('Called off');
        expect(planState(plan({ ...set, status: 'cancelled' }), '2026-08-01')).toBe('Called off. It was set for Wed 12 Aug 2026 at 7pm');
    });
});

/*
    The overview as each kind of person gets it. Whoever runs the plan gets the panels that
    change it. A guest gets the same picture to read and nothing to press, and is shown no
    reason even if one were sent.
*/
describe('a plan overview', () => {
    const ahead = (days: number) => isoFromNow(days, 'day');
    const person = (userId: string, over: Partial<Participant> = {}): Participant => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: false,
        vote: null,
        voteReason: null,
        override: null,
        invited: true,
        ...over
    });
    const crowd = [
        person('ann', { in: true, standing: 'done' }),
        person('bo', { in: true, standing: 'days-left', daysLeft: 3, sentBack: { byName: 'Ali' }, dmsClosed: true }),
        person('flo', { in: false, standing: 'out', inReason: 'Away that week' })
    ];
    const screen = (over: Partial<CompareScreen> = {}, plan: Partial<ComparePlan> = {}): CompareScreen => ({
        plan: {
            planId: 'ab12cd34ef',
            name: 'Bowling',
            description: 'Bring socks',
            start: ahead(3),
            end: ahead(10),
            status: 'collecting',
            allowedWeekdays: null,
            guildName: 'The server',
            chosenDate: null,
            chosenTime: null,
            chosenNote: null,
            timeZone: 'America/New_York',
            guildId: 'g1',
            probeActive: false,
            repeatWeeks: null,
            repeatedFrom: null,
            repeatedInto: null,
            threadUrl: 'https://discord.com/channels/g1/t1',
            ...plan
        },
        role: 'host',
        hosts: ['Ali', 'Sam'],
        canTakeOn: false,
        isPlanner: true,
        seesDays: true,
        participants: crowd,
        youAreIn: true,
        you: { vote: null, invited: true },
        confirmedCount: 1,
        totalParticipants: 3,
        freeByDate: {},
        history: [{ type: 'created', at: new Date().toISOString(), by: 'ali', byName: 'Ali' }],
        ...over
    });
    const set: Partial<ComparePlan> = { status: 'closed', chosenDate: ahead(4), chosenTime: '19:00', probeActive: true };
    const voters = [
        person('ann', { vote: 'yes' }),
        person('bo', { vote: 'no', voteReason: 'Working late' }),
        person('cy', { vote: 'no', override: 'yes' }),
        person('di', { invited: false })
    ];
    const draw = (data: CompareScreen) => {
        //The plan's own clock, so no line about the reader's gets in the way
        device.zone = 'America/New_York';
        return bare(render(PlanOverview, { props: { planId: 'ab12cd34ef', data, onrefresh: async () => {} } }).body);
    };
    const guest = { role: 'guest' as const, isPlanner: false };

    it('says what kind of plan it is and where it has got to, then who runs it', () => {
        const body = draw(screen());
        expect(body).toContain(`<p class="muted">Finding a day, ${formatDate(ahead(3))} to ${formatDate(ahead(10))} · The server</p>`);
        expect(body).toContain('Run by Ali and Sam.');
    });

    //Nothing offers a day that has already gone, and every day of this one has
    it('says when the dates it asked about have passed, and stops offering them to fill in', () => {
        const body = draw(screen({}, { start: ahead(-10), end: ahead(-3) }));
        expect(body).toContain('<p class="muted">The dates it asked about have passed · The server</p>');
        expect(body).not.toContain('Fill in your own dates');
        expect(draw(screen())).toContain('Fill in your own dates');
    });

    describe('coming round again', () => {
        const repeating = { ...set, repeatWeeks: 2, repeatBy: 'Ali' };

        it('says how often, who set it, and when the next one is, with where it lands drawn', () => {
            const body = draw(screen({}, repeating));
            expect(body).toContain('<h2>Comes round again</h2>');
            expect(body).toContain(`Every other week, set by Ali. Next one ${formatDate(ahead(18))}, made once this day has been.`);
            expect(body).toContain('class="rcal"');
        });

        it('is the same for a guest', () => {
            expect(draw(screen({ role: 'guest' }, repeating))).toContain('Comes round again');
        });

        it('says nothing once the plan is over, or for a one off', () => {
            expect(draw(screen({}, { ...repeating, chosenDate: ahead(-2) }))).not.toContain('Comes round again');
            expect(draw(screen({}, { ...repeating, status: 'cancelled' }))).not.toContain('Comes round again');
            expect(draw(screen({}, set))).not.toContain('Comes round again');
        });

        //Nothing is made until it has a day, so there is no date to give or calendar to draw
        it('waits for a day on a plan still finding one', () => {
            const body = draw(screen({}, { repeatWeeks: 2, repeatBy: 'Ali' }));
            expect(body).toContain('Every other week, set by Ali, once it has a day.');
            expect(body).not.toContain('class="rcal"');
        });

        //A repeat turned on before anyone was written down as setting it
        it('names nobody it has no name for', () => {
            expect(repeatLine({ ...screen({}, { ...set, repeatWeeks: 1 }).plan }, [])).toBe(
                'Every week. Nothing follows this one, since the next would land past the two years anything here reaches.'
            );
        });
    });

    //The one thing everyone came for, so it keeps the box it had
    it('puts a day still to come in the box', () => {
        expect(draw(screen({}, set))).toMatch(new RegExp(`<div class="prompt good"><p>Set for ${formatDate(ahead(4))} at 7pm · The server</p>`));
    });

    it('gives whoever runs it the ways to change it', () => {
        const body = draw(screen());
        expect(body).toContain('<a class="ghost" href="#/plan/ab12cd34ef/edit">Edit plan</a>');
        expect(body).toContain('Call it off</button>');
        expect(body).toContain('Something missing in Discord?');
        expect(body).toContain('Nudge the 1 still to answer');
        expect(body).toContain('Plan another like this');
        expect(body).toContain('Away that week');
    });

    describe('for a guest', () => {
        it('has no reasons, no Edit plan and no Call it off', () => {
            const body = draw(screen(guest));
            expect(body).not.toContain('Away that week');
            expect(body).not.toContain('Edit plan');
            expect(body).not.toContain('Call it off');
        });

        it('has nothing else a host works from, and nothing that changes anyone', () => {
            const body = draw(screen(guest));
            for (const gone of ['Quiet', 'Nudge', 'aria-expanded', 'Ask again', 'moved back by', 'DMs closed', 'Plan another like this', 'Something missing in Discord']) {
                expect(body).not.toContain(gone);
            }
        });

        //The only thing a guest can press on anyone, and only on someone whose days they are sent
        it('can look at the days of anyone who is in, by their name', () => {
            const body = draw(screen(guest));
            expect(body).toMatch(/<button class="bchip" data-user="ann" aria-haspopup="dialog">ANN\s*<\/button>/);
            expect(body).toMatch(/<button class="bchip" data-user="bo" aria-haspopup="dialog">BO\s+<span class="muted small">3 days left<\/span><\/button>/);
            expect(body).toMatch(/<span class="bstatic">FLO\s*<\/span>/);
        });

        it('is given nobody to look at on a plan from before guests could see days', () => {
            expect(draw(screen({ ...guest, seesDays: false }))).not.toContain('bchip');
        });

        it('still has who runs it, where everyone stands, the days, the thread and their own dates', () => {
            const body = draw(screen(guest));
            expect(body).toContain('Run by Ali and Sam.');
            expect(body).toContain('<h2>Who has answered</h2>');
            expect(body).toContain('<h3>Still to answer (1)</h3>');
            expect(body).toMatch(/BO\s+<span class="muted small">3 days left<\/span>/);
            expect(body).toContain("<h2>Everyone's days</h2>");
            expect(body).toContain('Open the thread in Discord');
            expect(body).toContain('Fill in your own dates');
            expect(body).toContain('What has happened');
        });

        it('offers another plan like it only to one who could start it', () => {
            expect(draw(screen({ ...guest, isPlanner: true }))).toContain('Plan another like this');
        });

        //Once there is a day there are no dates left to fill in
        it('reads the board on a set day, with nobody to move and nobody listed as left off', () => {
            const body = draw(screen({ ...guest, participants: voters, you: { vote: null, invited: true } }, set));
            expect(body).toContain('<h2>Where it stands</h2>');
            expect(body).toContain('<h3>Coming (2)</h3>');
            expect(body).toContain("<h3>Can't make it (1)</h3>");
            for (const gone of ['bchip', 'Working late', '(said', 'Not invited to this date', 'Invite them', 'Fill in your own dates', "Everyone's days"]) {
                expect(body).not.toContain(gone);
            }
        });

        //People on those answered expecting only the planner to see, so a day has its counts and no list under it
        it('gets the grid with nothing under a day on a plan from before guests could see days', () => {
            const day = ahead(5);
            const old = screen({
                ...guest,
                seesDays: false,
                participants: [person('ann', { in: true }), person('bo', { in: true }), person('cy', { in: true })],
                freeByDate: { [day]: [{ userId: 'free0', hours: [] }, { userId: 'free1', hours: [] }] },
                unansweredCounts: { [day]: 1 }
            });
            const body = draw(old);
            expect(body).toContain(`${formatLong(day)}: 2 of 2 free, 24h in common, 1 hasn't answered it`);

            //The panel under the grid is there before a day is picked, waiting to read it out, so it is counted by its line
            const lines = (html: string) => (html.match(/role="status"/g) || []).length;
            expect(lines(body)).toBe(lines(draw({ ...old, seesDays: true })) - 1);
        });
    });

    //The board is for moving other people. Their own word is given here, by guests and by whoever runs it alike.
    describe('their own answer', () => {
        it('is asked of anyone on the list of a day still to come', () => {
            expect(draw(screen({ ...guest, participants: voters }, set))).toContain('Can you make it?');
            expect(draw(screen({ participants: voters, you: { vote: 'yes', invited: true } }, set))).toContain("You're down as coming.");
        });

        it('is not asked while the plan is finding its day, once it is over, or of someone who is not a guest', () => {
            for (const quiet of [
                screen(guest),
                screen({ ...guest, participants: voters }, { ...set, chosenDate: ahead(-2) }),
                screen({ ...guest, participants: voters }, { ...set, status: 'cancelled' }),
                screen({ participants: voters, youAreIn: false, you: null }, set)
            ]) {
                const body = draw(quiet);
                expect(body).not.toContain('Can you make it?');
                expect(body).not.toContain('Leave this plan');
            }
        });
    });

    describe('once it is over', () => {
        const been: Partial<ComparePlan> = { ...set, chosenDate: ahead(-2) };

        it('leaves whoever ran it everything to read and nothing to change', () => {
            const body = draw(screen({ participants: voters }, been));
            expect(body).toContain(`<p class="muted">Was on ${formatDate(ahead(-2))} at 7pm · The server</p>`);
            for (const gone of ['Edit plan', 'Call it off', 'Nudge', 'bchip', 'Invite them', 'Something missing in Discord']) expect(body).not.toContain(gone);
            expect(body).toContain('(Working late)');
            expect(body).toContain('<h3>Not invited to this date (1)</h3>');
            expect(body).toContain('Plan another like this');
            expect(body).toContain('Deleting its thread in Discord clears it for good.');
        });

        it('says how a plan that was called off gets cleared, to whoever ran it', () => {
            const off = screen({}, { status: 'cancelled' });
            expect(draw(off)).toContain('<p class="muted">Called off · The server</p>');
            expect(draw(off)).toContain('Deleting its thread in Discord clears it for good.');
            expect(draw(off)).not.toContain('Call it off');
            expect(draw(screen(guest, { status: 'cancelled' }))).not.toContain('Deleting its thread');
        });
    });

    describe('taking it on', () => {
        const orphaned = { ...guest, isPlanner: true, hosts: [], canTakeOn: true };

        it('is offered where it says nobody is left running the plan', () => {
            const body = draw(screen(orphaned));
            expect(body).toMatch(/Nobody who runs this is still in the server\.\s*<\/p>\s*<div class="takeon"><button class="ghost">Take it on<\/button>/);
        });

        it('is not offered to someone who cannot, or on a plan that is over', () => {
            expect(draw(screen({ ...orphaned, canTakeOn: false }))).not.toContain('Take it on');
            expect(draw(screen(orphaned, { status: 'cancelled' }))).not.toContain('Take it on');
        });
    });

    //For the few minutes a deploy takes, when the answer comes from a backend that only ever answered planners
    it('reads an answer with no role in it as one for whoever runs the plan', () => {
        const { role, hosts, canTakeOn, isPlanner, seesDays, you, ...old } = screen();
        void [role, hosts, canTakeOn, isPlanner, seesDays, you];
        const body = draw(old);
        expect(body).toContain('>Edit plan</a>');
        expect(body).toContain('Plan another like this');
        expect(body).not.toContain('Run by');
        expect(body).not.toContain('Nobody who runs this');
    });
});

//The overview's side of the buttons on a DM, for anyone on a set day's list
describe('your own answer for a set day', () => {
    const draw = (props: Record<string, unknown> = {}) =>
        bare(render(YourAnswer, { props: { planId: 'ab12cd34ef', onanswered: async () => {}, onleft: () => {}, ...props } }).body);

    it('asks, with both answers to give', () => {
        const body = draw();
        expect(body).toContain('Can you make it?');
        expect(body).toMatch(/<button class="primary">I'm coming<\/button>/);
        expect(body).toMatch(/<button class="ghost danger-btn">Can't make it<\/button>/);
    });

    it('says where they stand once they have answered, and offers the other answer', () => {
        const yes = draw({ vote: 'yes' });
        expect(yes).toContain("You're down as coming.");
        expect(yes).not.toContain("I'm coming</button>");
        expect(yes).toContain("Can't make it</button>");

        const no = draw({ vote: 'no' });
        expect(no).toContain("You're down as not coming.");
        expect(no).toContain("I'm coming</button>");
        expect(no).not.toContain("Can't make it</button>");
    });

    it('asks nothing of someone left off the day', () => {
        const body = draw({ invited: false });
        expect(body).toContain('You are not on the list for this day.');
        expect(body).not.toContain('Can you make it?');
        expect(body).not.toContain("I'm coming");
    });

    //Smaller than the answers, since it takes them off the plan rather than answering for one day
    it('offers a way off the plan altogether, whether or not they are on the day', () => {
        expect(draw()).toContain('<button class="link-btn">Leave this plan</button>');
        expect(draw({ invited: false })).toContain('<button class="link-btn">Leave this plan</button>');
    });

    it('has a line waiting for each thing that can go wrong', () => {
        expect(draw().match(/role="alert"/g)).toHaveLength(2);
    });
});

describe('the day picked, for a guest', () => {
    const body = bare(
        render(PickPanel, {
            props: {
                planId: 'ab12cd34ef',
                selectedDate: '2026-08-12',
                inCount: 2,
                totalParticipants: 2,
                guest: true,
                participants: ['ann', 'bo'].map((userId) => ({
                    userId,
                    displayName: userId.toUpperCase(),
                    avatarUrl: '',
                    confirmed: true,
                    in: true,
                    vote: null,
                    voteReason: null,
                    override: null,
                    invited: true
                })),
                freeByDate: { '2026-08-12': [{ userId: 'ann', hours: [17, 18, 19] }] },
                onsaved: async () => {}
            }
        }).body
    );

    it('says who is free and who is not', () => {
        expect(body).toContain('<strong>Wed 12 Aug 2026</strong>');
        expect(body).toContain('ANN: 5pm to 8pm');
        expect(body).toContain('Not free on this day: BO.');
    });

    it('stops before the time, since setting the day is for whoever runs the plan', () => {
        for (const gone of ['Time (optional)', 'Who is still invited?', 'Set it to', 'pings', '<button']) expect(body).not.toContain(gone);
    });
});

describe('the board, read rather than worked', () => {
    const person = (userId: string, over: Partial<Participant> = {}): Participant => ({
        userId,
        displayName: userId.toUpperCase(),
        avatarUrl: '',
        confirmed: true,
        vote: null,
        voteReason: null,
        override: null,
        invited: true,
        ...over
    });
    const people = [
        person('a', { vote: 'no', voteReason: 'Working late' }),
        person('b', { vote: 'yes', override: 'no', dmsClosed: true }),
        person('c', { sentBack: { byName: 'Ali' } }),
        person('d', { in: false, inReason: 'Away' }),
        person('e', { invited: false })
    ];
    const draw = (props: Record<string, unknown>) =>
        bare(render(AttendanceBoard, { props: { planId: 'ab12cd34ef', chosenDate: '2026-08-12', participants: people, onmoved: async () => {}, ...props } }).body);

    //Even with everything a host is sent in hand, which a guest never is
    it('shows a guest each person in their column and nothing beside the name', () => {
        const body = draw({ host: false });
        expect(body).toContain("<h3>Can't make it (3)</h3>");
        expect(body.match(/<span class="bstatic">/g)).toHaveLength(4);
        for (const gone of ['<button', 'Working late', 'Away', '(said', 'moved back', 'DMs closed', 'Not invited to this date']) {
            expect(body).not.toContain(gone);
        }
    });

    it('shows whoever ran a plan that is over all of it, with nothing to press', () => {
        const body = draw({ readOnly: true });
        expect(body).not.toContain('<button');
        expect(body).toContain('(Working late)');
        expect(body).toContain('(said coming)');
        expect(body).toContain('(moved back by Ali)');
        expect(body).toMatch(/<li class="plain"><span>E\s*<\/span>\s*<\/li>/);
    });
});

describe('who has answered, for a guest', () => {
    const body = bare(
        render(AnswerBoard, {
            props: {
                planId: 'ab12cd34ef',
                host: false,
                onmoved: async () => {},
                participants: [
                    { userId: 'bo', displayName: 'BO', avatarUrl: '', confirmed: false, vote: null, voteReason: null, override: null, invited: true, in: true, standing: 'days-left', daysLeft: 3, dmsClosed: true, sentBack: { byName: 'Ali' }, updatedAt: new Date().toISOString() },
                    { userId: 'di', displayName: 'DI', avatarUrl: '', confirmed: false, vote: null, voteReason: null, override: null, invited: true, in: null, standing: 'not-said', dmsClosed: true },
                    { userId: 'ed', displayName: 'ED', avatarUrl: '', confirmed: false, vote: null, voteReason: null, override: null, invited: true, in: false, standing: 'out', inReason: 'Away' }
                ]
            }
        }).body
    );

    it('has what someone still owes and nothing else beside a name', () => {
        expect(body).toMatch(/<span class="bstatic">BO\s+<span class="muted small">3 days left<\/span><\/span>/);
        expect(body).toMatch(/<span class="bstatic">DI\s+<span class="muted small">hasn't said if they're in<\/span><\/span>/);
        for (const gone of ['Away', 'moved back', 'DMs closed', 'calendar updated', 'bchip']) expect(body).not.toContain(gone);
    });
});

/*
    The quick view: one person's days on a plan still finding its day, read off what the
    overview was already sent. Bo has answered the first four days and is free on two.
*/
describe("someone's days", () => {
    const today = '2026-08-10';
    //Mon 10 to Sun 16 Aug 2026
    const asked = { start: '2026-08-10', end: '2026-08-16', allowedWeekdays: null };
    const bo: Participant = {
        userId: 'bo',
        displayName: 'BO',
        avatarUrl: '',
        confirmed: true,
        vote: null,
        voteReason: null,
        override: null,
        invited: true,
        in: true,
        standing: 'days-left',
        daysLeft: 3,
        unanswered: [['2026-08-14', '2026-08-16']]
    };
    const freeByDate: Record<string, FreePerson[]> = {
        '2026-08-11': [{ userId: 'ann', hours: [] }, { userId: 'bo', hours: [17, 18, 19, 20, 21] }],
        '2026-08-12': [{ userId: 'bo', hours: [] }],
        '2026-08-13': [{ userId: 'ann', hours: [] }]
    };
    const week = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];

    it('are the days they are free on with their hours, and the days their answer has not reached', () => {
        expect(daysOf(bo, freeByDate, asked, today)).toEqual({
            free: { '2026-08-11': [17, 18, 19, 20, 21], '2026-08-12': [] },
            left: ['2026-08-14', '2026-08-15', '2026-08-16'],
            days: week
        });
    });

    it('count from today, and keep to the weekdays a pinned plan asks about', () => {
        const weekends = { ...asked, start: '2026-08-01', end: '2026-08-31', allowedWeekdays: [0, 6] };
        const view = daysOf({ ...bo, unanswered: [['2026-08-22', '2026-08-30']] }, {}, weekends, today);
        expect(view.days).toEqual(['2026-08-15', '2026-08-16', '2026-08-22', '2026-08-23', '2026-08-29', '2026-08-30']);
        expect(view.left).toEqual(['2026-08-22', '2026-08-23', '2026-08-29', '2026-08-30']);
    });

    describe('in a line', () => {
        const free = { '2026-08-11': [], '2026-08-12': [] };

        it('say how many days they are free on once every day is answered', () => {
            expect(daysLine(week, [], free)).toBe('Free on 2 of the 7 days.');
            expect(daysLine(week, [], {})).toBe('Not free on any of the 7 days.');
            expect(daysLine(['2026-08-12'], [], free)).toBe('Free that day.');
            expect(daysLine(['2026-08-10'], [], free)).toBe('Not free that day.');
        });

        it('say where their answer stops when it stops part way', () => {
            expect(daysLine(week, week.slice(4), free)).toBe('Answered up to Thu 13 Aug, with 3 days after that still to answer.');
            expect(daysLine(week, week.slice(6), free)).toBe('Answered up to Sat 15 Aug, with 1 day after that still to answer.');
            //Nothing answered at the front, so there is no day it runs up to
            expect(daysLine(week, week.slice(0, 2), free)).toBe('2 days of the 7 still to answer.');
        });

        it('say when no day is answered yet', () => {
            expect(daysLine(week, week, free)).toBe('Still to answer all 7 days.');
            expect(daysLine(['2026-08-12'], ['2026-08-12'], {})).toBe('Still to answer that day.');
        });

        it('say nothing once every day it asked about has gone', () => {
            expect(daysLine([], [], free)).toBe('');
        });
    });

    //The calendar is hidden from a screen reader, so this is the only way one gets the days
    it('are said in words too, in runs, with the hours of a day narrowed down', () => {
        const view = daysOf(bo, freeByDate, asked, today);
        expect(daysSpoken(view.days, view.left, view.free)).toBe('Free: Tue 11 Aug, 5pm to 10pm; Wed 12 Aug. Still to answer: Fri 14 Aug to Sun 16 Aug.');
        expect(daysSpoken(week, [], { '2026-08-11': [], '2026-08-12': [], '2026-08-13': [] })).toBe('Free: Tue 11 Aug to Thu 13 Aug.');
        expect(daysSpoken(week, [], {})).toBe('');
    });

    describe('drawn', () => {
        const body = bare(render(PersonDialog, { props: { person: bo, freeByDate, asked, today, onclose: () => {} } }).body);

        it('are a dialog named for the person, with a way to close it', () => {
            const [, id] = body.match(/<dialog class="person-card" aria-labelledby="([^"]+)">/)!;
            expect(body).toContain(`<h2 id="${id}">BO's days</h2>`);
            expect(body).toMatch(/<button class="close" aria-label="Close">/);
        });

        it('say where their answer has got to, on screen and in words for anyone who cannot see the calendar', () => {
            expect(body).toContain('<p class="muted small">Answered up to Thu 13 Aug, with 3 days after that still to answer.</p>');
            expect(body).toContain('<p class="offscreen">Free: Tue 11 Aug, 5pm to 10pm; Wed 12 Aug. Still to answer: Fri 14 Aug to Sun 16 Aug.</p>');
        });

        //Only one month to draw, so the card stays at one month's width
        it('keep the card to one month when the plan asks about one', () => {
            expect(body).not.toContain('person-card wide');
            const long = render(PersonDialog, { props: { person: bo, freeByDate, asked: { ...asked, end: '2026-09-02' }, today, onclose: () => {} } }).body;
            expect(long).toContain('class="person-card wide"');
        });
    });
});

//The same calendar people fill in, in someone's quick view, where nothing on it is theirs to change
describe('the fill-in grid, to look at', () => {
    const day = (n: number) => isoFromNow(n, 'day');
    const body = bare(
        render(DayGrid, {
            props: { start: day(0), end: day(4), readOnly: true, selection: { [day(1)]: [], [day(2)]: [17, 18, 19, 20, 21] }, toFill: [day(3), day(4)] }
        }).body
    );

    it('has nothing to press, and nothing about pressing', () => {
        expect(body).not.toContain('<button');
        expect(body).not.toContain('Arrow keys');
        expect(body).not.toContain('role="group"');
    });

    //Whatever draws it says the days in words, since a row of bare day numbers says nothing
    it('is kept from a screen reader', () => {
        expect(body).toMatch(/<div class="grid-wrap reading" aria-hidden="true">/);
    });

    it('fills the days they are free on and dashes the ones still to answer', () => {
        expect(body.match(/<span class="day free"/g)).toHaveLength(2);
        expect(body.match(/<span class="day is-new"/g)).toHaveLength(2);
    });

    it('says the hours of a day narrowed down, and puts no clock on a day free all of it', () => {
        const clocks = [...body.matchAll(/<span class="clock">([\s\S]*?)<\/span>/g)].map((m) => m[1].replace(/<svg[\s\S]*?<\/svg>/, '').trim());
        expect(clocks).toEqual(['5h']);
    });
});

describe('a few names', () => {
    it('read the way they are said', () => {
        expect(listNames(['Ali'])).toBe('Ali');
        expect(listNames(['Ali', 'Sam'])).toBe('Ali and Sam');
        expect(listNames(['Ali', 'Sam', 'Jo'])).toBe('Ali, Sam and Jo');
        expect(listNames([])).toBe('');
    });
});
