import { col, collections } from './mongo.js';
import { shortId } from '../lib/ids.js';

/*
    What the bot sends made-up people, and posts in practice plans' threads, kept here in
    place of Discord: { id, planId, to, content, components, pinned, at, editedAt }. to is
    the made-up person, or 'thread'. components are stored as the JSON Discord is sent.
*/

const box = () => col(collections.practiceOutbox);
const bare = { projection: { _id: 0 } };

export async function addToOutbox({ planId, to, content = '', components = [] }) {
    const row = { id: shortId(16), planId, to, content, components, pinned: false, at: new Date(), editedAt: null };
    //insertOne writes an _id onto what it is given
    await box().insertOne({ ...row });
    return row;
}

export async function getOutboxMessage(id) {
    return box().findOne({ id }, bare);
}

//Only what an edit names changes, as with a message edited in Discord
export async function editOutboxMessage(id, patch) {
    return box().findOneAndUpdate({ id }, { $set: { ...patch, editedAt: new Date() } }, { returnDocument: 'after', ...bare });
}

export async function deleteOutboxMessage(id) {
    await box().deleteOne({ id });
}

export async function pinOutboxMessage(id) {
    await box().updateOne({ id }, { $set: { pinned: true } });
}

//Newest first. A thread is its plan's, and a person's messages span every plan they are on.
export async function getOutbox(to, planId = null, limit = 200) {
    return box()
        .find(planId ? { to, planId } : { to }, bare)
        .sort({ at: -1 })
        .limit(limit)
        .toArray();
}

//Everything kept for these plans' threads, and for these people
export async function deleteOutboxFor(planIds, userIds) {
    if (!planIds.length && !userIds.length) return;
    await box().deleteMany({ $or: [{ planId: { $in: planIds } }, { to: { $in: userIds } }] });
}

//One message as the site is sent it
export function outboxShape(row) {
    return {
        id: row.id,
        planId: row.planId,
        content: row.content,
        components: row.components,
        pinned: Boolean(row.pinned),
        at: new Date(row.at).toISOString(),
        editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : null
    };
}
