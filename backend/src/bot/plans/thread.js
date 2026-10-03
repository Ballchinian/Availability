import { ChannelType } from 'discord.js';
import { client } from '../client.js';
import { createThread, reviveThread, pinMessage } from '../util.js';
import { setPlanThread, setPlanOpener, forgetProbeMessage } from '../../db/plans/index.js';
import { fanOut } from '../../lib/fanout.js';
import { hostIdsOf } from '../../lib/hosts.js';
import { outboxThreadId } from '../../lib/practice.js';
import { channelFor } from '../outbox.js';
import { threadName, opener } from './cards.js';
import { syncPlanCards } from './send.js';

//A plan's thread: making it, the pinned post, its name, and who is in it

//Pulls people into a plan's thread, best effort: someone who has left the server
//just does not arrive, and the rest of the list still gets in
export async function addToThread(thread, ids) {
    await fanOut(ids, (id) => thread.members.add(id).catch(() => {}));
}

//Whoever should be on the thread from the start: the guests, and everyone who runs the plan even when not one of them
function threadPeople(plan) {
    return [...new Set([...plan.participants.map((p) => p.userId), ...hostIdsOf(plan)])];
}

//Someone who took the plan on goes in its thread, which is where /overview and /cancel are run
export async function addHostToThread(plan, userId) {
    const thread = plan.threadId ? await channelFor(plan.threadId).catch(() => null) : null;
    if (!thread) return;
    await reviveThread(thread);
    await addToThread(thread, [userId]);
}

/*
    Never awaited. Discord allows two renames a thread per ten minutes and discord.js waits
    out the rest, which would hold up whatever was waiting on it. One already waiting for
    the same name is not asked for again.
*/
const renaming = new Map();

export function renameThread(thread, name) {
    if (thread.name === name || renaming.get(thread.id) === name) return;
    renaming.set(thread.id, name);
    Promise.resolve().then(() => thread.setName(name)).catch(() => {}).finally(() => {
        if (renaming.get(thread.id) === name) renaming.delete(thread.id);
    });
}

/*
    One of the plan's own messages, edited where it sits or posted again when somebody has
    deleted it. Without the second half a deletion is permanent, every later pass fetching
    nothing and giving up.

    A replacement lands at the bottom of the thread, not back where the old one was, which
    is what pinning is for. Says which happened, since only a fresh one needs writing down.
*/
async function placeThreadMessage(thread, messageId, payload) {
    if (messageId) {
        const msg = await thread.messages.fetch(messageId).catch(() => null);
        if (msg) {
            const edited = await msg.edit(payload).catch(() => null);
            if (edited) return { message: edited, fresh: false };
        }
    }
    const sent = await thread.send(payload).catch(() => null);
    return sent ? { message: sent, fresh: true } : null;
}

/*
    The pinned opener brought in line with the plan, and put back and pinned again when
    somebody has deleted it. Runs on every vote, since on a set day it carries the tally.

    A plan with no remembered opener is left alone, since a repost would land at the bottom
    of the thread and that is not an opener.
*/
export async function updateOpener(plan, thread = null) {
    if (!plan.threadId || !plan.openerMessageId) return;
    thread ??= await channelFor(plan.threadId).catch(() => null);
    if (!thread) return;
    await reviveThread(thread);

    const placed = await placeThreadMessage(thread, plan.openerMessageId, opener(plan));
    if (placed?.fresh) {
        await pinMessage(placed.message).catch(() => {});
        await setPlanOpener(plan.planId, placed.message.id);
    }

    //Its tally stopped moving the day the opener took its job, so it goes
    if (plan.probeThreadMessageId) {
        const old = await thread.messages.fetch(plan.probeThreadMessageId).catch(() => null);
        if (old) await old.delete().catch(() => old.edit({ content: 'The yes/no is the pinned message now.', components: [] }).catch(() => {}));
        await forgetProbeMessage(plan.planId);
    }
}

/*
    A new plan's private thread, with the opener posted and pinned before anybody is
    added, so everyone arrives to it rather than to an empty thread.
*/
export async function openThread(plan, cfg) {
    const guild = await client.guilds.fetch(plan.guildId);
    //A practice plan's is kept on the site, and nobody in the server sees anything of it
    const thread = plan.practice
        ? await channelFor(outboxThreadId(plan.planId))
        : await createThread(await guild.channels.fetch(cfg.plansChannelId), threadName(plan), ChannelType.PrivateThread);
    await setPlanThread(plan.planId, thread.id, plan.practice ? null : cfg.plansChannelId);

    //No @ here, adding people to the thread already pings them
    const pinned = await thread.send(opener(plan));
    //Best effort: a server that has not given the bot Pin Messages still gets its thread
    await pinMessage(pinned).catch(() => {});
    //Remember it so editing the title or description later can rewrite this same post
    await setPlanOpener(plan.planId, pinned.id);

    await addToThread(thread, threadPeople(plan));
    return { guild, thread };
}

/*
    Everything Discord holds about a plan, brought back in line with it: the pinned opener,
    which is the yes/no on a set day, every card, and the thread's name. All edits, so this
    pings nobody. cards: false is for an announcement about to send everyone a fresh one.
*/
export async function syncPlan(plan, { cfg = null, cards = true } = {}) {
    const thread = plan.threadId ? await channelFor(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        await updateOpener(plan, thread);
    }

    const done = cards ? await syncPlanCards(plan, cfg) : 0;
    if (thread) renameThread(thread, threadName(plan));
    return done;
}
