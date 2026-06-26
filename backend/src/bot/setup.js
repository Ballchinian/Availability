import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';
import { getGuildConfig, saveGuildConfig } from '../db/guilds.js';
import { findPlannerRole, createInfoChannel, pinMessage, introText } from './util.js';

/*
    The /setup flow. It runs as a little ephemeral wizard so only the person who
    ran it sees the steps. All the state between steps is packed into the button
    ids, so there is no in memory session to keep track of.

    Step 1: sort the planner role (adopt an existing one or make a fresh one)
    Step 2: save config, make the read-only info channel, post and pin the intro,
            report back. Plan threads spawn off that channel.
*/

//Entry point when someone runs /setup
export async function startSetup(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server, not in a DM.', flags: MessageFlags.Ephemeral });
    }
    //inGuild can be true while guild is null if I was only added to someone's apps and
    //not the server itself, in which case I cannot see the roles or channels here
    if (!interaction.guild) {
        return interaction.reply({
            content: 'I am not actually in this server, it looks like I was added to your apps instead of the server. Re-add me with my invite link (choose Add to Server) and run /setup again.',
            flags: MessageFlags.Ephemeral
        });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to set me up.', flags: MessageFlags.Ephemeral });
    }

    return askAboutRole(interaction, true);
}

//Routes every setup|* button back here
export async function handleSetupComponent(interaction) {
    const parts = interaction.customId.split('|');
    const step = parts[1];

    if (step === 'role') {
        const mode = parts[2];
        const roleId = parts[3];
        //Acknowledge first, since making or adopting a role is a slow call
        await interaction.update({ content: 'Setting things up...', components: [] });
        const role = await resolveRole(interaction.guild, { mode, roleId });
        return finalize(interaction, role.id);
    }
}

/*
    Step 1: either there is already a planner role to adopt, or we just make one.
    fresh is true when this comes straight off the slash command, so we reply
    instead of editing a component message that does not exist yet.
*/
async function askAboutRole(interaction, fresh) {
    await interaction.guild.roles.fetch();
    const existing = findPlannerRole(interaction.guild);

    if (!existing) {
        //Acknowledge first, since making the role and the channel are slow calls
        const ack = { content: 'Setting things up...', components: [] };
        if (fresh) await interaction.reply({ ...ack, flags: MessageFlags.Ephemeral });
        else await interaction.update(ack);
        const role = await resolveRole(interaction.guild, { mode: 'new' });
        return finalize(interaction, role.id);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`setup|role|adopt|${existing.id}`)
            .setLabel(`Use existing ${existing.name}`)
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('setup|role|new')
            .setLabel('Make a fresh role')
            .setStyle(ButtonStyle.Secondary)
    );

    const payload = {
        content: `There is already a role called "${existing.name}". Want me to use it, or make a separate role just for planning?`,
        components: [row]
    };
    if (fresh) return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return interaction.update(payload);
}

//Step 2: make the info channel, post the intro, save config, report back
async function finalize(interaction, plannerRoleId) {
    const guild = interaction.guild;

    try {
        //Hand the planner role to whoever ran setup so they can plan right away
        const setupMember = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (setupMember && !setupMember.roles.cache.has(plannerRoleId)) {
            await setupMember.roles.add(plannerRoleId).catch(() => {});
        }

        //Clear out anything a previous setup left behind so we do not pile up
        const prev = await getGuildConfig(guild.id);
        if (prev?.infoChannelId) {
            const oldChannel = await guild.channels.fetch(prev.infoChannelId).catch(() => null);
            if (oldChannel) await oldChannel.delete().catch(() => {});
        } else if (prev?.introThreadId) {
            //An older setup kept the intro in a thread, tidy that up
            const oldThread = await guild.channels.fetch(prev.introThreadId).catch(() => null);
            if (oldThread) await oldThread.delete().catch(() => {});
        }

        //The bot makes its own read-only channel: the intro lives here and plan threads spawn off it
        const channel = await createInfoChannel(guild);
        const intro = await channel.send({
            content: introText(guild.id, plannerRoleId),
            //Show the role as a styled mention without actually pinging it
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
            //The info channel is also the parent every plan thread spawns from
            plansChannelId: channel.id,
            infoChannelId: channel.id,
            plannerRoleId,
            //Clear any trusted role a previous setup saved, the split is gone now
            trustedRoleId: null,
            //No more intro thread, the intro lives in the channel itself now
            introThreadId: null,
            introMessageId: intro.id,
            setupBy: interaction.user.id,
            setupComplete: true
        });

        const pinNote = pinned
            ? ''
            : '\n\n(Heads up: I could not pin the intro. Give me the Manage Messages permission and rerun /setup if you want it pinned.)';

        return interaction.editReply({
            content: `All set. I made the ${channel} channel, read only so it stays clean, with the intro and the link pinned at the top. The planner role is <@&${plannerRoleId}>. Anyone with that role can start, confirm, change the dates, cancel or send reminders for a plan, and each plan gets its own thread off that channel.${pinNote}`,
            allowedMentions: { parse: [] }
        });
    } catch (err) {
        console.error('[setup] finalize failed:', err);
        return interaction.editReply({
            content: `That did not work: ${err.message}\n\nCheck that I have Manage Channels and Manage Roles, and that I can create threads and post.`,
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
