import { config, missingConfig, fatalConfig } from './config.js';
import { connectMongo, closeMongo, retryMongo } from './db/mongo.js';
import { client, startBot } from './bot/client.js';
import { buildApp } from './api/server.js';

/*
    Boot order: warn about anything missing, bring up the database, log the bot
    in, then start the web server. Each step is best effort so a half configured
    machine still boots far enough to be useful while you fill in the .env. The
    one exception is fatalConfig, which stops the process outright.
*/
async function main() {
    const gaps = missingConfig();
    if (gaps.length) {
        console.warn('[boot] missing or default config:', gaps.join(', '));
    }

    //Best effort stops here: some gaps are worse in production than not running at all
    const fatal = fatalConfig();
    if (fatal) {
        console.error('[boot] refusing to start:', fatal);
        process.exit(1);
    }

    try {
        await connectMongo();
    } catch (err) {
        console.error('[boot] mongo failed to connect:', err.message);
        //Keeps trying behind the boot, so a blip right now is a blip and not a dead service
        retryMongo();
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
    let stopping = false;
    const stop = async () => {
        //A second ctrl-c while the first is still working would run all of this twice
        if (stopping) return;
        stopping = true;
        console.log('\n[boot] shutting down');

        await new Promise((resolve) => {
            server.close(resolve);
            //Idle keep-alive sockets would otherwise hold the close open until they time out
            server.closeIdleConnections();
        });
        await client.destroy().catch((err) => console.error('[boot] discord client would not close:', err.message));
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
