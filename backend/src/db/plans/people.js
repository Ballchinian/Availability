import { col, collections } from '../mongo.js';
import { hostIdsOf } from '../../lib/hosts.js';
import { getPlan, onPlan } from './find.js';
import { moved } from './rev.js';

/*
    The shape of a brand new participant: not confirmed for availability, and not yet
    voted on whether they can make a set date. Shared by createPlan and addParticipants
    so a late joiner looks exactly like one who was there from the start.
*/
export function freshParticipant(userId) {
    return {
        userId,
        confirmed: false,
        confirmedAt: null,
        vote: null,
        voteReason: null,
        votedAt: null,
        invited: true,
        override: null,
        //Count me in / Not for me. Null is not said yet, see inOf in shared/coverage.js for older plans.
        in: null,
        inReason: null,
        //What a host moving them back to waiting took off them, so moving them straight back restores it
        sentBack: null,
        //The DM saying what the plan is, rewritten in place when it changes. See setPlanCards.
        cardMessageId: null,
        cardActor: '',
        cardMoved: false,
        //Discord's 50007 on the last DM tried, see deliver in bot/plans.js
        dmsClosed: false
    };
}

/*
    Someone taking a plan on, with anyone on the list who has left the server (gone) taken
    off it. A plan from before hosts has its list written down first, or adding to nothing
    would lose whoever made it. Three writes, each safe to land twice, so two people taking
    a plan on together both end up running it.
*/
export async function addHost(planId, userId, gone = [], by = null) {
    const plan = await getPlan(planId);
    if (!plan) return null;
    const plans = col(collections.plans);
    await plans.updateOne({ planId, hostIds: { $exists: false } }, { $set: { hostIds: hostIdsOf(plan) } });
    if (gone.length) await plans.updateOne({ planId }, { $pull: { hostIds: { $in: gone } } });
    await plans.updateOne({ planId }, moved({ $addToSet: { hostIds: userId } }, by));
    return getPlan(planId);
}

/*
    Someone leaving a server comes off the guest list of every plan in it, and stops
    running any they ran. A plan from before hosts that they made has its list written
    down as empty first, or it would go on reading as run by them. Hands back the plans
    they were on, as they now stand, since whoever is left may now all have answered.
*/
export async function removeUserFromGuildPlans(guildId, userId, by = null) {
    const plans = col(collections.plans);
    const ids = (await plans.find({ $and: [{ guildId }, onPlan(userId)] }).toArray()).map((plan) => plan.planId);
    if (!ids.length) return [];

    await plans.updateMany({ guildId, hostIds: { $exists: false }, createdBy: userId }, { $set: { hostIds: [] } });
    await plans.updateMany({ planId: { $in: ids } }, moved({ $pull: { participants: { userId }, hostIds: userId } }, by));
    return plans.find({ planId: { $in: ids } }).toArray();
}

//Drop one person from a single plan's guest list, for when they opt out themselves
export async function removeParticipant(planId, userId, by = null) {
    await col(collections.plans).updateOne({ planId }, moved({ $pull: { participants: { userId } } }, by));
    return getPlan(planId);
}

/*
    Add people to a plan that is already running, fresh and unconfirmed. One write for the lot.

    Only ids not already on the plan are pushed, and the write matches only while none of
    them is, so two adds landing together cannot put the same person on twice. When the
    other add got there first the write misses and this reads the plan again.
*/
export async function addParticipants(planId, userIds, by = null) {
    const ids = [...new Set(userIds)];
    for (let tries = 0; tries < 3; tries++) {
        const plan = await getPlan(planId);
        if (!plan) return null;
        const on = new Set(plan.participants.map((p) => p.userId));
        const fresh = ids.filter((id) => !on.has(id));
        if (!fresh.length) return plan;

        const res = await col(collections.plans).updateOne(
            { planId, 'participants.userId': { $nin: fresh } },
            moved({
                $push: { participants: { $each: fresh.map((id) => freshParticipant(id)) } },
                //A new face means not everyone is in yet, so let the all-in nudge fire again later
                $set: { allInNotifiedAt: null }
            }, by)
        );
        if (res.modifiedCount) return getPlan(planId);
    }
    return getPlan(planId);
}

