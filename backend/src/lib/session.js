import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/*
    Sessions are a signed token in an httpOnly cookie, nothing kept server side.
    That keeps the whole thing stateless and easy to run on more than one box if
    it ever needs to scale. The token just carries who they are, signed so it
    cannot be faked without the secret.
*/

const COOKIE = 'sid';
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

//Secure cookies only make sense once we are actually on https
const secure = config.baseUrl.startsWith('https');

export function issueSession(res, user) {
    const token = jwt.sign(
        { uid: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar },
        config.sessionSecret,
        { expiresIn: `${MAX_AGE_DAYS}d` }
    );
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE_MS });
}

export function clearSession(res) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure });
}

//Reads and verifies the cookie, returning the user or null
export function getSessionUser(req) {
    const token = req.cookies?.[COOKIE];
    if (!token) return null;
    try {
        const p = jwt.verify(token, config.sessionSecret);
        return { id: p.uid, username: p.username, displayName: p.displayName, avatar: p.avatar };
    } catch {
        return null;
    }
}

//Gate for routes that need someone logged in
export function requireUser(req, res, next) {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'You need to log in first.' });
    req.user = user;
    next();
}
