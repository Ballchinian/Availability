import { ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { client } from './client.js';
import { createThread, planUrl, compareUrl, calendarUrl, threadUrl, reviveThread, pinMessage } from './util.js';
import { setPlanThread, setPlanOpener, getPlan, getPlanByThread, getOpenPlansForUser, markPlanCancelled, removeParticipant, markAllInNotified, recordVote, forgetProbeMessage, markProbeAllYes, addParticipants, addPlanEvent, setPlanCards, clearPlanCard, setDmsClosed, setIn } from '../db/plans.js';
import { getGuildConfig } from '../db/guilds.js';
import { getAvailabilityInRange, getAvailabilityForUsersInRange, getLastUpdated, blockDay, setDayFree } from '../db/availability.js';
import { getPlanningPrefs } from '../db/users.js';
import { refundAction } from '../db/ratelimits.js';
import { announceAfter } from '../api/announce.js';
import { fanOut } from '../lib/fanout.js';
import { realMembers } from '../lib/members.js';
import { formatDay, formatDate, formatTime, shiftDate } from '../lib/dates.js';
import { answersOn, coverageOf, standing, owes, askFor, inOf } from '../lib/coverage.js';
import { safeZone, planInstant, instantToWall, discordStamp, dayHasPassed } from '../lib/zones.js';

/*
    Every DM about a plan goes out through here, and never throws. Discord answers 50007
    when someone has DMs from the server off or has blocked the bot, which is written onto
    them so whoever runs the plan knows the thread is the only way to reach them. Any other
    failure is a blip or someone gone, which says nothing about their settings.

    Hands back the message, or null when it did not land.
*/
async function deliver(plan, userId, payload) {
    const p = plan.participants?.find((q) => q.userId === userId);
    try {
        const user = await client.users.fetch(userId);
        const msg = await user.send(payload);
        if (p?.dmsClosed) await setDmsClosed(plan.planId, userId, false).catch(() => {});
        return msg;
    } catch (err) {
        if (err?.code === 50007 && p && !p.dmsClosed) await setDmsClosed(plan.planId, userId, true).catch(() => {});
        return null;
    }
}

//build is one payload for everybody or a function of the id. Hands back what landed.
async function deliverEach(plan, ids, build) {
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
async function sendCards(plan, ids, build, lead = {}) {
    const sent = await deliverEach(plan, ids, build);
    await setPlanCards(plan.planId, sent, lead);
    const old = new Map(plan.participants.map((p) => [p.userId, p.cardMessageId]));
    await fanOut(sent.filter((s) => old.get(s.userId)), (s) => retireCard(s.userId, old.get(s.userId)));
    return sent;
}

//Their card again with a line saying why it came, the lead they already had left as it is. opts can be a function of the id.
async function resendCards(plan, ids, cfg, opts) {
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
async function askLines(plan, ids) {
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
async function cardFor(plan, p, opts = {}) {
    const [cfg, asks] = await Promise.all([getGuildConfig(plan.guildId).catch(() => null), askLines(plan, [p.userId])]);
    return planCard(plan, p, { guildName: cfg?.guildName || '', ...opts, ask: asks[p.userId] });
}

//Discord can refuse the delete, and then the card at least loses its buttons
async function retireCard(userId, messageId) {
    try {
        const user = await client.users.fetch(userId);
        const dm = await user.createDM();
        const msg = await dm.messages.fetch(messageId);
        await msg.delete().catch(() => msg.edit({ content: "There's a newer message about this plan.", components: [] }));
    } catch {
        //Gone already, or out of reach, which leaves nothing to do from here
    }
}

//Whoever of ids the DMs did not reach, which is who a thread post still has to ping
function missedBy(ids, sent) {
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
async function postMentioning(thread, ids, payload) {
    const [first, ...rest] = mentionPosts(ids, payload);
    const msg = await thread.send(first);
    for (const post of rest) await thread.send(post).catch(() => {});
    return msg;
}

//Pulls people into a plan's thread, best effort: someone who has left the server
//just does not arrive, and the rest of the list still gets in
async function addToThread(thread, ids) {
    await fanOut(ids, (id) => thread.members.add(id).catch(() => {}));
}

//Whoever should be on the thread from the start: the guests, and whoever made the plan even when not one of them
function threadPeople(plan) {
    return [...new Set([...plan.participants.map((p) => p.userId), plan.createdBy].filter(Boolean))];
}

//Thread names cap at 100 characters. The day is on a set plan's, so a repeating series is not a row of the same name.
export function threadName(plan) {
    const day = plan.chosenDate ? ` · ${formatDay(plan.chosenDate)}` : '';
    return `${plan.name.slice(0, 100 - day.length)}${day}`;
}

/*
    Never awaited. Discord allows two renames a thread per ten minutes and discord.js waits
    out the rest, which would hold up whatever was waiting on it. One already waiting for
    the same name is not asked for again.
*/
const renaming = new Map();
function renameThread(thread, name) {
    if (thread.name === name || renaming.get(thread.id) === name) return;
    renaming.set(thread.id, name);
    Promise.resolve().then(() => thread.setName(name)).catch(() => {}).finally(() => {
        if (renaming.get(thread.id) === name) renaming.delete(thread.id);
    });
}

//Count me in / Not for me, with their answer ticked once there is one, the way votedDmRow shows a vote
function joinRow(planId, joined) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join|yes|${planId}`)
            .setLabel(joined === true ? "✓ I'm in" : 'Count me in')
            .setStyle(joined === false ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`join|no|${planId}`)
            .setLabel(joined === false ? '✓ Not for me' : 'Not for me')
            .setStyle(joined === true ? ButtonStyle.Secondary : ButtonStyle.Danger)
    );
}

function linkButton(label, url) {
    return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
}

const datesButton = (plan) => linkButton('Add my dates', planUrl(plan.planId));
const overviewRow = (plan) => new ActionRowBuilder().addComponents(linkButton('Open the overview', compareUrl(plan.planId)));

//A bold banner topping a thread post or DM so you can tell at a glance what it is about
function banner(title) {
    return `**${title}**\n\n`;
}

/*
    The "set for this day" line, shared by the set-plan opener and the confirmation probe.

    A plan with a time gets a stamp on the end, which Discord redraws in whatever clock
    the person reading it is on. The server's own reading stays in front of it, since
    that is the one everybody here was talking about when the day was picked, and the
    stamp is what tells someone abroad what that comes to for them.

    No stamp on a plan with no time: there is no moment to put in one, and a day drawn
    in the wrong clock would read as the day before for half the world.
*/
function whenLine(plan) {
    const time = formatTime(plan.chosenTime);
    if (!time) return formatDate(plan.chosenDate);

    const instant = planInstant(safeZone(plan.timeZone), plan.chosenDate, plan.chosenTime);
    return `${formatDate(plan.chosenDate)} at ${time}${instant ? ` (${discordStamp(instant, 'f')} your time)` : ''}`;
}

//The "what it is about" line, dropped entirely when a plan has no description
function aboutLine(plan) {
    return plan.description ? `What it is about: ${plan.description}\n` : '';
}

//The round the buttons are about, see roundFor in db/plans.js. Buttons from before rounds carry none.
function roundOf(customId) {
    const tag = customId.split('|').find((bit) => /^r\d+$/.test(bit));
    return tag ? Number(tag.slice(1)) : 0;
}

/*
    The yes/no buttons for a confirmation probe. The same row rides on the shared thread
    message and on each person's DM, since the vote it records is shared either way.
*/
function probeRow(plan) {
    const r = `r${plan.round || 0}`;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vote|yes|${plan.planId}|${r}`).setLabel("I'm coming").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`vote|no|${plan.planId}|${r}`).setLabel("Can't make it").setStyle(ButtonStyle.Danger)
    );
}

/*
    The DM version once someone has voted. A DM is private to one person, so we can lock
    the buttons to their answer: the one they picked turns solid with a tick, the other
    stays live so they can switch. This is how a DM voter sees that their choice landed.
*/
function votedDmRow(plan, vote) {
    const r = `r${plan.round || 0}`;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`vote|yes|${plan.planId}|${r}`)
            .setLabel(vote === 'yes' ? '✓ Coming' : "I'm coming")
            .setStyle(vote === 'yes' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`vote|no|${plan.planId}|${r}`)
            .setLabel(vote === 'no' ? "✓ Can't make it" : "Can't make it")
            .setStyle(vote === 'no' ? ButtonStyle.Danger : ButtonStyle.Secondary)
    );
}

