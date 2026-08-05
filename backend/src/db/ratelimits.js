import { col, collections } from './mongo.js';

/*
    The one real guard against spamming people: how many times a person has fired
    a noisy action (start a plan, push a date out, lock one in) in a server lately.
    We keep the timestamps of recent hits per person per server per action, drop
    anything past the window, and count what is left against their allowance. The
    handful we track is tiny, so the list never grows.
*/

const WINDOW_MS = 24 * 60 * 60 * 1000;

/*
    Check the allowance and, if there is room, spend one. Returns whether it went
    through, and when it does not, how long until the oldest hit ages out so the
    caller can say "try again in N hours". Spending happens here, so a caller that
    gets allowed: true has already used the slot.
*/
export async function takeAction(userId, guildId, action, limit) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - WINDOW_MS);
    const key = { userId, guildId, action };
    const c = col(collections.ratelimits);

    //Only the hits still inside the window, the same expression the guard and the write both need
    const surviving = { $filter: { input: { $ifNull: ['$hits', []] }, cond: { $gt: ['$$this', cutoff] } } };

    /*
        The counter has to exist before the guarded update, which cannot upsert:
        with the count condition in its filter, a miss would mean inserting a
        second row for the same key and tripping the unique index.
    */
    await c.updateOne(key, { $setOnInsert: { hits: [] } }, { upsert: true });

    /*
        Ageing out the old hits, counting the survivors and spending one all happen
        inside a single update, so two requests arriving together cannot both read
        the same count and both be let through.
    */
    const spent = await c.findOneAndUpdate(
        { ...key, $expr: { $lt: [{ $size: surviving }, limit] } },
        [{ $set: { hits: { $concatArrays: [surviving, [now]] } } }],
        { returnDocument: 'after' }
    );

    if (spent) return { allowed: true, used: spent.hits.length, limit };

    //Refused, so reread only to say when the oldest hit ages out. Kept in order, oldest first.
    const doc = await c.findOne(key);
    const recent = (doc?.hits || []).filter((t) => new Date(t).getTime() > cutoff.getTime());
    const freesAt = recent.length ? new Date(recent[0]).getTime() + WINDOW_MS : now.getTime();
    const retryAfterHours = Math.max(1, Math.ceil((freesAt - now.getTime()) / 3600000));
    return { allowed: false, used: recent.length, limit, retryAfterHours };
}

/*
    Give one slot back, used when a plan is cancelled so starting and scrapping a
    plan to try things out does not eat into the day's allowance. Drops the newest
    hit, since that is the one being undone.
*/
export async function refundAction(userId, guildId, action) {
    const key = { userId, guildId, action };
    const doc = await col(collections.ratelimits).findOne(key);
    if (!doc?.hits?.length) return;
    const hits = doc.hits.slice(0, -1);
    await col(collections.ratelimits).updateOne(key, { $set: { hits } });
}
