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

    They get a user record like anyone who has logged in, since that is where a calendar's
    answers and clock are kept, and its server list is what clears it if the bot leaves.
*/
export async function addPracticePerson({ id, ownerId, guildId, displayName, planner }) {
    if ((await people().countDocuments({ ownerId, guildId })) >= PRACTICE_LIMIT) return null;
    const now = new Date();
    const person = { id, ownerId, guildId, displayName, planner: Boolean(planner), createdAt: now };
    //insertOne writes an _id onto what it is given
    await people().insertOne({ ...person });
    await col(collections.users).updateOne(
        { userId: id },
        { $setOnInsert: { userId: id, displayName, guilds: [guildId], createdAt: now, tokenVersion: 0 } },
        { upsert: true }
    );
    return person;
}

//Nobody ever signs in as one, so there is no session version to keep the way forgetUser does
export async function removePracticePerson(id, ownerId) {
    const res = await people().deleteOne({ id, ownerId });
    if (res.deletedCount !== 1) return false;
    await col(collections.users).deleteOne({ userId: id });
    return true;
}
