import { client } from '../client.js';
import { setPlanCards, clearPlanCard, setDmsClosed } from '../../db/plans.js';
import { getGuildConfig } from '../../db/guilds.js';
import { getAvailabilityForUsersInRange, getLastUpdated } from '../../db/availability.js';
import { getPlanningPrefs } from '../../db/users.js';
import { fanOut } from '../../lib/fanout.js';
import { memberOf } from '../../lib/members.js';
import { shiftDate } from '../../lib/dates.js';
import { askFor } from '../../lib/coverage.js';
import { userFor } from '../outbox.js';
import { planCard } from './cards.js';

/*
    Every DM about a plan goes out through here, and never throws. Discord answers 50007
    when someone has DMs from the server off or has blocked the bot, which is written onto
    them so whoever runs the plan knows the thread is the only way to reach them. Any other
    failure is a blip or someone gone, which says nothing about their settings.

    Hands back the message, or null when it did not land. Anyone made up gets theirs in
    the outbox, see outbox.js.
*/
export async function deliver(plan, userId, payload) {
    const p = plan.participants?.find((q) => q.userId === userId);
    try {
        const user = await userFor(userId, plan.planId);
        const msg = await user.send(payload);
        if (p?.dmsClosed) await setDmsClosed(plan.planId, userId, false).catch(() => {});
        return msg;
    } catch (err) {
        if (err?.code === 50007 && p && !p.dmsClosed) await setDmsClosed(plan.planId, userId, true).catch(() => {});
        return null;
    }
}

//build is one payload for everybody or a function of the id. Hands back what landed.
export async function deliverEach(plan, ids, build) {
    const sent = [];
    await fanOut(ids, async (id) => {
        const msg = await deliver(plan, id, typeof build === 'function' ? build(id) : build);
        if (msg) sent.push({ userId: id, messageId: msg.id });
    });
    return sent;
}

/*
    A fresh card for each of ids, then their old one taken down, so only the newest carries
    live buttons. The old ids are the ones on the plan as it was read, from before setPlanCards
    writes over them. Anyone the new card missed keeps the old one, the best they have.
*/
export async function sendCards(plan, ids, build, lead = {}) {
    const sent = await deliverEach(plan, ids, build);
    await setPlanCards(plan.planId, sent, lead);
    const old = new Map(plan.participants.map((p) => [p.userId, p.cardMessageId]));
    await fanOut(sent.filter((s) => old.get(s.userId)), (s) => retireCard(s.userId, old.get(s.userId)));
    return sent;
}

//Their card again with a line saying why it came, the lead they already had left as it is. opts can be a function of the id.
export async function resendCards(plan, ids, cfg, opts) {
    const asks = await askLines(plan, ids);
    return sendCards(plan, ids, (id) =>
        planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
            guildName: cfg?.guildName || '',
            ...(typeof opts === 'function' ? opts(id) : opts),
            ask: asks[id]
        }), { keepLead: true });
}

/*
    The line under Count me in for each of ids, keyed by id: what their calendar already
    answers. Only a plan still finding its day asks. Three reads for the lot rather than
    three a person, and a card goes out without the line rather than not at all.
*/
export async function askLines(plan, ids) {
    if (plan.status !== 'collecting' || !ids.length) return {};
    try {
        const { start, end } = plan.dateRange;
        const [prefs, rows, updated] = await Promise.all([
            getPlanningPrefs(ids),
            getAvailabilityForUsersInRange(ids, shiftDate(start, -1), shiftDate(end, 1)),
            getLastUpdated(ids)
        ]);
        const theirs = {};
        for (const r of rows) (theirs[r.userId] ||= []).push(r);
        const lines = {};
        for (const p of plan.participants.filter((q) => ids.includes(q.userId))) {
            lines[p.userId] = askFor(plan, p, prefs[p.userId], theirs[p.userId] || [], updated[p.userId]);
        }
        return lines;
    } catch (err) {
        console.error('[plans] ask lines failed:', err);
        return {};
    }
}

//One person's card as the plan stands now, line and all
export async function cardFor(plan, p, opts = {}) {
    const [cfg, asks] = await Promise.all([getGuildConfig(plan.guildId).catch(() => null), askLines(plan, [p.userId])]);
    return planCard(plan, p, { guildName: cfg?.guildName || '', ...opts, ask: asks[p.userId] });
}