/*
    Everyone who has not said the plan is not for them. They stay on it, and can say
    they're in again, but nothing is sent to them and nobody waits on them.
*/
function onIt(plan) {
    return plan.participants.filter((p) => p.in !== false);
}

/*
    The people still on the invite list for a set date. Everyone starts invited, a
    planner can narrow it to just the people who fit while locking a date in, and
    voiding or moving the date puts everyone back on.
*/
function invitedOnly(plan) {
    return onIt(plan).filter((p) => p.invited !== false);
}

//Where someone actually stands: a planner's manual call wins over their own vote,
//and no answer at all reads as still waiting
function effectiveVote(p) {
    return p.override || p.vote || null;
}

/*
    A one line count of where the confirmation vote stands, shown under the probe. Only the
    people still invited count, nobody waits on someone who is off the list. Someone who said
    Not for me and hasn't answered for the day counts as can't make it.
*/
function probeTally(plan) {
    const invited = plan.participants.filter((p) => p.invited !== false);
    const yes = invited.filter((p) => effectiveVote(p) === 'yes').length;
    const no = invited.filter((p) => effectiveVote(p) === 'no' || (!effectiveVote(p) && inOf(p) === false)).length;
    const pending = invited.length - yes - no;
    const bits = [`${yes} coming`, `${no} can't make it`];
    if (pending > 0) bits.push(`${pending} yet to answer`);
    return bits.join(' · ');
}

/*
    The one DM per person saying what the plan currently is, rebuilt from the plan every
    time so a send and a later rewrite agree. Every DM that tells a guest something about
    the plan is a fresh card, and sendCards takes the one before it down. The creator's
    notes about other people are the only DMs that are not.

    actor and moved fall back to the participant, which is how a rebuild months later still
    names the right person. Their own vote goes on it, or a rewrite would blank a voted DM
    back to the question. title and aside are for this send only, so a banner or a line
    about why it arrived does not outlive its moment. ask is the line under Count me in,
    from askLines, and a card built without one just asks.
*/
export function planCard(plan, p, { guildName = '', actorName = null, moved = null, title = null, aside = '', ask = '' } = {}) {
    const who = actorName ?? p.cardActor ?? '';
    const wasMoved = moved ?? Boolean(p.cardMoved);
    const again = Boolean(plan.repeatedFrom);
    const where = guildName ? ` in ${guildName}` : '';
    const top = (fallback) => banner(title || fallback);
    const extra = aside ? `\n${aside}` : '';

    //Only ever set on the copy onThreadDelete keeps after the plan itself has gone
    if (plan.deleted) {
        return { content: `"${plan.name}"${where} was deleted, so there is nothing more to answer here.`, components: [] };
    }

    //First, so nobody is left holding a card that still has them coming on the twelfth
    if (plan.status === 'cancelled') {
        //Never the stored actor, which is whoever set the day or sent the invite
        const lead = actorName ? `${actorName} called off "${plan.name}"${where}.` : `"${plan.name}"${where} is off.`;
        return {
            content: top('CALLED OFF') + `${lead} Nothing more to fill in.`,
            components: []
        };
    }

    //Still collecting: the card is the invitation, the question, and the way to the dates and the thread
    if (plan.status !== 'closed' || !plan.chosenDate) {
        const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
        const lead = again
            ? `"${plan.name}" is back round again${where} (${range}).`
            : who
                ? `${who} added you to the plan "${plan.name}"${where} (${range}).`
                : `You are on the plan "${plan.name}"${where} (${range}).`;
        const joined = inOf(p);
        const stand = joined === false ? "You said it's not for you." : [joined ? "You're in." : 'Are you in?', ask].filter(Boolean).join(' ');
        const links = new ActionRowBuilder().addComponents(datesButton(plan));
        //Left off rather than guessed at when there is no thread yet, since the card outlives the send
        if (plan.threadId) links.addComponents(linkButton('Open the thread', threadUrl(plan.guildId, plan.threadId)));
        return {
            content: top('INVITED') + [lead, aboutLine(plan).trimEnd(), aside].filter(Boolean).join('\n') + `\n\n${stand}`,
            components: [joinRow(plan.planId, joined), links]
        };
    }

    const when = whenLine(plan);
    const about = plan.description ? `\nWhat it is about: ${plan.description}` : '';
    const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';

    //Narrowed off the list. Their buttons are refused anyway, so the card stops asking.
    if (p.invited === false) {
        return {
            content: banner('NOT THIS ONE') +
                `"${plan.name}"${where} is set for ${when}, and you are not on the list for this one. ` +
                `Nothing to do. Say so in the thread if that looks wrong.`,
            components: []
        };
    }
    const lead = again
        ? `"${plan.name}" is back round again${where}, set for ${when}.`
        : who
            ? wasMoved
                ? `${who} moved the plan "${plan.name}"${where} to ${when}.`
                : `${who} set the plan "${plan.name}"${where} for ${when}.`
            : `"${plan.name}"${where} is set for ${when}.`;
    const day = !again && wasMoved ? 'CHANGED' : 'DAY SET';

    //Their answer, kept on the card so a rewrite cannot undo what ackVote put there
    const vote = plan.probeActive ? p.vote || null : null;
    if (vote) {
        const line = vote === 'yes' ? "You're down as coming." : "You're down as not coming.";
        return {
            content: top(day) + `**${plan.name}** is set for ${when}.${about}${note}${extra}\n${line}`,
            components: [votedDmRow(plan, vote)]
        };
    }

    if (plan.probeActive) {
        return {
            content: top(day) + lead + about + note + extra + `\n\nCan you make it?`,
            components: [probeRow(plan)]
        };
    }

    return {
        content: top(day) +
            lead + about + note + extra,
        components: []
    };
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
    thread ??= await client.channels.fetch(plan.threadId).catch(() => null);
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

//Best effort display name for someone in a guild, falling back when they have left
async function memberName(guildId, userId, fallback = 'Someone') {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return member.displayName;
    } catch {
        return fallback;
    }
}

