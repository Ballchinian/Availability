import { Client, GatewayIntentBits } from 'discord.js';
import { config } from '../config.js';
import { attachEvents } from './events.js';

/*
    the gateway client. it stays connected the whole time the service is up,
    which is why we need an always-on host. GuildMembers is a privileged intent
    and powers the member picker on the site, so it has to be switched on in the
    discord dev portal too. We only need Guilds and GuildMembers: the bot never
    reads messages, and the DMs and button clicks it does handle arrive over the
    interaction gateway, which no message intent gates.
*/

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

let started = false;

export async function startBot() {
    if (!config.discord.token) {
        console.warn('[bot] no DISCORD_BOT_TOKEN set, running the api without the bot');
        return null;
    }
    if (started) return client;

    //Hook up the gateway events before logging in so we do not miss the ready
    attachEvents(client);

    await client.login(config.discord.token);
    started = true;
    return client;
}