//Discord can refuse the delete, and then the card at least loses its buttons
export async function retireCard(userId, messageId) {
    try {
        const user = await userFor(userId);
        const dm = await user.createDM();
        const msg = await dm.messages.fetch(messageId);
        await msg.delete().catch(() => msg.edit({ content: "There's a newer message about this plan.", components: [] }));
    } catch {
        //Gone already, or out of reach, which leaves nothing to do from here
    }
}

//A card edited where it sits, which tells nobody
export async function rewriteCard(userId, messageId, payload) {
    try {
        const user = await userFor(userId);
        const dm = await user.createDM();
        const msg = await dm.messages.fetch(messageId);
        await msg.edit(payload);
    } catch {
        //Gone already, or out of reach
    }
}

//Whoever of ids the DMs did not reach, which is who a thread post still has to ping
export function missedBy(ids, sent) {
    const reached = new Set(sent.map((s) => s.userId));
    return ids.filter((id) => !reached.has(id));
}

//Discord refuses a post past 2000 characters, and allowedMentions takes at most 100 users
const POST_CHARS = 2000;

const POST_MENTIONS = 100;

/*
    A thread post pinging ids, as however many posts that takes. The mentions lead the
    first post as far as both limits allow, and the rest follow in posts of their own.
    With nobody to ping it is the one post, pinging nobody.
*/
export function mentionPosts(ids, payload) {
    const tag = (id) => `<@${id}>`;
    const posts = [];
    let batch = [];
    let length = 0;
    //The first post shares its room with the body under it
    let room = POST_CHARS - payload.content.length - 2;

    const flush = () => {
        const lead = batch.map(tag).join(' ');
        posts.push(posts.length
            ? { content: lead, allowedMentions: { users: batch } }
            : { ...payload, content: batch.length ? `${lead}\n\n${payload.content}` : payload.content, allowedMentions: { users: batch } });
        batch = [];
        length = 0;
        room = POST_CHARS;
    };

    //Each tag is counted with a space after it, one more than the joined lead needs
    for (const id of ids) {
        if (batch.length === POST_MENTIONS || length + tag(id).length + 1 > room) flush();
        length += tag(id).length + 1;
        batch.push(id);
    }
    flush();
    return posts;
}

//Hands back the first post, the one carrying the body. The overflow pings are best effort.
export async function postMentioning(thread, ids, payload) {
    const [first, ...rest] = mentionPosts(ids, payload);
    const msg = await thread.send(first);
    for (const post of rest) await thread.send(post).catch(() => {});
    return msg;
}

//Best effort display name for someone in a guild, falling back when they have left
export async function memberName(guildId, userId, fallback = 'Someone') {
    try {
        const guild = await client.guilds.fetch(guildId);
        return (await memberOf(guild, userId))?.displayName || fallback;
    } catch {
        return fallback;
    }
}

/*
    Rewrite every card so they all say what the plan says now. An edit notifies nobody in
    Discord, which is what lets a wrong time be corrected without the correction being an
    event of its own.

    Never sends a replacement: that would ping them, which is the one thing this avoids.
    Each edit is swallowed alone rather than through fanOut's rethrow, so one person with
    DMs closed does not cost the rest theirs. only narrows it to a few people by id.
*/
export async function syncPlanCards(plan, cfg = null, { only = null } = {}) {
    const wanted = only ? new Set(only) : null;
    const holders = plan.participants.filter((p) => p.cardMessageId && (!wanted || wanted.has(p.userId)));
    if (!holders.length) return 0;

    const conf = cfg || (await getGuildConfig(plan.guildId).catch(() => null));
    const guildName = conf?.guildName || '';
    const asks = await askLines(plan, holders.map((p) => p.userId));

    let done = 0;
    await fanOut(holders, async (p) => {
        try {
            const user = await userFor(p.userId);
            const dm = await user.createDM();
            const msg = await dm.messages.fetch(p.cardMessageId);
            await msg.edit(planCard(plan, p, { guildName, ask: asks[p.userId] }));
            done++;
        } catch (err) {
            //10008 is Discord's unknown message: they deleted it, so stop paying for it every pass
            if (err?.code === 10008) await clearPlanCard(plan.planId, p.userId, p.cardMessageId).catch(() => {});
        }
    });
    return done;
}
