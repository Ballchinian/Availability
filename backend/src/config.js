import 'dotenv/config';

/*
    One place to read the environment. Nothing here is secret on its own, the
    real values live in backend/.env which stays out of git. We keep booting even
    when bits are missing so the scaffold runs before every secret is filled, and
    we just shout about what is absent.
*/

/*
    The domain people actually visit, which live is the Netlify one and not the
    Railway service behind it. Every link the bot posts is built from this, and
    the session cookie only sets its secure flag when it starts https, so pointing
    it at Railway hands out links to the wrong host while everything else keeps
    working and looking fine.
*/
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

//Named so the boot check can tell "they left it alone" apart from a real value
const DEFAULT_SESSION_SECRET = 'dev-secret-change-me';

export const config = {
    port: Number(process.env.PORT) || 3000,
    baseUrl,

    mongoUri: process.env.MONGODB_URI || '',
    mongoDb: process.env.MONGODB_DB || 'availability',

    discord: {
        token: process.env.DISCORD_BOT_TOKEN || '',
        clientId: process.env.DISCORD_CLIENT_ID || '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
        //Where Discord sends people back after they log in
        redirectUri: process.env.DISCORD_OAUTH_REDIRECT || `${baseUrl}/api/auth/callback`,
        /*
            Set this to a test server id while developing. Slash commands
            registered to one guild show up instantly, global ones can take up to
            an hour. Leave it blank in production to register globally.
        */
        devGuildId: process.env.DISCORD_DEV_GUILD_ID || ''
    },

    //Signs the session cookie. Set a long random value in production.
    sessionSecret: process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET,

    //Same origin in production, so this is mostly for local dev tooling
    corsOrigin: process.env.CORS_ORIGIN || baseUrl,

    /*
        How many proxies sit in front of this process. Express counts back that
        many hops through X-Forwarded-For to work out who is really calling, which
        is what the login limiter counts against. Two is the live setup: Netlify
        holds the domain and forwards /api to Railway, which forwards to here. Too
        low and everyone behind the proxy shares one allowance; too high and the
        header can be dressed up to look like a fresh caller each time.
    */
    trustProxy: Number(process.env.TRUST_PROXY ?? 2)
};

//Lists what is missing so the startup log is honest about it
export function missingConfig() {
    const gaps = [];
    if (!config.mongoUri) gaps.push('MONGODB_URI');
    if (!config.discord.token) gaps.push('DISCORD_BOT_TOKEN');
    if (!config.discord.clientId) gaps.push('DISCORD_CLIENT_ID');
    if (!config.discord.clientSecret) gaps.push('DISCORD_CLIENT_SECRET');
    if (config.sessionSecret === DEFAULT_SESSION_SECRET) gaps.push('SESSION_SECRET (using insecure default)');
    return gaps;
}

/*
    The gaps that must not reach production, both of them cases where carrying on
    means a door left open in a log nobody reads. Anyone can sign a session cookie
    with a secret that is published in this file, and a BASE_URL that is not https
    means the cookie goes out without its secure flag, so the browser will send a
    live session over plain http. Returns what to say, or null when there is
    nothing to stop for.
*/
export function fatalConfig() {
    if (process.env.NODE_ENV !== 'production') return null;
    if (config.sessionSecret === DEFAULT_SESSION_SECRET) {
        return 'SESSION_SECRET is still the built in default, which anyone could forge a login with. Set a long random value.';
    }
    if (!baseUrl.startsWith('https://')) {
        return `BASE_URL is ${baseUrl}, which is not https, so sessions would travel unprotected and the bot would post links there. Set it to the public https domain.`;
    }
    return null;
}
