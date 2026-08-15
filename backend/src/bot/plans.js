import { ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { client } from './client.js';
import { createThread, planUrl, compareUrl, icsUrl, threadUrl, reviveThread, pinMessage } from './util.js';
import { googleCalendarUrl } from '../lib/ics.js';
import { setPlanThread, setPlanOpener, getPlan, getPlanByThread, getOpenPlansForUser, markPlanCancelled, removeParticipant, markAllInNotified, recordVote, setProbe, markProbeAllYes, addParticipants, getPlansCoveredBy, confirmParticipant, addPlanEvent, setPlanCards, clearPlanCard } from '../db/plans.js';
import { getGuildConfig } from '../db/guilds.js';
import { getAvailabilityInRange, blockDay, setDayFree } from '../db/availability.js';
import { getPlanningPrefs } from '../db/users.js';
import { refundAction } from '../db/ratelimits.js';
import { fanOut } from '../lib/fanout.js';
import { formatDate, formatTime } from '../lib/dates.js';
import { safeZone, planInstant, instantToWall, discordStamp } from '../lib/zones.js';
import { config } from '../config.js';

/*
    Sends the same line to a list of people by DM, best effort, since some have
    DMs closed. The thread ping still reaches anyone the DM cannot. An optional
    set of components rides along so a DM can carry a button, like drop out.
*/
async function dmEach(ids, text, components = []) {
    await fanOut(ids, async (id) => {
        try {
            const user = await client.users.fetch(id);
            await user.send(components.length ? { content: text, components } : text);
        } catch {
            //DMs off, the thread ping still reaches them
        }
    });
}

/*
    The same for a message meant to stay current: each person gets their own payload and the
    ids that landed come back to be written down. DMs off just means no card for them.
*/
async function dmCards(ids, build) {
    const sent = [];
    await fanOut(ids, async (id) => {
        try {
            const user = await client.users.fetch(id);
            const msg = await user.send(build(id));
            sent.push({ userId: id, messageId: msg.id });
        } catch {
            //DMs off, the thread is the backstop
        }
    });
    return sent;
}

//Pulls people into a plan's thread, best effort: someone who has left the server
//just does not arrive, and the rest of the list still gets in
async function addToThread(thread, ids) {
    await fanOut(ids, (id) => thread.members.add(id).catch(() => {}));
}

//The drop out button that rides along on the DMs for a plan that is still collecting
function dropRow(planId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`drop|${planId}`).setLabel('Drop out of this plan').setStyle(ButtonStyle.Danger)
    );
}

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

/*
    The two ways into a calendar with the day already filled in, added wherever a set
    date is announced. Both, because they fail in opposite places: the download is the
    one every calendar takes but it asks for a login, and the Google link asks for
    nothing at all, which is what someone reading a DM on their phone actually has.
*/
function calendarLines(plan) {
    if (!plan.chosenDate) return '';
    return `\nAdd it to your calendar: ${googleCalendarUrl(plan)}\nOr download it: ${icsUrl(plan.planId)}`;
}

/*
    The yes/no buttons for a confirmation probe. The same row rides on the shared thread
    message and on each person's DM, since the vote it records is shared either way.
*/
function probeRow(planId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vote|yes|${planId}`).setLabel("I'm coming").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`vote|no|${planId}`).setLabel("Can't make it").setStyle(ButtonStyle.Danger)
    );
}

/*
    The DM version once someone has voted. A DM is private to one person, so we can lock
    the buttons to their answer: the one they picked turns solid with a tick, the other
    stays live so they can switch. This is how a DM voter sees that their choice landed.
*/
function votedDmRow(planId, vote) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`vote|yes|${planId}`)
            .setLabel(vote === 'yes' ? '✓ Coming' : "I'm coming")
            .setStyle(vote === 'yes' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`vote|no|${planId}`)
            .setLabel(vote === 'no' ? "✓ Can't make it" : "Can't make it")
            .setStyle(vote === 'no' ? ButtonStyle.Danger : ButtonStyle.Secondary)
    );
}

/*
    The people still on the invite list for a set date. Everyone starts invited, a
    planner can narrow it to just the people who fit while locking a date in, and
    voiding or moving the date puts everyone back on.
*/
function invitedOnly(plan) {
    return plan.participants.filter((p) => p.invited !== false);
}

//Where someone actually stands: a planner's manual call wins over their own vote,
//and no answer at all reads as still waiting
function effectiveVote(p) {
    return p.override || p.vote || null;
}

//A one line count of where the confirmation vote stands, shown under the probe.
//Only the people still invited count, nobody waits on someone who is off the list.
function probeTally(plan) {
    const invited = invitedOnly(plan);
    const yes = invited.filter((p) => effectiveVote(p) === 'yes').length;
    const no = invited.filter((p) => effectiveVote(p) === 'no').length;
    const pending = invited.length - yes - no;
    const bits = [`${yes} coming`, `${no} can't make it`];
    if (pending > 0) bits.push(`${pending} yet to answer`);
    return bits.join(' · ');
}

/*
    The body of a confirmation probe: a clear heading, the date in question, what the
    plan is about and the running tally, so anyone reading the thread sees where the
    vote stands at a glance.
*/
function probeText(plan) {
    const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';
    //A closed one keeps its tally: what people said still stands, it is only the asking that stopped
    const asking = plan.probeActive !== false;
    return banner('CAN YOU MAKE IT?') +
        `**${plan.name}** is set for ${whenLine(plan)}.${note}\n` +
        aboutLine(plan) +
        (asking ? `Tap below to let everyone know.\n\n` : `Confirmations are closed.\n\n`) +
        probeTally(plan);
}

