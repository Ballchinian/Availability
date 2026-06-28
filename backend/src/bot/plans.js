import { ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { client } from './client.js';
import { createThread, planUrl, compareUrl, reviveThread } from './util.js';
import { setPlanThread, setPlanOpener, getPlan, getPlanByThread, getOpenPlansForUser, markPlanCancelled, removeParticipant, markAllInNotified } from '../db/plans.js';
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

/*
    The opening post for a plan's thread, pulled out so creating a plan, announcing
    a set plan, and editing the details later all build the exact same message,
    which keeps the pinned post in step. A set plan already has its date, so its
    opener states it instead of asking people to fill in availability.
*/
function openerText(plan) {
    if (plan.status === 'closed' && plan.chosenDate) {
        const time = formatTime(plan.chosenTime);
        const when = formatDate(plan.chosenDate) + (time ? ` at ${time}` : '');
        const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';
        return banner('PLAN SET') +
            `**${plan.name}** is set for ${when}.\n` +
            `What it is about: ${plan.description}${note}`;
    }
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;
    return banner('EVENT CREATED') +
        `New plan: **${plan.name}** (${range}).\n` +
        `What it is about: ${plan.description}\n` +
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
            `What it is about: ${plan.description}\n` +
            `Add the dates you are free here: ${url}\n` +
            `${jump}\n\n` +
            `Hit "Drop out" below to leave the plan`,
            [dropRow(plan.planId)]);
    }

    return thread;
}

/*
    The announce-a-set-plan path: the planner already knows the date, so there is
    nothing to collect. Optionally open a thread and post the set date (pinging
    everyone if post is on), and optionally DM everyone. With both off the plan is
    just recorded quietly. actorName is whoever set it up.
*/
export async function announceSetPlan(plan, cfg, actorName, { post = true, dm = true } = {}) {
    const ids = plan.participants.map((p) => p.userId);
    const time = formatTime(plan.chosenTime);
    const when = formatDate(plan.chosenDate) + (time ? ` at ${time}` : '');
    const note = plan.chosenNote ? `\n${plan.chosenNote}` : '';

    if (post) {
        const guild = await client.guilds.fetch(plan.guildId);
        const channel = await guild.channels.fetch(cfg.plansChannelId);
        const thread = await createThread(channel, plan.name.slice(0, 100), ChannelType.PrivateThread);
        await setPlanThread(plan.planId, thread.id);
        for (const id of ids) await thread.members.add(id).catch(() => {});

        //Ping everyone, since the whole point of posting a set plan is to surface it
        const lead = ids.length ? `${ids.map((id) => `<@${id}>`).join(' ')}\n\n` : '';
        const opener = await thread.send({ content: lead + openerText(plan), allowedMentions: { users: ids } });
        await opener.pin().catch(() => {});
        await setPlanOpener(plan.planId, opener.id);
    }

    if (dm) {
        await dmEach(ids,
            banner('PLAN SET') +
            `${actorName} set up the plan "${plan.name}" in ${cfg.guildName} for ${when}.\n` +
            `What it is about: ${plan.description}${note}`);
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
            `What it is about: ${plan.description}\n` +
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
export async function announceOutcome(plan, cfg, { pingAttending, pingAllInvited, attendingIds, changed, actorName, post = true, dm = true }) {
    const ids = plan.participants.map((p) => p.userId);
    const time = formatTime(plan.chosenTime);
    const when = formatDate(plan.chosenDate) + (time ? ` at ${time}` : '');
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
            const headline = changed
                ? `${banner('PLAN CHANGED')}${lead}Change of plan: ${actorName} moved **${plan.name}** to ${when}.${note}`
                : `${banner('DATE SET')}${lead}${actorName} set **${plan.name}** for ${when}.${note}`;
            await thread.send({ content: headline, allowedMentions: { users: pingList } });
        }
    }

    if (dm) {
        await dmEach(ids, banner(changed ? 'PLAN CHANGED' : 'DATE SET') + (changed
            ? `${actorName} moved the plan "${plan.name}" in ${cfg.guildName} to ${when}.`
            : `${actorName} set the plan "${plan.name}" in ${cfg.guildName} for ${when}.`) + note);
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
}

//The drop out button on a DM. Takes the clicker off the plan and swaps the button
//out for a confirmation so it cannot be pressed twice.
export async function handleDrop(interaction) {
    const planId = interaction.customId.split('|')[1];
    const plan = await getPlan(planId);
    if (!plan) {
        return interaction.update({ content: 'That plan is no longer around.', components: [] });
    }
    if (!plan.participants.some((p) => p.userId === interaction.user.id)) {
        return interaction.update({ content: `You are not on "${plan.name}" anymore.`, components: [] });
    }
    await leavePlan(plan, interaction.user.id);
    return interaction.update({ content: `Done, you have dropped out of "${plan.name}". I will not nudge you about it again.`, components: [] });
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
