import { ActionRowBuilder } from 'discord.js';
import { client } from '../client.js';
import { reviveThread } from '../util.js';
import { markPlanCancelled, removeParticipant, addPlanEvent, setPlanCards } from '../../db/plans/index.js';
import { getGuildConfig } from '../../db/guilds.js';
import { refundAction } from '../../db/ratelimits.js';
import { announceAfter } from '../../api/announce.js';
import { fanOut } from '../../lib/fanout.js';
import { hostIdsOf } from '../../lib/hosts.js';
import { channelFor } from '../outbox.js';
import { buildEditMessages, tookOffText } from '../edits.js';
import { threadName, datesButton, overviewRow, banner, whenLine, noMoreLine, probeRow, onIt, invitedOnly, planCard } from './cards.js';
import { deliver, deliverEach, sendCards, resendCards, askLines, retireCard, rewriteCard, missedBy, postMentioning, memberName, syncPlanCards } from './send.js';
import { addToThread, renameThread, updateOpener, openThread, syncPlan } from './thread.js';
import { notifyHostsIfAllIn, notifyHostsAllYes, notifyHostsVoteNo, notifyHostsOut, notifyHostsBackIn } from './hosts.js';

//The Discord side of every change to a plan, from the site or from here

/*
    A calendar save moves what someone has answered on every plan still finding its day.
    Each card they hold says how much is left, so it is brought in line, and a plan the
    save finished may now have everyone in. Never waited on.
*/
export function answersMoved(userId, planIds) {
    for (const planId of planIds) {
        announceAfter(planId, 'answers moved', async (plan) => {
            if (plan.status !== 'collecting') return;
            await syncPlanCards(plan, null, { only: [userId] });
            await notifyHostsIfAllIn(plan);
        });
    }
}

/*
    When a plan is created on the site this is the Discord side of it: its thread, and a
    DM to everyone with the range, what the plan is about, buttons to their dates and the
    thread, and a drop out button. actorName is whoever started it.
*/
export async function announcePlan(plan, cfg, actorName) {
    const { guild, thread } = await openThread(plan, cfg);
    const ids = onIt(plan).map((p) => p.userId);

    //The thread id is only in the database yet, so it is patched on or the card has no thread button
    const withThread = { ...plan, threadId: thread.id };
    const asks = await askLines(plan, ids);
    //A repeat has no actor: nobody did this, it just came round, so the card says that instead
    await sendCards(plan, ids, (id) =>
        planCard(withThread, plan.participants.find((p) => p.userId === id) || {}, {
            guildName: guild.name,
            actorName: plan.repeatedFrom ? '' : actorName,
            ask: asks[id]
        }), { actorName: plan.repeatedFrom ? '' : actorName });

    return thread;
}

/*
    The announce-a-set-plan path: the planner already knows the date, so there is
    nothing to collect. The thread is always opened, same as a normal plan, so /overview
    keeps working and the plan can be reached and managed later. Everyone is asked
    whether they can make it, on the pinned opener and by DM. actorName is whoever set it up.
*/
export async function announceSetPlan(plan, cfg, actorName) {
    const ids = onIt(plan).map((p) => p.userId);
    await openThread(plan, cfg);

    const who = plan.repeatedFrom ? '' : actorName;
    await sendCards(plan, ids, (id) =>
        planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
            guildName: cfg.guildName,
            actorName: who
        }), { actorName: who });
}

/*
    Pull extra people into a plan that is already running. They slip into the
    thread quietly, no ping and no post about it. The welcome goes by DM instead,
    the same card everyone got at the start. actorName is whoever added them.
*/
export async function announceAddition(plan, newIds, actorName) {
    //Anyone gone again by the time this runs would be invited to a plan they are not on
    const still = new Set(plan.participants.map((p) => p.userId));
    newIds = newIds.filter((id) => still.has(id));
    if (!newIds.length) return;

    const guild = await client.guilds.fetch(plan.guildId);

    const thread = plan.threadId ? await channelFor(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        await addToThread(thread, newIds);
        //A set day's pin counts them in its tally
        await updateOpener(plan, thread).catch(() => {});
    }

    //The same card everyone else holds, so a late joiner rides the same rewrites
    const asks = await askLines(plan, newIds);
    await sendCards(plan, newIds, (id) =>
        planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
            guildName: guild.name,
            actorName,
            ask: asks[id]
        }), { actorName });
}

