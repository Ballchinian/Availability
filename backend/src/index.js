import { config, missingConfig } from './config.js';
import { connectMongo, closeMongo } from './db/mongo.js';
import { startBot } from './bot/client.js';
import { buildApp } from './api/server.js';

/*
    Boot order: warn about anything missing, bring up the database, log the bot
    in, then start the web server. Each step is best effort so a half configured
    machine still boots far enough to be useful while you fill in the .env.
*/
async function main() {
    const gaps = missingConfig();
    if (gaps.length) {
        console.warn('[boot] missing or default config:', gaps.join(', '));
    }

    try {
        await connectMongo();
    } catch (err) {
        console.error('[boot] mongo failed to connect:', err.message);
    }

    try {
        await startBot();
    } catch (err) {
        console.error('[boot] bot failed to log in:', err.message);
    }

    const app = buildApp();
    const server = app.listen(config.port, () => {
        console.log(`[boot] web server on ${config.baseUrl} (port ${config.port})`);
    });

    //Tidy shutdown so the gateway and mongo do not dangle
    const stop = async () => {
        console.log('\n[boot] shutting down');
        server.close();
        await closeMongo();
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main().catch((err) => {
    console.error('[boot] fatal:', err);
    process.exit(1);
});