/*
    The pinned post at the top of a plan's thread, built the same way every time so any
    rewrite keeps it in step. On a set day it is the yes/no itself: the day, what it is
    about, the running tally and the buttons. Always carries its components, even none,
    or a plan sent back out for dates would keep the buttons on its edited pin.
*/
function opener(plan) {
    //A plan the sweep made says so itself, so nothing has to be passed down to every caller
    const again = Boolean(plan.repeatedFrom);
    const quietly = { allowedMentions: { parse: [] } };

    if (plan.status === 'cancelled') {
        return { content: banner('CALLED OFF') + `**${plan.name}** was called off.`, components: [], ...quietly };
    }

    if (plan.status === 'closed' && plan.chosenDate) {
        const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';
        const about = plan.description ? `\nWhat it is about: ${plan.description}` : '';
        //A closed one keeps its tally: what people said still stands, it is only the asking that stopped
        const asking = Boolean(plan.probeActive);
        return {
            content: banner('DAY SET') +
                `**${plan.name}** is set for ${whenLine(plan)}.${about}${note}\n` +
                (asking ? 'Can you make it?' : 'Confirmations are closed.') +
                `\n\n${probeTally(plan)}`,
            components: asking ? [probeRow(plan)] : [],
            ...quietly
        };
    }

    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    return {
        content: banner('INVITED') +
            (again ? `**${plan.name}** is back round (${range}).\n` : `New plan: **${plan.name}** (${range}).\n`) +
            aboutLine(plan) +
            `\`/free\` in this thread ticks off your days without leaving Discord.`,
        components: [new ActionRowBuilder().addComponents(datesButton(plan))],
        ...quietly
    };
}

/*
    Once everyone left on the plan is in and their calendar answers every day of it,
    nothing else tells the planner they can go and pick a day, so whoever created it
    gets a DM with the overview. The allInNotifiedAt flag keeps it to one nudge per
    round: adding someone or changing the dates reopens the round and lets it fire again.
*/
export async function notifyCreatorIfAllIn(plan) {
    if (!plan || plan.status !== 'collecting' || plan.allInNotifiedAt) return;
    const on = onIt(plan);
    if (!on.length) return;
    const prefs = await getPlanningPrefs(on.map((p) => p.userId));
    if (!on.every((p) => standing(p, coverageOf(answersOn(plan, prefs[p.userId], p))) === 'done')) return;

    //Set the flag before the DM so a slow send cannot let a second nudge slip through
    await markAllInNotified(plan.planId);

    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    await deliver(plan, plan.createdBy, {
        content: banner('EVERYONE IS IN') + `Everyone has answered "${plan.name}"${where}, so you can pick a day now.`,
        components: [overviewRow(plan)]
    });
}

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
            await notifyCreatorIfAllIn(plan);
        });
    }
}

/*
    A new plan's private thread, with the opener posted and pinned before anybody is
    added, so everyone arrives to it rather than to an empty thread.
*/
async function openThread(plan, cfg) {
    const guild = await client.guilds.fetch(plan.guildId);
    const channel = await guild.channels.fetch(cfg.plansChannelId);
    const thread = await createThread(channel, threadName(plan), ChannelType.PrivateThread);
    await setPlanThread(plan.planId, thread.id, channel.id);

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
    the same card everyone got at the start. The DM is optional, dm off just adds
    them to the thread. actorName is the planner who added them.
*/
export async function announceAddition(plan, newIds, actorName, { dm = true } = {}) {
    //Anyone gone again by the time this runs would be invited to a plan they are not on
    const still = new Set(plan.participants.map((p) => p.userId));
    newIds = newIds.filter((id) => still.has(id));
    if (!newIds.length) return;

    const guild = await client.guilds.fetch(plan.guildId);

    const thread = plan.threadId ? await client.channels.fetch(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        await addToThread(thread, newIds);
        //A set day's pin counts them in its tally
        await updateOpener(plan, thread).catch(() => {});
    }

    //The same card everyone else holds, so a late joiner rides the same rewrites
    if (dm) {
        const asks = await askLines(plan, newIds);
        await sendCards(plan, newIds, (id) =>
            planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
                guildName: guild.name,
                actorName,
                ask: asks[id]
            }), { actorName });
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
            const user = await client.users.fetch(p.userId);
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

/*
    Everything Discord holds about a plan, brought back in line with it: the pinned opener,
    which is the yes/no on a set day, every card, and the thread's name. All edits, so this
    pings nobody. cards: false is for an announcement about to send everyone a fresh one.
*/
export async function syncPlan(plan, { cfg = null, cards = true } = {}) {
    const thread = plan.threadId ? await client.channels.fetch(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        await updateOpener(plan, thread);
    }

    const done = cards ? await syncPlanCards(plan, cfg) : 0;
    if (thread) renameThread(thread, threadName(plan));
    return done;
}

/*
    Once a planner locks the winning date the plan closes. The pinned opener turns into the
    yes/no first. Everyone still invited then gets a card, and a post in the thread pings
    whoever the card missed, so nobody who is meant to be there can miss it. Anyone the
    planner left off the invite list hears nothing. The card names who set or moved it.

    The post carries the buttons too, since the people it pings are the ones with no card
    to press them on. The tally stays on the pin.

    quiet sends no card and posts nothing. The pin and everyone's card are rewritten where
    they sit instead, so the DM they already hold quietly becomes the new day.
*/
export async function announceOutcome(plan, cfg, { changed, actorName, quiet = false, added = [] }) {
    /*
        Anyone arriving with the day is left out of this and handed to announceAddition:
        their invitation already carries the day, so being pinged about it changing is
        about a plan they have never seen.
    */
    const isNew = new Set(added);
    const ids = invitedOnly(plan).map((p) => p.userId).filter((id) => !isNew.has(id));

    //Ahead of every branch below, quiet included: this is what puts them in the thread at all
    if (added.length) await announceAddition(plan, added, actorName, { dm: !quiet });
    //Sent back out for dates since this was queued, which announces itself
    if (!plan.chosenDate) return;

    /*
        Quiet rewrites the cards people already hold rather than sending new ones. The ids
        stay put and only the lead they carry moves on, which has to be written down before
        the sync reads it back.
    */
    if (quiet) {
        const held = plan.participants.filter((p) => p.cardMessageId);
        await setPlanCards(plan.planId, held.map((p) => ({ userId: p.userId, messageId: p.cardMessageId })), { actorName, moved: changed });
        const relabelled = { ...plan, participants: plan.participants.map((p) => ({ ...p, cardActor: actorName, cardMoved: changed })) };
        await syncPlan(relabelled, { cfg }).catch((err) => console.error('[plans] quiet outcome sync failed:', err));
        return;
    }

    await syncPlan(plan, { cfg, cards: false }).catch((err) => console.error('[plans] outcome sync failed:', err));

    const sent = await sendCards(plan, ids, (id) =>
        planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
            guildName: cfg.guildName,
            actorName,
            moved: changed
        }), { actorName, moved: changed });

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
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
    const stale = plan.participants.map((p) => p.userId).filter((id) => !reached.has(id) && !isNew.has(id));
    if (stale.length) {
        await syncPlanCards(plan, cfg, { only: stale })
            .catch((err) => console.error('[plans] stale card sync failed:', err));
    }
}

