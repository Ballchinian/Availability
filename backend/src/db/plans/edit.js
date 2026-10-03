import { col, collections } from '../mongo.js';
import { weekdayAllowed, weekdayOf } from '../../lib/dates.js';
import { kindOf } from '../../../../shared/planDiff.js';
import { getPlan } from './find.js';
import { freshParticipant, addParticipants } from './people.js';
import { moved } from './rev.js';
import { wipe, stashVotes, roundFor } from './day.js';

//The edit form's save, worked out first and then written

/*
    The plan as an edit would leave it, worked out without writing anything: the edit
    form's review is read off this, and applyPlanEdit writes it. form is readPlanForm's,
    with participantIds and hostIds already settled against who is in the server.

    wiped is everyone's yes or no going, and restore the answers a day moved back to
    gets back, the same as setPlanChosen and the old dates screen. by is whoever saves,
    who the overview names as setting a repeat they turn on or change.
*/
export function planEdit(plan, form, by = null) {
    const wasSet = kindOf(plan) === 'set';
    const repeatWeeks = form.repeatWeeks || null;
    const after = {
        ...plan,
        name: form.name,
        description: form.description,
        //Folded into the description by the form, see aboutOf in shared/planDiff.js
        chosenNote: null,
        repeatWeeks,
        repeatBy: !repeatWeeks ? null : repeatWeeks === (plan.repeatWeeks || null) ? plan.repeatBy || null : by,
        hostIds: form.hostIds
    };
    let wiped = false;
    let restore = [];

    if (form.set) {
        const { start, end } = plan.dateRange;
        const pinned = plan.allowedWeekdays || null;
        Object.assign(after, {
            status: 'closed',
            chosenDate: form.date,
            chosenTime: form.time,
            //Stretched to reach the day rather than replaced by it, so the dates people gave are still about something
            dateRange: { start: form.date < start ? form.date : start, end: form.date > end ? form.date : end },
            //A day off the pinned weekdays joins them, or every path reading the two together drops the day
            allowedWeekdays: pinned && !weekdayAllowed(form.date, pinned) ? [...pinned, weekdayOf(form.date)].sort((a, b) => a - b) : pinned
        });
        if (!wasSet || plan.chosenDate !== form.date) {
            const turn = roundFor(plan, form.date);
            wiped = true;
            restore = turn.restore;
            Object.assign(after, {
                round: turn.round,
                lastRound: turn.lastRound,
                pastVotes: turn.pastVotes,
                probeActive: true,
                probeAllYesNotifiedAt: null,
                lastVoteRemindedAt: null
            });
        }
    } else {
        const { start, end } = form.window;
        const moved = start !== plan.dateRange.start || end !== plan.dateRange.end || String(form.allowedWeekdays || '') !== String(plan.allowedWeekdays || '');
        Object.assign(after, { status: 'collecting', chosenDate: null, chosenTime: null, dateRange: { start, end }, allowedWeekdays: form.allowedWeekdays || null });
        if (wasSet) {
            wiped = true;
            Object.assign(after, {
                pastVotes: stashVotes(plan),
                probeActive: false,
                probeAllYesNotifiedAt: null,
                lastVoteRemindedAt: null,
                lastRemindedAt: null,
                allInNotifiedAt: null
            });
        } else if (moved) {
            //A fresh round of dates to chase, so the nudge's cooldown and the all-in DM start over
            Object.assign(after, { lastRemindedAt: null, allInNotifiedAt: null });
        }
    }

    const keep = new Set(form.participantIds);
    const back = new Map(restore.map((v) => [v.userId, v]));
    const blank = { vote: null, voteReason: null, votedAt: null, override: null, sentBack: null, invited: true };
    const kept = plan.participants
        .filter((p) => keep.has(p.userId))
        .map((p) => (wiped ? { ...p, ...blank, ...back.get(p.userId) } : p));
    const on = new Set(plan.participants.map((p) => p.userId));
    const joining = form.participantIds.filter((id) => !on.has(id));
    after.participants = [...kept, ...joining.map((id) => freshParticipant(id))];
    if (joining.length) after.allInNotifiedAt = null;

    return { plan: after, wiped, restore };
}

//What an edit can change on the plan itself. Only what did change is written, so nothing written since the read is put back.
const EDITABLE = [
    'name', 'description', 'chosenNote', 'repeatWeeks', 'repeatBy', 'hostIds', 'status', 'chosenDate', 'chosenTime', 'dateRange', 'allowedWeekdays',
    'round', 'lastRound', 'pastVotes', 'probeActive', 'probeAllYesNotifiedAt', 'lastVoteRemindedAt', 'lastRemindedAt', 'allInNotifiedAt'
];

/*
    Writes what planEdit worked out, only while the plan's rev is still the one it was
    read at. Null when it was not. The first write is the guard and moves rev on, so the
    rest cannot race another edit: who is on the plan changes in writes of their own,
    since one update cannot set into an array and pull from it, and answers are written
    in place for the reason clearedProbe gives.
*/
export async function applyPlanEdit(plan, edit, by = null) {
    const { planId } = plan;
    const after = edit.plan;
    const set = {};
    for (const key of EDITABLE) {
        if (JSON.stringify(after[key] ?? null) !== JSON.stringify(plan[key] ?? null)) set[key] = after[key] ?? null;
    }
    if (edit.wiped) Object.assign(set, wipe('$[]'), { 'participants.$[].invited': true });

    const plans = col(collections.plans);
    const rev = plan.rev || 0;
    const res = await plans.updateOne({ planId, rev: rev || { $in: [null, 0] } }, moved({ $set: set }, by));
    if (!res.matchedCount) return null;

    const on = new Set(after.participants.map((p) => p.userId));
    const gone = plan.participants.map((p) => p.userId).filter((id) => !on.has(id));
    if (gone.length) await plans.updateOne({ planId }, { $pull: { participants: { userId: { $in: gone } } } });
    const was = new Set(plan.participants.map((p) => p.userId));
    const joining = [...on].filter((id) => !was.has(id));
    if (joining.length) await addParticipants(planId, joining, by);

    if (edit.restore.length) {
        await plans.bulkWrite(
            edit.restore.map((v) => ({
                updateOne: {
                    filter: { planId, 'participants.userId': v.userId },
                    update: {
                        $set: {
                            'participants.$.vote': v.vote,
                            'participants.$.voteReason': v.voteReason,
                            'participants.$.votedAt': v.votedAt,
                            'participants.$.override': v.override
                        }
                    }
                }
            })),
            { ordered: false }
        );
    }
    return getPlan(planId);
}
