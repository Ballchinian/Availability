import { coverageOf, inOf } from '../../../shared/coverage.js';
import { safeZone, todayIn, retimeDay } from './zones.js';

/*
    shared/coverage.js passed straight back out, the same arrangement dates.js and
    zones.js have, plus what only this end knows how to build: the answers of one
    person on one plan, out of the plan and their row from getPlanningPrefs.
*/

export { askedDays, answeredOn, coverageOf, inOf, standing, owes, askLine } from '../../../shared/coverage.js';

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
