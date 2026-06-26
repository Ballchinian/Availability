import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { config } from '../config.js';
import { isMongoReady } from '../db/mongo.js';
import authRouter from './routes/auth.js';
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

    app.use(cors({ origin: config.corsOrigin, credentials: true }));
    app.use(express.json());
    app.use(cookieParser());

    //Quick liveness check, also tells us if the database came up
    app.get('/api/health', (req, res) => {
        res.json({ ok: true, mongo: isMongoReady() });
    });

    app.use('/api/auth', authRouter);
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

    return app;
}
