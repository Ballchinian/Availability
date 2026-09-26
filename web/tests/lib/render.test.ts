import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import ClockNote from '../../src/lib/ClockNote.svelte';
import PickPanel from '../../src/lib/compare/PickPanel.svelte';
import CancelPanel from '../../src/lib/compare/CancelPanel.svelte';
import CompareGrid from '../../src/lib/CompareGrid.svelte';
import AttendanceBoard from '../../src/lib/compare/AttendanceBoard.svelte';
import MemberPicker from '../../src/lib/MemberPicker.svelte';
import DayGrid from '../../src/lib/DayGrid.svelte';
import TimePicker from '../../src/lib/TimePicker.svelte';
import RepeatDates from '../../src/lib/RepeatDates.svelte';
import RepeatField from '../../src/lib/RepeatField.svelte';
import WeekdayPicker from '../../src/lib/WeekdayPicker.svelte';
import PlanCards from '../../src/lib/PlanCards.svelte';
import StartPlan from '../../src/lib/StartPlan.svelte';
import { isoFromNow, repeatSeries } from '../../src/lib/calendar.js';
import { formatDate, formatLong } from '../../src/lib/format.js';
import type { Member, Participant, UserGuild, UserPlan } from '../../src/lib/types.js';

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

/*
    The grid is the only way to a date now, so it has to hold up on a plan nobody has
    answered, which is where the panel that used to stand in for it was reached from.
*/
describe('picking a day nobody has answered about', () => {
    const draw = (props: Record<string, unknown> = {}) =>
        render(PickPanel, {
            props: { planId: 'ab12cd34ef', selectedDate: '2026-08-12', onsaved: async () => {}, ...props }
        }).body;

    //The other way to count nobody is everyone's sure-up-to date having passed, which
    //this would otherwise blame it on
    it('says nobody has answered rather than blaming their horizons', () => {
        const body = draw({ confirmedCount: 0, totalParticipants: 3 });
        expect(body).toContain('nobody has filled their dates in');
        expect(body).not.toContain('sure-up-to date');
    });

    it('still offers to set the day', () => {
        expect(draw({ confirmedCount: 0, totalParticipants: 3 })).toContain('You can still set it');
    });

    //Narrowing to the people who can make it is nought people here, and it is the default
    it('does not offer to narrow the invite list to nobody', () => {
        expect(draw({ confirmedCount: 0, totalParticipants: 3 })).not.toContain('Just the people who can make it');
    });

    it('offers it again once somebody is free on the day', () => {
        const body = draw({
            confirmedCount: 1,
            totalParticipants: 3,
            freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] }
        });
        expect(body).toContain('Just the people who can make it');
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
        invited: true,
        sureUntil: null
    }));

    const draw = (props: Record<string, unknown> = {}) =>
        render(PickPanel, {
            props: {
                planId: 'ab12cd34ef',
                selectedDate: '2026-08-12',
                confirmedCount: 0,
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

    //The default narrows the list, so the people it takes off get counted before it happens
    it('counts who comes off the list when it narrows', () => {
        const body = draw({ confirmedCount: 1, freeByDate: { '2026-08-12': [{ userId: 'a', hours: [] }] } });
        expect(body).toContain('pings 1 person and DMs them the same buttons.');
        expect(body).toContain('2 people come off the list and hear no more about it.');
    });

    //The buttons need a message to sit on, so quiet still posts the yes/no, just without the pings
    it('still posts the yes/no under quiet mode, pinging nobody', () => {
        expect(draw({ quiet: true })).toContain('Posts the yes/no in the thread pinging nobody');
    });

    //A day staying put keeps every answer, which is the opposite of what moving one does
    it('says what stands when only the time or note is changing', () => {
        const body = draw({ participants: onPlan, chosen: { date: '2026-08-12', time: '', note: '' } });
        expect(body).toContain('DMs 3 people to say what changed');
        expect(body).toContain('Every answer and the invite list stand.');
    });

    /*
        The list is not touched by an edit to the day it is already on, so the people free
        on that day are not a narrowing. Counting them as one had it promise fewer DMs than
        it sends, in the same breath as saying the list stands.
    */
    it('counts everyone still invited on an edit, not just whoever is free that day', () => {
        const body = draw({
            participants: onPlan,
            confirmedCount: 1,
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

describe('the compare grid', () => {
    const draw = (props: Record<string, unknown>) =>
        render(CompareGrid, {
            props: {
                start: '2026-08-01',
                end: '2026-08-14',
                freeByDate: { '2026-08-05': [{ userId: 'a', hours: [] }] },
                confirmedCount: 1,
                ...props
            }
        }).body;

    /*
        Two different things: the day the plan is on, and the day being looked at. Before this
        the grid could only show the second, so scrolling the grid lost track of the first.
    */
    it('marks the set day apart from the day being looked at', () => {
        const body = draw({ chosenDate: '2026-08-05', selectedDate: '2026-08-07' });
        expect(body).toContain('isset');
        expect(body).toContain('chosen');
    });

    it('says which day is set in the accessible name too', () => {
        expect(draw({ chosenDate: '2026-08-05' })).toContain('the day this plan is set for');
    });

    it('marks nothing when no day is set', () => {
        expect(draw({ chosenDate: null })).not.toContain('isset');
    });

    //The server refuses a day before today, so the grid does not offer one
    it('draws the days before today as out', () => {
        expect(buttons(draw({ today: '2026-08-06' }))).toBe(9);
    });

    it('keeps every day on a grid that is only looked back at', () => {
        expect(buttons(draw({ today: null }))).toBe(14);
    });
});

//Counted off today, since the grid reads the clock itself
describe('the fill-in grid', () => {
    const draw = (selection: Record<string, number[]> = {}) =>
        render(DayGrid, { props: { start: isoFromNow(-3, 'day'), end: isoFromNow(3, 'day'), selection } }).body;

    it('locks the days already gone', () => {
        expect(buttons(draw())).toBe(4);
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
        invited: true,
        sureUntil: null
    });
    const draw = () =>
        render(AttendanceBoard, {
            props: {
                planId: 'ab12cd34ef',
                chosenDate: '2026-08-12',
                participants: [person('a', 'yes'), person('b', null)],
                onmoved: async () => {}
            }
        }).body;

    //Under the page's "Where it stands", so a level down from it rather than two
    it('heads each column one level under the section it sits in', () => {
        const body = draw();
        expect(body).toContain('<h3>Coming (1)</h3>');
        expect(body).not.toContain('<h4');
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
});

describe('the weekday picker', () => {
    it('says whether each day is on, since the colour is all that shows it', () => {
        const body = render(WeekdayPicker, { props: { dayOn: [true, false, true, true, true, true, true] } }).body;
        expect(body).toContain('aria-pressed="false">Mo</button>');
        expect(body).toContain('aria-pressed="true">Tu</button>');
    });
});
