import { ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { client } from './client.js';
import { createThread, planUrl, reviveThread } from './util.js';
import { setPlanThread, getPlan, getPlanByThread, getOpenPlansForUser, markPlanCancelled, removeParticipant } from '../db/plans.js';
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

/*
    When a plan is created on the site this is the Discord side of it: open a
    private thread named after the plan, pull the invited people in, and ping them
    in the thread. Everyone also gets a DM, with the range, what the plan is about,
    a jump straight to the thread, and a drop out button so they never have to go
    near the thread if they do not want to. actorName is whoever started it.
*/
export async function announcePlan(plan, cfg, actorName) {
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
    const mentions = ids.map((id) => `<@${id}>`).join(' ');
    await thread.send({
        content:
            `${mentions}\n\n` +
            `New plan: **${plan.name}** (${range}).\n` +
            `What it is about: ${plan.description}\n` +
            `Choose the dates you are free here: ${url}\n` +
            `A planner can run \`/compare\` any time to see where things stand, even before everyone is in.`,
        allowedMentions: { users: ids }
    });

    const jump = thread.url ? `Jump straight to the thread: ${thread.url}` : `Look for the thread in #${channel.name}.`;
    await dmEach(ids,
        `${actorName} added you to the plan "${plan.name}" in ${guild.name} (${range}).\n` +
        `What it is about: ${plan.description}\n` +
        `Add the dates you are free here: ${url}\n` +
        `${jump}\n\n` +
        `Hit "Drop out" below to leave the plan`,
        [dropRow(plan.planId)]);

    return thread;
}

/*
    Pull extra people into a plan that is already running. They slip into the
    thread quietly, no ping, with just a no fuss note so the group can see who
    joined. The welcome goes by DM instead: what it is about, the range, the link
    and a way to the thread, plus a drop out button, same as the start. actorName
    is the planner who added them.
*/
export async function announceAddition(plan, newIds, actorName) {
    const guild = await client.guilds.fetch(plan.guildId);
    const url = planUrl(plan.planId);
    const range = `${formatDate(plan.dateRange.start)} to ${formatDate(plan.dateRange.end)}`;

    const thread = plan.threadId ? await client.channels.fetch(plan.threadId).catch(() => null) : null;
    if (thread) {
        await reviveThread(thread);
        for (const id of newIds) await thread.members.add(id).catch(() => {});
        const names = newIds.map((id) => `<@${id}>`).join(' ');
        //Names show so the thread has context, but no ping, the DM is how they hear about it
        await thread.send({
            content: `${actorName} added ${names} to the plan.`,
            allowedMentions: { parse: [] }
        });
    }

    const jump = thread?.url ? `\nJump straight to the thread: ${thread.url}` : '';
    await dmEach(newIds,
        `${actorName} invited you to the plan "${plan.name}" in ${guild.name} (${range}).\n` +
        `What it is about: ${plan.description}\n` +
        `Add the dates you are free here: ${url}${jump}\n\n` +
        `Hit "Drop out" below to leave the plan`,
        [dropRow(plan.planId)]);
}

/*
    Once a planner locks the winning date the plan closes. The outcome lands in
    the thread, pinging whoever the planner chose (the people who can make it, or
    everyone invited, or both), and everyone invited gets a DM either way. The
    headline and DM both name who set or moved it.
*/
export async function announceOutcome(plan, cfg, { pingAttending, pingAllInvited, attendingIds, changed, actorName }) {
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

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            const lead = pingList.length ? `${pingList.map((id) => `<@${id}>`).join(' ')}\n\n` : '';
            const headline = changed
                ? `${lead}Change of plan: ${actorName} moved **${plan.name}** to ${when}.${note}`
                : `${lead}${actorName} set **${plan.name}** for ${when}.${note}`;
            await thread.send({ content: headline, allowedMentions: { users: pingList } });
        }
    }

    await dmEach(ids, (changed
        ? `${actorName} moved the plan "${plan.name}" in ${cfg.guildName} to ${when}.`
        : `${actorName} set the plan "${plan.name}" in ${cfg.guildName} for ${when}.`) + note);
}