/*
    A time or note edit on a day that is staying put. Everything already sent is brought
    into line first, which pings nobody, so a quiet fix leaves every DM correct and no
    trace of the correction.

    Loud sends a fresh card and no thread post: the pin and the confirmation already carry
    the change, and a second post about a note reads as noise. The card puts the buttons
    back in front of anyone who said yes to the old time.
*/
export async function announceWhenEdit(plan, cfg, { actorName, was = {}, quiet = false }) {
    await syncPlan(plan, { cfg });
    if (quiet || !plan.chosenDate) return;

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
    What the plan says it is about has changed on a plan whose day is already set. The pin
    and every card carry it, so they are rewritten either way; the fresh card on top is
    because this one field now holds what the day's own note used to, and "meet at the pub,
    not the station" reaching nobody is the whole reason that note spoke up when it changed.

    Nothing goes in the thread. A plan still out looking for a day says nothing at all:
    there is no arrangement yet for a correction to be about.
*/
export async function announceDetailsEdit(plan, cfg, { actorName, quiet = false }) {
    await syncPlan(plan, { cfg }).catch((err) => console.error('[plans] details sync failed:', err));
    if (quiet || !plan.chosenDate) return;

    const ids = invitedOnly(plan).map((p) => p.userId);
    if (!ids.length) return;

    await resendCards(plan, ids, cfg, {
        title: 'CHANGED',
        aside: plan.description ? `${actorName} changed what it's about.` : `${actorName} took out what it's about.`
    });
}

/*
    One post for a change that moved several things at once: the window, which days count,
    and anyone new on the list. The window and the days used to move down separate routes
    with a post each, which put three messages in the thread within a second of each other
    and read as a fault rather than as one decision.

    Anyone added is left out of the ids this writes to and handed to announceAddition
    instead: the invitation already carries the window and the days, so a second message
    telling them what changed would be about a plan they have never seen.
*/
export async function announcePlanDates(plan, cfg, { actorName, daysLabel, reopened, note, added = [], post = true, dm = true }) {
    //Every card carries the window and the days, so they are all wrong until this runs
    await syncPlan(plan, { cfg }).catch((err) => console.error('[plans] dates sync failed:', err));

    const isNew = new Set(added);
    const ids = onIt(plan).map((p) => p.userId).filter((id) => !isNew.has(id));
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    const days = daysLabel ? `, ${daysLabel} only` : '';
    //A round reopened means fill it in, which the button says, and anything narrower means nothing to do
    const tail = reopened ? '' : ' Nothing to do, your saved days still stand.';
    const extra = note ? `\n${note}` : '';

    //The card carries the range itself, so the aside leaves it out
    const sent = dm && ids.length
        ? await resendCards(plan, ids, cfg, {
            title: 'CHANGED',
            aside: `${actorName} is asking about different dates${daysLabel ? `, ${daysLabel} only` : ''}.${tail}${extra}`
        })
        : [];

    if (post && plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await postMentioning(thread, missedBy(ids, sent), {
                content: banner('CHANGED') +
                    `${actorName} is asking about different dates for **${plan.name}**: ${range}${days}.${tail}${extra}`,
                components: reopened ? [new ActionRowBuilder().addComponents(datesButton(plan))] : []
            });
        }
    }

    if (added.length) await announceAddition(plan, added, actorName, { dm });
}

/*
    Cancel a plan. It gets marked cancelled and, when post is on, the thread is told,
    but the thread is left in place: deleting it by hand is what finally
    clears the plan. When dm is on everyone gets a DM. The creator gets their daily
    plan slot back since the plan never really ran. actorName is whoever cancelled it.
*/
export async function cancelPlan(plan, actorId, actorName, { post = true, dm = true } = {}) {
    if (!(await markPlanCancelled(plan.planId))) return false;
    await refundAction(plan.createdBy, plan.guildId, 'create', plan.createdAt);
    await addPlanEvent(plan.planId, { type: 'cancelled', by: actorId, byName: actorName }).catch(() => {});
    //In the queue the site's saves wait in, or a cancel from here lands in the middle of one of their announcements
    await announceAfter(plan.planId, 'cancel announce', (current) => announceCancel(current, actorName, { post, dm }), { cancel: true });
    return true;
}

