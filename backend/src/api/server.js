import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { config } from '../config.js';
import { isMongoReady } from '../db/mongo.js';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import guildsRouter from './routes/guilds.js';
import plansRouter from './routes/plans.js';
import availabilityRouter from './routes/availability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

//The built svelte app, which this service hands out in production
const webDist = join(__dirname, '..', '..', '..', 'web', 'dist');

/*
    Builds the express app. Same origin as the frontend in production, so cors is
    really just here for local dev where vite runs on its own port. Routers for
    plans and availability slot in over the next couple of phases.
*/
export function buildApp() {
    const app = express();

    //Only meaningful behind a proxy, and what the login limiter reads req.ip through
    app.set('trust proxy', config.trustProxy);

    /*
        Helmet's defaults, with one hole for Discord's CDN: every avatar and server
        icon on the site is an <img> straight off it, and the default policy allows
        images from here and data urls only.
    */
    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: { 'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com'] }
            }
        })
    );

    app.use(cors({ origin: config.corsOrigin, credentials: true }));
    app.use(express.json());
    app.use(cookieParser());

    //Quick liveness check, also tells us if the database came up
    app.get('/api/health', (req, res) => {
        res.json({ ok: true, mongo: isMongoReady() });
    });

    app.use('/api/auth', authRouter);
    app.use('/api/me', meRouter);
    app.use('/api/guilds', guildsRouter);
    app.use('/api/plans', plansRouter);
    app.use('/api/availability', availabilityRouter);

    //Serve the built site if it is there, otherwise the api runs on its own
    if (existsSync(webDist)) {
        app.use(express.static(webDist));

        /*
            Single page app fallback. Anything that is not an api route and was
            not a real file gets index.html so client side routing can take over.
        */
        app.get(/^(?!\/api\/).*/, (req, res) => {
            res.sendFile(join(webDist, 'index.html'));
        });
    } else {
        app.get('/', (req, res) => {
            res.type('text').send('api is up. build the web app (cd web && npm run build) to serve the site here.');
        });
    }

    //An api path that matches nothing gets json too, since the spa fallback deliberately skips /api
    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'No such endpoint.' });
    });

    /*
        Last in the chain, and the four arguments are what mark it as the error
        handler. Express 5 forwards a rejected async handler here; without it the
        default handler replies with an html stack page, the site's api() sees a
        non-json body and shows a bare "Internal Server Error" instead.
    */
    app.use((err, req, res, next) => {
        console.error(`[api] ${req.method} ${req.originalUrl} threw:`, err);
        if (res.headersSent) return next(err);
        res.status(err.status || 500).json({ error: 'Something went wrong at our end. Try that again in a moment.' });
    });

    return app;
}
