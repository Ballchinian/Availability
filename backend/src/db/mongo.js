import { MongoClient } from 'mongodb';
import { config } from '../config.js';

/*
    Thin wrapper around the mongo driver. One client for the whole process, a
    getDb() everything else calls, and an index pass on boot so the queries we
    lean on later (per user per day availability, plans by guild) stay quick.
*/

let client = null;
let db = null;
//Only ever one background reconnect loop, and it stops when the process is going down
let retrying = false;
let shuttingDown = false;

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

    /*
        Nothing is published until the connection and the index pass have both
        gone through, so a half finished attempt cannot leave getDb() handing out
        a database the queries below have never been prepared on.
    */
    const attempt = new MongoClient(config.mongoUri);
    try {
        await attempt.connect();
        const database = attempt.db(config.mongoDb);
        await ensureIndexes(database);
        client = attempt;
        db = database;
    } catch (err) {
        await attempt.close().catch(() => {});
        throw err;
    }

    console.log(`[mongo] connected to ${config.mongoDb}`);
    return db;
}

const RETRY_START_MS = 1000;
const RETRY_MAX_MS = 60000;

/*
    Keep trying in the background after the first connection fails. Boot carries on
    without a database on purpose, which is right for local dev, but without this a
    blip in the seconds around startup leaves db null forever: every route throws
    and nothing ever tries again until someone restarts it by hand.

    Not awaited by the caller. Doubles the wait up to a minute and stays there.
*/
export function retryMongo() {
    if (retrying || db || !config.mongoUri) return;
    retrying = true;

    (async () => {
        let wait = RETRY_START_MS;
        while (!db && !shuttingDown) {
            await new Promise((resolve) => setTimeout(resolve, wait));
            if (shuttingDown) break;
            try {
                await connectMongo();
            } catch (err) {
                wait = Math.min(wait * 2, RETRY_MAX_MS);
                console.error(`[mongo] still down (${err.message}), trying again in ${Math.round(wait / 1000)}s`);
            }
        }
        retrying = false;
    })();
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
    //Backs getUsersInGuild, which filters on the array itself
    await database.collection(collections.users).createIndex({ guilds: 1 });
    //One availability row per user per day, upserted as people edit their schedule
    await database.collection(collections.availability).createIndex({ userId: 1, date: 1 }, { unique: true });
    //Backs the "last updated" lookup in getAvailabilitySummary
    await database.collection(collections.availability).createIndex({ userId: 1, updatedAt: -1 });
    await database.collection(collections.plans).createIndex({ planId: 1 }, { unique: true });
    await database.collection(collections.plans).createIndex({ guildId: 1 });
    //Every /compare and /cancel starts by finding the plan behind the thread
    await database.collection(collections.plans).createIndex({ threadId: 1 });
    //Backs getPlansCoveredBy and getOpenPlansForUser, which guildId alone does not cover
    await database.collection(collections.plans).createIndex({ 'participants.userId': 1, status: 1 });
    //The other half of the landing page list: the plans someone runs, whether or not they are in them
    await database.collection(collections.plans).createIndex({ createdBy: 1, status: 1 });
    //One counter per person per server per action, the key we look spam up by
    await database.collection(collections.ratelimits).createIndex({ userId: 1, guildId: 1, action: 1 }, { unique: true });
}

export async function closeMongo() {
    shuttingDown = true;
    if (client) await client.close();
    client = null;
    db = null;
}
