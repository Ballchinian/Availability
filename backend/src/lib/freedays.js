import { safeZone, retimeDay } from './zones.js';
import { DAY_HOURS } from './hours.js';

/*
    Everyone's stored days read into the clock the plan runs on, grouped by the plan's
    own days. Their day is theirs, so it lands on one or two of the server's and usually
    not lined up: someone an hour ahead is free from 11pm the night before as far as this
    grid is concerned. Feed it rows from a day either side of the range, since that is
    where the spill comes from, and anything still landing outside is dropped here.

    Kept in the order the ids come in, since the overlap maths on the site breaks ties by
    position. Two of someone's days can land on one of the server's, so their hours are
    gathered per day before anything goes out, and a set that fills out to the whole day
    goes back to the empty that means all day: a server where everyone shares one clock
    sends exactly what it always did.
*/
export function gatherFreeDays(rows, { userIds, prefs = {}, zone, start, end }) {
    const byUser = new Map();
    for (const r of rows) {
        if (!byUser.has(r.userId)) byUser.set(r.userId, []);
        byUser.get(r.userId).push(r);
    }

    const freeByDate = {};
    for (const userId of userIds) {
        //Their own clock, which is whatever their browser last said and may be nothing at all
        const theirs = safeZone(prefs[userId]?.timeZone);
        const gathered = new Map();
        for (const a of byUser.get(userId) || []) {
            for (const day of retimeDay(theirs, zone, a.date, a.hours || [])) {
                if (day.date < start || day.date > end) continue;
                if (!gathered.has(day.date)) gathered.set(day.date, new Set());
                const set = gathered.get(day.date);
                for (const h of day.hours.length ? day.hours : DAY_HOURS) set.add(h);
            }
        }
        for (const [date, set] of gathered) {
            const hours = set.size === DAY_HOURS.length ? [] : [...set].sort((a, b) => a - b);
            (freeByDate[date] ||= []).push({ userId, hours });
        }
    }

    return freeByDate;
}
