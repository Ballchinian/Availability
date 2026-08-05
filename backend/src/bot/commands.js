import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

/*
    Every slash command the bot knows lives here. Setup is the one locked to
    people who can manage the server, since it wires the bot up. The rest are
    open to anyone and check the planner role themselves where it matters.
*/
export const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set up the bot: makes a read-only info channel and sorts the planner role')
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
    Push the command list up to Discord. With a dev guild set they register there
    for instant updates, otherwise globally for every server at once, which
    Discord can take an hour to spread around.
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
