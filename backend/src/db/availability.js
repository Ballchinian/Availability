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
    const c = col(collections.availability);
    if (onlyDates) {
        await c.deleteMany({ userId, date: { $in: onlyDates } });
    } else {
        await c.deleteMany({ userId, date: { $gte: start, $lte: end } });
    }

    /*
        {userId, date} is unique, so a body naming the same day twice would fail
        the whole insert on a duplicate key. The site cannot send one, it builds
        from object keys, but the endpoint is open to anyone logged in. Last
        mention of a day wins.
    */
    const byDate = new Map();
    for (const d of days) byDate.set(d.date, Array.isArray(d.hours) ? d.hours : []);

    if (byDate.size) {
        const now = new Date();
        await c.insertMany([...byDate].map(([date, hours]) => ({ userId, date, hours, updatedAt: now })));
    }
    return byDate.size;
}
