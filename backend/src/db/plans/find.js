import { col, collections } from '../mongo.js';
import { shiftDate, LAPSE_DAYS } from '../../lib/dates.js';

//Looking plans up, one at a time or everything someone is on

export async function getPlan(planId) {
    return col(collections.plans).findOne({ planId });
}

//Find the plan that owns a given thread, used by /overview run inside a thread
export async function getPlanByThread(threadId) {
    return col(collections.plans).findOne({ threadId });
}

//The still-open plans in a server that a given person is invited to, for /mylink
export async function getOpenPlansForUser(guildId, userId) {
    return col(collections.plans)
        .find({ guildId, 'participants.userId': userId, status: 'collecting' })
        .sort({ createdAt: -1 })
        .toArray();
}

//Every plan still collecting that they are on, across every server, since one calendar answers them all
export async function getCollectingPlansForUser(userId) {
    return col(collections.plans).find({ 'participants.userId': userId, status: 'collecting' }).toArray();
}

/*
    The plans someone is on: a guest of, or running. The last clause is hostIdsOf as a
    query, for plans from before hosts were stored, which whoever made them runs.
*/
export function onPlan(userId) {
    return { $or: [{ 'participants.userId': userId }, { hostIds: userId }, { hostIds: { $exists: false }, createdBy: userId }] };
}

/*
    Still on as of fromDate: a set plan whose day has not come round yet, or one still
    finding its day. That one stays on for LAPSE_DAYS after the last day it asked
    about, which is how long whoever runs it has to ask about new dates.
*/
function stillOn(fromDate) {
    return {
        $or: [
            { status: 'collecting', 'dateRange.end': { $gte: shiftDate(fromDate, -LAPSE_DAYS) } },
            { status: 'closed', chosenDate: { $gte: fromDate } }
        ]
    };
}

/*
    Everything this person still has on, across every server. Backs the landing page
    list, which is the only way back into a plan for someone who lost the DM.
    Cancelled plans and days gone by fall out on their own.

    Plans they are running count as well as plans they are in, since nothing makes a
    planner invite themselves and the guest list alone would hide a plan from the
    people organising it.
*/
export async function getActivePlansForUser(userId, fromDate) {
    return col(collections.plans)
        .find({ $and: [onPlan(userId), stillOn(fromDate)] })
        .sort({ createdAt: -1 })
        .toArray();
}

//The same within one server, for /mylink. fromDate wants to be a day behind, since a day passes on the server's clock, not ours.
export async function getLivePlansForUser(guildId, userId, fromDate) {
    return col(collections.plans)
        .find({ $and: [{ guildId }, onPlan(userId), stillOn(fromDate)] })
        .sort({ createdAt: -1 })
        .toArray();
}

/*
    The other end of that list: plans that are over. A cancelled one, one whose day has
    been and gone, or one that never got a day. Each drops out of the active query as
    it finishes, which leaves the overview behind it, and everything it remembers
    about who said what, reachable only by whoever still has the link.

    Capped, since this half only ever grows. A dozen is enough to find the one you
    meant and short enough to sit folded under the live ones. Newest made first rather
    than newest finished, so a plan sits where the person who made it would look.
*/
export async function getFinishedPlansForUser(userId, fromDate, limit = 12) {
    return col(collections.plans)
        .find({
            $and: [
                onPlan(userId),
                {
                    $or: [
                        { status: 'cancelled' },
                        { status: 'closed', chosenDate: { $lt: fromDate } },
                        { status: 'collecting', 'dateRange.end': { $lt: shiftDate(fromDate, -LAPSE_DAYS) } }
                    ]
                }
            ]
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
}
