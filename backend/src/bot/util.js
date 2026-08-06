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

//The plan's thread back in Discord, the way out of the site and into the conversation
export function threadUrl(guildId, threadId) {
    return `https://discord.com/channels/${guildId}/${threadId}`;
}

//The set day as a calendar file. An api path rather than a site one, since what comes
//back is a download and not a page.
export function icsUrl(planId) {
    return `${config.baseUrl}/api/plans/${planId}/calendar.ics`;
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
    Which role setup should offer to keep, and whether it is the one this server is
    already running on.

    The saved id comes first because it is the only thing that knows the answer: a
    planner role can be named anything, findPlannerRole goes by the name alone, so on
    a server whose role is called something else it would offer an unrelated role
    named "planner" and quietly hand planning to whoever happens to hold it.

    Falls back to the name for a server being set up for the first time, and answers
    with nothing when the saved role has been deleted since.
*/
export function plannerRoleFor(guild, prev) {
    const saved = prev?.plannerRoleId ? guild.roles.cache.get(prev.plannerRoleId) : null;
    if (saved) return { role: saved, saved: true };
    return { role: findPlannerRole(guild), saved: false };
}

/*
    A name no role here has taken yet. Setup used to pick between two names and stop,
    so a server that made a fresh role twice ended up with two roles called "Plan
    Master" and nothing in the role list to tell them apart by.
*/
export function freeRoleName(guild) {
    const taken = new Set(guild.roles.cache.map((r) => r.name.toLowerCase()));
    if (!taken.has('planner')) return 'planner';
    //Discord caps a server at 250 roles, so a free name is always inside that many tries
    for (let n = 1; n <= 250; n++) {
        const name = n === 1 ? 'Plan Master' : `Plan Master ${n}`;
        if (!taken.has(name.toLowerCase())) return name;
    }
    return 'Plan Master';
}

//Discord rejects a button label past 80 characters, and a role name is allowed 100
export function buttonLabel(text) {
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
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
    Puts the intro where it goes on setup, and says whether the channel is new.

    A server being set up a second time keeps the channel it already has. Plan
    threads live under that channel and a deleted plan thread clears its plan for
    good, so making a fresh one used to take every live plan on the server with it.
    Nothing here deletes a channel: the worst case is an intro posted twice.

    The intro itself is edited where it sits rather than posted again, so a rerun
    brings the pinned message up to date instead of leaving a stale copy above a new
    one.
*/
export async function placeIntro(guild, prev, body) {
    const channel = prev?.infoChannelId ? await guild.channels.fetch(prev.infoChannelId).catch(() => null) : null;

    //Only tidied when there is no channel, since an older setup kept the intro in a thread instead of one
    if (!channel && prev?.introThreadId) {
        const thread = await guild.channels.fetch(prev.introThreadId).catch(() => null);
        if (thread) await thread.delete().catch(() => {});
    }

    if (!channel) {
        const made = await createInfoChannel(guild);
        return { channel: made, intro: await made.send(body), madeChannel: true };
    }

    if (prev?.introMessageId) {
        const old = await channel.messages.fetch(prev.introMessageId).catch(() => null);
        //An intro somebody deleted by hand falls through to a fresh one in the same channel
        if (old) {
            const edited = await old.edit(body).catch(() => null);
            if (edited) return { channel, intro: edited, madeChannel: false };
        }
    }

    return { channel, intro: await channel.send(body), madeChannel: false };
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
        'Not one for clicking links? Run `/free` in a plan thread and tick your days right here instead.',
        'Lost the DM with your link in it? `/mylink` lists the plans you are in here and hands them all back.',
        "Once everyone has filled theirs in I will DM whoever started the plan. To find a day that works for the group, run `/compare` in that plan's thread, any time, even before everyone is in. `/cancel` in the same place calls the plan off, and asks before it does.",
        '',
        `Want to set your availability ahead of time? Do it here any time: ${config.baseUrl}/#/availability`,
        'Or run `/myavailability` anywhere in the server and I will hand you that link.',
        '',
        `Heads up: only people with the <@&${plannerRoleId}> role can start, confirm, change the dates, cancel or send reminders for a plan. Everyone gets a DM when one of those happens.`,
        'When a plan is confirmed or cancelled its thread stays put until someone deletes it by hand, and deleting a plan thread clears the plan for good.'
    ].join('\n');
}
