import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';
import { getGuildConfig, saveGuildConfig } from '../db/guilds.js';
import { plannerRoleFor, freeRoleName, buttonLabel, placeIntro, pinMessage, introText, announceToServer } from './util.js';
import { readZoneOption, setupZoneLine, describeZone } from './timezone.js';
import { safeZone } from '../lib/zones.js';
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
    one.

    A rerun on a server whose saved role is still there keeps it and asks nothing.
    Which role it is was never the interesting question: who can plan is who holds
    that role, which is Discord's own business, and swapping the role for a fresh one
    only takes planning off everybody at once. So setup no longer offers to.

    fresh is true when this comes straight off the slash command, so we reply
    instead of editing a component message that does not exist yet.
*/
async function askAboutRole(interaction, fresh, zone) {
    await interaction.guild.roles.fetch();
    const prev = await getGuildConfig(interaction.guild.id);
    const { role: existing, saved } = plannerRoleFor(interaction.guild, prev);

    if (saved) {
        const ack = { content: 'Setting things up...', components: [] };
        if (fresh) await interaction.reply({ ...ack, flags: MessageFlags.Ephemeral });
        else await interaction.update(ack);
        return finalize(interaction, existing.id, zone, true);
    }

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
            .setLabel(buttonLabel(`Use existing ${existing.name}`))
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`setup|role|new||${zone}`)
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

/*
    Step 2: place the intro, save config, report back. keptRole is true when the role
    was already the server's and is being left alone, which is the one case where
    nothing about who can plan should move.
*/
async function finalize(interaction, plannerRoleId, zone, keptRole = false) {
    const guild = interaction.guild;

    try {
        const prev = await getGuildConfig(guild.id);
        const timeZone = chooseZone(zone, prev);

        /*
            Hand the planner role to whoever ran setup so somebody can plan right away.
            Not when the role was already here and holds people: a rerun would widen who
            can plan by one every time, quietly, on nothing more than Manage Server.
        */
        if (!keptRole) {
            const setupMember = await guild.members.fetch(interaction.user.id).catch(() => null);
            if (setupMember && !setupMember.roles.cache.has(plannerRoleId)) {
                await setupMember.roles.add(plannerRoleId).catch(() => {});
            }
        }

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

        const next = {
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
        };
        await saveGuildConfig(guild.id, next);

        /*
            Out loud, and only on a rerun: a first run is announced by the channel and
            the intro appearing at all. The reply below is ephemeral, so without this a
            run that moves who can plan, or what every time here means, is invisible to
            everybody it lands on, the owner of the server included.

            Best effort, since a server that has taken the bot's posting rights away
            should still get its setup rather than an error about a notice.
        */
        if (prev?.setupComplete) {
            await announceToServer(guild, channel.id, rerunNotice(interaction.user.id, setupChanges(prev, next)));
        }

        const pinNote = pinned
            ? ''
            : '\n\n(Heads up: I could not pin the intro. Give me the Manage Messages permission and rerun /setup if you want it pinned.)';

        //A rerun has to say what it actually did, since the answer is now "nothing to the channel"
        const opening = madeChannel
            ? `All set. I made the ${channel} channel, read only so it stays clean, with the intro and the link pinned at the top.`
            : `All set. ${channel} was already there, so I left it and its plan threads alone and brought the pinned intro up to date.`;

        return interaction.editReply({
            content: `${opening} The planner role is <@&${plannerRoleId}>. Anyone with that role can start, confirm, change the dates, cancel or send reminders for a plan, and each plan gets its own thread off that channel.${setupZoneLine(timeZone, Boolean(zone) || Boolean(prev?.timeZone))}${pinNote}`,
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

/*
    The clock to save. Leaving the option off keeps the one the server already picked,
    which is what `readZoneOption` returning null is for: falling back to the default
    here would move what every time in the server means, on a command people are now
    told to run again just to refresh the intro.
*/
export function chooseZone(picked, prev) {
    return picked || prev?.timeZone || config.defaultTimeZone;
}

/*
    What a rerun actually moved, in the words the notice says it in. Only the three
    things a run can change: nothing else in the config is setup's to touch.
*/
export function setupChanges(prev, next) {
    const changes = [];
    if (prev.plannerRoleId !== next.plannerRoleId) {
        changes.push(`Who can plan: it is <@&${next.plannerRoleId}> now, it was <@&${prev.plannerRoleId}>.`);
    }
    //Read through safeZone on the old side, since a server from before the clock existed has none saved
    if (safeZone(prev.timeZone) !== next.timeZone) {
        changes.push(
            `The clock: this server runs on ${describeZone(next.timeZone)} now, it was ${describeZone(safeZone(prev.timeZone))}. A plan set for 8pm means 8pm there.`
        );
    }
    if (prev.infoChannelId !== next.infoChannelId) {
        changes.push('This channel: the old one had gone, so this is a fresh one.');
    }
    return changes;
}

//Said in the info channel rather than back to whoever ran it, so everybody it affects can see it
export function rerunNotice(byUserId, changes) {
    const opening = `<@${byUserId}> ran \`/setup\` again.`;
    if (!changes.length) return `${opening} Nothing changed, the pinned message above is just current again.`;
    return [`${opening} What changed:`, ...changes.map((c) => `- ${c}`)].join('\n');
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
