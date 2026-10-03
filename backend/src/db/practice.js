import { col, collections } from './mongo.js';
import { PRACTICE_LIMIT } from '../lib/practice.js';

/*
    The made-up people, one document each: { id, ownerId, guildId, displayName, planner }.
    Whoever made them is the only one who sees them, and only in the server they were
    made for.
*/

const people = () => col(collections.practice);
const bare = { projection: { _id: 0 } };

//Oldest first, so a list keeps its order as people are added
export async function getPracticePeople(ownerId, guildId = null) {
    return people().find(guildId ? { ownerId, guildId } : { ownerId }, bare).sort({ createdAt: 1 }).toArray();
}

export async function getPracticePerson(id) {
    return people().findOne({ id }, bare);
}

export async function getPracticePeopleById(ids) {
    if (!ids.length) return [];
    return people().find({ id: { $in: ids } }, bare).toArray();
}

/*
    Null when the owner already has PRACTICE_LIMIT in that server. Counted before the
    insert, so two adds at once can land one over, which costs nothing.
*/
export async function addPracticePerson({ id, ownerId, guildId, displayName, planner }) {
    if ((await people().countDocuments({ ownerId, guildId })) >= PRACTICE_LIMIT) return null;
    const person = { id, ownerId, guildId, displayName, planner: Boolean(planner), createdAt: new Date() };
    //insertOne writes an _id onto what it is given
    await people().insertOne({ ...person });
    return person;
}

export async function removePracticePerson(id, ownerId) {
    const res = await people().deleteOne({ id, ownerId });
    return res.deletedCount === 1;
}
