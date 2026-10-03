import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { planUrl, overviewUrl, threadUrl } from '../util.js';
import { formatDay, formatDate, formatTime } from '../../lib/dates.js';
import { inOf } from '../../lib/coverage.js';
import { safeZone, planInstant, discordStamp } from '../../lib/zones.js';

//What a plan's DMs and pinned post say, built from the plan alone and sending nothing

//Thread names cap at 100 characters. The day is on a set plan's, so a repeating series is not a row of the same name.
export function threadName(plan) {
    const day = plan.chosenDate ? ` · ${formatDay(plan.chosenDate)}` : '';
    return `${plan.name.slice(0, 100 - day.length)}${day}`;
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

export function linkButton(label, url) {
    return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
}

export const datesButton = (plan) => linkButton('Add my dates', planUrl(plan.planId));

export const overviewRow = (plan) => new ActionRowBuilder().addComponents(linkButton('Open the overview', overviewUrl(plan.planId)));

//A bold banner topping a thread post or DM so you can tell at a glance what it is about
export function banner(title) {
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
export function whenLine(plan) {
    const time = formatTime(plan.chosenTime);
    if (!time) return formatDate(plan.chosenDate);

    const instant = planInstant(safeZone(plan.timeZone), plan.chosenDate, plan.chosenTime);
    return `${formatDate(plan.chosenDate)} at ${time}${instant ? ` (${discordStamp(instant, 'f')} your time)` : ''}`;
}

//The "what it is about" line, dropped entirely when a plan has no description
function aboutLine(plan) {
    return plan.description ? `What it is about: ${plan.description}\n` : '';
}

//Calling off a plan that comes round again ends the chain too, see getPlansDueToRepeat
export function noMoreLine(plan) {
    return plan.repeatWeeks ? " It won't come round again." : '';
}

//The round the buttons are about, see roundFor in db/plans.js. Buttons from before rounds carry none.
export function roundOf(customId) {
    const tag = customId.split('|').find((bit) => /^r\d+$/.test(bit));
    return tag ? Number(tag.slice(1)) : 0;
}

/*
    The yes/no buttons for a confirmation probe. The same row rides on the shared thread
    message and on each person's DM, since the vote it records is shared either way.
*/
export function probeRow(plan) {
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
export function onIt(plan) {
    return plan.participants.filter((p) => p.in !== false);
}

/*
    The people still on the invite list for a set date. Everyone starts invited, a
    planner can narrow it to just the people who fit while locking a date in, and
    voiding or moving the date puts everyone back on.
*/
export function invitedOnly(plan) {
    return onIt(plan).filter((p) => p.invited !== false);
}

//Where someone actually stands: a planner's manual call wins over their own vote,
//and no answer at all reads as still waiting
export function effectiveVote(p) {
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
            content: top('CALLED OFF') + `${lead}${noMoreLine(plan)} Nothing more to fill in.`,
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
    The pinned post at the top of a plan's thread, built the same way every time so any
    rewrite keeps it in step. On a set day it is the yes/no itself: the day, what it is
    about, the running tally and the buttons. Always carries its components, even none,
    or a plan sent back out for dates would keep the buttons on its edited pin.
*/
export function opener(plan) {
    //A plan the sweep made says so itself, so nothing has to be passed down to every caller
    const again = Boolean(plan.repeatedFrom);
    const quietly = { allowedMentions: { parse: [] } };

    if (plan.status === 'cancelled') {
        return { content: banner('CALLED OFF') + `**${plan.name}** was called off.${noMoreLine(plan)}`, components: [], ...quietly };
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