/*
    The one DM per person saying what the plan currently is, rebuilt from the plan every
    time so a send and a later rewrite agree. Every other DM the bot sends is a note about
    a moment and ages fine on its own.

    actor and moved fall back to the participant, which is how a rebuild months later still
    names the right person. Their own vote goes on it, or a rewrite would blank a voted DM
    back to the question. aside is for this send only, so advice does not outlive its moment.
*/
export function planCard(plan, p, { guildName = '', actorName = null, moved = null, aside = '' } = {}) {
    const who = actorName ?? p.cardActor ?? '';
    const wasMoved = moved ?? Boolean(p.cardMoved);
    const again = Boolean(plan.repeatedFrom);
    const where = guildName ? ` in ${guildName}` : '';

    //First, so nobody is left holding a card that still has them coming on the twelfth
    if (plan.status === 'cancelled') {
        return {
            content: banner('PLAN CANCELLED') + `"${plan.name}"${where} is off. Nothing more to fill in.`,
            components: []
        };
    }

    //Still collecting: the card is the invitation, and the way to the dates and the thread
    if (plan.status !== 'closed' || !plan.chosenDate) {
        const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
        const lead = again
            ? `"${plan.name}" is back round again${where} (${range}).`
            : who
                ? `${who} added you to the plan "${plan.name}"${where} (${range}).`
                : `You are on the plan "${plan.name}"${where} (${range}).`;
        //Dropped rather than guessed at when there is no thread yet, since the card outlives the send
        const jump = plan.threadId ? `Jump straight to the thread: ${threadUrl(plan.guildId, plan.threadId)}\n` : '';
        return {
            content: banner(again ? 'ROUND AGAIN' : 'INVITED TO A PLAN') +
                `${lead}\n` +
                aboutLine(plan) +
                `Add the dates you are free here: ${planUrl(plan.planId)}\n` +
                `${jump}\n` +
                `Hit "Drop out" below to leave the plan`,
            components: [dropRow(plan.planId)]
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

    //Their answer, kept on the card so a rewrite cannot undo what ackVote put there
    const vote = plan.probeActive ? p.vote || null : null;
    if (vote) {
        const line = vote === 'yes' ? "You're down as coming." : "You're down as not coming.";
        return {
            content: banner('CAN YOU MAKE IT?') +
                `**${plan.name}** is set for ${when}.${about}${note}${aside}\n` +
                `${line} Tap the other button if that changes.` +
                (vote === 'yes' ? `\n${calendarLines(plan)}` : ''),
            components: [votedDmRow(plan.planId, vote)]
        };
    }

    if (plan.probeActive) {
        return {
            content: banner('CAN YOU MAKE IT?') + lead + about + note + aside + `\n\nCan you make it? Tap below.`,
            components: [probeRow(plan.planId)]
        };
    }

    return {
        content: banner(again ? 'ROUND AGAIN' : wasMoved ? 'PLAN CHANGED' : 'DATE SET') +
            lead + about + note + aside + '\n' + calendarLines(plan),
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
    Redraw the shared thread probe as votes land, and put it back when it has been deleted.

    A probe that never had a thread message is left alone rather than given one: that is the
    DM only case, and this runs on every vote, so it would post a poll nobody asked for.
*/
export async function updateProbeMessage(plan) {
    if (!plan.probeThreadMessageId || !plan.threadId) return;
    const thread = await client.channels.fetch(plan.threadId).catch(() => null);
    if (!thread) return;
    await reviveThread(thread);

    const payload = {
        content: probeText(plan),
        components: plan.probeActive ? [probeRow(plan.planId)] : [],
        allowedMentions: { parse: [] }
    };

    //A closed one is only ever edited: reposting a poll with no buttons helps nobody
    if (!plan.probeActive) {
        const msg = await thread.messages.fetch(plan.probeThreadMessageId).catch(() => null);
        if (msg) await msg.edit(payload).catch(() => {});
        return;
    }

    const placed = await placeThreadMessage(thread, plan.probeThreadMessageId, payload);
    if (placed?.fresh) await setProbe(plan.planId, { active: true, threadMessageId: placed.message.id });
}

//Best effort display name for someone in a guild, falling back when they have left
async function memberName(guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return member.displayName;
    } catch {
        return 'Someone';
    }
}

/*
    The opening post for a plan's thread, pulled out so creating a plan, announcing
    a set plan, and editing the details later all build the exact same message,
    which keeps the pinned post in step. A set plan already has its date, so its
    opener states it instead of asking people to fill in availability.
*/
function openerText(plan) {
    //A plan the sweep made says so itself, so nothing has to be passed down to every caller
    const again = Boolean(plan.repeatedFrom);
    if (plan.status === 'closed' && plan.chosenDate) {
        const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';
        const about = plan.description ? `\nWhat it is about: ${plan.description}` : '';
        return banner(again ? 'ROUND AGAIN' : 'PLAN SET') +
            `**${plan.name}** is set for ${whenLine(plan)}.${about}${note}\n` +
            calendarLines(plan);
    }
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    return banner(again ? 'ROUND AGAIN' : 'EVENT CREATED') +
        (again ? `**${plan.name}** is back round (${range}).\n` : `New plan: **${plan.name}** (${range}).\n`) +
        aboutLine(plan) +
        `Choose the dates you are free here: ${planUrl(plan.planId)}\n` +
        //The link is the fuller thing, so it stays first, but a lot of people will only ever use this
        `Or run \`/free\` in this thread and tick them off without going anywhere.\n` +
        `A planner can run \`/compare\` any time to see where things stand, even before everyone is in.`;
}

/*
    When the last invited person fills their availability, nothing else tells the
    planner they can go and pick a day, so we DM whoever created the plan with the
    compare link. The allInNotifiedAt flag keeps it to one nudge per round: adding
    someone or changing the dates reopens the round and lets it fire again.
*/
export async function notifyCreatorIfAllIn(plan) {
    if (!plan || plan.status !== 'collecting') return;
    const ids = plan.participants.map((p) => p.userId);
    if (!ids.length || !plan.participants.every((p) => p.confirmed)) return;
    if (plan.allInNotifiedAt) return;

    //Set the flag before the DM so a slow send cannot let a second nudge slip through
    await markAllInNotified(plan.planId);

    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    const count = ids.length === 1 ? '1 person has' : `all ${ids.length} people have`;
    await dmEach([plan.createdBy],
        banner('EVERYONE IS IN') +
        `Everyone is in for "${plan.name}"${where}. ${count} filled their availability, so you can compare and lock in a day now.\n` +
        `Compare here: ${compareUrl(plan.planId)}\n` +
        `Or run \`/compare\` in the plan's thread.`);
}

/*
    Confirm this person for every open plan whose whole window sits inside the range
    they just filled, the auto-accept behind the availability pages. Quiet on the
    thread as ever, but if someone was the last one in, the planner gets their
    compare nudge. Returns the names of the plans it confirmed, for the saved message.
*/
export async function autoConfirmCoveredPlans(userId, start, end) {
    const names = [];
    const plans = await getPlansCoveredBy(userId, start, end);
    for (const plan of plans) {
        const me = plan.participants.find((p) => p.userId === userId);
        if (me && !me.confirmed) {
            const updated = await confirmParticipant(plan.planId, userId);
            names.push(plan.name);
            try {
                await notifyCreatorIfAllIn(updated);
            } catch (err) {
                console.error('[plans] all-in notify failed:', err);
            }
        }
    }
    return names;
}

/*
    When a plan is created on the site this is the Discord side of it: open a
    private thread named after the plan, pull the invited people in, and ping them
    in the thread. The thread is the workspace so it always opens. The DM, with the
    range, what the plan is about, a jump to the thread and a drop out button, is
    optional: dm off means people only hear about it through the thread ping.
    actorName is whoever started it.
*/
export async function announcePlan(plan, cfg, actorName, { dm = true } = {}) {
    const guild = await client.guilds.fetch(plan.guildId);
    const channel = await guild.channels.fetch(cfg.plansChannelId);

    //Thread names cap at 100 characters
    const thread = await createThread(channel, plan.name.slice(0, 100), ChannelType.PrivateThread);
    await setPlanThread(plan.planId, thread.id);

    const ids = plan.participants.map((p) => p.userId);
    await addToThread(thread, ids);

    //No @ here, adding people to the thread already pings them
    const opener = await thread.send({ content: openerText(plan), allowedMentions: { parse: [] } });
    //Pin the opener so the link and the details stay at the top of the thread, best effort:
    //a server that has not given the bot Manage Messages still gets its thread
    await pinMessage(opener).catch(() => {});
    //Remember it so editing the title or description later can rewrite this same post
    await setPlanOpener(plan.planId, opener.id);

    //The thread id is only in the database yet, so it is patched on or the card has no jump link
    if (dm) {
        const withThread = { ...plan, threadId: thread.id };
        //A repeat has no actor: nobody did this, it just came round, so the card says that instead
        const sent = await dmCards(ids, (id) =>
            planCard(withThread, plan.participants.find((p) => p.userId === id) || {}, {
                guildName: guild.name,
                actorName: plan.repeatedFrom ? '' : actorName
            }));
        await setPlanCards(plan.planId, sent, { actorName: plan.repeatedFrom ? '' : actorName });
    }

    return thread;
}

/*
    The announce-a-set-plan path: the planner already knows the date, so there is
    nothing to collect. The thread is always opened, same as a normal plan, so /compare
    keeps working and the plan can be reached and managed later. Adding people to a
    private thread already pings them, so the opener goes up quietly. dm says whether
    everyone also gets a DM, probe says whether to ask everyone to confirm with yes/no
    buttons. actorName is whoever set it up.
*/
export async function announceSetPlan(plan, cfg, actorName, { dm = true, probe = false } = {}) {
    const ids = plan.participants.map((p) => p.userId);

    const guild = await client.guilds.fetch(plan.guildId);
    const channel = await guild.channels.fetch(cfg.plansChannelId);
    const thread = await createThread(channel, plan.name.slice(0, 100), ChannelType.PrivateThread);
    await setPlanThread(plan.planId, thread.id);
    await addToThread(thread, ids);

    //No @ here, adding people to the thread already pings them
    const opener = await thread.send({ content: openerText(plan), allowedMentions: { parse: [] } });
    await pinMessage(opener).catch(() => {});
    await setPlanOpener(plan.planId, opener.id);

    /*
        The confirmation probe rides on top: a thread message everyone can vote on, and
        the same buttons in each DM when DMs go out. We mark the probe live and remember
        the thread message so its tally can be kept current.
    */
    if (probe) {
        const probeMsg = await thread.send({ content: probeText(plan), components: [probeRow(plan.planId)], allowedMentions: { parse: [] } });
        plan = await setProbe(plan.planId, { active: true, threadMessageId: probeMsg.id });
    }

    //Off the plan setProbe handed back, or the cards go out without the buttons
    if (dm) {
        const who = plan.repeatedFrom ? '' : actorName;
        const sent = await dmCards(ids, (id) =>
            planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
                guildName: cfg.guildName,
                actorName: who
            }));
        await setPlanCards(plan.planId, sent, { actorName: who });
    }
}

/*
    Pull extra people into a plan that is already running. They slip into the
    thread quietly, no ping and no post about it. The welcome goes by DM instead:
    what it is about, the range, the link and a way to the thread, plus a drop out
    button, same as the start. The DM is optional, dm off just adds them to the
    thread. actorName is the planner who added them.
*/
export async function announceAddition(plan, newIds, actorName, { dm = true } = {}) {
    const guild = await client.guilds.fetch(plan.guildId);

    const thread = plan.threadId ? await client.channels.fetch(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        await addToThread(thread, newIds);
    }

    //The same card everyone else holds, so a late joiner rides the same rewrites
    if (dm) {
        const sent = await dmCards(newIds, (id) =>
            planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
                guildName: guild.name,
                actorName
            }));
        await setPlanCards(plan.planId, sent, { actorName });
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

    let done = 0;
    await fanOut(holders, async (p) => {
        try {
            const user = await client.users.fetch(p.userId);
            const dm = await user.createDM();
            const msg = await dm.messages.fetch(p.cardMessageId);
            await msg.edit(planCard(plan, p, { guildName }));
            done++;
        } catch (err) {
            //10008 is Discord's unknown message: they deleted it, so stop paying for it every pass
            if (err?.code === 10008) await clearPlanCard(plan.planId, p.userId).catch(() => {});
        }
    });
    return done;
}

