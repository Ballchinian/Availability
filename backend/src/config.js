import 'dotenv/config';

/*
    One place to read the environment. Nothing here is secret on its own, the
    real values live in backend/.env which stays out of git. We keep booting even
    when bits are missing so the scaffold runs before every secret is filled, and
    we just shout about what is absent.
*/

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

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
    sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',

    //Same origin in production, so this is mostly for local dev tooling
    corsOrigin: process.env.CORS_ORIGIN || baseUrl
};

//Lists what is missing so the startup log is honest about it
export function missingConfig() {
    const gaps = [];
    if (!config.mongoUri) gaps.push('MONGODB_URI');
    if (!config.discord.token) gaps.push('DISCORD_BOT_TOKEN');
    if (!config.discord.clientId) gaps.push('DISCORD_CLIENT_ID');
    if (!config.discord.clientSecret) gaps.push('DISCORD_CLIENT_SECRET');
    if (config.sessionSecret === 'dev-secret-change-me') gaps.push('SESSION_SECRET (using insecure default)');
    return gaps;
}
