/*
    What an edit to a plan changes, and who has to hear about it. Shared so the edit
    form's review and the save itself read the same answer. Plain ESM like coverage.js,
    which is what it reads, and planDiff.d.ts is what the typescript side reads.

    Both plans are whole plan documents, and hostIds has to be spelled out on each: a
    plan from before hosts has none, and reads as run by whoever made it.
*/

import { inOf, owes } from './coverage.js';

//Whether a plan has its day
export function kindOf(plan) {
    return plan.status === 'closed' && plan.chosenDate ? 'set' : 'collect';
}

//An older plan's note on the day reads as the end of what it is about, the way the form shows it
function aboutOf(plan) {
    return [plan.description, plan.chosenNote].filter(Boolean).join(' ');
}

const idsOf = (people) => (people || []).map((p) => p.userId);
const missing = (from, to) => from.filter((id) => !to.includes(id));
//No restriction and every day are the same ask
const daysKey = (days) => (days?.length && days.length < 7 ? [...days].sort().join() : '');

/*
    Every change from before to after, in the order a message lists them. The day and
    the window are one change between them: a plan either has its day or asks about
    some, so a kind changing says where it went rather than listing both.
*/
export function diffPlan(before, after) {
    const changes = [];
    if (before.name !== after.name) changes.push({ type: 'name', from: before.name, to: after.name });
    if (aboutOf(before) !== aboutOf(after)) changes.push({ type: 'description', to: aboutOf(after) });

    const day = { date: after.chosenDate, time: after.chosenTime || null };
    const window = { start: after.dateRange.start, end: after.dateRange.end, allowedWeekdays: after.allowedWeekdays || null };
    if (kindOf(after) === 'set') {
        if (kindOf(before) !== 'set') changes.push({ type: 'set', ...day });
        else if (before.chosenDate !== day.date) changes.push({ type: 'day', from: before.chosenDate, ...day });
        else if ((before.chosenTime || null) !== day.time) changes.push({ type: 'time', from: before.chosenTime || null, to: day.time });
    } else if (kindOf(before) === 'set') {
        changes.push({ type: 'collect', ...window });
    } else if (
        before.dateRange.start !== window.start ||
        before.dateRange.end !== window.end ||
        daysKey(before.allowedWeekdays) !== daysKey(window.allowedWeekdays)
    ) {
        changes.push({ type: 'window', ...window });
    }

    if ((before.repeatWeeks || null) !== (after.repeatWeeks || null)) {
        changes.push({ type: 'repeat', from: before.repeatWeeks || null, to: after.repeatWeeks || null });
    }

    const [was, now] = [idsOf(before.participants), idsOf(after.participants)];
    if (missing(now, was).length) changes.push({ type: 'added', ids: missing(now, was) });
    if (missing(was, now).length) changes.push({ type: 'removed', ids: missing(was, now) });

    const [ran, runs] = [before.hostIds || [], after.hostIds || []];
    if (missing(runs, ran).length || missing(ran, runs).length) {
        changes.push({ type: 'hosts', added: missing(runs, ran), removed: missing(ran, runs) });
    }
    return changes;
}

//What everyone is told. Who comes and who runs it are only said to the people they are about.
export function listed(changes) {
    return changes.filter((c) => c.type !== 'added' && c.type !== 'removed' && c.type !== 'hosts');
}

/*
    What someone has to do on a plan now: say if they're coming to its day ('vote'),
    say if they're in ('answer'), fill in days ('days'), or nothing. Anyone who said it
    is not for them owes nothing, and nor does anyone left off a set day.
*/
export function owedOn(p, plan, coverage) {
    if (inOf(p) === false) return null;
    if (kindOf(plan) === 'set') return p.invited === false || p.override || p.vote ? null : 'vote';
    return owes(p, coverage);
}

//The changes everyone hears about by DM on a loud save. What it is about is where to be once there is a day.
const TO_EVERYONE = new Set(['set', 'day', 'time', 'collect', 'window']);

const answerOf = (p) => p.override || p.vote || null;

/*
    Who gets a fresh card about an edit, each with why: 'cleared' when the edit took away
    their yes or no, what they now owe when they owed nothing before, and 'changed' for
    anyone else on a loud save that reaches everyone. Everyone else has the card they
    hold rewritten where it sits. owed is owedOn for each person before and after, by id.

    Anyone added gets the invitation and anyone removed is told on their own, so neither
    is here, and nobody who said it is not for them hears either way.
*/
export function whoHears(before, after, { quiet = false, owed = {} } = {}) {
    const set = kindOf(after) === 'set';
    const loud = !quiet && diffPlan(before, after).some((c) => TO_EVERYONE.has(c.type) || (c.type === 'description' && set));
    const was = new Map((before.participants || []).map((p) => [p.userId, p]));

    const heard = [];
    for (const p of after.participants || []) {
        const old = was.get(p.userId);
        if (!old || inOf(p) === false || (set && p.invited === false)) continue;
        const { before: had = null, after: has = null } = owed[p.userId] || {};
        const why = answerOf(old) && !answerOf(p) ? 'cleared' : has && !had ? has : loud ? 'changed' : null;
        if (why) heard.push({ userId: p.userId, why });
    }
    return heard;
}
