import { col, collections } from '../mongo.js';
import { getPlan } from './find.js';
import { moved } from './rev.js';

//Plans that come round again, and the sweep that makes the next one

//Turn repeating on or off. Null is a one off, and stopping never touches the plans already made.
export async function setPlanRepeat(planId, repeatWeeks) {
    const set = repeatWeeks ? { repeatWeeks } : { repeatWeeks: null, repeatBy: null };
    await col(collections.plans).updateOne({ planId }, moved({ $set: set }));
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
