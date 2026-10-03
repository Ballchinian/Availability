import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { client } from '../client.js';
import { getPlan, recordVote, addParticipants, setPlanCards, setIn } from '../../db/plans/index.js';
import { getAvailabilityInRange, blockDay, setDayFree } from '../../db/availability.js';
import { getPlanningPrefs } from '../../db/users.js';
import { realMembers } from '../../lib/members.js';
import { formatDate } from '../../lib/dates.js';
import { inOf } from '../../lib/coverage.js';
import { safeZone, planInstant, instantToWall, dayHasPassed } from '../../lib/zones.js';
import { whenLine, roundOf, probeRow, effectiveVote, planCard } from './cards.js';
import { cardFor, retireCard, memberName, syncPlanCards } from './send.js';
import { updateOpener } from './thread.js';
import { announceJoin } from './announce.js';
import { notifyHostsAllYes, notifyHostsVoteNo } from './hosts.js';

//The buttons and reason boxes on a plan's DMs and pinned post

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
        await addParticipants(planId, [interaction.user.id], { id: interaction.user.id, name: await memberName(plan.guildId, interaction.user.id) });
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
    await notifyHostsAllYes(updated).catch(() => {});
}

/*
    The "can't make it" reason came back. Record the no, give the same feedback a yes
    gets, and let whoever runs the plan know who and why, but only when this is a fresh
    no, so a re-submit of one already on record does not nudge them twice.
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

    if (!wasNo) await notifyHostsVoteNo(updated, interaction.user.id, reason).catch(() => {});
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
