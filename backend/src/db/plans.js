import { col, collections } from './mongo.js';
import { shortId } from '../lib/ids.js';

/*
    A plan is one meetup someone is trying to organise: a name, a date range, the
    people invited, and the thread it lives in. Each invited person carries their
    own confirmed flag, which is about whether they have reviewed for this plan,
    separate from the actual availability data they save.
*/

/*
    The shape of a brand new participant: not confirmed for availability, and not yet
    voted on whether they can make a set date. Shared by createPlan and addParticipant
    so a late joiner looks exactly like one who was there from the start.
*/
function freshParticipant(userId) {
    return { userId, confirmed: false, confirmedAt: null, vote: null, voteReason: null, votedAt: null };
}

/*
    The fields that clear a confirmation round: everyone's vote is wiped and the probe
    is taken down. Pulled out so picking a new date, voiding a date or moving the range
    all start the next round from a clean slate.
*/
function clearedProbeFields(participants) {
    return {
        participants: participants.map((p) => ({ ...p, vote: null, voteReason: null, votedAt: null })),
        probeActive: false,
        probeThreadMessageId: null,
        probeAllYesNotifiedAt: null
    };
}

export async function createPlan({ guildId, name, description, createdBy, dateRange, participantIds }) {
    const now = new Date();
    const doc = {
        planId: shortId(10),
        guildId,
        name,
        description,
        createdBy,
        dateRange,
        participants: participantIds.map((userId) => freshParticipant(userId)),
        threadId: null,
        openerMessageId: null,
        status: 'collecting',
        chosenDate: null,
        allInNotifiedAt: null,
        //The confirmation probe: off until a planner asks people to confirm a set date
        probeActive: false,
        probeThreadMessageId: null,
        probeAllYesNotifiedAt: null,
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

/*
    Lock in the winning date (with an optional time and note) and close the plan off.
    A new date means a fresh confirmation round, so any votes from a previous date are
    wiped and the probe is reset, ready for a planner to ask people again.
*/
export async function setPlanChosen(planId, date, time = null, note = null) {
    const plan = await getPlan(planId);
    await col(collections.plans).updateOne(
        { planId },
        { $set: { chosenDate: date, chosenTime: time, chosenNote: note, status: 'closed', ...clearedProbeFields(plan.participants) } }
    );
    return getPlan(planId);
}

//Undo a confirmed date and reopen the plan so a fresh day can be picked. The date is
//gone, so any confirmation votes for it go with it.
export async function voidPlanChoice(planId) {
    const plan = await getPlan(planId);
    await col(collections.plans).updateOne(
        { planId },
        { $set: { chosenDate: null, chosenTime: null, chosenNote: null, status: 'collecting', ...clearedProbeFields(plan.participants) } }
    );
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
    Set a fresh start and end on the plan and reopen it. Everyone's confirmed flag
    is reset so they all take another look at the new window, but their saved
    availability is left alone, so anyone whose timetable already reaches the new
    dates just needs a quick glance. Any date that had been picked is cleared too,
    since the window moved out from under it.
*/
export async function setPlanRange(planId, start, end) {
    const plan = await getPlan(planId);
    const participants = plan.participants.map((p) => ({ ...p, confirmed: false, confirmedAt: null }));
    //The window moved, so any date and its votes are gone too, start the round clean
    const cleared = clearedProbeFields(participants);
    await col(collections.plans).updateOne(
        { planId },
        {
            $set: {
                'dateRange.start': start,
                'dateRange.end': end,
                status: 'collecting',
                chosenDate: null,
                chosenTime: null,
                chosenNote: null,
                ...cleared,
                //A fresh round of dates to chase up, so clear the cooldown and the all-in nudge
                lastRemindedAt: null,
                allInNotifiedAt: null
            }
        }
    );
    return getPlan(planId);
}

export async function setPlanThread(planId, threadId) {
    await col(collections.plans).updateOne({ planId }, { $set: { threadId } });
}

//Remember which message opened the thread, so a later edit can rewrite that pinned post
export async function setPlanOpener(planId, messageId) {
    await col(collections.plans).updateOne({ planId }, { $set: { openerMessageId: messageId } });
}

//Change a plan's title and description, leaving everything else (dates, guests) alone
export async function setPlanDetails(planId, name, description) {
    await col(collections.plans).updateOne({ planId }, { $set: { name, description } });
    return getPlan(planId);
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
        {
            $push: { participants: freshParticipant(userId) },
            //A new face means not everyone is in yet, so let the all-in nudge fire again later
            $set: { allInNotifiedAt: null }
        }
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

//Note that we have told the creator everyone is in, so that nudge only goes once a round
export async function markAllInNotified(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { allInNotifiedAt: new Date() } });
}

/*
    Record one person's answer to the confirmation probe: whether they can make the set
    date, with an optional reason when they cannot. A yes drops any old reason, since a
    reason only makes sense alongside a no.
*/
export async function recordVote(planId, userId, vote, reason = null) {
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        {
            $set: {
                'participants.$.vote': vote,
                'participants.$.voteReason': vote === 'no' ? reason : null,
                'participants.$.votedAt': new Date()
            }
        }
    );
    return getPlan(planId);
}

//Turn the probe on or off and remember which thread message carries its buttons, so the
//running tally on it can be rewritten as votes land
export async function setProbe(planId, { active, threadMessageId = null }) {
    await col(collections.plans).updateOne(
        { planId },
        { $set: { probeActive: active, probeThreadMessageId: threadMessageId } }
    );
    return getPlan(planId);
}

//Note that the creator has been told everyone confirmed, so that good-to-go DM only goes once
export async function markProbeAllYes(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { probeAllYesNotifiedAt: new Date() } });
}
