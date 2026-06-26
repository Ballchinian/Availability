import { col, collections } from './mongo.js';

/*
    read and write the per server config: which channel is the plans chat,
    which role can drive the bot, and the pinned intro message we posted.
    one document per guild, upserted as setup runs.
*/

export async function getGuildConfig(guildId) {
    return col(collections.guilds).findOne({ guildId });
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
