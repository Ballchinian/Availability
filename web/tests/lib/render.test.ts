import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import ClockNote from '../../src/lib/ClockNote.svelte';
import PickPanel, { invitees } from '../../src/lib/compare/PickPanel.svelte';
import CancelPanel from '../../src/lib/compare/CancelPanel.svelte';
import AboutPanel from '../../src/lib/compare/AboutPanel.svelte';
import AddPeople from '../../src/lib/compare/AddPeople.svelte';
import EditDetails from '../../src/lib/compare/EditDetails.svelte';
import RemindPanel from '../../src/lib/compare/RemindPanel.svelte';
import RepairPanel from '../../src/lib/compare/RepairPanel.svelte';
import RepeatPanel from '../../src/lib/compare/RepeatPanel.svelte';
import Standing from '../../src/lib/compare/Standing.svelte';
import HostGroups, { owing, askedLine, updatedLine } from '../../src/lib/compare/HostGroups.svelte';
import WhenPanel from '../../src/lib/compare/WhenPanel.svelte';
import Status, { invalidIf } from '../../src/lib/Status.svelte';
import CompareGrid from '../../src/lib/CompareGrid.svelte';
import DayCompare from '../../src/lib/compare/DayCompare.svelte';
import AttendanceBoard, { invitedLine } from '../../src/lib/compare/AttendanceBoard.svelte';
import MemberPicker from '../../src/lib/MemberPicker.svelte';
import RangeField from '../../src/lib/RangeField.svelte';
import DayGrid from '../../src/lib/DayGrid.svelte';
import TimePicker from '../../src/lib/TimePicker.svelte';
import RepeatDates from '../../src/lib/RepeatDates.svelte';
import RepeatField from '../../src/lib/RepeatField.svelte';
import WeekdayPicker from '../../src/lib/WeekdayPicker.svelte';
import PlanCards from '../../src/lib/PlanCards.svelte';
import PlanList from '../../src/lib/PlanList.svelte';
import StartPlan from '../../src/lib/StartPlan.svelte';
import Home from '../../src/routes/Home.svelte';
import Terms from '../../src/routes/Terms.svelte';
import Privacy from '../../src/routes/Privacy.svelte';
import { auth } from '../../src/lib/auth.svelte.js';
import { isoFromNow, repeatSeries } from '../../src/lib/calendar.js';
import { formatDate, formatLong } from '../../src/lib/format.js';
import type { CompareScreen, Member, Participant, UserGuild, UserPlan } from '../../src/lib/types.js';
import type { FreePerson } from '../../src/lib/overlap.js';

