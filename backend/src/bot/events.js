import { MessageFlags } from 'discord.js';
import { registerCommands } from './commands.js';
import { startSetup, handleSetupComponent } from './setup.js';
import { handleCompare, handleMyLink, handleMyAvailability, handleCancel, handlePlanComponent, handleDrop, handleDropModal, handleUndrop, handleVote, handleVoteModal } from './plans.js';
import { onThreadDelete, onChannelDelete, onGuildDelete, onGuildMemberRemove, onGuildMemberAdd } from './cleanup.js';
import { findAnnounceChannel, welcomeText, warmGuildMembers } from './util.js';
import { inviteUrl } from './permissions.js';

/*
    Wires the gateway events to the bits that handle them. Kept separate from the
    client itself so the login code stays short. Three things matter here: push
    commands once we are ready, greet a server when we join it, and route every
    interaction to the right handler.
*/
export function attachEvents(client) {
    client.once('clientReady', async (c) => {
        console.log(`[bot] logged in as ${c.user.tag}`);
        //Handy to have the up to date invite link in the logs at all times
        console.log(`[bot] invite link: ${inviteUrl(c.user.id)}`);
        try {
            await registerCommands(c);
        } catch (err) {
            console.error('[bot] could not register commands:', err.message);
        }

        //Warm the member cache for every server, one at a time so we stay gentle on the
        //gateway, so the picker can read from cache instead of the rate limited fetch
        for (const guild of c.guilds.cache.values()) {
            await warmGuildMembers(guild);
        }
    });

    //Say hello and nudge an admin towards /setup when added to a server
    client.on('guildCreate', async (guild) => {
        //The announcements channel is the natural home for this, with a fallback if there is none
        const channel = findAnnounceChannel(guild);
        if (channel) {
            await channel.send(welcomeText()).catch(() => {});
        }
        //Warm the member cache now so the first plan's picker does not hit the gateway limit
        await warmGuildMembers(guild);
    });

    //Tidy up after deletions and departures
    client.on('threadDelete', (thread) => onThreadDelete(thread).catch((err) => console.error('[cleanup] threadDelete:', err.message)));
    client.on('channelDelete', (channel) => onChannelDelete(channel).catch((err) => console.error('[cleanup] channelDelete:', err.message)));
    client.on('guildDelete', (guild) => onGuildDelete(guild).catch((err) => console.error('[cleanup] guildDelete:', err.message)));
    client.on('guildMemberRemove', (member) => onGuildMemberRemove(member).catch((err) => console.error('[cleanup] memberRemove:', err.message)));
    client.on('guildMemberAdd', (member) => onGuildMemberAdd(member).catch((err) => console.error('[cleanup] memberAdd:', err.message)));

    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
                return await startSetup(interaction);
            }
            if (interaction.isChatInputCommand() && interaction.commandName === 'compare') {
                return await handleCompare(interaction);
            }
            if (interaction.isChatInputCommand() && interaction.commandName === 'mylink') {
                return await handleMyLink(interaction);
            }
            if (interaction.isChatInputCommand() && interaction.commandName === 'myavailability') {
                return await handleMyAvailability(interaction);
            }
            if (interaction.isChatInputCommand() && interaction.commandName === 'cancel') {
                return await handleCancel(interaction);
            }
            if (interaction.isModalSubmit() && interaction.customId.startsWith('votemodal|')) {
                return await handleVoteModal(interaction);
            }
            if (interaction.isModalSubmit() && interaction.customId.startsWith('dropmodal|')) {
                return await handleDropModal(interaction);
            }
            if (interaction.isMessageComponent() && interaction.customId.startsWith('setup|')) {
                return await handleSetupComponent(interaction);
            }
            if (interaction.isMessageComponent() && interaction.customId.startsWith('cancel|')) {
                return await handlePlanComponent(interaction);
            }
            if (interaction.isMessageComponent() && interaction.customId.startsWith('vote|')) {
                return await handleVote(interaction);
            }
            if (interaction.isMessageComponent() && interaction.customId.startsWith('undrop|')) {
                return await handleUndrop(interaction);
            }
            if (interaction.isMessageComponent() && interaction.customId.startsWith('drop|')) {
                return await handleDrop(interaction);
            }
        } catch (err) {
            console.error('[bot] interaction failed:', err);
            await replyError(interaction);
        }
    });
}

//Best effort apology when a handler throws, without crashing the bot
async function replyError(interaction) {
    const body = { content: 'something went wrong on my end, give it another go.', flags: MessageFlags.Ephemeral };
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(body);
        } else if (interaction.isRepliable()) {
            await interaction.reply(body);
        }
    } catch {
        //Nothing more we can do here
    }
}
