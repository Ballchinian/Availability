import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { isMongoReady } from '../db/mongo.js';
import { getTokenVersion } from '../db/users.js';

/*
    Sessions are a signed token in an httpOnly cookie, nothing kept server side.
    That keeps the whole thing stateless and easy to run on more than one box if
    it ever needs to scale. The token just carries who they are, signed so it
    cannot be faked without the secret.

    The one thing that costs is revocation: a cookie cannot be recalled. So the
    token carries the tokenVersion it was signed under and every request compares
    that against the user record, which logout bumps. One indexed lookup per
    request buys a logout that actually ends the session.
*/

const COOKIE = 'sid';
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

//Secure cookies only make sense once we are actually on https
const secure = config.baseUrl.startsWith('https');

/*
    real is set while a planner views the site as one of their made-up people: user is
    that person, real is the planner, and tokenVersion is the planner's, so their logout
    ends this too.
*/
export function issueSession(res, user, tokenVersion = 0, real = null) {
    const token = jwt.sign(
        { uid: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, tv: tokenVersion, ...(real ? { real } : {}) },
        config.sessionSecret,
        { expiresIn: `${MAX_AGE_DAYS}d` }
    );
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE_MS });
}

export function clearSession(res) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure });
}

function readToken(req) {
    const token = req.cookies?.[COOKIE];
    if (!token) return null;
    try {
        return jwt.verify(token, config.sessionSecret);
    } catch {
        return null;
    }
}

//tokenVersion stays out of this: it is a detail of the check, not part of who they are
function asUser(p) {
    return { id: p.uid, username: p.username, displayName: p.displayName, avatar: p.avatar, ...(p.real ? { real: p.real } : {}) };
}

/*
    Reads and verifies the cookie, returning the user or null. Signature only, so
    a session someone has since logged out of still passes. Only for the spot that
    needs the id before the database is worth asking: logout itself, which is
    about to bump the number anyway.
*/
export function getSessionUser(req) {
    const p = readToken(req);
    return p ? asUser(p) : null;
}

/*
    The same, plus the revocation check. Two ways to pass without matching a
    number: no database, where there is nothing to compare against and every route
    worth guarding is dead regardless, so throwing everyone out would only add a
    second fault; and no user record, since cleanup deletes people who share no
    server with the bot and being logged out for that would read as a bug.
*/
export async function loadSessionUser(req) {
    const p = readToken(req);
    if (!p) return null;
    if (!isMongoReady()) return asUser(p);

    const current = await getTokenVersion(p.real?.id ?? p.uid);
    if (current !== null && current !== (p.tv || 0)) return null;
    return asUser(p);
}

/*
    The session as the routes take it: who it is for, and who is really there, the same
    person unless a planner is viewing as someone made up. That has to stop the moment
    they could not start it again, and ended says why. The person is then the planner,
    for the caller to sign back in as. Loaded only for a practice session, since it
    reaches for Discord.
*/
export async function loadSession(req) {
    const found = await loadSessionUser(req);
    if (!found) return null;
    const { real, ...user } = found;
    const tv = readToken(req).tv || 0;
    if (!real) return { user, real: user, tv, ended: null };

    const { practiceEnded } = await import('../api/practising.js');
    const ended = await practiceEnded(user.id, real.id);
    return ended ? { user: real, real, tv, ended } : { user, real, tv, ended: null };
}

/*
    Gate for routes that need someone logged in. A practice session that has had to end
    is refused rather than carried on as the planner, since whatever it was about to do
    was meant for somebody else.
*/
export async function requireUser(req, res, next) {
    const session = await loadSession(req);
    if (!session) return res.status(401).json({ error: 'You need to log in first.' });
    if (session.ended) {
        issueSession(res, session.real, session.tv);
        return res.status(401).json({ error: session.ended, practiceEnded: true });
    }
    req.user = session.user;
    req.realUser = session.real;
    next();
}