/*
    Everything Discord holds about a plan, brought back in line with it: the pinned opener,
    the confirmation, every card. All edits, so this pings nobody.

    rename is asked for rather than done every pass, Discord capping thread renames at twice
    per ten minutes. A plan with no remembered opener is left alone, since a repost would
    land at the bottom of the thread and that is not an opener.
*/
export async function syncPlan(plan, { cfg = null, rename = false } = {}) {
    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            if (rename) await thread.setName(plan.name.slice(0, 100)).catch(() => {});

            if (plan.openerMessageId) {
                const placed = await placeThreadMessage(thread, plan.openerMessageId, {
                    content: openerText(plan),
                    allowedMentions: { parse: [] }
                });
                if (placed?.fresh) {
                    await pinMessage(placed.message).catch(() => {});
                    await setPlanOpener(plan.planId, placed.message.id);
                }
            }
        }
    }

    await updateProbeMessage(plan).catch(() => {});
    return syncPlanCards(plan, cfg);
}

/*
    Once a planner locks the winning date the plan closes. The outcome always lands
    in the thread, pinging the people still invited, and those same people always get
    a DM, so nobody who is meant to be there can miss it. Anyone the planner left off
    the invite list hears nothing. The headline and DM both name who set or moved it.

    The DM becomes their card, so a later change to the time or note rewrites it in place.

    quiet sends nothing and mentions nobody. Everyone's card is rewritten where it sits
    instead, so their DM quietly becomes the new day and the thread gains no post. A
    confirmation still has to exist as a message to carry its buttons, so that one goes up
    unmentioned rather than not at all.
*/
export async function announceOutcome(plan, cfg, { changed, actorName, probe = false, quiet = false }) {
    const ids = invitedOnly(plan).map((p) => p.userId);
    const when = whenLine(plan);
    const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';
    const about = plan.description ? `\nWhat it is about: ${plan.description}` : '';

    if (plan.threadId && (probe || !quiet)) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            const lead = ids.length && !quiet ? `${ids.map((id) => `<@${id}>`).join(' ')}\n\n` : '';
            if (probe) {
                /*
                    With a probe on, the outcome post is the confirmation itself: the date
                    and the yes/no buttons in one. We remember the message so its tally
                    can be kept current as votes come in.
                */
                const probeMsg = await thread.send({
                    content: lead + probeText(plan),
                    components: [probeRow(plan.planId)],
                    allowedMentions: quiet ? { parse: [] } : { users: ids }
                });
                plan = await setProbe(plan.planId, { active: true, threadMessageId: probeMsg.id });
            } else {
                const headline = changed
                    ? `${banner('PLAN CHANGED')}${lead}Change of plan: ${actorName} moved **${plan.name}** to ${when}.${about}${note}`
                    : `${banner('DATE SET')}${lead}${actorName} set **${plan.name}** for ${when}.${about}${note}`;
                await thread.send({ content: `${headline}\n${calendarLines(plan)}`, allowedMentions: { users: ids } });
            }
        }
    }

    //A probe with no thread to post in still needs marking live so DM votes are accepted,
    //even though there is no thread message to tally
    if (probe && !plan.probeActive) {
        plan = await setProbe(plan.planId, { active: true, threadMessageId: null });
    }

    /*
        Quiet rewrites the cards people already hold rather than sending new ones, so the DM
        in somebody's inbox silently becomes the new day. The ids stay put and only the lead
        they carry moves on, which has to be written down before the sync reads it back.
    */
    if (quiet) {
        const held = plan.participants.filter((p) => p.cardMessageId);
        await setPlanCards(plan.planId, held.map((p) => ({ userId: p.userId, messageId: p.cardMessageId })), { actorName, moved: changed });
        const relabelled = { ...plan, participants: plan.participants.map((p) => ({ ...p, cardActor: actorName, cardMoved: changed })) };
        //One pass for the pin, the confirmation and every card, since the probe is now settled
        await syncPlan(relabelled, { cfg }).catch((err) => console.error('[plans] quiet outcome sync failed:', err));
        return;
    }

    //Anyone whose horizon sits before the date never really answered for it, so their card says so
    const prefs = probe ? await getPlanningPrefs(ids).catch(() => ({})) : {};
    const nudge = '\nThis lands past the date you said you could plan up to, so it is worth a proper look.';

    const sent = await dmCards(ids, (id) =>
        planCard(plan, plan.participants.find((p) => p.userId === id) || {}, {
            guildName: cfg.guildName,
            actorName,
            moved: changed,
            aside: prefs[id]?.sureUntil && plan.chosenDate > prefs[id].sureUntil ? nudge : ''
        }));
    await setPlanCards(plan.planId, sent, { actorName, moved: changed });

    //Narrowed off the list hear nothing, but their card would still be asking about the day
    const dropped = plan.participants.filter((p) => p.invited === false).map((p) => p.userId);
    if (dropped.length) {
        await syncPlanCards(plan, cfg, { only: dropped })
            .catch((err) => console.error('[plans] dropped card sync failed:', err));
    }
}