/*
    Mark one person as having saved their dates for this plan, which counts as in. Callers
    also add the window to their answered list (addAnswered in db/users.js), since that is
    what answers the other plans over the same days.
*/
export async function confirmParticipant(planId, userId) {
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        {
            $set: {
                'participants.$.confirmed': true,
                'participants.$.confirmedAt': new Date(),
                'participants.$.in': true,
                'participants.$.inReason': null,
                'participants.$.sentBack': null
            }
        }
    );
    return getPlan(planId);
}

/*
    Count me in (true) or Not for me (false, with an optional reason). A no ends being sent
    back and a yes leaves it: Ask again only sends back someone already in, so pressing in
    again would let a stale calendar answer without them going over their dates.
*/
export async function setIn(planId, userId, value, reason = null) {
    const set = { 'participants.$.in': value, 'participants.$.inReason': value === false ? reason : null };
    if (value === false) set['participants.$.sentBack'] = null;
    await col(collections.plans).updateOne({ planId, 'participants.userId': userId }, { $set: set });
    return getPlan(planId);
}

/*
    Record one person's answer to the confirmation probe: whether they can make the set
    date, with an optional reason when they cannot. A yes drops any old reason, since a
    reason only makes sense alongside a no. Their own answer also clears any manual
    call a planner made on them, since the horse's mouth beats a guess.

    A yes counts as in, so a plan sent back for dates does not ask them if they're in
    again. A no is about the one day and leaves in alone.
*/
export async function recordVote(planId, userId, vote, reason = null) {
    const set = {
        'participants.$.vote': vote,
        'participants.$.voteReason': vote === 'no' ? reason : null,
        'participants.$.votedAt': new Date(),
        'participants.$.override': null,
        'participants.$.sentBack': null
    };
    if (vote === 'yes') Object.assign(set, { 'participants.$.in': true, 'participants.$.inReason': null });
    await col(collections.plans).updateOne({ planId, 'participants.userId': userId }, { $set: set });
    return getPlan(planId);
}

/*
    A planner's manual call on whether someone is coming, laid over their real vote.
    "yes" and "no" override whatever the person answered (or did not answer), null
    clears it and lets their own answer stand again. reinvite puts someone left off
    when the date was locked back on the list.
*/
export async function setAttendanceOverride(planId, userId, override, { reinvite = false } = {}) {
    const set = { 'participants.$.override': override };
    if (reinvite) set['participants.$.invited'] = true;
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        { $set: set }
    );
    return getPlan(planId);
}

//Ask again on a plan still finding its day. askedAgainAt keeps it to once a day a person, and sentBack is for someone in.
export async function setAskedAgain(planId, userId, sentBack = null) {
    const set = { 'participants.$.askedAgainAt': new Date() };
    if (sentBack) set['participants.$.sentBack'] = sentBack;
    await col(collections.plans).updateOne({ planId, 'participants.userId': userId }, { $set: set });
    return getPlan(planId);
}

/*
    A host sending someone back (sentBack is { byName, at, was }) or taking them out of it
    again (null). vote is the answer to leave live, left alone when it is missing, which is
    how a collect plan's Ask again keeps in and only stops their calendar answering.
*/
export async function setSentBack(planId, userId, sentBack, vote = undefined) {
    const set = { 'participants.$.sentBack': sentBack };
    if (vote !== undefined) {
        Object.assign(set, {
            'participants.$.vote': vote?.vote || null,
            'participants.$.voteReason': vote?.voteReason || null,
            'participants.$.votedAt': vote?.votedAt || null,
            'participants.$.override': vote?.override || null
        });
    }
    await col(collections.plans).updateOne({ planId, 'participants.userId': userId }, { $set: set });
    return getPlan(planId);
}

export async function setDmsClosed(planId, userId, closed) {
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        { $set: { 'participants.$.dmsClosed': closed } }
    );
}