//The telling-everyone half, split off so the site can send it after it has responded
export async function announceCancel(plan, actorName, { post = true, dm = true } = {}) {
    //Nobody should be left holding a card that still says they are coming on the twelfth
    await syncPlan(plan).catch((err) => console.error('[plans] cancel sync failed:', err));

    const ids = onIt(plan).map((p) => p.userId);
    const cfg = dm ? await getGuildConfig(plan.guildId).catch(() => null) : null;
    const sent = dm ? await resendCards(plan, ids, cfg, { actorName }) : [];

    if (post && plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await postMentioning(thread, missedBy(ids, sent), {
                content: banner('CALLED OFF') + `${actorName} called off **${plan.name}**. Nothing more to fill in.`
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
    const updated = await removeParticipant(plan.planId, userId);
    await addPlanEvent(plan.planId, { type: 'left', by: userId, byName: actorName || '' }).catch(() => {});
    return updated;
}

async function afterLeaving(updated) {
    //A set day's pin was counting them
    await updateOpener(updated).catch(() => {});

    //If that drop out leaves everyone else already in, the planner can compare now
    await notifyCreatorIfAllIn(updated).catch(() => {});
    //Likewise, if a probe is running and the leaver was the last to answer, the rest may
    //now all be coming, so the creator should hear they are good to go
    await notifyCreatorAllYes(updated).catch(() => {});
}

/*
    Count me in or Not for me on a DM card. Not for me opens the reason box first, and
    the answer lands when that comes back.
*/
export async function handleJoin(interaction) {
    const [, choice, planId] = interaction.customId.split('|');
    const me = await joinable(interaction, await getPlan(planId));
    if (!me) return;
    if (choice === 'no') return interaction.showModal(notForMeBox(planId));
    await answerJoin(interaction, me, true, null);
}

//The reason came back, from the Not for me box or a drop out box opened before there was one
export async function handleJoinModal(interaction) {
    const me = await joinable(interaction, await getPlan(interaction.customId.split('|')[1]));
    if (!me) return;
    await answerJoin(interaction, me, false, (interaction.fields.getTextInputValue('reason') || '').trim().slice(0, 200) || null);
}

//Drop out on a card from before Count me in, which is Not for me now
export async function handleDrop(interaction) {
    const planId = interaction.customId.split('|')[1];
    if (await joinable(interaction, await getPlan(planId))) return interaction.showModal(notForMeBox(planId));
}

const notForMeBox = (planId) => reasonModal(`joinmodal|${planId}`, 'Not for me', 'Why not? (optional)');

/*
    Who pressed, with the plan they pressed about, while it is still asking. Otherwise the
    press is answered here from the plan as it is now, writing nothing: an older card, a plan
    that has its day, or one called off each get the current card, and null comes back.
*/
async function joinable(interaction, plan) {
    if (!plan) {
        await interaction.update({ content: 'That plan is no longer around.', components: [] });
        return null;
    }
    const me = plan.participants.find((p) => p.userId === interaction.user.id);
    if (!me) {
        await interaction.update({ content: `You are not on "${plan.name}" anymore.`, components: [] });
        return null;
    }
    if (await answeredOldCard(interaction, plan)) return null;
    if (plan.status !== 'collecting') {
        await interaction.update(await cardFor(plan, me));
        return null;
    }
    return { plan, p: me };
}

//The card turns into the answer first, and whoever runs the plan hears after
async function answerJoin(interaction, { plan, p }, value, reason) {
    const updated = await setIn(plan.planId, p.userId, value, reason);
    const now = updated.participants.find((q) => q.userId === p.userId) || { ...p, in: value };
    await interaction.update(await cardFor(updated, now));
    await announceJoin(updated, p.userId, inOf(p), reason, { card: false });
}

//The box for a reason, which only ever goes to whoever runs the plan
function reasonModal(customId, title, question) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addLabelComponents(
            new LabelBuilder()
                .setLabel(question)
                .setDescription('Only whoever runs the plan sees this.')
                .setTextInputComponent(
                    new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false)
                )
        );
}

/*
    Undo on a drop out from before Count me in, when dropping out took people off the plan.
    Puts them back on first when that is still where they are, then counts them in. They
    were left in the thread, so nothing to add there.
*/
export async function handleUndrop(interaction) {
    const planId = interaction.customId.split('|')[1];
    const plan = await getPlan(planId);
    if (!plan) {
        return interaction.update({ content: 'That plan is no longer around.', components: [] });
    }
    if (plan.status === 'cancelled') {
        return interaction.update({ content: `"${plan.name}" was called off, so there is nothing to rejoin.`, components: [] });
    }
    if (dayHasPassed(plan)) {
        return interaction.update({ content: `"${plan.name}" was on ${formatDate(plan.chosenDate)}, so there is nothing to rejoin.`, components: [] });
    }
    const onPlan = plan.participants.find((p) => p.userId === interaction.user.id);
    if (!onPlan) {
        //Pressed from a DM, which says nothing about whether they are still in the server
        const guild = await client.guilds.fetch(plan.guildId).catch(() => null);
        if (!guild || !(await realMembers(guild, [interaction.user.id])).length) {
            return interaction.update({ content: `You are not in the server "${plan.name}" is in anymore, so I cannot put you back on it.`, components: [] });
        }
        await addParticipants(planId, [interaction.user.id]);
    }

    const updated = await setIn(planId, interaction.user.id, true);
    await interaction.update(await cardFor(updated, updated.participants.find((p) => p.userId === interaction.user.id)));
    await announceJoin(updated, interaction.user.id, onPlan ? inOf(onPlan) : false, null, { card: false });
    //A set day's pin counts them again
    await updateOpener(updated).catch(() => {});
}

/*
    A tap on a confirmation probe's yes/no buttons, from the shared thread message or
    from a DM. Yes records straight away. No needs a reason, so it opens a short modal and
    the vote lands when that comes back. The vote is shared, so a DM tap and a thread tap
    hit the same place and the thread tally reflects both.
*/
export async function handleVote(interaction) {
    const [, choice, planId] = interaction.customId.split('|');
    const round = roundOf(interaction.customId);
    const plan = await getPlan(planId);

    const stale = voteStale(plan, interaction.user.id);
    if (stale) return respondStale(interaction, stale);
    const moved = roundMoved(plan, round);
    if (await answeredOldCard(interaction, plan, moved)) return;
    if (moved) return respondStale(interaction, moved);

    if (choice === 'no') {
        //The day can move while the box is open, so the round goes with it
        return interaction.showModal(reasonModal(`votemodal|${planId}|r${round}`, "Can't make it", 'Why not? (optional)'));
    }

    //Whether they were already down as coming, so a re-tap does not re-offer the day block
    const wasYes = plan.participants.find((p) => p.userId === interaction.user.id)?.vote === 'yes';

    const updated = await recordVote(planId, interaction.user.id, 'yes');
    const offer = !interaction.inGuild() && !wasYes ? await blockOffer(updated, interaction.user.id).catch(() => null) : null;
    await ackVote(interaction, updated, 'yes', offer);
    await notifyCreatorAllYes(updated).catch(() => {});
}

/*
    The "can't make it" reason came back. Record the no, give the same feedback a yes
    gets, and let the creator know who and why, but only when this is a fresh no, so a
    re-submit of one already on record does not nudge them twice.
*/
export async function handleVoteModal(interaction) {
    const planId = interaction.customId.split('|')[1];
    const plan = await getPlan(planId);

    const stale = voteStale(plan, interaction.user.id);
    if (stale) return respondStale(interaction, stale);
    const moved = roundMoved(plan, roundOf(interaction.customId));
    if (await answeredOldCard(interaction, plan, moved)) return;
    if (moved) return respondStale(interaction, moved);

    const reason = (interaction.fields.getTextInputValue('reason') || '').trim().slice(0, 200) || null;
    const wasNo = plan.participants.find((p) => p.userId === interaction.user.id)?.vote === 'no';

    const updated = await recordVote(planId, interaction.user.id, 'no', reason);
    await ackVote(interaction, updated, 'no');

    if (!wasNo) await notifyCreatorVoteNo(updated, interaction.user.id, reason).catch(() => {});
}

//Why a vote cannot be counted: the plan is gone, called off, the round is over, or the
//clicker is no longer on it. Returns the line to show, or null when the vote is good.
function voteStale(plan, userId) {
    if (!plan) return 'That plan is no longer around.';
    if (plan.status === 'cancelled') return `"${plan.name}" was cancelled.`;
    if (!plan.probeActive || !plan.chosenDate) return 'That confirmation is closed now. Check the thread for the latest.';
    if (dayHasPassed(plan)) return `"${plan.name}" was on ${formatDate(plan.chosenDate)}, so that day has been and gone.`;
    const me = plan.participants.find((p) => p.userId === userId);
    if (!me) return `You are not on "${plan.name}" anymore.`;
    if (me.invited === false) return `You are not on the invite list for this date. Check the thread for the latest.`;
    return null;
}

//What /free answers in a set plan's thread: the day and the yes/no, with no day picker
export function setDayReply(plan, userId) {
    const stale = voteStale(plan, userId);
    if (stale) return { content: stale, components: [] };
    const vote = effectiveVote(plan.participants.find((p) => p.userId === userId));
    const line = vote === 'yes' ? "You're down as coming." : vote === 'no' ? "You're down as not coming." : 'Can you make it?';
    return { content: `**${plan.name}** is set for ${whenLine(plan)}.\n${line}`, components: [probeRow(plan)] };
}

//The line for a press from a round the plan has moved on from, or null when it is this one
function roundMoved(plan, round) {
    if (round === (plan.round || 0)) return null;
    const day = (plan.pastVotes || []).find((d) => d.round === round)?.date;
    return day ? `That was about ${formatDate(day)}; the plan has moved.` : 'That was about an earlier day; the plan has moved.';
}

/*
    A DM press on buttons that may be about something that has since changed: an older card
    whose delete failed, a message from before every DM was a card, or a round the day has
    moved on from. Nothing is written. The message becomes the card, showing the plan as it
    is now, with moved saying why, and any other card on record is taken down. Says whether
    it answered.
*/
async function answeredOldCard(interaction, plan, moved = null) {
    if (interaction.inGuild() || !interaction.message) return false;
    const p = plan.participants.find((q) => q.userId === interaction.user.id);
    if (!p) return false;
    const onRecord = p.cardMessageId === interaction.message.id;
    if (!moved && (onRecord || !p.cardMessageId)) return false;

    await interaction.update(await cardFor(plan, p, { aside: moved || '' }));
    if (!onRecord) {
        await setPlanCards(plan.planId, [{ userId: p.userId, messageId: interaction.message.id }], { keepLead: true });
        if (p.cardMessageId) await retireCard(p.userId, p.cardMessageId);
    }
    return true;
}

/*
    Answer a stale tap. In a thread we can reply privately, in a DM there is no ephemeral,
    so we just replace the dead buttons with the note.
*/
async function respondStale(interaction, message) {
    if (interaction.inGuild()) {
        return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
    return interaction.update({ content: message, components: [] });
}

/*
    Tell the voter their answer landed, then refresh the shared tally. In a DM the card
    itself becomes their answer, with the offer under it when there is one. In a thread the
    buttons are shared, so we answer them privately instead, no DM and no notification. We
    respond first so a slow tally edit cannot hold the click up past Discord's window.
*/
async function ackVote(interaction, plan, vote, offer = null) {
    if (interaction.inGuild()) {
        const line = vote === 'yes' ? "You're down as coming." : "You're down as not coming.";
        await interaction.reply({ content: `${line} Tap the buttons again any time to change it.`, flags: MessageFlags.Ephemeral });
        //A tap in the thread leaves their own DM still asking the question, so it is brought into line
        await syncPlanCards(plan, null, { only: [interaction.user.id] }).catch(() => {});
    } else {
        const me = { ...plan.participants.find((p) => p.userId === interaction.user.id), vote };
        await interaction.update(underCard(planCard(plan, me), offer));
    }
    await updateOpener(plan).catch(() => {});
}

//The card with a line and a row of buttons of the moment added below it
function underCard(card, extra) {
    if (!extra) return card;
    return { content: `${card.content}\n\n${extra.line}`, components: [...card.components, extra.row] };
}

/*
    Hours are ints from a small fixed set, so a day's hours pack into one integer bitmask.
    We ride that mask on the undo button so undoing a day block restores the exact hours it
    had, a part-day and all, rather than blanket all day. An empty hours (free all day) packs
    to 0.
*/
function packHours(hours) {
    return (hours || []).reduce((mask, h) => mask | (1 << h), 0);
}

function unpackHours(mask) {
    const hours = [];
    for (let h = 0; h < 24; h++) if (mask & (1 << h)) hours.push(h);
    return hours;
}

//Dated, so a press lands on the day that was offered whatever the plan has done since
function offerOn(planId, date) {
    return {
        line: `Your calendar has you free on ${formatDate(date)}.`,
        row: new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`block|yes|${planId}|${date}`).setLabel('Mark me busy that day').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`block|no|${planId}|${date}`).setLabel('Leave my calendar').setStyle(ButtonStyle.Secondary)
        )
    };
}