/*
    Tells everyone the range moved and they need to look at the new days. Pings in
    the thread and DMs everyone, with the drop out button since the plan is still
    collecting. actorName is whoever extended it.
*/
export async function announceExtension(plan, cfg, { actorName, note }) {
    const ids = plan.participants.map((p) => p.userId);
    const url = planUrl(plan.planId);
    const when = formatDate(plan.dateRange.end);
    const extra = note ? `\n${note}` : '';

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content: `${ids.map((id) => `<@${id}>`).join(' ')}\n\n${actorName} extended **${plan.name}** to ${when}. Add the new days here: ${url}${extra}`,
                allowedMentions: { users: ids }
            });
        }
    }

    await dmEach(ids,
        `${actorName} extended the plan "${plan.name}" in ${cfg.guildName} to ${when}. Add the new days here: ${url}${extra}`,
        [dropRow(plan.planId)]);
}

/*
    The planner has called off a date that was set and is rescheduling. This one
    is DM only, no thread post, with an optional reason. Everyone's saved dates
    stay put so they can just tweak them for the new pick. actorName is whoever
    voided it.
*/
export async function announceVoid(plan, cfg, actorName, reason) {
    const ids = plan.participants.map((p) => p.userId);
    const url = planUrl(plan.planId);
    const why = reason ? `\nReason: ${reason}` : '';

    await dmEach(ids,
        `${actorName} called off the date for "${plan.name}" in ${cfg.guildName} and is sorting out a new one. ` +
        `Nothing is locked in for now.${why}\n` +
        `Your dates are still saved, tweak them here if you need to: ${url}`,
        [dropRow(plan.planId)]);
}

/*
    Cancel a plan. It gets marked cancelled and the thread is told, with a ping,
    but the thread is left in place: deleting it by hand is what finally clears
    the plan. Everyone gets a DM, and the creator gets their daily plan slot back
    since the plan never really ran. actorName is whoever cancelled it.
*/
export async function cancelPlan(plan, actorName) {
    await markPlanCancelled(plan.planId);

    const ids = plan.participants.map((p) => p.userId);

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({
                content:
                    `${ids.map((id) => `<@${id}>`).join(' ')}\n\n` +
                    `${actorName} cancelled **${plan.name}**. Nothing more to fill in.\n` +
                    `This thread stays until someone deletes it by hand, and deleting it clears the plan for good.`,
                allowedMentions: { users: ids }
            });
        }
    }

    await dmEach(ids, `${actorName} cancelled the plan "${plan.name}".`);

    await refundAction(plan.createdBy, plan.guildId, 'create');
}

/*
    Drop one person out of a plan, from the site or the DM button. We take them
    off the guest list so they are no longer pinged or DMed about it, but leave
    them in the thread so they can still follow along if they want. A quiet note
    lets the rest of the group know, no ping, they did not do anything to anyone.
*/
export async function leavePlan(plan, userId) {
    await removeParticipant(plan.planId, userId);

    const guild = await client.guilds.fetch(plan.guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    const name = member?.displayName || 'Someone';

    if (plan.threadId) {
        const thread = await client.channels.fetch(plan.threadId).catch(() => null);
        if (thread) {
            await reviveThread(thread);
            await thread.send({ content: `${name} dropped out of **${plan.name}**. They can still read along here but will not be nudged about it.`, allowedMentions: { parse: [] } });
        }
    }
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
    /remind route caps this to once a day. actorName is whoever asked for it, and
    the drop out button rides along in case someone would rather bow out.
*/
export async function remindStragglers(plan, actorName) {
    const pending = plan.participants.filter((p) => !p.confirmed).map((p) => p.userId);
    if (!pending.length) return 0;

    const url = planUrl(plan.planId);
    await dmEach(pending,
        `${actorName} has asked for your availability for "${plan.name}". ` +
        `Please fill it in when you are next free, or just confirm if you already have the dates filled in: ${url}`,
        [dropRow(plan.planId)]);

    return pending.length;
}
