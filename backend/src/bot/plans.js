import { ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { client } from './client.js';
import { createThread, planUrl, compareUrl, reviveThread } from './util.js';
import { setPlanThread, setPlanOpener, getPlan, getPlanByThread, getOpenPlansForUser, markPlanCancelled, removeParticipant, markAllInNotified, recordVote, setProbe, markProbeAllYes, addParticipant } from '../db/plans.js';
import { getGuildConfig } from '../db/guilds.js';
import { getAvailabilityInRange } from '../db/availability.js';
import { refundAction } from '../db/ratelimits.js';
import { formatDate, formatTime } from '../lib/dates.js';
import { config } from '../config.js';

/*
    Sends the same line to a list of people by DM, best effort, since some have
    DMs closed. The thread ping still reaches anyone the DM cannot. An optional
    set of components rides along so a DM can carry a button, like drop out.
*/
async function dmEach(ids, text, components = []) {
    for (const id of ids) {
        try {
            const user = await client.users.fetch(id);
            await user.send(components.length ? { content: text, components } : text);
        } catch {
            //DMs off, the thread ping still reaches them
        }
    }
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

//The "set for this day" line, shared by the set-plan opener and the confirmation probe
function whenLine(plan) {
    const time = formatTime(plan.chosenTime);
    return formatDate(plan.chosenDate) + (time ? ` at ${time}` : '');
}

//The "what it is about" line, dropped entirely when a plan has no description
function aboutLine(plan) {
    return plan.description ? `What it is about: ${plan.description}\n` : '';
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

//A one line count of where the confirmation vote stands, shown under the probe
function probeTally(plan) {
    const yes = plan.participants.filter((p) => p.vote === 'yes').length;
    const no = plan.participants.filter((p) => p.vote === 'no').length;
    const pending = plan.participants.length - yes - no;
    const bits = [`${yes} coming`, `${no} can't make it`];
    if (pending > 0) bits.push(`${pending} yet to answer`);
    return bits.join(' · ');
}

/*
    The body of a confirmation probe: a clear heading, the date in question and the
    running tally, so anyone reading the thread sees where the vote stands at a glance.
*/
function probeText(plan) {
    const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';
    return banner('CAN YOU MAKE IT?') +
        `**${plan.name}** is set for ${whenLine(plan)}.${note}\n` +
        `Tap below to let everyone know.\n\n` +
        probeTally(plan);
}

/*
    Rewrite the shared thread probe so its tally keeps up as votes come in, including
    votes cast from a DM. A probe with no thread message (DM only) has nothing to redraw,
    so this quietly does nothing. Best effort, a deleted message is fine.
*/
async function updateProbeMessage(plan) {
    if (!plan.probeThreadMessageId || !plan.threadId) return;
    const thread = await client.channels.fetch(plan.threadId).catch(() => null);
    if (!thread) return;
    await reviveThread(thread);
    const msg = await thread.messages.fetch(plan.probeThreadMessageId).catch(() => null);
    if (msg) await msg.edit({ content: probeText(plan), components: [probeRow(plan.planId)], allowedMentions: { parse: [] } }).catch(() => {});
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
    if (plan.status === 'closed' && plan.chosenDate) {
        const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';
        const about = plan.description ? `\nWhat it is about: ${plan.description}` : '';
        return banner('PLAN SET') +
            `**${plan.name}** is set for ${whenLine(plan)}.${about}${note}`;
    }
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    return banner('EVENT CREATED') +
        `New plan: **${plan.name}** (${range}).\n` +
        aboutLine(plan) +
        `Choose the dates you are free here: ${planUrl(plan.planId)}\n` +
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
    for (const id of ids) {
        await thread.members.add(id).catch(() => {});
    }

    const url = planUrl(plan.planId);
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    //No @ here, adding people to the thread already pings them
    const opener = await thread.send({ content: openerText(plan), allowedMentions: { parse: [] } });
    //Pin the opener so the link and the details stay at the top of the thread, best effort
    await opener.pin().catch(() => {});
    //Remember it so editing the title or description later can rewrite this same post
    await setPlanOpener(plan.planId, opener.id);

    if (dm) {
        const jump = thread.url ? `Jump straight to the thread: ${thread.url}` : `Look for the thread in #${channel.name}.`;
        await dmEach(ids,
            banner('INVITED TO A PLAN') +
            `${actorName} added you to the plan "${plan.name}" in ${guild.name} (${range}).\n` +
            aboutLine(plan) +
            `Add the dates you are free here: ${url}\n` +
            `${jump}\n\n` +
            `Hit "Drop out" below to leave the plan`,
            [dropRow(plan.planId)]);
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
    const when = whenLine(plan);
    const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';

    const guild = await client.guilds.fetch(plan.guildId);
    const channel = await guild.channels.fetch(cfg.plansChannelId);
    const thread = await createThread(channel, plan.name.slice(0, 100), ChannelType.PrivateThread);
    await setPlanThread(plan.planId, thread.id);
    for (const id of ids) await thread.members.add(id).catch(() => {});

    //No @ here, adding people to the thread already pings them
    const opener = await thread.send({ content: openerText(plan), allowedMentions: { parse: [] } });
    await opener.pin().catch(() => {});
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

    if (dm) {
        const about = plan.description ? `\nWhat it is about: ${plan.description}` : '';
        const tail = probe ? `\n\nCan you make it? Tap below.` : '';
        await dmEach(ids,
            banner('PLAN SET') +
            `${actorName} set up the plan "${plan.name}" in ${cfg.guildName} for ${when}.${about}${note}${tail}`,
            probe ? [probeRow(plan.planId)] : []);
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
    const url = planUrl(plan.planId);
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;

    const thread = plan.threadId ? await client.channels.fetch(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        for (const id of newIds) await thread.members.add(id).catch(() => {});
    }

    if (dm) {
        const jump = thread?.url ? `\nJump straight to the thread: ${thread.url}` : '';
        await dmEach(newIds,
            banner('INVITED TO A PLAN') +
            `${actorName} invited you to the plan "${plan.name}" in ${guild.name} (${range}).\n` +
            aboutLine(plan) +
            `Add the dates you are free here: ${url}${jump}\n\n` +
            `Hit "Drop out" below to leave the plan`,
            [dropRow(plan.planId)]);
    }
}

/*
    Apply a title or description edit to the Discord side of a plan. The stored
    plan is already updated, so this just keeps Discord in step: rename the thread
    when the title changed, and rewrite the pinned opening post so it still shows
    the right title and description. All best effort, a missing thread or a deleted
    opener just means there is nothing to update. This makes no noise, no DM and no
    new thread message.
*/
export async function applyDetailsEdit(plan, renamed) {
    if (!plan.threadId) return;
    const thread = await client.channels.fetch(plan.threadId).catch(() => null);
    if (!thread) return;
    await reviveThread(thread);

    //Discord caps thread renames at 2 per 10 minutes, so only rename when the title moved
    if (renamed) await thread.setName(plan.name.slice(0, 100)).catch(() => {});

    //Older plans have no remembered opener, so there is nothing to rewrite for those
    if (plan.openerMessageId) {
        const msg = await thread.messages.fetch(plan.openerMessageId).catch(() => null);
        if (msg) await msg.edit({ content: openerText(plan), allowedMentions: { parse: [] } }).catch(() => {});
    }
}

/*
    Once a planner locks the winning date the plan closes. When post is on the
    outcome lands in the thread, pinging whoever the planner chose (the people who
    can make it, or everyone invited, or both). When dm is on everyone invited gets
    a DM. The headline and DM both name who set or moved it.
*/
export async function announceOutcome(plan, cfg, { pingAttending, pingAllInvited, attendingIds, changed, actorName, post = true, dm = true, probe = false }) {
    const ids = plan.participants.map((p) => p.userId);
    const when = whenLine(plan);
    const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';

    //Fall back to anyone free that day if the site did not send the attending set
    let attending = Array.isArray(attendingIds) ? attendingIds.filter((id) => ids.includes(id)) : null;
    if (!attending) {
        attending = [];
        for (const id of ids) {
            const free = await getAvailabilityInRange(id, plan.chosenDate, plan.chosenDate);
            if (free.length > 0) attending.push(id);
        }
    }

    const toPing = new Set();
    if (pingAllInvited) ids.forEach((id) => toPing.add(id));
    if (pingAttending) attending.forEach((id) => toPing.add(id));
    const pingList = [...toPing];

    if (post && plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            const lead = pingList.length ? `${pingList.map((id) => `<@${id}>`).join(' ')}\n\n` : '';
            if (probe) {
                /*
                    With a probe on, the outcome post is the confirmation itself: the date
                    and the yes/no buttons in one. We remember the message so its tally
                    can be kept current as votes come in.
                */
                const probeMsg = await thread.send({ content: lead + probeText(plan), components: [probeRow(plan.planId)], allowedMentions: { users: pingList } });
                plan = await setProbe(plan.planId, { active: true, threadMessageId: probeMsg.id });
            } else {
                const headline = changed
                    ? `${banner('PLAN CHANGED')}${lead}Change of plan: ${actorName} moved **${plan.name}** to ${when}.${note}`
                    : `${banner('DATE SET')}${lead}${actorName} set **${plan.name}** for ${when}.${note}`;
                await thread.send({ content: headline, allowedMentions: { users: pingList } });
            }
        }
    }

    //A probe with no thread post still needs marking live so DM votes are accepted,
    //even though there is no thread message to tally
    if (probe && !plan.probeActive) {
        plan = await setProbe(plan.planId, { active: true, threadMessageId: null });
    }

    if (dm) {
        const lead = changed
            ? `${actorName} moved the plan "${plan.name}" in ${cfg.guildName} to ${when}.`
            : `${actorName} set the plan "${plan.name}" in ${cfg.guildName} for ${when}.`;
        if (probe) {
            await dmEach(ids, banner('CAN YOU MAKE IT?') + lead + note + `\n\nCan you make it? Tap below.`, [probeRow(plan.planId)]);
        } else {
            await dmEach(ids, banner(changed ? 'PLAN CHANGED' : 'DATE SET') + lead + note);
        }
    }
}

/*
    Tells everyone the date range moved and they need to look at the new window.
    When post is on it pings the thread, when dm is on it DMs everyone. actorName
    is whoever changed it.
*/
export async function announceRangeChange(plan, cfg, { actorName, note, post = true, dm = true }) {
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
    Tells everyone the plan now asks about a different set of days. When reopened is on
    the change opened a new day, so people are asked to look again and fill it in; when
    it is off the plan only narrowed, so their saved days still stand and there is
    nothing to do. When post is on it pings the thread, when dm is on it DMs everyone.
    daysLabel is the plain-English set of days, like "weekends and Mondays". actorName
    is whoever changed it.
*/
export async function announceWeekdaysChange(plan, cfg, { actorName, daysLabel, reopened, note, post = true, dm = true }) {
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
export async function cancelPlan(plan, actorName, { post = true, dm = true } = {}) {
    await markPlanCancelled(plan.planId);

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

    await refundAction(plan.createdBy, plan.guildId, 'create');
}

/*
    Drop one person out of a plan, from the site or the DM button. We take them
    off the guest list so they are no longer pinged or DMed about it, but leave
    them in the thread so they can still follow along if they want. No note goes
    to the thread, a quiet exit, nobody needs telling who bowed out.
*/
export async function leavePlan(plan, userId) {
    const updated = await removeParticipant(plan.planId, userId);

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

    await leavePlan(plan, interaction.user.id);
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

    const updated = await addParticipant(planId, interaction.user.id);
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

    const updated = await recordVote(planId, interaction.user.id, 'yes');
    await ackVote(interaction, updated, 'yes');
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
    if (!plan.probeActive || !plan.chosenDate) return 'That confirmation is closed now, the date may have changed. Check the thread for the latest.';
    if (!plan.participants.some((p) => p.userId === userId)) return `You are not on "${plan.name}" anymore.`;
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
    if (interaction.inGuild()) {
        await interaction.reply({ content: `${line} Tap the buttons again any time to change it.`, flags: MessageFlags.Ephemeral });
    } else {
        await interaction.update({
            content: banner('CAN YOU MAKE IT?') + `**${plan.name}** is set for ${whenLine(plan)}.\n${line} Tap the other button if that changes.`,
            components: [votedDmRow(plan.planId, vote)]
        });
    }
    await updateProbeMessage(plan).catch(() => {});
}

/*
    When everyone has said they are coming, tell whoever set the plan up they are good to
    go. The probeAllYesNotifiedAt flag keeps it to one DM a round, the same way the
    availability all-in nudge does.
*/
async function notifyCreatorAllYes(plan) {
    if (!plan || !plan.probeActive) return;
    if (!plan.participants.length || !plan.participants.every((p) => p.vote === 'yes')) return;
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
        await cancelPlan(plan, actorName);
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
        `Please fill it in when you are next free, or just confirm if you already have the dates filled in: ${url}`);

    return pending.length;
}
