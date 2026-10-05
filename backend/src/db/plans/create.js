import { col, collections } from '../mongo.js';
import { shortId } from '../../lib/ids.js';
import { freshParticipant } from './people.js';

/*
    A plan is one meetup someone is trying to organise: a name, a date range, the
    people invited, and the thread it lives in. Each invited person carries their
    own confirmed flag, which is about whether they have reviewed for this plan,
    separate from the actual availability data they save.
*/

export async function createPlan({
    guildId,
    name,
    description,
    createdBy,
    actorName,
    dateRange,
    participantIds,
    allowedWeekdays = null,
    timeZone = null,
    repeatWeeks = null,
    //{ id, name } of whoever set it coming round, which the next one in the series carries on
    repeatBy = null,
    repeatedFrom = null,
    //Everyone who runs it, when that is more than whoever made it. The sweep's list can leave createdBy out.
    hostIds = null,
    //Only the repeat sweep passes one: it claims the id before making the plan, so it has to say which
    planId = null
}) {
    const now = new Date();
    const doc = {
        planId: planId || shortId(10),
        guildId,
        name,
        description,
        createdBy,
        //Who can change it. Plans from before this have none, see hostIdsOf in lib/hosts.js.
        hostIds: hostIds || [createdBy],
        /*
            Guests see each other's days by name on the overview. Never written onto a plan
            from before it: people on those answered expecting only the planner to see.
        */
        guestsSeeDays: true,
        dateRange,
        /*
            The server's clock, copied on rather than looked up, because every line the
            bot writes about a plan is built from the plan alone and half of them are
            nowhere near a database call. setGuildPlansTimeZone keeps the copies honest.
        */
        timeZone,
        //Which weekdays people can mark, 0 (Sunday) to 6, or null for the whole range
        allowedWeekdays: allowedWeekdays || null,
        /*
            How many weeks until this comes round again, or null for a one off. The next
            one is not made until this one's day has been and gone, so a chain is only
            ever one plan long and a service that was asleep for a month wakes up owing
            one plan rather than four.
        */
        repeatWeeks: repeatWeeks || null,
        repeatBy: repeatWeeks ? repeatBy : null,
        //The plan this one came out of, and the one it went into, so a chain can be followed both ways
        repeatedFrom: repeatedFrom || null,
        repeatedInto: null,
        participants: participantIds.map((userId) => freshParticipant(userId)),
        threadId: null,
        //The channel the thread was made under, which can outlive a /setup that moved to a new one
        threadParentId: null,
        openerMessageId: null,
        status: 'collecting',
        chosenDate: null,
        allInNotifiedAt: null,
        //The confirmation probe: off while collecting, and on from the moment a day is set
        probeActive: false,
        probeAllYesNotifiedAt: null,
        createdAt: now,
        //Seeded here rather than pushed after, so the list always opens on the plan starting
        history: [{ type: 'created', at: now, by: createdBy, byName: actorName || '' }]
    };
    await col(collections.plans).insertOne(doc);
    return doc;
}

export async function deletePlan(planId) {
    await col(collections.plans).deleteOne({ planId });
}

//Remove every plan in a server (used when the bot is kicked), returning them first
export async function deletePlansForGuild(guildId) {
    const plans = await col(collections.plans).find({ guildId }).toArray();
    await col(collections.plans).deleteMany({ guildId });
    return plans;
}

/*
    Remove the plans whose threads went with a deleted channel, returning them first.
    Plans threaded before threadParentId was stored have none, and unknownParent takes
    those too: only right when the channel is the one the server's plans are made under.
*/
export async function deletePlansUnderChannel(guildId, channelId, { unknownParent = false } = {}) {
    const under = [{ threadParentId: channelId }];
    //null matches a missing field as well as a stored null
    if (unknownParent) under.push({ threadId: { $ne: null }, threadParentId: null });
    const plans = await col(collections.plans).find({ guildId, $or: under }).toArray();
    if (plans.length) await col(collections.plans).deleteMany({ planId: { $in: plans.map((p) => p.planId) } });
    return plans;
}
