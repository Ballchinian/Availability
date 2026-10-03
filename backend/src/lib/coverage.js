import { coverageOf, inOf, standing, askedDays, askLine, datesPassed } from '../../../shared/coverage.js';
import { safeZone, todayIn, retimeDay, instantToWall } from './zones.js';
import { gatherFreeDays } from './freedays.js';
import { hostIdsOf } from './hosts.js';
import { owedOn, kindOf } from '../../../shared/planDiff.js';

/*
    shared/coverage.js passed straight back out, the same arrangement dates.js and
    zones.js have, plus what only this end knows how to build: the answers of one
    person on one plan, out of the plan and their row from getPlanningPrefs.
*/

export { askedDays, datesPassed, answeredOn, coverageOf, daysToFill, toFillRuns, inOf, standing, owes, askLine, nextStep } from '../../../shared/coverage.js';

//coverageOf's input. Only coveredUntil is a date on their own clock, so only it goes through retimeDay.
export function answersOn(plan, prefs, p = null) {
    const planZone = safeZone(plan.timeZone);
    const theirZone = safeZone(prefs?.timeZone);
    const answers = {
        window: { start: plan.dateRange.start, end: plan.dateRange.end, allowedWeekdays: plan.allowedWeekdays || null },
        coveredUntil: prefs?.coveredUntil || null,
        answered: prefs?.answered || [],
        today: todayIn(plan.timeZone),
        sentBack: p?.sentBack || null
    };
    if (theirZone !== planZone) answers.theirDays = (d) => retimeDay(planZone, theirZone, d).map((x) => x.date);
    return answers;
}

/*
    The line under Count me in for p, the same on the plan page and in their DM. rows are
    their saved days from a day before the window to a day after, since their free days
    are counted on the plan's clock the way the overview reads them. lastUpdatedAt is
    the latest save across their whole calendar.
*/
export function askFor(plan, p, prefs, rows, lastUpdatedAt = null) {
    const answers = answersOn(plan, prefs, p);
    const free = gatherFreeDays(rows.map((r) => ({ ...r, userId: p.userId })), {
        userIds: [p.userId],
        prefs: { [p.userId]: prefs },
        zone: safeZone(plan.timeZone),
        start: plan.dateRange.start,
        end: plan.dateRange.end
    });
    const updated = lastUpdatedAt ? instantToWall(safeZone(prefs?.timeZone), new Date(lastUpdatedAt)).date : null;
    return askLine(coverageOf(answers), {
        free: askedDays(answers.window).filter((d) => d >= answers.today && free[d]).length,
        updated,
        joined: inOf(p) === true
    });
}

/*
    Whether a plan still finding its day has heard from everyone: all of them in, with a
    calendar that answers every day of it. Anyone who said it's not for them is not
    waited on, and a plan with nobody else left on it has heard from no one.
*/
export function everyoneAnswered(plan, prefs) {
    const on = plan.participants.filter((p) => inOf(p) !== false);
    return on.length > 0 && on.every((p) => standing(p, coverageOf(answersOn(plan, prefs[p.userId], p))) === 'done');
}

/*
    Where one person stands on one plan, which is what nextStep reads. prefs is
    getPlanningPrefs for them, and for everyone on a plan they run that is still finding
    its day, since whether the day can be picked is everybody's answers.

    A host's call on the board stands as their answer for a set day, and so does having
    said it's not for them: nothing is waiting on either.
*/
export function rowFor(plan, userId, prefs = {}) {
    const me = plan.participants.find((p) => p.userId === userId) || null;
    const collecting = plan.status === 'collecting';
    const hosting = hostIdsOf(plan).includes(userId);
    const coverage = me && collecting ? coverageOf(answersOn(plan, prefs[userId], me)) : null;
    const window = { start: plan.dateRange.start, end: plan.dateRange.end, allowedWeekdays: plan.allowedWeekdays || null };
    return {
        role: hosting ? 'host' : 'guest',
        onList: Boolean(me),
        standing: coverage ? standing(me, coverage) : null,
        daysLeft: coverage ? coverage.daysLeft : 0,
        movedBack: Boolean(collecting && me?.sentBack),
        datesPassed: collecting && datesPassed(window, todayIn(plan.timeZone)),
        answer: me ? me.override || me.vote || (inOf(me) === false ? 'no' : null) : null,
        invited: Boolean(me) && me.invited !== false,
        readyToPick: hosting && collecting && everyoneAnswered(plan, prefs)
    };
}

//The plans a save took from not answered to answered, leaving out any the person has said no to
export function newlyCovered(plans, userId, before, after) {
    return plans
        .filter((plan) => {
            const p = plan.participants.find((q) => q.userId === userId);
            if (!p || inOf(p) === false) return false;
            const now = coverageOf(answersOn(plan, after, p));
            return now.total > 0 && now.state === 'covered' && coverageOf(answersOn(plan, before, p)).state !== 'covered';
        })
        .map((plan) => ({ planId: plan.planId, name: plan.name }));
}

//owedOn for everyone on either side of an edit, before it and after it, as whoHears reads them
export function owedAcross(before, after, prefs = {}) {
    const owedIn = (plan, id) => {
        const p = plan.participants.find((q) => q.userId === id);
        if (!p) return null;
        return owedOn(p, plan, kindOf(plan) === 'set' ? null : coverageOf(answersOn(plan, prefs[id], p)));
    };
    const ids = new Set([...before.participants, ...after.participants].map((p) => p.userId));
    return Object.fromEntries([...ids].map((id) => [id, { before: owedIn(before, id), after: owedIn(after, id) }]));
}