/*
    A time or note edit on a day that is staying put. Everything already sent is brought
    into line first, which pings nobody, so a quiet fix leaves every DM correct and no
    trace of the correction.

    Loud sends a DM and no thread post: the pin and the confirmation already carry the
    change, and a second post about a note reads as noise. A moved time also puts the
    buttons back in front of anyone who said yes to the old one.
*/
export async function announceWhenEdit(plan, cfg, { actorName, was = {}, quiet = false }) {
    await syncPlan(plan, { cfg });
    if (quiet) return;

    const ids = invitedOnly(plan).map((p) => p.userId);
    if (!ids.length) return;

    const timeMoved = (was.time || null) !== (plan.chosenTime || null);
    const noteMoved = (was.note || null) !== (plan.chosenNote || null);

    const bits = [];
    if (timeMoved) bits.push(plan.chosenTime ? `it starts at ${formatTime(plan.chosenTime)} now` : 'there is no set time any more');
    if (noteMoved) bits.push(plan.chosenNote ? `the note now reads "${plan.chosenNote}"` : 'the note is gone');

    const about = plan.description ? `\nWhat it is about: ${plan.description}` : '';
    //Only worth re-offering when the moment itself moved, since the file carries the time
    const calendar = timeMoved ? `\n${calendarLines(plan)}` : '';
    const recheck = plan.probeActive && timeMoved ? `\n\nIf that no longer works, change your answer below.` : '';

    await dmEach(ids,
        banner('PLAN UPDATED') +
        `${actorName} updated "${plan.name}" in ${cfg.guildName} on ${whenLine(plan)}: ${bits.join(', and ')}.${about}${calendar}${recheck}`,
        plan.probeActive && timeMoved ? [probeRow(plan.planId)] : []);
}