/*
    The only tests here that draw anything. `render` from svelte/server takes a component to
    a string with no DOM and no new dependency, which is as close as this suite gets to
    looking at a screen. Not the compare page itself, which wants auth and the api behind it.
*/

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

    //The buttons need a message to sit on, so quiet still posts the yes/no, just without the pings
    it('still posts the yes/no under quiet mode, pinging nobody', () => {
        expect(draw({ quiet: true })).toContain('Posts the yes/no in the thread pinging nobody');
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

    it('tells nobody about a quiet edit to a day that is staying put', () => {
        expect(draw({ quiet: true, chosen: { date: '2026-08-12', time: '', note: '' } })).toContain('tells nobody');
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

    //A plan that collected dates comes back as a window, which reads as a stretch rather than a day
    it('names the days a following window asks about', () => {
        const body = draw({
            first: '2026-08-10',
            shapes: repeatSeries({ repeatWeeks: 1, dateRange: { start: '2026-08-01', end: '2026-08-14' }, chosenDate: '2026-08-10' })
        });
        expect(body).toContain('one of the days the next one asks about');
        expect(body).toContain('the days it asks about');
    });
});

/*
    The repeat picker both screens share. What it has to get right is when there is a day
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
});

//"Call it off" is the one name for this, on the site and in Discord alike
describe('the call it off panel', () => {
    it('names the button for what it does', () => {
        const body = render(CancelPanel, { props: { planId: 'ab12cd34ef', oncancelled: () => {} } }).body;
        expect(body).toContain('Call it off</button>');
        expect(body).not.toContain('It is off');
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
    const plan: UserPlan = {
        planId: 'ab12cd34ef',
        name: 'Pub quiz',
        guildName: 'Friends',
        status: 'closed',
        start: day,
        end: day,
        chosenDate: day,
        chosenTime: null,
        timeZone: 'Europe/London',
        inIt: true,
        filledIn: true,
        mine: true
    };
    const draw = (over: boolean) => render(PlanCards, { props: { plans: [plan], over } }).body;

    it('says a day still to come is set and offers who is coming', () => {
        const body = draw(false);
        expect(body).toContain(`set for ${formatDate(day)}`);
        expect(body).not.toContain('was set for');
        expect(body).toContain('See who is coming');
    });

    it('says a day that is over was set and offers a look back', () => {
        const body = draw(true);
        expect(body).toContain(`was set for ${formatDate(day)}`);
        expect(body).toContain('Look back at it');
        expect(body).not.toContain('See who is coming');
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
        bare(render(Standing, { props: { planId: 'ab12cd34ef', data, chosen: { date: '2026-08-12', time: '19:00', note: '' }, onmoved: async () => {} } }).body);

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

    //The groups above name them, so the button only says how many it reaches
    it('says how many it reaches and names nobody', () => {
        const body = render(RemindPanel, { props: { planId: 'ab12cd34ef', waiting } }).body;
        expect(body).toContain('Nudge the 2 still to answer');
        expect(body).not.toContain('Still out');
    });
});

describe('where everyone stands before there is a day', () => {
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
        bare(render(HostGroups, { props: { planId: 'ab12cd34ef', participants: crowd, onmoved: async () => {}, ...props } }).body);

    it('heads each group with how many are in it, leaving out any with nobody', () => {
        const body = draw({ participants: crowd.slice(0, 2) });
        expect(body).toContain('<h3>In, done (1)</h3>');
        expect(body).toContain('<h3>In, days left (1)</h3>');
        expect(body).not.toContain('Not said yet');
        expect(body).not.toContain('Nobody here');
    });

    it('says what the group cannot beside each name', () => {
        const body = draw();
        expect(body).toMatch(/>ANN\s+<span class="muted small">calendar updated 2 days ago<\/span>/);
        expect(body).toMatch(/>BO\s+<span class="muted small">3 days left<\/span>/);
        expect(body).toMatch(/>CY\s+<span class="muted small">moved back by Ali<\/span>/);
        expect(body).toMatch(/>DI\s+<span class="muted small">DMs closed, only reachable in the thread<\/span>/);
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
        ['what it is about', () => render(AboutPanel, { props: { planId, onsaved: done } }).body],
        ['adding people', () => render(AddPeople, { props: { planId, guildId: '1', onadded: done } }).body],
        ['the board', () => render(AttendanceBoard, { props: { planId, chosenDate: '2026-08-12', onmoved: done } }).body],
        ['calling it off', () => render(CancelPanel, { props: { planId, oncancelled: () => {} } }).body],
        ['the name', () => render(EditDetails, { props: { planId, onsaved: done } }).body],
        ['the picked day', () => render(PickPanel, { props: { planId, selectedDate: '2026-08-12', onsaved: done } }).body],
        ['the nudge', () => render(RemindPanel, { props: { planId } }).body],
        ['the repair', () => render(RepairPanel, { props: { planId } }).body],
        ['the repeat', () => render(RepeatPanel, { props: { planId, onchanged: done } }).body],
        ['the time', () => render(WhenPanel, { props: { planId, chosenDate: '2026-08-12', onsaved: done } }).body]
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

    it('says dropping out tells whoever set the plan up', () => {
        expect(body).toMatch(/Whoever set the plan up gets a DM saying you did/);
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
        expect(body).toMatch(/whether your DMs were closed the last time it\s+tried, so the overview can show planners/);
    });

    it('says who can see your days', () => {
        expect(body).toMatch(/<h2>Who can see your days<\/h2>\s*<p>\s*Anyone with the planner role in a server/);
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