//The undo puts back the exact hours carried in the mask
function blockedOn(planId, date, mask) {
    return {
        line: `Marked ${formatDate(date)} busy in your calendar.`,
        row: new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`unblock|${planId}|${date}|${mask}`).setLabel('Undo').setStyle(ButtonStyle.Secondary)
        )
    };
}

//The offer buttons from before they carried a day read "Yes, keep it free" for marking it busy, so a press on one is not trusted
const EXPIRED_OFFER = { content: 'That offer has expired, so I left your calendar as it is.', components: [] };

/*
    Which of this person's own days a plan lands on. The plan's day is the server's, and a
    clock far enough from it puts the same evening on the day either side, so the day taken
    out of their timetable is worked back from the moment rather than copied off the plan.
    Midday stands in for a plan with no time, since that lands inside the same day whatever
    clock is reading it.
*/
async function theirDayFor(plan, userId) {
    const planZone = safeZone(plan.timeZone);
    const prefs = await getPlanningPrefs([userId]).catch(() => ({}));
    const zone = safeZone(prefs[userId]?.timeZone);
    if (zone === planZone) return plan.chosenDate;
    return instantToWall(zone, planInstant(planZone, plan.chosenDate, plan.chosenTime || '12:00')).date;
}

/*
    The offer that rides under someone's card once they say they are coming: mark that day
    busy in their calendar, so other plans stop counting them free then. Only made when they
    are free that day, since a day already off their calendar has nothing to mark.
*/
async function blockOffer(plan, userId) {
    const theirs = await theirDayFor(plan, userId);
    const free = await getAvailabilityInRange(userId, theirs, theirs);
    return free.length ? offerOn(plan.planId, theirs) : null;
}

