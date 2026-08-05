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

export function issueSession(res, user, tokenVersion = 0) {
    const token = jwt.sign(
        { uid: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, tv: tokenVersion },
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
    return { id: p.uid, username: p.username, displayName: p.displayName, avatar: p.avatar };
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

    const current = await getTokenVersion(p.uid);
    if (current !== null && current !== (p.tv || 0)) return null;
    return asUser(p);
}

//Gate for routes that need someone logged in
export async function requireUser(req, res, next) {
    const user = await loadSessionUser(req);
    if (!user) return res.status(401).json({ error: 'You need to log in first.' });
    req.user = user;
    next();
}
