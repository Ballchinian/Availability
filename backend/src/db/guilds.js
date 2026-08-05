import { col, collections } from './mongo.js';

/*
    Read and write the per server config: which channel is the plans chat,
    which role can drive the bot, and the pinned intro message we posted.
    One document per guild, upserted as setup runs.
*/

export async function getGuildConfig(guildId) {
    return col(collections.guilds).findOne({ guildId });
}

//Several servers in one query, for the landing page listing everything someone is in
export async function getGuildConfigs(guildIds) {
    return col(collections.guilds)
        .find({ guildId: { $in: guildIds } })
        .toArray();
}

export async function saveGuildConfig(guildId, patch) {
    const now = new Date();
    await col(collections.guilds).updateOne(
        { guildId },
        {
            $set: { ...patch, guildId, updatedAt: now },
            $setOnInsert: { createdAt: now }
        },
        { upsert: true }
    );
    return getGuildConfig(guildId);
}

export async function deleteGuildConfig(guildId) {
    await col(collections.guilds).deleteOne({ guildId });
}

//Setup is no longer usable, e.g. the plans channel was deleted, so flag a redo
export async function markSetupBroken(guildId) {
    await col(collections.guilds).updateOne({ guildId }, { $set: { setupComplete: false } });
}
