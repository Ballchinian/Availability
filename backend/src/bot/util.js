import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

/*
    Small shared helpers for the bot side, plus the human sounding copy the bot
    posts. Keeping the wording here means the tone stays in one place.
*/

//Link a planner opens to start a plan in this server
export function createUrl(guildId) {
    return `${config.baseUrl}/#/g/${guildId}`;
}

//Link an invited person opens to fill in their availability for a plan
export function planUrl(planId) {
    return `${config.baseUrl}/#/plan/${planId}`;
}

//Link a planner opens to compare everyone's dates and pick the winner
export function compareUrl(planId) {
    return `${config.baseUrl}/#/plan/${planId}/compare`;
}

//Bring a thread back from archived so a post lands and reopens it
export async function reviveThread(thread) {
    if (thread.archived) await thread.setArchived(false).catch(() => {});
}

//Finds a text channel the bot can actually talk in, preferring the system one
export function findWritableChannel(guild) {
    const me = guild.members.me;
    if (!me) return null;

    const canSend = (channel) =>
        channel &&
        channel.type === ChannelType.GuildText &&
        channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages);

    if (canSend(guild.systemChannel)) return guild.systemChannel;
    return guild.channels.cache.find(canSend) || null;
}

/*
    Where the welcome message wants to land: the announcements channel if the bot
    can post there, since that is where a server expects the bot to introduce
    itself. We take a proper Announcement channel first, then anything named like
    announcements, and fall back to the next best writable chat if neither works.
*/
export function findAnnounceChannel(guild) {
    const me = guild.members.me;
    if (!me) return null;

    const canSend = (channel) =>
        channel &&
        (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
        channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages);

    const byType = guild.channels.cache.find((c) => c.type === ChannelType.GuildAnnouncement && canSend(c));
    if (byType) return byType;

    const byName = guild.channels.cache.find((c) => /announce/i.test(c.name) && canSend(c));
    if (byName) return byName;

    return findWritableChannel(guild);
}

//Looks for a role literally named planner, case insensitive
export function findPlannerRole(guild) {
    return guild.roles.cache.find((r) => r.name.toLowerCase() === 'planner') || null;
}

/*
    Pulls a guild's whole member list into the cache once, so the member picker can
    read it straight from cache instead of the rate limited gateway fetch. Smaller
    servers already arrive fully cached, so this only does any work for the larger
    ones, and with the GuildMembers intent the cache then stays current on its own.
    Best effort: a throttle here just means the picker fetches on demand later.
*/
export async function warmGuildMembers(guild) {
    if (guild.members.cache.size >= guild.memberCount) return;
    await guild.members.fetch().catch(() => {});
}

/*
    Opens a thread off a channel. The longer auto archive windows (3 and 7 days)
    are gated to boosted servers, so we ask for the preferred length and quietly
    fall back to 24 hours when the server will not allow it.
*/
export async function createThread(channel, name, type = ChannelType.PublicThread, preferredDuration = 1440) {
    const durations = [...new Set([preferredDuration, 1440])];
    let lastErr;
    for (const autoArchiveDuration of durations) {
        try {
            return await channel.threads.create({ name, type, autoArchiveDuration });
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr;
}

//The name of the read-only channel the bot makes on setup to hold the intro and host plan threads
export const INFO_CHANNEL_NAME = 'plan-bot-info';

/*
    Makes the bot its own channel on setup: a read-only info chat where the intro
    lives and every plan thread spawns from. Everyone can read it but no one can
    type, so it stays clean. The bot keeps the rights it needs to post, pin and
    open the private plan threads.
*/
export async function createInfoChannel(guild) {
    const me = guild.members.me;
    //Deny @everyone Send Messages so it stays read only. The bot is part of @everyone,
    //so re-allow it for the bot alone, otherwise it could not post the intro here.
    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] }
    ];
    if (me) {
        overwrites.push({
            id: me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        });
    }
    return guild.channels.create({
        name: INFO_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: 'Plan bot info, and the home for plan threads. Read only, the bot posts here.',
        permissionOverwrites: overwrites
    });
}

/*
    Pins a message. Discord moved pinning to a new endpoint in the 2025 pins
    revamp, and the library's message.pin() still calls the old one, which now
    quietly does nothing. So we hit the new route directly. Works in channels
    and threads alike, since pins are tracked per channel.
*/
export async function pinMessage(message) {
    await message.client.rest.put(`/channels/${message.channelId}/messages/pins/${message.id}`);
}

//Dropped in the first channel when the bot joins a new server
export function welcomeText() {
    return [
        "Trying to help the self-torment of organising when you're an adult",
        '',
        'To get going, someone with Manage Server runs `/setup`. I will make a read-only info channel with the link, and anyone with the planner role can start a plan from there.'
    ].join('\n');
}

//Posted and pinned in the read-only info channel once setup finishes
export function introText(guildId, plannerRoleId) {
    return [
        'This is the plan bot info channel. It is read only, I post here and every plan gets its own thread off this channel.',
        '',
        `Start a plan here: ${createUrl(guildId)}`,
        '',
        'Pick a date range, say what the plan is about, and choose who is coming. I will open a thread for it and nudge everyone to drop the dates they are free.',
        "Once everyone has filled theirs in I will DM whoever started the plan. To find a day that works for the group, run `/compare` in that plan's thread, any time, even before everyone is in.",
        '',
        `Want to set your availability ahead of time? Do it here any time: ${config.baseUrl}/#/availability`,
        '',
        `Heads up: only people with the <@&${plannerRoleId}> role can start, confirm, change the dates, cancel or send reminders for a plan. Everyone gets a DM when one of those happens.`,
        'When a plan is confirmed or cancelled its thread stays put until someone deletes it by hand, and deleting a plan thread clears the plan for good.'
    ].join('\n');
}
