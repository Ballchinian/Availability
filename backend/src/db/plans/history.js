import { col, collections } from '../mongo.js';

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
