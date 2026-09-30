/*
    Whether a person's calendar already answers a plan. Shared so a DM and the page
    it opens can never disagree about what is left to fill in. Plain ESM like
    dates.js, which is the only thing it reads, and coverage.d.ts is what the
    typescript side reads.

    Nothing here is stored. Which group someone is in comes out of their calendar
    every time it is asked, so a window that moves takes people between groups on
    its own.
*/

import { shiftDate, weekdayAllowed, formatDay } from './dates.js';

//Every day a window asks about, pinned weekdays and all
export function askedDays({ start, end, allowedWeekdays } = {}) {
    const days = [];
    if (!start || !end) return days;
    for (let d = start; d <= end; d = shiftDate(d, 1)) {
        if (weekdayAllowed(d, allowedWeekdays)) days.push(d);
    }
    return days;
}

function inWindows(date, answered) {
    return (answered || []).some((w) => date >= w.start && date <= w.end && weekdayAllowed(date, w.allowedWeekdays));
}

//A day as the person wrote it: inside a window they saved, or on or before their coveredUntil
export function answeredOn(date, { coveredUntil = null, answered = [] } = {}) {
    return inWindows(date, answered) || Boolean(coveredUntil && date <= coveredUntil);
}

/*
    A saved window answers a plan's day by name, since the plan page and /free both
    ask about the plan's dates in the person's own clock. coveredUntil is a date on
    their clock, so it answers a plan's day only once every day of theirs that the
    plan's day touches is on or before it. theirDays does that mapping (retimeDay's
    dates) and can be left out when both clocks agree.
*/
function answeredBy({ coveredUntil = null, answered = [], sentBack = null, theirDays = (d) => [d] }) {
    return (d) => !sentBack && (inWindows(d, answered) || Boolean(coveredUntil && theirDays(d).every((t) => t <= coveredUntil)));
}

//lastCovered is the end of the answered run at the front, null when the first day still to come is unanswered
export function coverageOf(answers) {
    const days = askedDays(answers.window).filter((d) => d >= (answers.today || ''));
    const done = answeredBy(answers);

    let daysLeft = 0;
    let lastCovered = null;
    for (const d of days) {
        if (!done(d)) daysLeft++;
        else if (!daysLeft) lastCovered = d;
    }

    const state = daysLeft === 0 ? 'covered' : daysLeft === days.length ? 'none' : 'partial';
    return { state, daysLeft, lastCovered, total: days.length };
}

//The days coverageOf counts as left, for a calendar to pick out
export function daysToFill(answers) {
    const done = answeredBy(answers);
    return askedDays(answers.window).filter((d) => d >= (answers.today || '') && !done(d));
}

/*
    The same days as [first, last] runs, where a run is days next to each other in what
    the window asks, so pinned weekdays make one run of a month of Saturdays. The
    overview carries these per person rather than the days, which on a two year window
    is hundreds of dates each.
*/
export function toFillRuns(answers) {
    const done = answeredBy(answers);
    const runs = [];
    let open = null;
    for (const d of askedDays(answers.window)) {
        if (d < (answers.today || '') || done(d)) open = null;
        else if (open) open[1] = d;
        else runs.push((open = [d, d]));
    }
    return runs;
}

/*
    Participants saved before the question existed carry no in at all. They read as
    in if they filled in or said yes, otherwise as not said yet, and never as out,
    since anyone who dropped out back then was taken off the plan instead.
*/
export function inOf(p) {
    if (p.in !== undefined) return p.in;
    return p.confirmed || p.vote === 'yes' ? true : null;
}

//Which of the five groups a host sees someone in
export function standing(p, coverage) {
    const joined = inOf(p);
    if (joined === false) return 'out';
    if (joined !== true) return 'not-said';
    if (coverage.state === 'covered') return 'done';
    return coverage.state === 'partial' ? 'days-left' : 'no-dates';
}

//What someone on a collect plan still has to do: say if they're in, fill in days, or nothing
export function owes(p, coverage) {
    const s = standing(p, coverage);
    if (s === 'not-said') return 'answer';
    return s === 'days-left' || s === 'no-dates' ? 'days' : null;
}

/*
    The line under Count me in / Not for me. It stops where a link used to go: the
    DM's Add my dates button does that job, and on the plan page there is nowhere
    else to send them. Blank when every day it asked about has gone.

    joined is for someone already in, who has nothing left to be told about a
    calendar that answers everything, so theirs is blank.
*/
export function askLine(coverage, { free = 0, updated = null, joined = false } = {}) {
    const { state, daysLeft, lastCovered, total } = coverage;
    if (!total || (joined && state === 'covered')) return '';

    if (state === 'covered') {
        const lead = updated
            ? `Your calendar (last updated ${formatDay(updated)}) already answers this`
            : 'Your calendar already answers this';
        if (total === 1) return `${lead}: you're ${free ? '' : 'not '}free that day.`;
        if (!free) return `${lead}: you're not free on any of the ${total} days.`;
        return `${lead}: you're free on ${free} of the ${total} days.`;
    }

    if (state === 'partial') {
        const are = daysLeft === 1 ? 'is 1' : `are ${daysLeft}`;
        if (lastCovered) return `Your calendar answers up to ${formatDay(lastCovered)}, so there ${are} ${daysLeft === 1 ? 'day' : 'days'} after that to fill in.`;
        return `Your calendar answers ${total - daysLeft} of the ${total} days, so there ${are} left to fill in.`;
    }

    return joined ? 'Now fill in your dates.' : 'Then fill in your dates.';
}
