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

//Looks for a role literally named planner, case insensitive
export function findPlannerRole(guild) {
    return guild.roles.cache.find((r) => r.name.toLowerCase() === 'planner') || null;
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

//The intro thread from /setup is public so everyone in the server can read it
export function createPublicThread(channel, name, preferredDuration = 1440) {
    return createThread(channel, name, ChannelType.PublicThread, preferredDuration);
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
        'Thanks for adding me. I help a group work out when everyone is actually free.',
        '',
        'To get going, someone with Manage Server runs `/setup` and tells me which channel is your plans chat.',
        'After that I will set up a thread with the link, and anyone with the planner role can start a plan.'
    ].join('\n');
}

//Posted and pinned inside the planner thread once setup finishes
export function introText(guildId, plannerRoleId, trustedRoleId = null) {
    const lines = [
        'This is where we sort out when everyone can meet up.',
        '',
        `Start a plan here: ${createUrl(guildId)}`,
        '',
        'Pick a date range and who is coming. I will open a thread for it and nudge everyone to drop the dates they are free.',
        'Once people have filled theirs in we compare and land on a day that works for the group.',
        '',
        `Want to set your availability ahead of time? Do it here any time: ${config.baseUrl}/#/availability`,
        '',
        `Heads up: only people with the <@&${plannerRoleId}> role can kick off a plan.`
    ];
    if (trustedRoleId) {
        lines.push(`People in <@&${trustedRoleId}> can organise more freely and choose to DM everyone.`);
    }
    return lines.join('\n');
}