/*
    Open or close the confirmation on a set day. A switch: no answer is touched either way,
    so one closed by accident comes back with every yes and no still on it.

    Opening revives the thread message it already had rather than posting a second poll.
    The trap is that an edit notifies nobody, so a revived confirmation is silent however
    loudly it was asked for, which is why the answer says which of the two happened.
    Every card is rewritten with it, so the buttons appear and vanish with the switch.
*/
export async function applyConfirmations(plan, active, { cfg = null, mention = true } = {}) {
    let updated = await setProbe(plan.planId, { active });
    let revived = true;

    if (active && updated.threadId) {
        const thread = await client.channels.fetch(updated.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            const ids = invitedOnly(updated).map((p) => p.userId);
            const ping = mention && ids.length;
            //Mentions only on a confirmation this plan has never had, the rest being replacements
            const announcing = ping && !updated.probeThreadMessageId;
            const placed = await placeThreadMessage(thread, updated.probeThreadMessageId, {
                content: (announcing ? `${ids.map((id) => `<@${id}>`).join(' ')}\n\n` : '') + probeText(updated),
                components: [probeRow(updated.planId)],
                allowedMentions: announcing ? { users: ids } : { parse: [] }
            });
            if (placed?.fresh) {
                revived = false;
                updated = await setProbe(updated.planId, { active: true, threadMessageId: placed.message.id });
            }
        }
    } else {
        await updateProbeMessage(updated).catch(() => {});
    }

    await syncPlanCards(updated, cfg).catch((err) => console.error('[plans] confirmation card sync failed:', err));
    return { plan: updated, revived };
}

/*
    Tells everyone the date range moved and they need to look at the new window.
    When post is on it pings the thread, when dm is on it DMs everyone. actorName
    is whoever changed it.
*/
export async function announceRangeChange(plan, cfg, { actorName, note, post = true, dm = true }) {
    //Every card carries the range, so they are all wrong until this runs
    await syncPlan(plan, { cfg }).catch((err) => console.error('[plans] range sync failed:', err));

    const ids = plan.participants.map((p) => p.userId);
    const url = planUrl(plan.planId);
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    const extra = note ? `\n${note}` : '';

    if (post && plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content: banner('DATE RANGE CHANGED') +
                    `${ids.map((id) => `<@${id}>`).join(' ')}\n\n${actorName} changed the dates for **${plan.name}** to ${range}. Add your availability here: ${url}${extra}`,
                allowedMentions: { users: ids }
            });
        }
    }

    if (dm) {
        await dmEach(ids,
            banner('DATES CHANGED') +
            `${actorName} changed the dates for "${plan.name}" in ${cfg.guildName} to ${range}. Add your availability here: ${url}${extra}`);
    }
}

/*
    One post for a change that moved several things at once: the window, which days count,
    and anyone new on the list. announceRangeChange and announceWeekdaysChange still answer
    their own routes; this is what the dates screen sends instead, since three of those
    arriving in the same thread within a second of each other reads as a fault rather than
    as one decision.

    Anyone added is left out of the ids this writes to and handed to announceAddition
    instead: the invitation already carries the window and the days, so a second message
    telling them what changed would be about a plan they have never seen.
*/
export async function announcePlanDates(plan, cfg, { actorName, daysLabel, reopened, note, added = [], post = true, dm = true }) {
    //Every card carries the window and the days, so they are all wrong until this runs
    await syncPlan(plan, { cfg }).catch((err) => console.error('[plans] dates sync failed:', err));

    const isNew = new Set(added);
    const ids = plan.participants.map((p) => p.userId).filter((id) => !isNew.has(id));
    const url = planUrl(plan.planId);
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    const days = daysLabel ? `, ${daysLabel} only` : '';
    //A round reopened means fill it in, anything narrower means nothing to do
    const tail = reopened ? `Add your availability here: ${url}` : 'Nothing to do, your saved days still stand.';
    const extra = note ? `\n${note}` : '';

    if (post && plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content: banner('DATES CHANGED') +
                    `${ids.map((id) => `<@${id}>`).join(' ')}\n\n${actorName} is asking about different dates for **${plan.name}**: ${range}${days}. ${tail}${extra}`,
                allowedMentions: { users: ids }
            });
        }
    }

    if (dm && ids.length) {
        await dmEach(ids,
            banner('DATES CHANGED') +
            `${actorName} is asking about different dates for "${plan.name}" in ${cfg.guildName}: ${range}${days}. ${tail}${extra}`);
    }

    if (added.length) await announceAddition(plan, added, actorName, { dm });
}

/*
    Tells everyone the plan now asks about a different set of days. When reopened is on
    the change opened a new day, so people are asked to look again and fill it in; when
    it is off the plan only narrowed, so their saved days still stand and there is
    nothing to do. When post is on it pings the thread, when dm is on it DMs everyone.
    daysLabel is the plain-English set of days, like "weekends and Mondays". actorName
    is whoever changed it.
*/
export async function announceWeekdaysChange(plan, cfg, { actorName, daysLabel, reopened, note, post = true, dm = true }) {
    //A change that opened a day drops any set date with it, so the cards go back to asking
    //for availability and the pin has to stop saying the plan is set
    await syncPlan(plan, { cfg }).catch((err) => console.error('[plans] weekdays sync failed:', err));

    const ids = plan.participants.map((p) => p.userId);
    const url = planUrl(plan.planId);
    const extra = note ? `\n${note}` : '';
    //A new day opened means fill it in, a narrowing means nothing to do
    const tail = reopened ? `Add your availability here: ${url}` : `Nothing to do, your saved days still stand.`;

    if (post && plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content: banner('DAYS CHANGED') +
                    `${ids.map((id) => `<@${id}>`).join(' ')}\n\n${actorName} changed which days count for **${plan.name}** to ${daysLabel}. ${tail}${extra}`,
                allowedMentions: { users: ids }
            });
        }
    }

    if (dm) {
        await dmEach(ids,
            banner('DAYS CHANGED') +
            `${actorName} changed which days count for "${plan.name}" in ${cfg.guildName} to ${daysLabel}. ${tail}${extra}`);
    }
}

