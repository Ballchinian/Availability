import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';

/*
    Everything the bot needs to do its job in a server, kept in one place so the
    invite link and any permission checks never drift apart. Pin Messages is its
    own permission now that Discord split it out from Manage Messages, so it has
    to be listed on its own or pinning quietly fails. Manage Channels is here so
    setup can make (and a later setup remake) the read-only plan-bot-info channel.
    We deliberately do not ask for Mention Everyone: the bot only ever pings named
    people in a thread, which needs no special permission, so leaving it off
    shrinks what an admin grants. Manage Messages is left off too, the bot only
    deletes its own intro messages and whole threads, neither of which needs it.
*/
export const requiredPermissions = new PermissionsBitField([
    P.ViewChannel,
    P.SendMessages,
    P.SendMessagesInThreads,
    P.CreatePublicThreads,
    P.CreatePrivateThreads,
    P.ManageThreads,
    P.ManageChannels,
    P.PinMessages,
    P.ManageRoles,
    P.ReadMessageHistory,
    P.EmbedLinks
]);

//The link an admin uses to add the bot, carrying exactly the permissions above
export function inviteUrl(clientId) {
    return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${requiredPermissions.bitfield}&scope=bot%20applications.commands`;
}
