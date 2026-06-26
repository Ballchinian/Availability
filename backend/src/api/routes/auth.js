import { Router } from 'express';
import crypto from 'crypto';
import { config } from '../../config.js';
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from '../../lib/discordOauth.js';
import { issueSession, clearSession, getSessionUser } from '../../lib/session.js';
import { upsertUser, setUserGuilds } from '../../db/users.js';
import { computeUserGuilds } from '../../bot/cleanup.js';

/*
    The login routes. /login bounces the person to Discord, /callback is where
    Discord sends them back with a code we trade for their identity. We guard the
    round trip with a state value tied to a short lived cookie so someone cannot
    forge the callback.
*/

const router = Router();

const STATE_COOKIE = 'oauth_state';
const stateSecure = config.baseUrl.startsWith('https');

//Pack the random nonce and where to land afterwards into the state value
function makeState(returnTo) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = Buffer.from(JSON.stringify({ n: nonce, r: returnTo })).toString('base64url');
    return { nonce, state };
}

function parseState(state) {
    try {
        return JSON.parse(Buffer.from(String(state), 'base64url').toString());
    } catch {
        return null;
    }
}

//Only ever send people back to a local path, never an arbitrary url
function safePath(p) {
    return typeof p === 'string' && p.startsWith('/') ? p : '/';
}

router.get('/login', (req, res) => {
    const returnTo = safePath(req.query.returnTo);
    const { nonce, state } = makeState(returnTo);
    res.cookie(STATE_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', secure: stateSecure, maxAge: 10 * 60 * 1000 });
    res.redirect(buildAuthorizeUrl(state));
});

router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const parsed = parseState(state);
    const cookieNonce = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { httpOnly: true, sameSite: 'lax', secure: stateSecure });

    if (!code || !parsed || !cookieNonce || parsed.n !== cookieNonce) {
        return res.status(400).send('Login did not go through. Head back and try again.');
    }

    try {
        const tokens = await exchangeCode(code);
        const user = await fetchDiscordUser(tokens.access_token);

        //Cache their profile, but do not fail the login if the database hiccups
        try {
            await upsertUser(user);
            await setUserGuilds(user.id, await computeUserGuilds(user.id));
        } catch (err) {
            console.warn('[auth] could not save user:', err.message);
        }

        issueSession(res, user);
        res.redirect(`${config.baseUrl}/#${safePath(parsed.r)}`);
    } catch (err) {
        console.error('[auth] callback failed:', err);
        res.status(500).send('Login did not go through. Head back and try again.');
    }
});

router.post('/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
});

//Who is logged in right now, or null
router.get('/me', (req, res) => {
    res.json({ user: getSessionUser(req) });
});

export default router;
