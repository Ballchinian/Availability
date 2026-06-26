import { ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { client } from './client.js';
import { createThread, planUrl, compareUrl, reviveThread } from './util.js';
import { setPlanThread, getPlan, getPlanByThread, getOpenPlansForUser, deletePlan } from '../db/plans.js';
import { getGuildConfig } from '../db/guilds.js';
import { getAvailabilityInRange } from '../db/availability.js';
import { formatDate } from '../lib/dates.js';
import { config } from '../config.js';

/*
    Sends the same line to a list of people by DM, best effort, since some have
    DMs closed. Only ever called when a trusted organiser asked us to, the thread
    ping is what everyone else gets so nobody is DMed without someone choosing it.
*/
async function dmEach(ids, text) {
    for (const id of ids) {
        try {
            const user = await client.users.fetch(id);
            await user.send(text);
        } catch {
            //DMs off, the thread ping still reaches them
        }
    }
}

/*
    When a plan is created on the site, this is the Discord side of it: open a
    private thread named after the plan, pull the invited people in, and ping them
    in the thread. The thread is never locked, so any of them can revive it later
    just by typing. We only DM when a trusted organiser ticked the box for it.
*/
export async function announcePlan(plan, cfg, { dm = false } = {}) {
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
    const mentions = ids.map((id) => `<@${id}>`).join(' ');
    await thread.send({
        content:
            `${mentions}\n\n` +
            `New plan: **${plan.name}** (${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}).\n` +
            `Drop the dates you are free here: ${url}\n` +
            `A planner can run \`/compare\` any time to see where things stand, even before everyone is in.`,
        allowedMentions: { users: ids }
    });

    if (dm) {
        await dmEach(ids,
            `You have been added to the plan "${plan.name}" in ${guild.name}.\n` +
            `Add the dates you are free here: ${url}`);
    }

    return thread;
}

/*
    Posted in the plan's thread when someone confirms their dates. This is the
    only running update people get, and it stays in the thread on purpose, no
    DMs, so nobody gets pinged every time another person checks in.
*/
export async function postConfirmation(plan, userId) {
    if (!plan.threadId) return;
    const thread = await client.channels.fetch(plan.threadId).catch(() => null);
    if (!thread) return;
    await reviveThread(thread);

    const confirmed = plan.participants.filter((p) => p.confirmed).length;
    const total = plan.participants.length;

    const line =
        confirmed >= total
            ? `<@${userId}> confirmed their dates. That is everyone in (${total}/${total}).\nCompare and pick a day here: ${compareUrl(plan.planId)}`
            : `<@${userId}> confirmed their dates. Waiting on ${confirmed}/${total}.`;

    //Their name shows, but no ping, they just acted and do not need a notification
    await thread.send({ content: line, allowedMentions: { parse: [] } });
}

/*
    Once a planner picks the winning date the plan closes. The outcome always
    lands in the thread. Two ping options, both about the invited people only:
    one pings just the people who can make the common time, the other pings
    everyone invited whether they can come or not. A trusted organiser can also
    tick dm to send everyone invited a short closing DM with the date.
    attendingIds is the set who share the chosen window, worked out on the site.
*/
export async function announceOutcome(plan, cfg, { pingAttending, pingAllInvited, attendingIds, changed, dm = false }) {
    const ids = plan.participants.map((p) => p.userId);
    const when = formatDate(plan.chosenDate);

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

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            const lead = pingList.length ? `${pingList.map((id) => `<@${id}>`).join(' ')}\n\n` : '';
            const headline = changed
                ? `${lead}Change of plan: **${plan.name}** has moved to ${when}.`
                : `${lead}**${plan.name}** is set for ${when}.`;
            await thread.send({ content: headline, allowedMentions: { users: pingList } });
        }
    }

    if (dm) {
        await dmEach(ids, changed
            ? `Change of plan: "${plan.name}" has moved to ${when}.`
            : `The plan "${plan.name}" is set for ${when}.`);
    }
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

