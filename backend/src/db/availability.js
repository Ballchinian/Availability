import { col, collections } from './mongo.js';

/*
    A person's remembered timetable. One row per free day, global to the person
    rather than tied to a server, since real life availability does not change
    between Discord servers. A day with no row is treated as not free. The hours
    array narrows a day to certain hours, and an empty array means free all day.
*/

export async function getAvailabilityInRange(userId, start, end) {
    return col(collections.availability)
        .find({ userId, date: { $gte: start, $lte: end } })
        .project({ _id: 0, date: 1, hours: 1 })
        .toArray();
}

/*
    The same read for a group of people at once, which is what the compare page
    needs: one query instead of one per confirmed participant. Rows carry userId
    so the caller can group them.
*/
export async function getAvailabilityForUsersInRange(userIds, start, end) {
    if (!userIds.length) return [];
    return col(collections.availability)
        .find({ userId: { $in: userIds }, date: { $gte: start, $lte: end } })
        .project({ _id: 0, userId: 1, date: 1, hours: 1 })
        .toArray();
}

export async function countAvailability(userId) {
    return col(collections.availability).countDocuments({ userId });
}

//Wipes a person's whole timetable, used when their data is no longer needed
export async function deleteAllForUser(userId) {
    await col(collections.availability).deleteMany({ userId });
}

/*
    Take one day out of a person's timetable, used when they lock in a plan for that
    day and want other plans to stop counting them free. A day with no row already
    reads as not free, so this is just a delete of that single day.
*/
export async function blockDay(userId, date) {
    await col(collections.availability).deleteOne({ userId, date });
}

/*
    Put one day back as free, the undo for blockDay. Hours carries the exact hours the
    day had before it was blocked, so a part-day (say 8pm to 11pm) comes back as it was
    rather than blanket all day. An empty hours means free the whole window.
*/
export async function setDayFree(userId, date, hours = []) {
    await col(collections.availability).updateOne(
        { userId, date },
        { $set: { hours: Array.isArray(hours) ? hours : [], updatedAt: new Date() } },
        { upsert: true }
    );
}

/*
    A quick read of how their timetable stands, worked out straight from the saved
    data so it is always current. lastFilled is the furthest forward day they have
    marked, the front edge of their timetable. lastUpdatedAt is the most recent
    time they touched any of it, which tells us if it is going stale.
*/
export async function getAvailabilitySummary(userId) {
    const c = col(collections.availability);
    const byDate = await c.find({ userId }).sort({ date: -1 }).limit(1).next();
    const byUpdate = await c.find({ userId }).sort({ updatedAt: -1 }).limit(1).next();
    return {
        lastFilled: byDate?.date || null,
        lastUpdatedAt: byUpdate?.updatedAt || null
    };
}

/*
    Replace the free days inside one date range with exactly what they just sent.
    Anything in range they left out is now not free and gets dropped. Days outside
    the range are untouched, so their wider timetable carries over to other plans.

    A plan pinned to certain weekdays passes onlyDates, the exact days it asks
    about. Then we only clear and rewrite those, so a weekends-only plan leaves the
    person's weekday availability from other plans alone rather than wiping it.

    Returns how many days were actually written.
*/
export async function replaceAvailabilityInRange(userId, start, end, days, onlyDates = null) {
    /*
        {userId, date} is unique, so a body naming the same day twice would fail
        the whole write on a duplicate key. The site cannot send one, it builds
        from object keys, but the endpoint is open to anyone logged in. Last
        mention of a day wins.
    */
    const byDate = new Map();
    for (const d of days) byDate.set(d.date, Array.isArray(d.hours) ? d.hours : []);

    const scope = onlyDates ? { $in: onlyDates } : { $gte: start, $lte: end };
    const now = new Date();
    /*
        One write rather than a delete and an insert, and the delete leaves out
        every day being written, so there is no window where a day is neither the
        old value nor the new one. A save that fails part way through can lose the
        days somebody unmarked, never the ones they marked.
    */
    await col(collections.availability).bulkWrite(
        [
            { deleteMany: { filter: { userId, date: { ...scope, $nin: [...byDate.keys()] } } } },
            ...[...byDate].map(([date, hours]) => ({
                updateOne: { filter: { userId, date }, update: { $set: { hours, updatedAt: now } }, upsert: true }
            }))
        ],
        //The delete and the upserts never touch the same day, so the order they run in does not matter
        { ordered: false }
    );
    return byDate.size;
}
