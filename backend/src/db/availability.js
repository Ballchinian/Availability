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
*/
export async function replaceAvailabilityInRange(userId, start, end, days, onlyDates = null) {
    const c = col(collections.availability);
    if (onlyDates) {
        await c.deleteMany({ userId, date: { $in: onlyDates } });
    } else {
        await c.deleteMany({ userId, date: { $gte: start, $lte: end } });
    }
    if (days.length) {
        const now = new Date();
        await c.insertMany(
            days.map((d) => ({
                userId,
                date: d.date,
                hours: Array.isArray(d.hours) ? d.hours : [],
                updatedAt: now
            }))
        );
    }
}