//Their card as the plan stands now, for a press on the offer under it
async function currentCard(planId, userId) {
    const plan = await getPlan(planId);
    const p = plan?.participants.find((q) => q.userId === userId);
    if (!p) return { content: plan ? `You are not on "${plan.name}" anymore.` : 'That plan is no longer around.', components: [] };
    return cardFor(plan, p);
}

//Yes packs the day's hours onto the undo before clearing it, so a part day comes back as it was
export async function handleBlockDay(interaction) {
    const [, choice, planId, date] = interaction.customId.split('|');
    if (!date) return interaction.update(EXPIRED_OFFER);

    let blocked = null;
    if (choice === 'yes') {
        const [day] = await getAvailabilityInRange(interaction.user.id, date, date);
        await blockDay(interaction.user.id, date);
        blocked = blockedOn(planId, date, packHours(day?.hours || []));
    }
    return interaction.update(underCard(await currentCard(planId, interaction.user.id), blocked));
}

//Back to how it was before they pressed, offer and all
export async function handleUnblockDay(interaction) {
    const [, planId, date, mask] = interaction.customId.split('|');
    if (!mask) return interaction.update(EXPIRED_OFFER);

    await setDayFree(interaction.user.id, date, unpackHours(Number(mask)));
    return interaction.update(underCard(await currentCard(planId, interaction.user.id), offerOn(planId, date)));
}

