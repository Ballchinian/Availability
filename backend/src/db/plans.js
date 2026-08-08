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
        //The DM saying what the plan is, rewritten in place when it changes. See setPlanCards.
        cardMessageId: null,
        cardActor: '',
        cardMoved: false
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
    const wipe = (who) => ({
        [`participants.${who}.vote`]: null,
        [`participants.${who}.voteReason`]: null,
        [`participants.${who}.votedAt`]: null,
        [`participants.${who}.override`]: null
    });
    const probe = {
        probeActive: false,
        probeThreadMessageId: null,
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
        openerMessageId: null,
        status: 'collecting',
        chosenDate: null,
        allInNotifiedAt: null,
        //The confirmation probe: off until a planner asks people to confirm a set date
        probeActive: false,
        probeThreadMessageId: null,
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
    wiped and the probe is reset, ready for a planner to ask people again. invitedIds
    is who stays invited for this date, null keeps everyone on the list.
*/
export async function setPlanChosen(planId, date, time = null, note = null, invitedIds = null) {
    const { set, options } = clearedProbe(invitedIds);
    await col(collections.plans).updateOne(
        { planId },
        { $set: { chosenDate: date, chosenTime: time, chosenNote: note, status: 'closed', ...set } },
        options
    );
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

//Undo a confirmed date and reopen the plan so a fresh day can be picked. The date is
//gone, so any confirmation votes for it go with it.
export async function voidPlanChoice(planId) {
    const { set } = clearedProbe();
    await col(collections.plans).updateOne(
        { planId },
        { $set: { chosenDate: null, chosenTime: null, chosenNote: null, status: 'collecting', ...set } }
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

//The same for the confirmation nudge, kept on its own field so a probe starting does not
//arrive already inside the availability nudge's cooldown
export async function setVoteReminded(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { lastVoteRemindedAt: new Date() } });
}

/*
    Set a fresh start and end on the plan and reopen it. Everyone's confirmed flag
    is reset so they all take another look at the new window, but their saved
    availability is left alone, so anyone whose timetable already reaches the new
    dates just needs a quick glance. Any date that had been picked is cleared too,
    since the window moved out from under it.
*/
export async function setPlanRange(planId, start, end) {
    //The window moved, so any date and its votes are gone too, start the round clean
    const { set } = clearedProbe();
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
                ...unconfirmAll,
                ...set,
                //A fresh round of dates to chase up, so clear the cooldown and the all-in nudge
                lastRemindedAt: null,
                allInNotifiedAt: null
            }
        }
    );
    return getPlan(planId);
}

/*
    Change which weekdays a plan asks about. Saved availability is always left alone.

    reopen is set when the change opens a day nobody has been asked about yet (a pure
    addition, or a swap that brings in a new day). Then it behaves like moving the
    range: everyone's confirmed flag is reset so they take another look, and any picked
    date is dropped, since the shape of a good day just changed.

    A pure narrowing (only taking days away) leaves confirmations standing, so nobody
    has to redo anything. The one thing it still has to tidy is a picked date that now
    lands on a day the plan no longer collects: that date is cleared and the plan
    reopens so a new one can be chosen, but the confirmations stay.
*/
export async function setPlanWeekdays(planId, allowedWeekdays, { reopen }) {
    const set = { allowedWeekdays: allowedWeekdays || null };
    //Only the narrowing case has anything to decide, and what it reads is the date, not the guest list
    const plan = reopen ? null : await getPlan(planId);

    if (reopen) {
        Object.assign(set, {
            status: 'collecting',
            chosenDate: null,
            chosenTime: null,
            chosenNote: null,
            ...unconfirmAll,
            ...clearedProbe().set,
            //A fresh round of dates to chase up, so clear the cooldown and the all-in nudge
            lastRemindedAt: null,
            allInNotifiedAt: null
        });
    } else if (plan.chosenDate && !weekdayAllowed(plan.chosenDate, allowedWeekdays)) {
        //Narrowing knocked out the day the date sat on, so drop the date and reopen, but the
        //confirmations (and everyone's saved availability) still stand
        Object.assign(set, {
            status: 'collecting',
            chosenDate: null,
            chosenTime: null,
            chosenNote: null,
            ...clearedProbe().set,
            allInNotifiedAt: null
        });
    }

    await col(collections.plans).updateOne({ planId }, { $set: set });
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

//Add people to a plan that is already running, fresh and unconfirmed. One write for the lot.
export async function addParticipants(planId, userIds) {
    await col(collections.plans).updateOne(
        { planId },
        {
            $push: { participants: { $each: userIds.map((id) => freshParticipant(id)) } },
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
    reason only makes sense alongside a no. Their own answer also clears any manual
    call a planner made on them, since the horse's mouth beats a guess.
*/
export async function recordVote(planId, userId, vote, reason = null) {
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        {
            $set: {
                'participants.$.vote': vote,
                'participants.$.voteReason': vote === 'no' ? reason : null,
                'participants.$.votedAt': new Date(),
                'participants.$.override': null
            }
        }
    );
    return getPlan(planId);
}

/*
    A planner's manual call on whether someone is coming, laid over their real vote.
    "yes" and "no" override whatever the person answered (or did not answer), null
    clears it and lets their own answer stand again. reinvite puts them back on the
    invite list at the same time, which is how a planner lets in someone who was
    left off when the date was locked.
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

/*
    Remember the DM that told each person what the plan is, so a later change rewrites it
    rather than sending a correction after it. One card per person, one write for the lot.
    actorName and moved are what the card's lead line needs and nothing else stores.
*/
export async function setPlanCards(planId, cards, { actorName = '', moved = false } = {}) {
    if (!cards.length) return;
    await col(collections.plans).bulkWrite(
        cards.map(({ userId, messageId }) => ({
            updateOne: {
                filter: { planId, 'participants.userId': userId },
                update: {
                    $set: {
                        'participants.$.cardMessageId': messageId,
                        'participants.$.cardActor': actorName,
                        'participants.$.cardMoved': moved
                    }
                }
            }
        })),
        { ordered: false }
    );
}

//Forget one person's card, for when the message behind it has gone and a rewrite found out
export async function clearPlanCard(planId, userId) {
    await col(collections.plans).updateOne(
        { planId, 'participants.userId': userId },
        { $set: { 'participants.$.cardMessageId': null } }
    );
}

/*
    Turn the probe on or off, and remember which thread message carries its buttons.

    Leaving threadMessageId out keeps the one already there, which is how a reopen revives
    the old poll instead of posting a second; pass null to really forget it. No vote is
    touched either way, a probe being a switch rather than a round. clearedProbe wipes them.
*/
export async function setProbe(planId, { active, threadMessageId }) {
    const set = { probeActive: active };
    if (threadMessageId !== undefined) set.probeThreadMessageId = threadMessageId;
    await col(collections.plans).updateOne({ planId }, { $set: set });
    return getPlan(planId);
}

//Note that the creator has been told everyone confirmed, so that good-to-go DM only goes once
export async function markProbeAllYes(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { probeAllYesNotifiedAt: new Date() } });
}
