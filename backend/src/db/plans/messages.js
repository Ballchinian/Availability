import { col, collections } from '../mongo.js';

//What the bot sent about a plan and when, so it can be found again or not sent twice

//Note when the stragglers were last nudged, so /remind cannot be spammed
export async function setReminded(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { lastRemindedAt: new Date() } });
}

//The same for the confirmation nudge, kept on its own field so a probe starting does not
//arrive already inside the availability nudge's cooldown
export async function setVoteReminded(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { lastVoteRemindedAt: new Date() } });
}

export async function setPlanThread(planId, threadId, threadParentId) {
    await col(collections.plans).updateOne({ planId }, { $set: { threadId, threadParentId } });
}

//Remember which message opened the thread, so a later edit can rewrite that pinned post
export async function setPlanOpener(planId, messageId) {
    await col(collections.plans).updateOne({ planId }, { $set: { openerMessageId: messageId } });
}

//Note that whoever runs the plan has been told everyone is in, so that nudge only goes once a round
export async function markAllInNotified(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { allInNotifiedAt: new Date() } });
}

/*
    Remember the DM that told each person what the plan is, so a later change rewrites it
    rather than sending a correction after it. One card per person, one write for the lot.
    actorName and moved are what the card's lead line needs and nothing else stores, and
    keepLead leaves the stored ones alone for a card sent without a lead of its own.
*/
export async function setPlanCards(planId, cards, { actorName = '', moved = false, keepLead = false } = {}) {
    if (!cards.length) return;
    const lead = keepLead ? {} : { 'participants.$.cardActor': actorName, 'participants.$.cardMoved': moved };
    await col(collections.plans).bulkWrite(
        cards.map(({ userId, messageId }) => ({
            updateOne: {
                filter: { planId, 'participants.userId': userId },
                update: { $set: { 'participants.$.cardMessageId': messageId, ...lead } }
            }
        })),
        { ordered: false }
    );
}

/*
    Forget one person's card, for when the message behind it has gone and a rewrite found out.
    Only while it is still the one on record: a rewrite running off an older read would
    otherwise forget the card that replaced it.
*/
export async function clearPlanCard(planId, userId, messageId) {
    await col(collections.plans).updateOne(
        { planId, participants: { $elemMatch: { userId, cardMessageId: messageId } } },
        { $set: { 'participants.$.cardMessageId': null } }
    );
}

//Plans set before the opener carried the yes/no posted it as a message of its own, this being its id
export async function forgetProbeMessage(planId) {
    await col(collections.plans).updateOne({ planId }, { $unset: { probeThreadMessageId: '' } });
}

//Note that whoever runs the plan has been told everyone confirmed, so that good-to-go DM only goes once
export async function markProbeAllYes(planId) {
    await col(collections.plans).updateOne({ planId }, { $set: { probeAllYesNotifiedAt: new Date() } });
}
