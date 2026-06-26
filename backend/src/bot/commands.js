import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

/*
    every slash command the bot knows lives here. setup is the only one for now,
    locked to people who can manage the server since it wires the bot up. more
    commands (compare, mylink) get added in later phases.
*/
export const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Point the bot at your plans channel and planner role')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
    new SlashCommandBuilder()
        .setName('compare')
        .setDescription("Get the compare link for the plan in this thread")
        .toJSON(),
    new SlashCommandBuilder()
        .setName('mylink')
        .setDescription('List your links for the plans you are in here')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('myavailability')
        .setDescription('Get the link to set your general availability')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('cancel')
        .setDescription('Cancel the plan in this thread')
        .toJSON()
];

/*
    push the command list up to discord. if a dev guild is set we register there
    for instant updates, otherwise we register globally for every server at once.
*/
export async function registerCommands(client) {
    if (config.discord.devGuildId) {
        const guild = await client.guilds.fetch(config.discord.devGuildId).catch(() => null);
        if (guild) {
            await guild.commands.set(commands);
            console.log(`[bot] registered ${commands.length} command(s) to dev guild ${guild.name}`);
            return;
        }
        console.warn('[bot] DISCORD_DEV_GUILD_ID set but the bot is not in that guild, falling back to global');
    }
    await client.application.commands.set(commands);
    console.log(`[bot] registered ${commands.length} global command(s)`);
}
