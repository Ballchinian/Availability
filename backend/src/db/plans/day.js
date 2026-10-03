import { col, collections } from '../mongo.js';
import { getPlan } from './find.js';
import { moved } from './rev.js';

//The day a plan is on, its time, and the rounds of yes and no that go with each day

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
//sentBack too, so what one sent back holds can only come back in the round it was taken
export const wipe = (who) => ({
    [`participants.${who}.vote`]: null,
    [`participants.${who}.voteReason`]: null,
    [`participants.${who}.votedAt`]: null,
    [`participants.${who}.override`]: null,
    [`participants.${who}.sentBack`]: null
});

function clearedProbe(invitedIds = null) {
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

//How many days moved away from keep their answers, in case the plan comes back to one
const PAST_VOTES = 3;

//The day the plan is leaving, with everyone's answer for it, added to the ones kept
export function stashVotes(plan) {
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
export async function setPlanChosen(planId, date, time = null, note = null, invitedIds = null, by = null) {
    const { restore, ...turn } = roundFor(await getPlan(planId), date);
    const { set, options } = clearedProbe(invitedIds);
    await col(collections.plans).updateOne(
        { planId },
        moved({ $set: { chosenDate: date, chosenTime: time, chosenNote: note, status: 'closed', ...set, probeActive: true, ...turn } }, by),
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
export async function setPlanWhen(planId, time, note, by = null) {
    await col(collections.plans).updateOne({ planId }, moved({ $set: { chosenTime: time, chosenNote: note } }, by));
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
        moved({ $set: { status: 'cancelled' } }),
        { returnDocument: 'after' }
    );
}