/*
    Once a planner locks the winning date the plan closes. The pinned opener turns into the
    yes/no first. Everyone still invited then gets a card, and a post in the thread pings
    whoever the card missed, so nobody who is meant to be there can miss it. Anyone the
    planner left off the invite list hears nothing. The card names who set or moved it.

    The post carries the buttons too, since the people it pings are the ones with no card
    to press them on. The tally stays on the pin. Never quiet: a day set off the grid always
    tells people, and quiet saves are the edit form's.
*/
export async function announceOutcome(plan, cfg, { changed, actorName }) {
    const ids = invitedOnly(plan).map((p) => p.userId);
    //Sent back out for dates since this was queued, which announces itself
    if (!plan.chosenDate) return;

    await syncPlan(plan, { cfg, cards: false }).catch((err) => console.error('[plans] outcome sync failed:', err));

    const sent = await sendCards(plan, ids, (id) =>
        planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
            guildName: cfg.guildName,
            actorName,
            moved: changed
        }), { actorName, moved: changed });

    if (plan.threadId) {
        const thread = await channelFor(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await postMentioning(thread, missedBy(ids, sent), {
                content: banner(changed ? 'CHANGED' : 'DAY SET') +
                    `${actorName} ${changed ? 'moved' : 'set'} **${plan.name}** ${changed ? 'to' : 'for'} ${whenLine(plan)}.\n` +
                    `Can you make it?`,
                components: [probeRow(plan)]
            });
        }
    }

    /*
        Nobody new is sent to the narrowed off the list, anyone who said it is not for them,
        or anyone the new card missed, but the cards they hold would still be about the old day.
    */
    const reached = new Set(sent.map((s) => s.userId));
    const stale = plan.participants.map((p) => p.userId).filter((id) => !reached.has(id));
    if (stale.length) {
        await syncPlanCards(plan, cfg, { only: stale })
            .catch((err) => console.error('[plans] stale card sync failed:', err));
    }
}

/*
    A time or note edit on a day that is staying put, from setting the day it is already on
    off the grid. Everything already sent is brought into line first, which pings nobody.

    Then a fresh card and no thread post: the pin already carries the change, and a second
    post about a time reads as noise. The card puts the buttons back in front of anyone who
    said yes to the old time.
*/
export async function announceWhenEdit(plan, cfg, { actorName, was = {} }) {
    await syncPlan(plan, { cfg });
    if (!plan.chosenDate) return;

    const ids = invitedOnly(plan).map((p) => p.userId);
    if (!ids.length) return;

    const timeMoved = (was.time || null) !== (plan.chosenTime || null);
    const noteMoved = (was.note || null) !== (plan.chosenNote || null);

    //The card under the aside has the new time and note, so the aside only says which moved
    const bits = [];
    if (timeMoved) bits.push(plan.chosenTime ? 'changed the time' : 'took the time off');
    if (noteMoved) bits.push(plan.chosenNote ? 'changed the note' : 'took the note off');
    //A later save put it back how it was
    if (!bits.length) return;

    await resendCards(plan, ids, cfg, { title: 'CHANGED', aside: `${actorName} ${bits.join(' and ')}.` });
}