/*
    When everyone has said they are coming, tell whoever set the plan up they are good to
    go. The probeAllYesNotifiedAt flag keeps it to one DM a round, the same way the
    availability all-in nudge does.
*/
async function notifyCreatorAllYes(plan) {
    if (!plan || !plan.probeActive) return;
    const invited = invitedOnly(plan);
    if (!invited.length || !invited.every((p) => effectiveVote(p) === 'yes')) return;
    if (plan.probeAllYesNotifiedAt) return;

    //Set the flag before the DM so a slow send cannot let a second one slip through
    await markProbeAllYes(plan.planId);

    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    await deliver(plan, plan.createdBy,
        banner('EVERYONE IS COMING') +
        `Everyone confirmed they can make "${plan.name}"${where} on ${whenLine(plan)}. You are good to go.`);
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
    if (status === 'coming') await notifyCreatorAllYes(plan).catch(() => {});
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
    When someone says they cannot make it, let the creator know who and why, privately,
    the thread never names them. The vote stays open, so we point them at the overview in case
    they want to move the date. We skip it when the creator is the one who voted.
*/
async function notifyCreatorVoteNo(plan, userId, reason) {
    if (userId === plan.createdBy) return;
    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    const name = await memberName(plan.guildId, userId);
    const why = reason ? `\nReason: ${reason}` : '\nThey did not give a reason.';
    await deliver(plan, plan.createdBy, {
        content: banner('SOMEONE CANNOT MAKE IT') +
            `${name} cannot make "${plan.name}"${where} on ${whenLine(plan)}.${why}\n` +
            `The vote is still going.`,
        components: [overviewRow(plan)]
    });
}

/*
    A note to whoever set the plan up about someone on it, built from that person's name and
    the " in {server}" to put after the plan. Hands back the names of who heard and who the
    DM could not reach, so the site can say which. Nobody is told about themselves.
*/
async function tellCreator(plan, userId, write) {
    if (userId === plan.createdBy) return { told: [], missed: [] };
    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    const reached = await deliver(plan, plan.createdBy, write(await memberName(plan.guildId, userId), where));
    const creator = await memberName(plan.guildId, plan.createdBy, 'whoever set it up');
    return reached ? { told: [creator], missed: [] } : { told: [], missed: [creator] };
}

const reasonLine = (reason) => (reason ? `\nReason: ${reason}` : '');

export function notifyCreatorDropped(plan, userId, reason) {
    return tellCreator(plan, userId, (name, where) =>
        banner('SOMEONE DROPPED OUT') + `${name} dropped out of "${plan.name}"${where}.${reasonLine(reason)}`);
}

//Not for me on a plan still finding its day. They stay on it, and can say they're in again.
function notifyCreatorOut(plan, userId, reason) {
    return tellCreator(plan, userId, (name, where) => ({
        content: banner('SOMEONE CANNOT MAKE IT') + `${name} can't make "${plan.name}"${where}.${reasonLine(reason)}`,
        components: [overviewRow(plan)]
    }));
}

function notifyCreatorUndropped(plan, userId) {
    return tellCreator(plan, userId, (name, where) => banner('BACK IN') + `${name} is in for "${plan.name}"${where} after all.`);
}

/*
    Count me in or Not for me having landed, from the site or a DM. Their card is brought in
    line unless the press that did it has already rewritten it, and whoever set the plan up
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
    if (out) heard = await notifyCreatorOut(plan, userId, reason).catch(() => heard);
    if (back) await notifyCreatorUndropped(plan, userId).catch(() => {});
    await notifyCreatorIfAllIn(plan).catch(() => {});
    return heard;
}

/*
    The /overview slash command. Run inside a plan's thread, it hands back the link
    to that plan's overview. Planner role only, although the pinned intro already
    offers it to anyone on the plan.
*/
export async function handleOverview(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server.', flags: MessageFlags.Ephemeral });
    }

    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg || !cfg.setupComplete) {
        return interaction.reply({ content: 'Run /setup first.', flags: MessageFlags.Ephemeral });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.roles.cache.has(cfg.plannerRoleId)) {
        return interaction.reply({ content: 'You need the planner role to do that.', flags: MessageFlags.Ephemeral });
    }

    const plan = await getPlanByThread(interaction.channelId);
    if (!plan) {
        return interaction.reply({ content: "Run this inside a plan's thread to get its overview link.", flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({
        content: `**${plan.name}**`,
        components: [overviewRow(plan)],
        flags: MessageFlags.Ephemeral
    });
}

/*
    The /mylink command. Lists the open plans the person is invited to in this
    server, each with its availability link. Always a private reply, just to them,
    so it works the same wherever they run it.
*/
export async function handleMyLink(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server.', flags: MessageFlags.Ephemeral });
    }

    const plans = await getOpenPlansForUser(interaction.guildId, interaction.user.id);
    if (!plans.length) {
        return interaction.reply({ content: 'You are not in any open plans here right now.', flags: MessageFlags.Ephemeral });
    }

    const lines = plans.map((p) => `- **${p.name}**: ${planUrl(p.planId)}`).join('\n');
    return interaction.reply({ content: `Your plans here:\n${lines}`, flags: MessageFlags.Ephemeral });
}

//Hands back the link to the calendar, the page not tied to any one plan
export async function handleMyCalendar(interaction) {
    return interaction.reply({
        content: `Your calendar: ${calendarUrl()}`,
        flags: MessageFlags.Ephemeral
    });
}

//The /cancel command, asks to confirm before scrapping the plan in this thread
export async function handleCancel(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a plan thread.', flags: MessageFlags.Ephemeral });
    }
    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg) return interaction.reply({ content: 'Run /setup first.', flags: MessageFlags.Ephemeral });

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.roles.cache.has(cfg.plannerRoleId)) {
        return interaction.reply({ content: 'You need the planner role to do that.', flags: MessageFlags.Ephemeral });
    }

    const plan = await getPlanByThread(interaction.channelId);
    if (!plan) return interaction.reply({ content: 'Run this inside a plan thread to call it off.', flags: MessageFlags.Ephemeral });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel|yes|${plan.planId}`).setLabel('Yes, call it off').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel|no').setLabel('Keep it').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
        content: `Call off **${plan.name}**? Everyone gets told, and the thread stays until you delete it by hand.`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

//Routes the cancel confirm buttons. Cancel is the only plan button left now that
//a deleted thread just scraps the plan outright.
export async function handlePlanComponent(interaction) {
    const [, action, planId] = interaction.customId.split('|');

    if (action === 'no') return interaction.update({ content: 'Kept it.', components: [] });

    await interaction.update({ content: 'Calling it off...', components: [] });
    const plan = await getPlan(planId);
    const actorName = interaction.member?.displayName || interaction.user.username;
    if (!plan || !(await cancelPlan(plan, interaction.user.id, actorName))) {
        return interaction.editReply({ content: 'It was already called off, so I left everyone be.' });
    }
    return interaction.editReply({ content: 'Done, everyone has been told. Delete this thread when you are ready to clear the plan for good.' });
}

/*
    Nudges everyone a plan still finding its day is waiting on with a fresh card, no thread
    post: whoever has not said if they're in, and whoever is in with days still to fill. The
    card says what is left, so the line on top only says who is waiting. The /remind route
    caps this to once a day. actorName is whoever asked for it.
*/
export async function remindStragglers(plan, actorName) {
    const on = onIt(plan);
    const prefs = await getPlanningPrefs(on.map((p) => p.userId));
    const owing = new Map();
    for (const p of on) {
        const owed = owes(p, coverageOf(answersOn(plan, prefs[p.userId], p)));
        if (owed) owing.set(p.userId, owed === 'answer' ? "is still waiting to hear if you're in." : 'is still waiting on your dates.');
    }
    if (!owing.size) return 0;

    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    await resendCards(plan, [...owing.keys()], cfg, (id) => ({ title: 'REMINDER', aside: nudgeLine(plan, id, `${actorName} ${owing.get(id)}`) }));

    return owing.size;
}

//Someone a host moved back hears that first, and nothing about who is waiting
function nudgeLine(plan, userId, waiting) {
    const back = plan.participants.find((p) => p.userId === userId)?.sentBack;
    if (!back?.byName) return waiting;
    return plan.chosenDate
        ? `${back.byName} moved you back to waiting for "${plan.name}".`
        : `${back.byName} asked you to go over your dates for "${plan.name}" again.`;
}

/*
    Ask again, from the overview of a plan still finding its day: one person's card sent
    fresh, opening with who asked. Answers whether it landed. Nobody who said Not for me,
    since they get no DMs at all.
*/
export async function askAgain(plan, userId, actorName) {
    const p = plan.participants.find((q) => q.userId === userId);
    if (!p || inOf(p) === false || plan.status !== 'collecting') return false;
    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    const sent = await resendCards(plan, [userId], cfg, {
        title: 'REMINDER',
        aside: nudgeLine(plan, userId, `${actorName} is still waiting to hear if you're in.`)
    });
    return sent.length > 0;
}

/*
    The same nudge for a running confirmation probe: the people who have not said
    whether they are coming, sent their card again, buttons and all, so they can answer
    without going and finding the thread.

    Only the people still on the invite list, and only where the answer is genuinely
    missing. A planner who has already made the call on someone counts as an answer, so
    the board they just filled in is not undone by a DM asking them again.
*/
export async function remindVoters(plan, actorName) {
    const pending = invitedOnly(plan).filter((p) => !effectiveVote(p)).map((p) => p.userId);
    if (!pending.length) return 0;

    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    await resendCards(plan, pending, cfg, (id) => ({
        title: 'REMINDER',
        aside: nudgeLine(plan, id, `${actorName} is still waiting to hear whether you can make it.`)
    }));

    return pending.length;
}
