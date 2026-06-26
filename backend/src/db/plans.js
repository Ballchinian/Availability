import { col, collections } from './mongo.js';
import { shortId } from '../lib/ids.js';

/*
    A plan is one meetup someone is trying to organise: a name, a date range, the
    people invited, and the thread it lives in. Each invited person carries their
    own confirmed flag, which is about whether they have reviewed for this plan,
    separate from the actual availability data they save.
*/

export async function createPlan({ guildId, name, description, createdBy, dateRange, participantIds }) {
    const now = new Date();
    const doc = {
        planId: shortId(10),
        guildId,
        name,
        description,
        createdBy,
        dateRange,
        participants: participantIds.map((userId) => ({ userId, confirmed: false, confirmedAt: null })),
        threadId: null,
        status: 'collecting',
        chosenDate: null,
        createdAt: now
    };
    await col(collections.plans).insertOne(doc);
    return doc;
}

export async function getPlan(planId) {
    return col(collections.plans).findOne({ planId });
}

//Find the plan that owns a given thread, used by /compare run inside a thread
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

/*
    Open plans the person is in whose whole range sits inside the dates they just
    filled. Used by the general availability page to auto-accept any plan they
    have now fully covered, across every server.
*/
export async function getPlansCoveredBy(userId, start, end) {
    return col(collections.plans)
        .find({
            'participants.userId': userId,
            status: 'collecting',
            'dateRange.start': { $gte: start },
            'dateRange.end': { $lte: end }
        })
        .toArray();
}

//Lock in the winning date and close the plan off
export async function setPlanChosen(planId, date) {
    await col(collections.plans).updateOne({ planId }, { $set: { chosenDate: date, status: 'closed' } });
    return getPlan(planId);
}

/*
    Mark a plan cancelled. We leave the document and its thread in place, the
    thread getting deleted by hand is what finally clears the plan, so a cancelled
    plan just drops out of the open lists in the meantime.
*/
export async function markPlanCancelled(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { status: 'cancelled' } });
    return getPlan(planId);
}

//Note when the stragglers were last nudged, so /remind cannot be spammed
export async function setReminded(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { lastRemindedAt: new Date() } });
}

/*
    Push the end date out and reopen the plan. Everyone's confirmed flag is reset
    so they all take another look at the new days, but their saved availability is
    left alone, so anyone whose timetable already reaches the new dates just needs
    a quick glance.
*/
export async function extendPlan(planId, newEnd) {
    const plan = await getPlan(planId);
    const participants = plan.participants.map((p) => ({ ...p, confirmed: false, confirmedAt: null }));
    await col(collections.plans).updateOne(
        { planId },
        //Clear the remind cooldown too, it is a fresh round of dates to chase up
        { $set: { 'dateRange.end': newEnd, status: 'collecting', chosenDate: null, participants, lastRemindedAt: null } }
    );
    return getPlan(planId);
}

export async function setPlanThread(planId, threadId) {
    await col(collections.plans).updateOne({ planId }, { $set: { threadId } });
}

export async function deletePlan(planId) {
    await col(collections.plans).deleteOne({ planId });
}

//Remove every plan in a server (used when the bot is kicked), returning them first
export async function deletePlansForGuild(guildId) {
    const plans = await col(collections.plans).find({ guildId }).toArray();
    await col(collections.plans).deleteMany({ guildId });
    return plans;
}

//Drop someone from the guest list of every plan in a server when they leave it
export async function removeUserFromGuildPlans(guildId, userId) {
    await col(collections.plans).updateMany({ guildId }, { $pull: { participants: { userId } } });
}

//Drop one person from a single plan's guest list, for when they opt out themselves
export async function removeParticipant(planId, userId) {
    await col(collections.plans).updateOne({ planId }, { $pull: { participants: { userId } } });
    return getPlan(planId);
}

//Add one person to a plan that is already running, fresh and unconfirmed
export async function addParticipant(planId, userId) {
    await col(collections.plans).updateOne(
        { planId },
        { $push: { participants: { userId, confirmed: false, confirmedAt: null } } }
    );
    return getPlan(planId);
}

//Mark one person as having reviewed and confirmed for this plan
export async function confirmParticipant(planId, userId) {
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        { $set: { 'participants.$.confirmed': true, 'participants.$.confirmedAt': new Date() } }
    );
    return getPlan(planId);
}
