import { coverageOf, inOf, askedDays, askLine } from '../../../shared/coverage.js';
import { safeZone, todayIn, retimeDay, instantToWall } from './zones.js';
import { gatherFreeDays } from './freedays.js';

/*
    shared/coverage.js passed straight back out, the same arrangement dates.js and
    zones.js have, plus what only this end knows how to build: the answers of one
    person on one plan, out of the plan and their row from getPlanningPrefs.
*/

export { askedDays, answeredOn, coverageOf, daysToFill, toFillRuns, inOf, standing, owes, askLine } from '../../../shared/coverage.js';

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