/*
    The planner has called off a date that was set and is rescheduling. This one is
    DM only, no thread post, with an optional reason. The DM is optional too, dm off
    just clears the date quietly. Everyone's saved dates stay put so they can tweak
    them for the new pick. actorName is whoever voided it.
*/
export async function announceVoid(plan, cfg, actorName, reason, { dm = true } = {}) {
    //Ahead of the dm branch, since a date that is gone has to come off the pin and every
    //card whether or not anybody is being told about it
    await syncPlan(plan, { cfg }).catch((err) => console.error('[plans] void sync failed:', err));
    if (!dm) return;

    const ids = plan.participants.map((p) => p.userId);
    const url = planUrl(plan.planId);
    const why = reason ? `\nReason: ${reason}` : '';

    await dmEach(ids,
        banner('RESCHEDULING') +
        `${actorName} called off the date for "${plan.name}" in ${cfg.guildName} and is sorting out a new one. ` +
        `Nothing is locked in for now.${why}\n` +
        `Your dates are still saved, tweak them here if you need to: ${url}`);
}

/*
    Cancel a plan. It gets marked cancelled and, when post is on, the thread is told
    with a ping, but the thread is left in place: deleting it by hand is what finally
    clears the plan. When dm is on everyone gets a DM. The creator gets their daily
    plan slot back since the plan never really ran. actorName is whoever cancelled it.
*/
export async function cancelPlan(plan, actorId, actorName, { post = true, dm = true } = {}) {
    //The cancelled copy, not the one read before it: what the cards say is read off the status
    const cancelled = await markPlanCancelled(plan.planId);
    await refundAction(plan.createdBy, plan.guildId, 'create', plan.createdAt);
    await addPlanEvent(plan.planId, { type: 'cancelled', by: actorId, byName: actorName }).catch(() => {});
    await announceCancel(cancelled || plan, actorName, { post, dm });
}

//The telling-everyone half, split off so the site can send it after it has responded
export async function announceCancel(plan, actorName, { post = true, dm = true } = {}) {
    //Nobody should be left holding a card that still says they are coming on the twelfth
    await syncPlan(plan).catch((err) => console.error('[plans] cancel sync failed:', err));

    const ids = plan.participants.map((p) => p.userId);

    if (post && plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content:
                    banner('PLAN CANCELLED') +
                    `${ids.map((id) => `<@${id}>`).join(' ')}\n\n` +
                    `${actorName} cancelled **${plan.name}**. Nothing more to fill in.\n` +
                    `This thread stays until someone deletes it by hand, and deleting it clears the plan for good.`,
                allowedMentions: { users: ids }
            });
        }
    }

    if (dm) await dmEach(ids, banner('PLAN CANCELLED') + `${actorName} cancelled the plan "${plan.name}".`);
}

/*
    Drop one person out of a plan, from the site or the DM button. We take them
    off the guest list so they are no longer pinged or DMed about it, but leave
    them in the thread so they can still follow along if they want. No note goes
    to the thread, a quiet exit, nobody needs telling who bowed out.
*/
export async function leavePlan(plan, userId, actorName) {
    const updated = await removeParticipant(plan.planId, userId);
    await addPlanEvent(plan.planId, { type: 'left', by: userId, byName: actorName || '' }).catch(() => {});

    //If that drop out leaves everyone else already in, the planner can compare now
    await notifyCreatorIfAllIn(updated).catch(() => {});
    //Likewise, if a probe is running and the leaver was the last to answer, the rest may
    //now all be coming, so the creator should hear they are good to go
    await notifyCreatorAllYes(updated).catch(() => {});
}

/*
    The drop out button on a DM. Rather than leaving on the spot, it opens a short modal
    so the person can say why they cannot make it, optional, before they actually go.
*/
export async function handleDrop(interaction) {
    const planId = interaction.customId.split('|')[1];
    const plan = await getPlan(planId);
    if (!plan) {
        return interaction.update({ content: 'That plan is no longer around.', components: [] });
    }
    if (!plan.participants.some((p) => p.userId === interaction.user.id)) {
        return interaction.update({ content: `You are not on "${plan.name}" anymore.`, components: [] });
    }
    return interaction.showModal(
        new ModalBuilder()
            .setCustomId(`dropmodal|${planId}`)
            .setTitle('Drop out')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel("Why can't you make it? (optional)")
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(200)
                        .setRequired(false)
                )
            )
    );
}

//Swapped onto the DM after a drop out, lets the person climb back on in one tap
function undropRow(planId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`undrop|${planId}`).setLabel('Undo, I can make it after all').setStyle(ButtonStyle.Success)
    );
}

/*
    The drop out reason came back, so take them off the plan. We leave them in the thread,
    a quiet exit as before, but now the creator gets a DM with the reason and the person
    gets an undo button in case they spoke too soon.
*/
export async function handleDropModal(interaction) {
    const planId = interaction.customId.split('|')[1];
    const plan = await getPlan(planId);
    if (!plan) {
        return interaction.update({ content: 'That plan is no longer around.', components: [] });
    }
    if (!plan.participants.some((p) => p.userId === interaction.user.id)) {
        return interaction.update({ content: `You are not on "${plan.name}" anymore.`, components: [] });
    }
    const reason = (interaction.fields.getTextInputValue('reason') || '').trim().slice(0, 200) || null;

    //A drop out is a DM, so there is no member to read a nickname off, only the account name
    await leavePlan(plan, interaction.user.id, interaction.member?.displayName || interaction.user.username);
    await notifyCreatorDropped(plan, interaction.user.id, reason).catch(() => {});

    const passed = reason ? ` I passed your reason on.` : '';
    return interaction.update({
        content: banner('DROPPED OUT') + `Done, you have dropped out of "${plan.name}". I will not nudge you about it again.${passed}\n\nChanged your mind? Hit undo below.`,
        components: [undropRow(planId)]
    });
}