/*
    The Discord side of one save on the edit form, sending what buildEditMessages built
    for the review. The pin and every card are brought in line whatever else happens,
    which is all a quiet save does for most people. before is the plan as the save read
    it, changes what moved, heard who gets a fresh card (see whoHears) and owing whoever
    now has something to do, who the thread post pings when their card did not land.
*/
export async function announceEdit(plan, cfg, { before, changes, actorName, quiet = false, heard = [], owing = [] }) {
    const guildName = cfg?.guildName || '';
    const where = guildName ? ` in ${guildName}` : '';
    const messages = buildEditMessages(before, plan, changes, { actorName, guildName, quiet, heard });
    const message = (kind) => messages.find((m) => m.kind === kind);
    const of = (type) => changes.find((c) => c.type === type);
    const on = new Set(plan.participants.map((p) => p.userId));
    const runs = new Set(hostIdsOf(plan));
    const day = of('set') || of('day');

    //Whoever set or moved the day is who every later rewrite of a card names, so it is written down before any reads it back
    const lead = day ? { actorName, moved: Boolean(before.chosenDate) } : { keepLead: true };
    let current = plan;
    if (day) {
        const held = plan.participants.filter((p) => p.cardMessageId);
        await setPlanCards(plan.planId, held.map((p) => ({ userId: p.userId, messageId: p.cardMessageId })), lead);
        current = { ...plan, participants: plan.participants.map((p) => ({ ...p, cardActor: actorName, cardMoved: lead.moved })) };
    }

    const thread = plan.threadId ? await channelFor(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        await updateOpener(current, thread).catch(() => {});
    }

    //Told, or on a quiet save their card turned into saying so, and out of the thread unless they run it
    const off = (of('removed')?.ids || []).filter((id) => !on.has(id));
    await fanOut(off, async (id) => {
        const card = before.participants.find((p) => p.userId === id)?.cardMessageId;
        const line = { content: tookOffText(actorName, before, where), components: [] };
        if (message('took off')) {
            if ((await deliver(current, id, line)) && card) await retireCard(id, card);
        } else if (card) {
            await rewriteCard(id, card, line);
        }
        if (thread && !runs.has(id)) await thread.members.remove(id).catch(() => {});
    });

    //Not running it and not coming leaves nothing for them in the thread
    for (const id of of('hosts')?.removed || []) {
        if (thread && !on.has(id)) await thread.members.remove(id).catch(() => {});
    }
    const picked = message('picked');
    if (picked) {
        if (thread) await addToThread(thread, picked.to);
        await deliverEach(current, picked.to, { content: banner('YOU RUN THIS') + picked.text, components: [overviewRow(current)] });
    }

    //The invitation everyone else got, which puts them in the thread and on the pin's tally as well
    const added = (of('added')?.ids || []).filter((id) => on.has(id));
    if (added.length) await announceAddition(current, added, actorName);

    const fresh = (message('card')?.to || []).filter((id) => on.has(id));
    const asks = await askLines(current, fresh);
    const sent = fresh.length
        ? await sendCards(current, fresh, (id) =>
            planCard(current, current.participants.find((p) => p.userId === id), {
                guildName,
                actorName: '',
                title: 'CHANGED',
                aside: message('card').text,
                ask: asks[id]
            }), lead)
        : [];
    const reached = new Set([...sent.map((s) => s.userId), ...added]);

    const post = message('post');
    if (post && thread) {
        const buttons = day ? [probeRow(current)] : of('collect') || of('window') ? [new ActionRowBuilder().addComponents(datesButton(current))] : [];
        await postMentioning(thread, owing.filter((id) => on.has(id) && !reached.has(id)), { content: post.text, components: buttons });
    }

    //Everyone else's card says what the plan says now
    await syncPlanCards(current, cfg, { only: current.participants.map((p) => p.userId).filter((id) => !reached.has(id)) })
        .catch((err) => console.error('[plans] edit card sync failed:', err));

    if (thread) renameThread(thread, threadName(current));
    await notifyHostsIfAllIn(current).catch(() => {});
    await notifyHostsAllYes(current).catch(() => {});
}

/*
    Cancel a plan. It gets marked cancelled and the thread and everyone on it are told,
    but the thread is left in place: deleting it by hand is what finally clears the
    plan. The creator gets their daily plan slot back since the plan never really ran.
    actorName is whoever cancelled it.
*/
export async function cancelPlan(plan, actorId, actorName) {
    if (!(await markPlanCancelled(plan.planId))) return false;
    await refundAction(plan.createdBy, plan.guildId, 'create', plan.createdAt);
    await addPlanEvent(plan.planId, { type: 'cancelled', by: actorId, byName: actorName }).catch(() => {});
    //In the queue the site's saves wait in, or a cancel from here lands in the middle of one of their announcements
    await announceAfter(plan.planId, 'cancel announce', (current) => announceCancel(current, actorName), { cancel: true });
    return true;
}

//The telling-everyone half, split off so the site can send it after it has responded
export async function announceCancel(plan, actorName) {
    //Nobody should be left holding a card that still says they are coming on the twelfth
    await syncPlan(plan).catch((err) => console.error('[plans] cancel sync failed:', err));

    const ids = onIt(plan).map((p) => p.userId);
    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    const sent = await resendCards(plan, ids, cfg, { actorName });

    if (plan.threadId) {
        const thread = await channelFor(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await postMentioning(thread, missedBy(ids, sent), {
                content: banner('CALLED OFF') + `${actorName} called off **${plan.name}**.${noMoreLine(plan)} Nothing more to fill in.`
            });
        }
    }
}

