import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    The real users.js and session.js over a users collection held in a Map, enough of
    one to run the updates these use: $inc, and a pipeline of one $replaceWith.
*/

const rows = vi.hoisted(() => new Map());

vi.mock('../../src/db/mongo.js', () => {
    const read = (doc, expr) => {
        if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)];
        if (expr && '$ifNull' in expr) return read(doc, expr.$ifNull[0]) ?? read(doc, expr.$ifNull[1]);
        return expr;
    };
    return {
        isMongoReady: () => true,
        collections: { users: 'users' },
        col: () => ({
            findOne: async ({ userId }) => (rows.has(userId) ? { ...rows.get(userId) } : null),
            updateOne: async ({ userId }, update) => {
                const doc = rows.get(userId);
                if (!doc) return;
                if (Array.isArray(update)) {
                    const shape = update[0].$replaceWith;
                    rows.set(userId, Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, read(doc, v)])));
                } else {
                    for (const [k, by] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + by;
                }
            }
        })
    };
});

const { revokeSessions, forgetUser } = await import('../../src/db/users.js');
const { issueSession, loadSessionUser } = await import('../../src/lib/session.js');

function signedIn(tokenVersion) {
    let token = null;
    issueSession({ cookie: (_name, value) => (token = value) }, { id: '1', username: 'bo', displayName: 'Bo', avatar: null }, tokenVersion);
    return { cookies: { sid: token } };
}

beforeEach(() => {
    rows.clear();
    rows.set('1', { userId: '1', username: 'bo', guilds: [], timeZone: 'Europe/London', tokenVersion: 0 });
});

describe('forgetting someone', () => {
    it('keeps only who they are and their session version', async () => {
        await revokeSessions('1');
        await forgetUser('1');
        expect(rows.get('1')).toEqual({ userId: '1', tokenVersion: 1 });
    });

    it('leaves a logged out session logged out', async () => {
        const old = signedIn(0);
        await revokeSessions('1');
        await forgetUser('1');
        expect(await loadSessionUser(old)).toBe(null);
    });

    it('does not end a session that was never logged out', async () => {
        const current = signedIn(0);
        await forgetUser('1');
        expect(await loadSessionUser(current)).toMatchObject({ id: '1' });
    });

    it('reads a record from before versions as version 0', async () => {
        rows.set('1', { userId: '1', username: 'bo' });
        await forgetUser('1');
        expect(rows.get('1')).toEqual({ userId: '1', tokenVersion: 0 });
    });
});