/*
    The undo button after a drop out. Puts the person back on the plan, fresh, and tells
    the creator they are back in. They were left in the thread, so nothing to re-add there.
*/
export async function handleUndrop(interaction) {
    const planId = interaction.customId.split('|')[1];
    const plan = await getPlan(planId);
    if (!plan) {
        return interaction.update({ content: 'That plan is no longer around.', components: [] });
    }
    if (plan.status === 'cancelled') {
        return interaction.update({ content: `"${plan.name}" was cancelled, so there is nothing to re-join.`, components: [] });
    }
    if (plan.participants.some((p) => p.userId === interaction.user.id)) {
        return interaction.update({ content: `You are already back on "${plan.name}".`, components: [dropRow(planId)] });
    }

    const updated = await addParticipants(planId, [interaction.user.id]);
    await addPlanEvent(planId, {
        type: 'rejoined',
        by: interaction.user.id,
        byName: interaction.member?.displayName || interaction.user.username
    }).catch(() => {});
    await notifyCreatorUndropped(updated, interaction.user.id).catch(() => {});

    return interaction.update({
        content: banner('BACK IN') + `You are back on "${plan.name}". Hit "Drop out" below if that changes again.`,
        components: [dropRow(planId)]
    });
}

/*
    A tap on a confirmation probe's yes/no buttons, from the shared thread message or
    from a DM. Yes records straight away. No needs a reason, so it opens a short modal and
    the vote lands when that comes back. The vote is shared, so a DM tap and a thread tap
    hit the same place and the thread tally reflects both.
*/
export async function handleVote(interaction) {
    const [, choice, planId] = interaction.customId.split('|');
    const plan = await getPlan(planId);

    const stale = voteStale(plan, interaction.user.id);
    if (stale) return respondStale(interaction, stale);

    if (choice === 'no') {
        return interaction.showModal(
            new ModalBuilder()
                .setCustomId(`votemodal|${planId}`)
                .setTitle("Can't make it")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('reason')
                            .setLabel('Why not? (optional)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(200)
                            .setRequired(false)
                    )
                )
        );
    }

    //Whether they were already down as coming, so a re-tap does not re-offer the day block
    const wasYes = plan.participants.find((p) => p.userId === interaction.user.id)?.vote === 'yes';

    const updated = await recordVote(planId, interaction.user.id, 'yes');
    await ackVote(interaction, updated, 'yes');
    await notifyCreatorAllYes(updated).catch(() => {});

    //A fresh yes from a DM: offer to clear that day out of their general availability
    if (!interaction.inGuild() && !wasYes) await offerBlockDay(interaction, updated).catch(() => {});
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
    const me = plan.participants.find((p) => p.userId === userId);
    if (!me) return `You are not on "${plan.name}" anymore.`;
    if (me.invited === false) return `You are not on the invite list for this date. Check the thread for the latest.`;
    return null;
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
    Tell the voter their answer landed, then refresh the shared tally. In a DM we lock the
    buttons to their pick so it stays on screen. In a thread the buttons are shared, so we
    answer them privately instead, no DM and no notification. We respond first so a slow
    tally edit cannot hold the click up past Discord's window.
*/
async function ackVote(interaction, plan, vote) {
    const line = vote === 'yes' ? "You're down as coming." : "You're down as not coming.";
    //Only worth offering to someone who has just said they are coming, which is also the
    //first moment the day is really theirs rather than a question they have been asked
    const calendar = vote === 'yes' ? `\n${calendarLines(plan)}` : '';

    if (interaction.inGuild()) {
        await interaction.reply({ content: `${line} Tap the buttons again any time to change it.${calendar}`, flags: MessageFlags.Ephemeral });
        //A tap in the thread leaves their own DM still asking the question, so it is brought into line
        await syncPlanCards(plan, null, { only: [interaction.user.id] }).catch(() => {});
    } else {
        await interaction.update({
            content: banner('CAN YOU MAKE IT?') + `**${plan.name}** is set for ${whenLine(plan)}.\n${line} Tap the other button if that changes.${calendar}`,
            components: [votedDmRow(plan.planId, vote)]
        });
    }
    await updateProbeMessage(plan).catch(() => {});
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

//The offer buttons: clear the locked day out of their general availability, or leave it be
function blockOfferRow(planId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`block|yes|${planId}`).setLabel('Yes, keep it free').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`block|no|${planId}`).setLabel('No, leave it').setStyle(ButtonStyle.Secondary)
    );
}

//Swapped on once the day is blocked, undo restores the exact hours carried in the mask
function blockedRow(planId, mask) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`unblock|${planId}|${mask}`).setLabel('Undo, put that day back as free').setStyle(ButtonStyle.Success)
    );
}

//Swapped on after an undo, lets them block the day off again in one tap
function reblockRow(planId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`block|yes|${planId}`).setLabel('Block it off again').setStyle(ButtonStyle.Secondary)
    );
}

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
    Once someone confirms they are coming to a set date, follow up in the same DM with the
    offer to clear that day out of their general availability, so other plans stop counting
    them free then. We only ask when they are actually free that day, since a day already
    off the timetable has nothing to block.
*/
async function offerBlockDay(interaction, plan) {
    if (!plan.chosenDate) return;
    const theirs = await theirDayFor(plan, interaction.user.id);
    const free = await getAvailabilityInRange(interaction.user.id, theirs, theirs);
    if (!free.length) return;
    await interaction.followUp({
        content: banner('KEEP THAT DAY CLEAR?') +
            `Since you are coming to "${plan.name}" on ${whenLine(plan)}, I can mark that day unavailable in your general availability so other plans do not count you as free then.`,
        components: [blockOfferRow(plan.planId)]
    });
}

/*
    A tap on the day-block offer. Yes reads the day's current hours, packs them onto the undo
    button, then clears the day. No just leaves the timetable alone. Both are DM only, so we
    rewrite the message in place either way.
*/
export async function handleBlockDay(interaction) {
    const [, choice, planId] = interaction.customId.split('|');
    const plan = await getPlan(planId);
    if (!plan || !plan.chosenDate) {
        return interaction.update({ content: 'That plan is no longer around.', components: [] });
    }

    if (choice === 'no') {
        return interaction.update({ content: 'No problem, I left your availability as it is.', components: [] });
    }

    const theirs = await theirDayFor(plan, interaction.user.id);
    const [day] = await getAvailabilityInRange(interaction.user.id, theirs, theirs);
    const mask = packHours(day?.hours || []);
    await blockDay(interaction.user.id, theirs);

    return interaction.update({
        content: banner('DAY BLOCKED OFF') +
            `Done, I marked ${formatDate(theirs)} as unavailable in your general availability. Other plans will not see you free that day.\n\nChanged your mind? Hit undo below.`,
        components: [blockedRow(planId, mask)]
    });
}

