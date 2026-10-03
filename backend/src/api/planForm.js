import { checkRange, maxEnd, cleanWeekdays, allowedDaysInRange, readTime, BAD_TIME, REPEAT_WEEKS } from '../lib/dates.js';
import { MAX_PARTICIPANTS } from '../lib/limits.js';

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/*
    The plan the create form and the edit form both send: a name, what it is about,
    either the day itself (announce) or a window to ask about, who comes, who else runs
    it and whether it comes round again. Answers { error } with the line to show, or
    { form } with everything checked that can be without asking Discord who is in the
    server. Each route asks that of the people it has not already got.

    today is the date on the plan's clock. plan is the one being edited, whose day or
    window can stay where it is after it has gone: a host renaming a plan whose dates
    have passed is not asking about new ones.
*/
export function readPlanForm(body, { today, plan = null }) {
    const { name, description, start, end, participantIds, hostIds, announce, date, time, allowedWeekdays, repeatWeeks } = body || {};
    const bad = (error) => ({ error });

    const cleanName = String(name || '').trim();
    if (!cleanName) return bad('Give the plan a name.');
    if (cleanName.length > 90) return bad('That name is a bit long, keep it under 90 characters.');

    const cleanDescription = String(description || '').trim();
    if (cleanDescription.length > 280) return bad('Keep the description under 280 characters.');

    if (!Array.isArray(participantIds) || participantIds.length === 0) return bad('Pick at least one person to invite.');
    if (participantIds.length > MAX_PARTICIPANTS) {
        return bad(`That is more than ${MAX_PARTICIPANTS} people, which is more than a plan can hold.`);
    }
    //Whoever else runs it. Nobody is the usual answer, and the cap is the guest list's, for the same lookups.
    const picked = Array.isArray(hostIds) ? hostIds : [];
    if (picked.length > MAX_PARTICIPANTS) return bad(`That is more than ${MAX_PARTICIPANTS} people to run one plan.`);

    const repeat = repeatWeeks == null ? null : REPEAT_WEEKS.includes(repeatWeeks) ? repeatWeeks : false;
    if (repeat === false) return bad('That is not a repeat I can do.');

    const form = { name: cleanName, description: cleanDescription, participantIds, hostIds: picked, repeatWeeks: repeat };

    if (announce === true) {
        if (!SHAPE.test(date || '')) return bad('Pick the date the plan is on.');
        if (date !== plan?.chosenDate) {
            if (date < today) return bad('That date is in the past.');
            if (date > maxEnd()) return bad('That date cannot be more than two years away.');
        }
        const cleanTime = readTime(time);
        if (cleanTime === false) return bad(BAD_TIME);
        return { form: { ...form, set: true, date, time: cleanTime } };
    }

    const rangeError = plan ? windowError(start, end, today, plan.dateRange) : checkRange(start, end, today);
    if (rangeError) return bad(rangeError);
    const weekdays = cleanWeekdays(allowedWeekdays);
    //A restriction that leaves no day inside the range would ask for nothing
    if (weekdays && !allowedDaysInRange(start, end, weekdays).length) {
        return bad('None of the days you allowed fall inside that date range.');
    }
    return { form: { ...form, set: false, window: { start, end }, allowedWeekdays: weekdays } };
}

//A running plan's window can reach back to today, unlike a new one's, and can be left where it was however long ago that was
function windowError(start, end, today, was) {
    if (!SHAPE.test(start || '') || !SHAPE.test(end || '')) return 'Pick a valid start and end date.';
    if (start === was.start && end === was.end) return null;
    if (start > end) return 'The start date is after the end date.';
    if (end < today) return 'That whole range is in the past.';
    if (start < today && start !== was.start) return 'The start date has to be today or later.';
    if (end > maxEnd()) return 'The end date cannot be more than two years away.';
    return null;
}
