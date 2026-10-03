import { isPracticeId } from '../lib/practice.js';
import { getPracticePeopleById } from '../db/practice.js';

/*
    A plan holding anyone made up is a practice plan, for the planner who made them, and
    holds only their made-up people and them. Nothing about it reaches anyone else.
*/

export const MIXED = 'A practice plan can only have your made-up people and you on it.';
export const MADE_UP_ONLY = 'Made-up people can only go on a practice plan.';

//Whose practice a new plan is: the planner behind a made-up person starting it, or one naming any. Null for a real plan.
export function practiceOwnerFor(req, ids) {
    if (isPracticeId(req.user.id)) return req.realUser.id;
    return ids.some(isPracticeId) ? req.user.id : null;
}

//Why ids cannot all be on a plan that is owner's practice, or a real one when owner is null. Null when they can.
export async function mixRefusal(owner, ids) {
    const madeUp = [...new Set(ids.filter(isPracticeId))];
    if (!owner) return madeUp.length ? MADE_UP_ONLY : null;
    if (ids.some((id) => !isPracticeId(id) && id !== owner)) return MIXED;
    const theirs = new Set((await getPracticePeopleById(madeUp)).filter((p) => p.ownerId === owner).map((p) => p.id));
    return madeUp.every((id) => theirs.has(id)) ? null : MIXED;
}
