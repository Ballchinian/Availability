import { col, collections } from './mongo.js';
import { shortId } from '../lib/ids.js';
import { weekdayAllowed } from '../lib/dates.js';

/*
    A plan is one meetup someone is trying to organise: a name, a date range, the
    people invited, and the thread it lives in. Each invited person carries their
    own confirmed flag, which is about whether they have reviewed for this plan,
    separate from the actual availability data they save.
*/

/*
    The shape of a brand new participant: not confirmed for availability, and not yet
    voted on whether they can make a set date. Shared by createPlan and addParticipants
    so a late joiner looks exactly like one who was there from the start.
*/
function freshParticipant(userId) {
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
    The fields that clear a confirmation round: everyone's vote is wiped and the probe
    is taken down. Pulled out so picking a new date, voiding a date or moving the range
    all start the next round from a clean slate. invitedIds narrows who is still on the
    invite list for the new round; leaving it out invites everyone back.

    Written in place rather than by rewriting the array, so a confirmation, a vote or a
    whole new guest landing at the same moment survives. Comes back as a $set fragment
    and the options that go with it.

    A narrowed invite list splits the array in two rather than mixing $[] with a filter:
    two paths reaching the same element have to be merged, two matched filters cannot.
*/
function clearedProbe(invitedIds = null) {
    //sentBack too, so what one sent back holds can only come back in the round it was taken
    const wipe = (who) => ({
        [`participants.${who}.vote`]: null,
        [`participants.${who}.voteReason`]: null,
        [`participants.${who}.votedAt`]: null,
        [`participants.${who}.override`]: null,
        [`participants.${who}.sentBack`]: null
    });
    //No probeThreadMessageId: an old plan's own yes/no message waits for updateOpener to delete it
    const probe = {
        probeActive: false,
        probeAllYesNotifiedAt: null,
        //A fresh round of votes to chase, so the nudge cooldown starts over with it
        lastVoteRemindedAt: null
    };

    if (!invitedIds) return { set: { ...wipe('$[]'), 'participants.$[].invited': true, ...probe }, options: {} };

    return {
        set: {
            ...wipe('$[keep]'),
            'participants.$[keep].invited': true,
            ...wipe('$[drop]'),
            'participants.$[drop].invited': false,
            ...probe
        },
        options: { arrayFilters: [{ 'keep.userId': { $in: invitedIds } }, { 'drop.userId': { $nin: invitedIds } }] }
    };
}

//Everyone takes another look. In place for the same reason clearedProbe is.
const unconfirmAll = { 'participants.$[].confirmed': false, 'participants.$[].confirmedAt': null };

/*
    A plan gathers a handful of these at most, but nothing ever prunes them, so the list
    is capped and the oldest fall off the end rather than growing without limit.
*/
const HISTORY_LIMIT = 100;

/*
    One line in a plan's history: what happened, when, and who did it. Kept on the plan
    document rather than in a collection of its own, since these are only ever read with
    the plan they belong to and a deleted plan should take them along.

    The actor's name is stored beside their id rather than looked up when the list is
    drawn. A history that rewrote itself when somebody changed their nickname, or read
    "Someone who left" for every line once they did, would not be much of a history.
*/
export async function addPlanEvent(planId, event) {
    await col(collections.plans).updateOne(
        { planId },
        { $push: { history: { $each: [{ ...event, at: new Date() }], $slice: -HISTORY_LIMIT } } }
    );
}

export async function createPlan({
    guildId,
    name,
    description,
    createdBy,
    actorName,
    dateRange,
    participantIds,
    allowedWeekdays = null,
    timeZone = null,
    repeatWeeks = null,
    repeatedFrom = null,
    //Only the repeat sweep passes one: it claims the id before making the plan, so it has to say which
    planId = null
}) {
    const now = new Date();
    const doc = {
        planId: planId || shortId(10),
        guildId,
        name,
        description,
        createdBy,
        //Who can change it. Plans from before this have none, see hostIdsOf in lib/hosts.js.
        hostIds: [createdBy],
        /*
            Guests see each other's days by name on the overview. Never written onto a plan
            from before it: people on those answered expecting only the planner to see.
        */
        guestsSeeDays: true,
        dateRange,
        /*
            The server's clock, copied on rather than looked up, because every line the
            bot writes about a plan is built from the plan alone and half of them are
            nowhere near a database call. setGuildPlansTimeZone keeps the copies honest.
        */
        timeZone,
        //Which weekdays people can mark, 0 (Sunday) to 6, or null for the whole range
        allowedWeekdays: allowedWeekdays || null,
        /*
            How many weeks until this comes round again, or null for a one off. The next
            one is not made until this one's day has been and gone, so a chain is only
            ever one plan long and a service that was asleep for a month wakes up owing
            one plan rather than four.
        */
        repeatWeeks: repeatWeeks || null,
        //The plan this one came out of, and the one it went into, so a chain can be followed both ways
        repeatedFrom: repeatedFrom || null,
        repeatedInto: null,
        participants: participantIds.map((userId) => freshParticipant(userId)),
        threadId: null,
        //The channel the thread was made under, which can outlive a /setup that moved to a new one
        threadParentId: null,
        openerMessageId: null,
        status: 'collecting',
        chosenDate: null,
        allInNotifiedAt: null,
        //The confirmation probe: off while collecting, and on from the moment a day is set
        probeActive: false,
        probeAllYesNotifiedAt: null,
        createdAt: now,
        //Seeded here rather than pushed after, so the list always opens on the plan starting
        history: [{ type: 'created', at: now, by: createdBy, byName: actorName || '' }]
    };
    await col(collections.plans).insertOne(doc);
    return doc;
}

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
    Everything this person still has on, across every server: plans still collecting
    dates, plus set ones whose day has not come round yet. Backs the landing page
    list, which is the only way back into a plan for someone who lost the DM.
    Cancelled plans and days gone by fall out on their own.

    Plans they are running count as well as plans they are in, since nothing makes a
    planner invite themselves and the guest list alone would hide a plan from the one
    person organising it.
*/
export async function getActivePlansForUser(userId, fromDate) {
    return col(collections.plans)
        .find({
            $and: [
                { $or: [{ 'participants.userId': userId }, { createdBy: userId }] },
                { $or: [{ status: 'collecting' }, { status: 'closed', chosenDate: { $gte: fromDate } }] }
            ]
        })
        .sort({ createdAt: -1 })
        .toArray();
}

/*
    The other end of that list: plans that are over. A cancelled one, or one whose day
    has been and gone. Both drop out of the active query as they finish, which leaves
    the compare page behind them, and everything it remembers about who said what,
    reachable only by whoever still has the link.

    Capped, since this half only ever grows. A dozen is enough to find the one you
    meant and short enough to sit folded under the live ones. Newest made first rather
    than newest finished, so a plan sits where the person who made it would look.
*/
export async function getFinishedPlansForUser(userId, fromDate, limit = 12) {
    return col(collections.plans)
        .find({
            $and: [
                { $or: [{ 'participants.userId': userId }, { createdBy: userId }] },
                { $or: [{ status: 'cancelled' }, { status: 'closed', chosenDate: { $lt: fromDate } }] }
            ]
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
}

/*
    Move every plan in a server onto a new clock, which is what makes the server have
    one rather than each plan carrying whichever was in force the day it was made. A
    plan keeps the day and time it says on it and those now mean an hour elsewhere,
    which is the right way round: the clock gets changed when it was wrong.
*/
export async function setGuildPlansTimeZone(guildId, timeZone) {
    const res = await col(collections.plans).updateMany({ guildId }, { $set: { timeZone } });
    return res.modifiedCount;
}

//Turn repeating on or off. Null is a one off, and stopping never touches the plans already made.
export async function setPlanRepeat(planId, repeatWeeks) {
    await col(collections.plans).updateOne({ planId }, { $set: { repeatWeeks: repeatWeeks || null } });
    return getPlan(planId);
}

/*
    The plans whose day has been and gone and which owe the next one. Cancelled plans
    never match, since only a closed one has a day to be past, so calling a plan off is
    also how you stop the chain without having to say so separately.

    repeatedInto is the guard that makes this safe to run as often as we like: it is
    written the moment the next plan exists, so a sweep that overlaps another, or one
    that runs twice after a restart, cannot make the same plan twice.
*/
export async function getPlansDueToRepeat(beforeDate, limit = 25) {
    return col(collections.plans)
        //$gt: 0 rather than "is set", so this matches the partial index behind it exactly
        .find({
            repeatWeeks: { $gt: 0 },
            repeatedInto: null,
            status: 'closed',
            chosenDate: { $ne: null, $lt: beforeDate }
        })
        .sort({ chosenDate: 1 })
        .limit(limit)
        .toArray();
}

/*
    Claim a plan for repeating, before its replacement is made rather than after. Comes
    back false if somebody else got there first, which is what stops two sweeps running
    at once from making two.
*/
export async function claimForRepeat(planId, nextPlanId) {
    const res = await col(collections.plans).updateOne(
        { planId, repeatedInto: null },
        { $set: { repeatedInto: nextPlanId } }
    );
    return res.modifiedCount === 1;
}

//Let go of a claim whose plan was never actually made, so the next sweep tries again
export async function releaseRepeatClaim(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { repeatedInto: null } });
}

//A repeat that was made but never fully reached Discord, picked up again by the next sweep
export async function setNeedsRepair(planId, needsRepair) {
    await col(collections.plans).updateOne({ planId }, needsRepair ? { $set: { needsRepair: true } } : { $unset: { needsRepair: '' } });
}

export async function getPlansNeedingRepair(limit = 25) {
    return col(collections.plans).find({ needsRepair: true }).limit(limit).toArray();
}

//How many days moved away from keep their answers, in case the plan comes back to one
const PAST_VOTES = 3;

//The day the plan is leaving, with everyone's answer for it, added to the ones kept
function stashVotes(plan) {
    const past = plan?.pastVotes || [];
    if (!plan?.chosenDate) return past;
    const votes = plan.participants
        .filter((p) => p.vote || p.override)
        .map((p) => ({ userId: p.userId, vote: p.vote || null, voteReason: p.voteReason || null, votedAt: p.votedAt || null, override: p.override || null }));
    return [...past.filter((d) => d.date !== plan.chosenDate), { date: plan.chosenDate, round: plan.round || 0, votes }].slice(-PAST_VOTES);
}

/*
    Every yes/no button carries the round it was sent in, so one pressed after the day moved
    cannot answer for the new day. A day moved back to gets its old round again, which puts
    its answers back and makes the buttons sent for it good again. Anything else is a round
    no button has carried yet. A plan from before rounds reads as round 0, the same as a
    button from then.
*/
export function roundFor(plan, date) {
    const past = stashVotes(plan);
    const back = past.find((d) => d.date === date) || null;
    const lastRound = plan?.lastRound ?? plan?.round ?? 0;
    const round = back ? back.round : lastRound + 1;
    return { round, lastRound: Math.max(lastRound, round), pastVotes: past.filter((d) => d !== back), restore: back?.votes || [] };
}

/*
    Lock in the winning date (with an optional time and note) and close the plan off.
    A new date means a fresh confirmation round: any votes from a previous date are
    wiped and everyone is asked about this one, a set day always asking. invitedIds
    is who stays invited for this date, null keeps everyone on the list.
*/
export async function setPlanChosen(planId, date, time = null, note = null, invitedIds = null) {
    const { restore, ...turn } = roundFor(await getPlan(planId), date);
    const { set, options } = clearedProbe(invitedIds);
    await col(collections.plans).updateOne(
        { planId },
        { $set: { chosenDate: date, chosenTime: time, chosenNote: note, status: 'closed', ...set, probeActive: true, ...turn } },
        options
    );
    //After the wipe above rather than in it, since the wipe reaches every participant
    if (restore.length) {
        await col(collections.plans).bulkWrite(
            restore.map((v) => ({
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

/*
    Change only the time and the note on a day that is staying put. Nothing else moves:
    every vote, the confirmation and the invite list all stand, since the day people
    answered about is the same day. Going through setPlanChosen for this wiped the lot.
*/
export async function setPlanWhen(planId, time, note) {
    await col(collections.plans).updateOne({ planId }, { $set: { chosenTime: time, chosenNote: note } });
    return getPlan(planId);
}

/*
    Mark a plan cancelled. We leave the document and its thread in place, the
    thread getting deleted by hand is what finally clears the plan, so a cancelled
    plan just drops out of the open lists in the meantime.

    Null when it was already cancelled, so of two cancels landing together (the site and
    /cancel at once) only one goes on to refund and tell everyone.
*/
export async function markPlanCancelled(planId) {
    return col(collections.plans).findOneAndUpdate(
        { planId, status: { $ne: 'cancelled' } },
        { $set: { status: 'cancelled' } },
        { returnDocument: 'after' }
    );
}

//Note when the stragglers were last nudged, so /remind cannot be spammed
export async function setReminded(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { lastRemindedAt: new Date() } });
}

//The same for the confirmation nudge, kept on its own field so a probe starting does not
//arrive already inside the availability nudge's cooldown
export async function setVoteReminded(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { lastVoteRemindedAt: new Date() } });
}

/*
    The window, the weekdays and the repeat in one write, for the screen that goes back
    out for different dates, which is the only way the site moves any of them. They used
    to have a setter each, so three changes meant three writes and three announcements
    landing in the thread together.

    reopen sends everyone back for their dates. Without it a pure narrowing leaves every
    confirmation standing, and the only tidying left is a set day the narrowed weekdays
    no longer collect, which is dropped on its own.
*/
export async function setPlanDates(planId, { start, end, allowedWeekdays, repeatWeeks, reopen }) {
    const set = {
        'dateRange.start': start,
        'dateRange.end': end,
        allowedWeekdays: allowedWeekdays || null,
        repeatWeeks: repeatWeeks || null
    };
    const plan = await getPlan(planId);

    if (reopen) {
        Object.assign(set, {
            status: 'collecting',
            chosenDate: null,
            chosenTime: null,
            chosenNote: null,
            ...unconfirmAll,
            ...clearedProbe().set,
            pastVotes: stashVotes(plan),
            //A fresh round of dates to chase up, so clear the cooldown and the all-in nudge
            lastRemindedAt: null,
            allInNotifiedAt: null
        });
    } else if (plan.chosenDate && !weekdayAllowed(plan.chosenDate, allowedWeekdays)) {
        Object.assign(set, {
            status: 'collecting',
            chosenDate: null,
            chosenTime: null,
            chosenNote: null,
            ...clearedProbe().set,
            pastVotes: stashVotes(plan),
            allInNotifiedAt: null
        });
    }

    await col(collections.plans).updateOne({ planId }, { $set: set });
    return getPlan(planId);
}

export async function setPlanThread(planId, threadId, threadParentId) {
    await col(collections.plans).updateOne({ planId }, { $set: { threadId, threadParentId } });
}

//Remember which message opened the thread, so a later edit can rewrite that pinned post
export async function setPlanOpener(planId, messageId) {
    await col(collections.plans).updateOne({ planId }, { $set: { openerMessageId: messageId } });
}

//Change a plan's title and description, leaving everything else (dates, guests) alone
/*
    The name and what the plan is about. chosenNote goes with them: the day used to carry
    a line of its own alongside the description, always rendered on the next line down and
    never tellable apart from it, so the two are one field now. Saving here is where a plan
    that still holds an old note lets go of it, the form having offered both joined up.
*/
export async function setPlanDetails(planId, name, description) {
    await col(collections.plans).updateOne({ planId }, { $set: { name, description, chosenNote: null } });
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

/*
    Remove the plans whose threads went with a deleted channel, returning them first.
    Plans threaded before threadParentId was stored have none, and unknownParent takes
    those too: only right when the channel is the one the server's plans are made under.
*/
export async function deletePlansUnderChannel(guildId, channelId, { unknownParent = false } = {}) {
    const under = [{ threadParentId: channelId }];
    //null matches a missing field as well as a stored null
    if (unknownParent) under.push({ threadId: { $ne: null }, threadParentId: null });
    const plans = await col(collections.plans).find({ guildId, $or: under }).toArray();
    if (plans.length) await col(collections.plans).deleteMany({ planId: { $in: plans.map((p) => p.planId) } });
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

/*
    Add people to a plan that is already running, fresh and unconfirmed. One write for the lot.

    Only ids not already on the plan are pushed, and the write matches only while none of
    them is, so two adds landing together cannot put the same person on twice. When the
    other add got there first the write misses and this reads the plan again.
*/
export async function addParticipants(planId, userIds) {
    const ids = [...new Set(userIds)];
    for (let tries = 0; tries < 3; tries++) {
        const plan = await getPlan(planId);
        if (!plan) return null;
        const on = new Set(plan.participants.map((p) => p.userId));
        const fresh = ids.filter((id) => !on.has(id));
        if (!fresh.length) return plan;

        const res = await col(collections.plans).updateOne(
            { planId, 'participants.userId': { $nin: fresh } },
            {
                $push: { participants: { $each: fresh.map((id) => freshParticipant(id)) } },
                //A new face means not everyone is in yet, so let the all-in nudge fire again later
                $set: { allInNotifiedAt: null }
            }
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

//Note that we have told the creator everyone is in, so that nudge only goes once a round
export async function markAllInNotified(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { allInNotifiedAt: new Date() } });
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

/*
    Remember the DM that told each person what the plan is, so a later change rewrites it
    rather than sending a correction after it. One card per person, one write for the lot.
    actorName and moved are what the card's lead line needs and nothing else stores, and
    keepLead leaves the stored ones alone for a card sent without a lead of its own.
*/
export async function setPlanCards(planId, cards, { actorName = '', moved = false, keepLead = false } = {}) {
    if (!cards.length) return;
    const lead = keepLead ? {} : { 'participants.$.cardActor': actorName, 'participants.$.cardMoved': moved };
    await col(collections.plans).bulkWrite(
        cards.map(({ userId, messageId }) => ({
            updateOne: {
                filter: { planId, 'participants.userId': userId },
                update: { $set: { 'participants.$.cardMessageId': messageId, ...lead } }
            }
        })),
        { ordered: false }
    );
}

export async function setDmsClosed(planId, userId, closed) {
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        { $set: { 'participants.$.dmsClosed': closed } }
    );
}

/*
    Forget one person's card, for when the message behind it has gone and a rewrite found out.
    Only while it is still the one on record: a rewrite running off an older read would
    otherwise forget the card that replaced it.
*/
export async function clearPlanCard(planId, userId, messageId) {
    await col(collections.plans).updateOne(
        { planId, participants: { $elemMatch: { userId, cardMessageId: messageId } } },
        { $set: { 'participants.$.cardMessageId': null } }
    );
}

//Plans set before the opener carried the yes/no posted it as a message of its own, this being its id
export async function forgetProbeMessage(planId) {
    await col(collections.plans).updateOne({ planId }, { $unset: { probeThreadMessageId: '' } });
}

//Note that the creator has been told everyone confirmed, so that good-to-go DM only goes once
export async function markProbeAllYes(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { probeAllYesNotifiedAt: new Date() } });
}
