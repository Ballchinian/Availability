import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config.js';
import { attachEvents } from './events.js';

/*
    the gateway client. it stays connected the whole time the service is up,
    which is why we need an always-on host. GuildMembers is a privileged intent
    and powers the member picker on the site, so it has to be switched on in the
    discord dev portal too. event and command wiring gets bolted on in phase 1.
*/

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ],
    //Needed so we can act on dm channels the bot has not cached yet
    partials: [Partials.Channel]
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
