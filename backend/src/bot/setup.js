import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';
import { getGuildConfig, saveGuildConfig } from '../db/guilds.js';
import { plannerRoleFor, freeRoleName, buttonLabel, placeIntro, pinMessage, introText } from './util.js';
import { readZoneOption, setupZoneLine } from './timezone.js';
import { config } from '../config.js';

/*
    The /setup flow. It runs as a little ephemeral wizard so only the person who
    ran it sees the steps. All the state between steps is packed into the button
    ids, so there is no in memory session to keep track of.

    Step 1: sort the planner role (adopt an existing one or make a fresh one)
    Step 2: save config, put the intro in the read-only info channel and pin it,
            report back. Plan threads spawn off that channel.

    Rerunning it is safe and is the way to bring an old server's pinned intro up to
    date. It keeps the channel it finds, since the plan threads hanging off it would
    go with it.

    The clock they picked rides in the button ids with everything else rather than
    being written as it is read, so abandoning the wizard halfway leaves no half
    written config behind for /cancel to trip over.
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

    const zone = readZoneOption(interaction);
    if (zone === false) {
        return interaction.reply({
            content: 'I do not know that zone. Pick one from the list I offer as you type, or leave it out and I will ask again with /timezone.',
            flags: MessageFlags.Ephemeral
        });
    }

    return askAboutRole(interaction, true, zone || '');
}

//Routes every setup|* button back here
export async function handleSetupComponent(interaction) {
    const parts = interaction.customId.split('|');
    const step = parts[1];

    if (step === 'role') {
        const mode = parts[2];
        const roleId = parts[3];
        const zone = parts[4] || '';
        //Acknowledge first, since making or adopting a role is a slow call
        await interaction.update({ content: 'Setting things up...', components: [] });
        const role = await resolveRole(interaction.guild, { mode, roleId });
        return finalize(interaction, role.id, zone);
    }
}

/*
    Step 1: either there is already a planner role to keep or adopt, or we just make
    one. A rerun asks about the role the server is already running on rather than
    whatever is named "planner", and warns what a fresh one would cost, since that is
    the click that takes planning off everybody who can do it today.

    fresh is true when this comes straight off the slash command, so we reply
    instead of editing a component message that does not exist yet.
*/
async function askAboutRole(interaction, fresh, zone) {
    await interaction.guild.roles.fetch();
    const prev = await getGuildConfig(interaction.guild.id);
    const { role: existing, saved } = plannerRoleFor(interaction.guild, prev);

    if (!existing) {
        //Acknowledge first, since making the role and the channel are slow calls
        const ack = { content: 'Setting things up...', components: [] };
        if (fresh) await interaction.reply({ ...ack, flags: MessageFlags.Ephemeral });
        else await interaction.update(ack);
        const role = await resolveRole(interaction.guild, { mode: 'new' });
        return finalize(interaction, role.id, zone);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            //The empty slot is the role id the other button carries, so the zone is always last
            .setCustomId(`setup|role|adopt|${existing.id}|${zone}`)
            .setLabel(buttonLabel(saved ? `Keep ${existing.name}` : `Use existing ${existing.name}`))
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`setup|role|new||${zone}`)
            .setLabel('Make a fresh role')
            .setStyle(ButtonStyle.Secondary)
    );

    const payload = {
        content: saved
            ? `You are already set up here, and "${existing.name}" is the role that lets people plan. Keep it, or make a fresh one? A fresh one leaves everybody who can plan today unable to, apart from you.`
            : `There is already a role called "${existing.name}". Want me to use it, or make a separate role just for planning?`,
        components: [row]
    };
    if (fresh) return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return interaction.update(payload);
}

//Step 2: place the intro, save config, report back
async function finalize(interaction, plannerRoleId, zone) {
    const guild = interaction.guild;
    const timeZone = zone || config.defaultTimeZone;

    try {
        //Hand the planner role to whoever ran setup so they can plan right away
        const setupMember = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (setupMember && !setupMember.roles.cache.has(plannerRoleId)) {
            await setupMember.roles.add(plannerRoleId).catch(() => {});
        }

        const prev = await getGuildConfig(guild.id);
        //The read-only channel the intro lives in and every plan thread spawns off, kept across a rerun
        const { channel, intro, madeChannel } = await placeIntro(guild, prev, {
            content: introText(guild.id, plannerRoleId),
            //Show the role as a styled mention without actually pinging it
            allowedMentions: { parse: [] }
        });

        /*
            Asked of the message rather than done again, so a rerun does not re-pin what
            is already pinned. An intro that went up unpinned for want of Manage Messages
            still gets another go, which is what the note at the bottom promises.
        */
        let pinned = intro.pinned;
        if (!pinned) {
            try {
                await pinMessage(intro);
                pinned = true;
            } catch (err) {
                console.warn('[setup] could not pin intro:', err.message);
            }
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
            //What "Wednesday" and "8pm" mean here, for the grid, the calendar file and every stamp
            timeZone,
            setupBy: interaction.user.id,
            setupComplete: true
        });

        const pinNote = pinned
            ? ''
            : '\n\n(Heads up: I could not pin the intro. Give me the Manage Messages permission and rerun /setup if you want it pinned.)';

        //A rerun has to say what it actually did, since the answer is now "nothing to the channel"
        const opening = madeChannel
            ? `All set. I made the ${channel} channel, read only so it stays clean, with the intro and the link pinned at the top.`
            : `All set. ${channel} was already there, so I left it and its plan threads alone and brought the pinned intro up to date.`;

        return interaction.editReply({
            content: `${opening} The planner role is <@&${plannerRoleId}>. Anyone with that role can start, confirm, change the dates, cancel or send reminders for a plan, and each plan gets its own thread off that channel.${setupZoneLine(timeZone, Boolean(zone))}${pinNote}`,
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

//Adopt the role they picked, or create one under a name nothing here has taken
async function resolveRole(guild, roleChoice) {
    if (roleChoice.mode === 'adopt') {
        const role = await guild.roles.fetch(roleChoice.roleId);
        if (!role) throw new Error('That role is gone now');
        return role;
    }

    return guild.roles.create({ name: freeRoleName(guild), mentionable: true, reason: 'Role that can start availability plans' });
}
