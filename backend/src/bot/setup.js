import {
    ActionRowBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';
import { getGuildConfig, saveGuildConfig } from '../db/guilds.js';
import { findPlannerRole, createPublicThread, pinMessage, introText } from './util.js';

/*
    The /setup flow. It runs as a little ephemeral wizard so only the person who
    ran it sees the steps. All the state between steps is packed into the button
    ids, so there is no in memory session to keep track of.

    Step 1: pick the plans channel (channel select menu)
    Step 2: sort the planner role (adopt an existing one or make a fresh one)
    Step 3: pick a trusted role, or skip it (the role that gets the higher limits)
    Step 4: save config, open the planner thread, post and pin the intro, report back
*/

//Entry point when someone runs /setup
export async function startSetup(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server, not in a DM.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to set me up.', flags: MessageFlags.Ephemeral });
    }

    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('setup|channel')
            .setPlaceholder('Pick your plans channel')
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)
    );

    return interaction.reply({
        content: 'Which channel is your plans chat? I will set up a thread there with the link.',
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

//Routes every setup|* button and menu back here
export async function handleSetupComponent(interaction) {
    const parts = interaction.customId.split('|');
    const step = parts[1];

    if (step === 'channel') {
        const channelId = interaction.values[0];
        return askAboutRole(interaction, channelId);
    }

    if (step === 'role') {
        const mode = parts[2];
        const channelId = parts[3];
        const roleId = parts[4];
        //Acknowledge first, since making or adopting a role is a slow call
        await interaction.deferUpdate();
        const role = await resolveRole(interaction.guild, { mode, roleId });
        return askAboutTrusted(interaction, channelId, role.id);
    }

    if (step === 'trust') {
        const channelId = parts[2];
        const plannerRoleId = parts[3];
        await interaction.update({ content: 'Setting things up...', components: [] });
        return finalize(interaction, channelId, plannerRoleId, interaction.values[0]);
    }

    if (step === 'trustskip') {
        const channelId = parts[2];
        const plannerRoleId = parts[3];
        await interaction.update({ content: 'Setting things up...', components: [] });
        return finalize(interaction, channelId, plannerRoleId, null);
    }
}

//Step 2: either there is already a planner role to adopt, or we just make one
async function askAboutRole(interaction, channelId) {
    await interaction.guild.roles.fetch();
    const existing = findPlannerRole(interaction.guild);

    if (!existing) {
        //Acknowledge first, since making the role is a slow call
        await interaction.deferUpdate();
        const role = await resolveRole(interaction.guild, { mode: 'new' });
        return askAboutTrusted(interaction, channelId, role.id);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`setup|role|adopt|${channelId}|${existing.id}`)
            .setLabel(`Use existing ${existing.name}`)
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`setup|role|new|${channelId}`)
            .setLabel('Make a fresh role')
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.update({
        content: `There is already a role called "${existing.name}". Want me to use it, or make a separate role just for planning?`,
        components: [row]
    });
}

/*
    Step 3: pick the trusted role. Anyone in it gets a much higher daily allowance
    on the noisy actions and the choice of whether to also DM people, so this is
    for the one or two people you actually trust to organise, not everyone. It is
    optional, skipping just means everyone with the planner role is treated the same.
*/
function askAboutTrusted(interaction, channelId, plannerRoleId) {
    const menu = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId(`setup|trust|${channelId}|${plannerRoleId}`)
            .setPlaceholder('Pick a trusted role (optional)')
            .setMinValues(1)
            .setMaxValues(1)
    );
    const skip = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`setup|trustskip|${channelId}|${plannerRoleId}`)
            .setLabel('Skip, treat everyone the same')
            .setStyle(ButtonStyle.Secondary)
    );

    //Both callers defer first (they make or adopt a role on the way here), so we
    //edit the acknowledged reply rather than update
    return interaction.editReply({
        content:
            'Last thing: is there a role you trust to organise more freely? People in it can run the noisy ' +
            'actions up to 10 times a day instead of twice, and get the option to DM everyone. Pick one, or skip it.',
        components: [menu, skip]
    });
}

//Step 4: open the thread, post the intro, save config, report back
async function finalize(interaction, channelId, plannerRoleId, trustedRoleId) {
    const guild = interaction.guild;

    try {
        const channel = await guild.channels.fetch(channelId);

        //Hand the planner role to whoever ran setup so they can plan right away
        const setupMember = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (setupMember && !setupMember.roles.cache.has(plannerRoleId)) {
            await setupMember.roles.add(plannerRoleId).catch(() => {});
        }

        //Clear out anything a previous setup left behind so we do not pile up
        const prev = await getGuildConfig(guild.id);
        if (prev?.introThreadId) {
            const oldThread = await guild.channels.fetch(prev.introThreadId).catch(() => null);
            if (oldThread) await oldThread.delete().catch(() => {});
        } else if (prev?.introMessageId && prev.plansChannelId) {
            //An older setup posted the intro straight into the channel, tidy that up
            const oldChannel = await guild.channels.fetch(prev.plansChannelId).catch(() => null);
            const oldMsg = oldChannel ? await oldChannel.messages.fetch(prev.introMessageId).catch(() => null) : null;
            if (oldMsg) await oldMsg.delete().catch(() => {});
        }

        //The bot lives in a thread so the plans channel stays clear for people
        const thread = await createPublicThread(channel, 'planner');
        const intro = await thread.send({
            content: introText(guild.id, plannerRoleId, trustedRoleId),
            //Show the roles as styled mentions without actually pinging them
            allowedMentions: { parse: [] }
        });

        let pinned = true;
        try {
            await pinMessage(intro);
        } catch (err) {
            pinned = false;
            console.warn('[setup] could not pin intro:', err.message);
        }

        await saveGuildConfig(guild.id, {
            guildName: guild.name,
            plansChannelId: channelId,
            plannerRoleId,
            trustedRoleId: trustedRoleId || null,
            introThreadId: thread.id,
            introMessageId: intro.id,
            setupBy: interaction.user.id,
            setupComplete: true
        });

        const pinNote = pinned
            ? ''
            : '\n\n(Heads up: I could not pin the intro. Give me the Pin Messages permission and rerun /setup if you want it pinned.)';
        const trustNote = trustedRoleId
            ? ` The trusted role is <@&${trustedRoleId}>.`
            : ' No trusted role, so everyone with the planner role gets the same limits.';

        return interaction.editReply({
            content: `All set. I opened the ${thread} thread in <#${channelId}> with the link, and the planner role is <@&${plannerRoleId}>.${trustNote} Each plan gets its own thread, so this channel stays free for normal chat.${pinNote}`,
            allowedMentions: { parse: [] }
        });
    } catch (err) {
        console.error('[setup] finalize failed:', err);
        return interaction.editReply({
            content: `That did not work: ${err.message}\n\nCheck that I have Manage Roles, and that I can create threads and post in that channel.`,
            components: []
        });
    }
}

//Adopt the role they picked, or create one (avoiding a duplicate "planner" name)
async function resolveRole(guild, roleChoice) {
    if (roleChoice.mode === 'adopt') {
        const role = await guild.roles.fetch(roleChoice.roleId);
        if (!role) throw new Error('That role is gone now');
        return role;
    }

    const name = findPlannerRole(guild) ? 'Plan Master' : 'planner';
    return guild.roles.create({ name, mentionable: true, reason: 'Role that can start availability plans' });
}
