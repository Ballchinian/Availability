import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { todayIn, dayHasPassed } from '../lib/zones.js';
import { saveAnswered } from '../lib/answered.js';

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
        //A missed pass is caught on the next boot, and is no reason to go without a database
        await askOnSetDays(database).catch((err) => console.error('[mongo] turning on yes/no for set days failed:', err));
        await carryOverAnswers(database).catch((err) => console.error('[mongo] carrying answers over failed:', err));
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
    //Every /overview and /cancel starts by finding the plan behind the thread
    await database.collection(collections.plans).createIndex({ threadId: 1 });
    //Backs getOpenPlansForUser and getCollectingPlansForUser, which guildId alone does not cover
    await database.collection(collections.plans).createIndex({ 'participants.userId': 1, status: 1 });
    //The other half of the landing page list: the plans someone runs, whether or not they are in them
    await database.collection(collections.plans).createIndex({ hostIds: 1, status: 1 });
    //The same for plans from before hosts were stored, which whoever made them runs
    await database.collection(collections.plans).createIndex({ createdBy: 1, status: 1 });
    /*
        What the repeat sweep asks for, on a timer forever. Partial rather than sparse:
        sparse on a compound only skips a document missing every key, and these all carry
        a chosenDate, so it would index every plan ever made to find the few that repeat.
        The sweep's own filter is written as the same `$gt: 0` so the planner can use it.
    */
    await database
        .collection(collections.plans)
        .createIndex({ repeatWeeks: 1, repeatedInto: 1, chosenDate: 1 }, { partialFilterExpression: { repeatWeeks: { $gt: 0 } } });
    //The same sweep's other question, which almost no plan ever answers yes to
    await database.collection(collections.plans).createIndex({ needsRepair: 1 }, { partialFilterExpression: { needsRepair: true } });
    //One counter per person per server per action, the key we look spam up by
    await database.collection(collections.ratelimits).createIndex({ userId: 1, guildId: 1, action: 1 }, { unique: true });
}

/*
    Every set day asks who can make it. Plans set before that was so, with asking left off,
    get it turned on, but only for a day still to come on the plan's own clock: a day that
    has been has nobody left to ask. Runs every boot and finds nothing once it has.
*/
export async function askOnSetDays(database) {
    const plans = database.collection(collections.plans);
    //Nowhere is further behind than UTC-12, so no day still to come is before its today
    const found = await plans
        .find(
            { status: 'closed', probeActive: { $ne: true }, chosenDate: { $gte: todayIn('Etc/GMT+12') } },
            { projection: { planId: 1, chosenDate: 1, timeZone: 1 } }
        )
        .toArray();
    const due = found.filter((plan) => !dayHasPassed(plan)).map((plan) => plan.planId);
    if (due.length) await plans.updateMany({ planId: { $in: due } }, { $set: { probeActive: true } });
    return due.length;
}

/*
    Participants from before in was stored. They read as in off confirmed or a yes (inOf
    in shared/coverage.js), but sending a plan back for dates clears confirmed and moving
    its day clears votes, so that only lasts until the plan next changes. So each one is
    written down here once, after anyone who filled in a plan still collecting gets its
    window as answered, or they would all read as "In, no dates yet".

    Only participants with no in, never everyone confirmed: a window widened later must
    not count as answered for people who were confirmed before it widened. The windows go
    first so a failure part way leaves in unwritten and the next boot tries again.
*/
export async function carryOverAnswers(database) {
    const plans = database.collection(collections.plans);
    const today = todayIn('Etc/GMT+12');
    const legacy = { confirmed: true, in: { $exists: false } };

    const open = await plans
        .find(
            { status: 'collecting', 'dateRange.end': { $gte: today }, participants: { $elemMatch: legacy } },
            { projection: { dateRange: 1, allowedWeekdays: 1, participants: 1 } }
        )
        .toArray();
    const byUser = new Map();
    for (const plan of open) {
        const window = { start: plan.dateRange.start, end: plan.dateRange.end, allowedWeekdays: plan.allowedWeekdays || null };
        for (const p of plan.participants) {
            if (!p.confirmed || p.in !== undefined) continue;
            if (!byUser.has(p.userId)) byUser.set(p.userId, []);
            byUser.get(p.userId).push(window);
        }
    }
    const users = database.collection(collections.users);
    for (const [userId, windows] of byUser) await saveAnswered(users, userId, windows, today);

    for (const [field, value] of [['confirmed', true], ['vote', 'yes']]) {
        await plans.updateMany(
            { participants: { $elemMatch: { in: { $exists: false }, [field]: value } } },
            { $set: { 'participants.$[p].in': true } },
            { arrayFilters: [{ 'p.in': { $exists: false }, [`p.${field}`]: value }] }
        );
    }
    return byUser.size;
}

export async function closeMongo() {
    shuttingDown = true;
    if (client) await client.close();
    client = null;
    db = null;
}
