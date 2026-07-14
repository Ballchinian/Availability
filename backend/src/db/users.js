import { col, collections } from './mongo.js';

/*
    The global user record. One per Discord person, shared across every server,
    since who they are (and later their real life availability) does not change
    from one guild to the next. Refreshed each time they log in.
*/

export async function upsertUser(user) {
    const now = new Date();
    await col(collections.users).updateOne(
        { userId: user.id },
        {
            $set: {
                userId: user.id,
                username: user.username,
                displayName: user.displayName,
                avatar: user.avatar,
                lastSeenAt: now
            },
            $setOnInsert: { createdAt: now }
        },
        { upsert: true }
    );
}

export async function getUserById(userId) {
    return col(collections.users).findOne({ userId });
}

/*
    We track which servers (that have the bot) each known user is in. That is how
    we know when their data is redundant: once they share no server with the bot,
    their timetable is no use to anyone and gets cleared out.
*/
export async function setUserGuilds(userId, guildIds) {
    await col(collections.users).updateOne({ userId }, { $set: { guilds: guildIds } });
}

export async function addUserGuild(userId, guildId) {
    await col(collections.users).updateOne({ userId }, { $addToSet: { guilds: guildId } });
}

export async function removeUserGuild(userId, guildId) {
    await col(collections.users).updateOne({ userId }, { $pull: { guilds: guildId } });
}

export async function getUsersInGuild(guildId) {
    return col(collections.users).find({ guilds: guildId }).toArray();
}

export async function deleteUser(userId) {
    await col(collections.users).deleteOne({ userId });
}

/*
    How far ahead this person can honestly plan. Days past it read as "too far to
    say" rather than busy, so nobody has to paint fake no's across far-off months
    just to stop early dates slipping away. Null means no limit.
*/
export async function setSureUntil(userId, date) {
    await col(collections.users).updateOne({ userId }, { $set: { sureUntil: date || null } });
}

//The certainty horizons for a set of people in one query, keyed by user id
export async function getSureUntilMap(userIds) {
    const rows = await col(collections.users)
        .find({ userId: { $in: userIds } })
        .project({ _id: 0, userId: 1, sureUntil: 1 })
        .toArray();
    const map = {};
    for (const r of rows) map[r.userId] = r.sureUntil || null;
    return map;
}
