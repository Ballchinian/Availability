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
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const key = { userId, guildId, action };

    const doc = await col(collections.ratelimits).findOne(key);
    //Kept in order, so the survivors stay oldest-first
    const recent = (doc?.hits || []).filter((t) => new Date(t).getTime() > cutoff);

    if (recent.length >= limit) {
        const freesAt = new Date(recent[0]).getTime() + WINDOW_MS;
        const retryAfterHours = Math.max(1, Math.ceil((freesAt - now) / 3600000));
        return { allowed: false, used: recent.length, limit, retryAfterHours };
    }

    recent.push(new Date(now));
    await col(collections.ratelimits).updateOne(
        key,
        { $set: { userId, guildId, action, hits: recent } },
        { upsert: true }
    );
    return { allowed: true, used: recent.length, limit };
}
