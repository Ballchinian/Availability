import { MongoClient } from 'mongodb';
import { config } from '../config.js';

/*
    Thin wrapper around the mongo driver. One client for the whole process, a
    getDb() everything else calls, and an index pass on boot so the queries we
    lean on later (per user per day availability, plans by guild) stay quick.
*/

let client = null;
let db = null;

//Collection names live here so nothing hardcodes a typo
export const collections = {
    guilds: 'guilds',
    users: 'users',
    availability: 'availability',
    plans: 'plans',
    ratelimits: 'ratelimits'
};

export async function connectMongo() {
    if (!config.mongoUri) {
        console.warn('[mongo] no MONGODB_URI set, the database is offline for this run');
        return null;
    }
    if (db) return db;

    client = new MongoClient(config.mongoUri);
    await client.connect();
    db = client.db(config.mongoDb);
    await ensureIndexes(db);
    console.log(`[mongo] connected to ${config.mongoDb}`);
    return db;
}

export function getDb() {
    if (!db) throw new Error('mongo is not connected yet');
    return db;
}

//Handy shortcut so callers write col('plans') instead of getDb().collection(...)
export function col(name) {
    return getDb().collection(name);
}

export function isMongoReady() {
    return Boolean(db);
}

async function ensureIndexes(database) {
    await database.collection(collections.guilds).createIndex({ guildId: 1 }, { unique: true });
    await database.collection(collections.users).createIndex({ userId: 1 }, { unique: true });
    //One availability row per user per day, upserted as people edit their schedule
    await database.collection(collections.availability).createIndex({ userId: 1, date: 1 }, { unique: true });
    await database.collection(collections.plans).createIndex({ planId: 1 }, { unique: true });
    await database.collection(collections.plans).createIndex({ guildId: 1 });
    //One counter per person per server per action, the key we look spam up by
    await database.collection(collections.ratelimits).createIndex({ userId: 1, guildId: 1, action: 1 }, { unique: true });
}

export async function closeMongo() {
    if (client) await client.close();
    client = null;
    db = null;
}