//Posted in the plans channel when an unconfirmed plan loses its thread
export async function postThreadGone(plan, cfg) {
    const channel = await client.channels.fetch(cfg.plansChannelId).catch(() => null);
    if (!channel) return;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`plan|remake|${plan.planId}`).setLabel('Remake the thread').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`plan|remove|${plan.planId}`).setLabel('Remove the plan').setStyle(ButtonStyle.Danger)
    );
    await channel.send({
        content: `The thread for **${plan.name}** got deleted. Want me to remake it, or scrap the plan?`,
        components: [row],
        allowedMentions: { parse: [] }
    });
}

//Opens a fresh private thread for a plan and pulls everyone back in
export async function remakeThread(plan, cfg) {
    const guild = await client.guilds.fetch(plan.guildId);
    const channel = await guild.channels.fetch(cfg.plansChannelId);
    const thread = await createThread(channel, plan.name.slice(0, 100), ChannelType.PrivateThread);
    await setPlanThread(plan.planId, thread.id);

    const ids = plan.participants.map((p) => p.userId);
    for (const id of ids) await thread.members.add(id).catch(() => {});
    await thread.send({
        content: `${ids.map((id) => `<@${id}>`).join(' ')}\n\nBack again. Drop the dates you are free for **${plan.name}** here: ${planUrl(plan.planId)}`,
        allowedMentions: { users: ids }
    });
    return thread;
}

//Deletes the thread and forgets the plan. The thread vanishing is the signal,
//so we do not DM anyone about a cancellation.
export async function cancelPlan(plan) {
    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) await thread.delete().catch(() => {});
    }
    await deletePlan(plan.planId);
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
        content: `Cancel **${plan.name}**? This deletes this thread and the plan for good.`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

//Routes the remake / remove / cancel buttons
export async function handlePlanComponent(interaction) {
    const [kind, action, planId] = interaction.customId.split('|');

    if (kind === 'cancel') {
        if (action === 'no') return interaction.update({ content: 'Kept it.', components: [] });
        await interaction.update({ content: 'Cancelling the plan...', components: [] });
        const plan = await getPlan(planId);
        if (plan) await cancelPlan(plan);
        return;
    }

    //plan|remake and plan|remove are planner only, since they sit in a public message
    const cfg = await getGuildConfig(interaction.guildId);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!cfg || !member || !member.roles.cache.has(cfg.plannerRoleId)) {
        return interaction.reply({ content: 'You need the planner role to do that.', flags: MessageFlags.Ephemeral });
    }

    const plan = await getPlan(planId);
    if (!plan) return interaction.update({ content: 'That plan is already gone.', components: [] });

    if (action === 'remake') {
        await interaction.update({ content: `Remaking the thread for **${plan.name}**...`, components: [] });
        try {
            await remakeThread(plan, cfg);
            await interaction.editReply({ content: `Done, there is a fresh thread for **${plan.name}**.` });
        } catch (err) {
            await interaction.editReply({ content: `Could not remake it: ${err.message}` });
        }
        return;
    }

    if (action === 'remove') {
        await interaction.update({ content: `Scrapped **${plan.name}**.`, components: [] });
        await deletePlan(planId);
    }
}

//Nudges the people who have not confirmed yet, in the thread. The /remind route
//caps this to once a day, and the ping in the thread is enough to reach them.
export async function remindStragglers(plan) {
    const pending = plan.participants.filter((p) => !p.confirmed).map((p) => p.userId);
    if (!pending.length) return 0;

    const url = planUrl(plan.planId);

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content: `${pending.map((id) => `<@${id}>`).join(' ')} still waiting on your dates for **${plan.name}**: ${url}`,
                allowedMentions: { users: pending }
            });
        }
    }

    return pending.length;
}

//Tells everyone the range moved and they need to look at the new days
export async function announceExtension(plan, { dm = false } = {}) {
    const ids = plan.participants.map((p) => p.userId);
    const url = planUrl(plan.planId);
    const when = formatDate(plan.dateRange.end);

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content: `${ids.map((id) => `<@${id}>`).join(' ')}\n\nThe range for **${plan.name}** got extended to ${when}. Add the new days here: ${url}`,
                allowedMentions: { users: ids }
            });
        }
    }

    if (dm) {
        await dmEach(ids, `The plan "${plan.name}" was extended to ${when}. Add the new days here: ${url}`);
    }
}