/*
    The undo on a blocked day. The mask carried on the button says what hours the day had, so
    we put it back exactly, then offer to block it off again in case they flip once more.
*/
export async function handleUnblockDay(interaction) {
    const [, planId, mask] = interaction.customId.split('|');
    const plan = await getPlan(planId);
    if (!plan || !plan.chosenDate) {
        return interaction.update({ content: 'That plan is no longer around.', components: [] });
    }

    //Worked out the same way it was blocked, so the undo lands on the day that went missing
    const theirs = await theirDayFor(plan, interaction.user.id);
    await setDayFree(interaction.user.id, theirs, unpackHours(Number(mask)));

    return interaction.update({
        content: banner('BACK TO FREE') +
            `Put ${formatDate(theirs)} back as free in your general availability.`,
        components: [reblockRow(planId)]
    });
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
    await dmEach([plan.createdBy],
        banner('EVERYONE IS COMING') +
        `Everyone confirmed they can make "${plan.name}"${where} on ${whenLine(plan)}. You are good to go.`);
}

/*
    A planner moving someone on the attendance board: the thread tally, nothing else.

    The person moved is never told. A planner reaches for the board having decided they
    will not answer, and an override only stops them being nudged: they keep the buttons
    on their card, and voting clears the override, so their own word still wins.
*/
export async function applyAttendanceMove(plan, status) {
    await updateProbeMessage(plan).catch(() => {});
    if (status === 'coming') await notifyCreatorAllYes(plan).catch(() => {});
}

/*
    When someone says they cannot make it, let the creator know who and why, privately,
    the thread never names them. The vote stays open, so we point them at compare in case
    they want to move the date. We skip it when the creator is the one who voted.
*/
async function notifyCreatorVoteNo(plan, userId, reason) {
    if (userId === plan.createdBy) return;
    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    const name = await memberName(plan.guildId, userId);
    const why = reason ? `\nReason: ${reason}` : '\nThey did not give a reason.';
    await dmEach([plan.createdBy],
        banner('SOMEONE CANNOT MAKE IT') +
        `${name} cannot make "${plan.name}"${where} on ${whenLine(plan)}.${why}\n` +
        `The vote is still going. To move the date, run \`/compare\` in the thread or here: ${compareUrl(plan.planId)}`);
}

//Let the creator know someone bowed out, with their reason if they left one
async function notifyCreatorDropped(plan, userId, reason) {
    if (userId === plan.createdBy) return;
    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    const name = await memberName(plan.guildId, userId);
    const why = reason ? `\nReason: ${reason}` : '';
    await dmEach([plan.createdBy], banner('SOMEONE DROPPED OUT') + `${name} dropped out of "${plan.name}"${where}.${why}`);
}

//Let the creator know someone who had dropped out is back on the plan
async function notifyCreatorUndropped(plan, userId) {
    if (userId === plan.createdBy) return;
    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    const name = await memberName(plan.guildId, userId);
    await dmEach([plan.createdBy], banner('BACK IN') + `${name} is back on "${plan.name}"${where} after dropping out.`);
}

/*
    The /compare slash command. Run inside a plan's thread, it hands the planner
    the link to that plan's compare page. Locked to people with the planner role.
*/
export async function handleCompare(interaction) {
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
        return interaction.reply({ content: "Run this inside a plan's thread to get its compare link.", flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({
        content: `Compare the dates for **${plan.name}**: ${config.baseUrl}/#/plan/${plan.planId}/compare`,
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

//Hands back the link to the general, plan-free availability page
export async function handleMyAvailability(interaction) {
    return interaction.reply({
        content: `Set your general availability here: ${config.baseUrl}/#/availability`,
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
    if (!plan) return interaction.reply({ content: 'Run this inside a plan thread to cancel it.', flags: MessageFlags.Ephemeral });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel|yes|${plan.planId}`).setLabel('Yes, cancel it').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel|no').setLabel('Keep it').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
        content: `Cancel **${plan.name}**? Everyone gets told, and the thread stays until you delete it by hand.`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

//Routes the cancel confirm buttons. Cancel is the only plan button left now that
//a deleted thread just scraps the plan outright.
export async function handlePlanComponent(interaction) {
    const [, action, planId] = interaction.customId.split('|');

    if (action === 'no') return interaction.update({ content: 'Kept it.', components: [] });

    await interaction.update({ content: 'Cancelling the plan...', components: [] });
    const plan = await getPlan(planId);
    if (plan) {
        const actorName = interaction.member?.displayName || interaction.user.username;
        await cancelPlan(plan, interaction.user.id, actorName);
    }
    return interaction.editReply({ content: 'Done, everyone has been told. Delete this thread when you are ready to clear the plan for good.' });
}

/*
    Nudges the people who have not confirmed yet, by DM only, no thread post. The
    /remind route caps this to once a day. actorName is whoever asked for it.
*/
export async function remindStragglers(plan, actorName) {
    const pending = plan.participants.filter((p) => !p.confirmed).map((p) => p.userId);
    if (!pending.length) return 0;

    const url = planUrl(plan.planId);
    await dmEach(pending,
        banner('REMINDER') +
        `${actorName} has asked for your availability for "${plan.name}". ` +
        `Please fill it in when you are next free, or just confirm if you already have the dates filled in: ${url}\n` +
        //The people this reaches are the ones who have not clicked the link, so the other way is worth saying
        `Or run \`/free\` in the plan's thread and tick your days off there.`);

    return pending.length;
}

/*
    The same nudge for a running confirmation probe: the people who have not said
    whether they are coming, chased by DM with the probe's own buttons riding along so
    they can answer without going and finding the thread.

    Only the people still on the invite list, and only where the answer is genuinely
    missing. A planner who has already made the call on someone counts as an answer, so
    the board they just filled in is not undone by a DM asking them again.
*/
export async function remindVoters(plan, actorName) {
    const pending = invitedOnly(plan).filter((p) => !effectiveVote(p)).map((p) => p.userId);
    if (!pending.length) return 0;

    await dmEach(pending,
        banner('CAN YOU MAKE IT?') +
        `${actorName} is still waiting to hear whether you can make "${plan.name}" on ${whenLine(plan)}.\n` +
        aboutLine(plan) +
        `\nTap below to let everyone know.`,
        [probeRow(plan.planId)]);

    return pending.length;
}