/*
    Take one person off a plan, from the site's drop out on a set day. They are left in
    the thread so they can still follow along, and nothing is posted there. A plan still
    finding its day asks Not for me instead, which keeps them on it.
*/
export async function leavePlan(plan, userId, actorName) {
    await afterLeaving(await dropOut(plan, userId, actorName));
}

async function dropOut(plan, userId, actorName) {
    const updated = await removeParticipant(plan.planId, userId, { id: userId, name: actorName || '' });
    await addPlanEvent(plan.planId, { type: 'left', by: userId, byName: actorName || '' }).catch(() => {});
    return updated;
}

//Also what a member leaving the server sets off, for each plan they were on
export async function afterLeaving(updated) {
    //A set day's pin was counting them
    await updateOpener(updated).catch(() => {});

    //If that drop out leaves everyone else already in, the day can be picked now
    await notifyHostsIfAllIn(updated).catch(() => {});
    //Likewise, if the leaver was the last to answer for a set day, the rest may now all
    //be coming, so whoever runs it should hear they are good to go
    await notifyHostsAllYes(updated).catch(() => {});
}

/*
    A planner moving someone on the attendance board: the thread tally, and for an invite,
    the yes/no card the others got, sent fresh since their old one says "NOT THIS ONE".
    Answers whether that DM landed.

    Anyone else moved is never told. A planner reaches for the board having decided they
    will not answer, and an override only stops them being nudged: they keep the buttons
    on their card, and voting clears the override, so their own word still wins. Sending
    them back, or out of it again, moves the answer their card shows, so rewrite edits it
    where it sits.
*/
export async function applyAttendanceMove(plan, status, userId, actorName = '', { rewrite = false } = {}) {
    const reached = status === 'invite' ? await sendInvite(plan, userId, actorName) : null;
    await updateOpener(plan).catch(() => {});
    if (rewrite) await syncPlanCards(plan, null, { only: [userId] }).catch(() => {});
    if (status === 'coming') await notifyHostsAllYes(plan).catch(() => {});
    return reached;
}

/*
    No actor on the lead, which is kept for rewrites and would call them whoever set the
    day. Who let them in is said once, on this send.
*/
async function sendInvite(plan, userId, actorName) {
    const p = plan.participants.find((q) => q.userId === userId);
    if (!p || p.invited === false) return false;
    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    const card = planCard(plan, p, { guildName: cfg?.guildName || '', actorName: '', title: 'INVITED', aside: actorName ? `${actorName} invited you.` : '' });
    const sent = await sendCards(plan, [userId], card, { actorName: '' });
    return sent.length > 0;
}

/*
    Count me in or Not for me having landed, from the site or a DM. Their card is brought in
    line unless the press that did it has already rewritten it, and whoever runs the plan
    hears about someone going out or coming back in. was is where they stood before. Hands
    back who that DM reached.
*/
export async function announceJoin(plan, userId, was, reason = null, { card = true } = {}) {
    const p = plan.participants.find((q) => q.userId === userId);
    if (!p) return { told: [], missed: [] };
    if (card) await syncPlanCards(plan, null, { only: [userId] }).catch(() => {});

    let heard = { told: [], missed: [] };
    const out = p.in === false && was !== false;
    const back = p.in === true && was === false;
    if (out || back) {
        const byName = await memberName(plan.guildId, userId, '');
        await addPlanEvent(plan.planId, { type: out ? 'left' : 'rejoined', by: userId, byName }).catch(() => {});
    }
    if (out) heard = await notifyHostsOut(plan, userId, reason).catch(() => heard);
    if (back) await notifyHostsBackIn(plan, userId).catch(() => {});
    await notifyHostsIfAllIn(plan).catch(() => {});
    return heard;
}

/*
    I'm coming or Can't make it having landed from the site. The pin's tally and their own
    card are brought in line, and whoever runs the plan hears about a fresh no, or that
    everyone is now coming. was is their answer before. Hands back who the no reached.
*/
export async function announceVote(plan, userId, was, reason = null) {
    const p = plan.participants.find((q) => q.userId === userId);
    if (!p) return { told: [], missed: [] };
    await updateOpener(plan).catch(() => {});
    await syncPlanCards(plan, null, { only: [userId] }).catch(() => {});

    const nobody = { told: [], missed: [] };
    if (p.vote === 'no' && was !== 'no') return notifyHostsVoteNo(plan, userId, reason).catch(() => nobody);
    if (p.vote === 'yes') await notifyHostsAllYes(plan).catch(() => {});
    return nobody;
}
