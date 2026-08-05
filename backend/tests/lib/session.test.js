import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    The database is the only thing session.js reaches for, and only to answer one
    question, so it stands in as two values here. Hoisted because vi.mock runs
    before the imports below it.
*/
const db = vi.hoisted(() => ({ ready: true, storedVersion: 0 }));

vi.mock('../../src/db/mongo.js', () => ({
    isMongoReady: () => db.ready
}));

vi.mock('../../src/db/users.js', () => ({
    getTokenVersion: async () => db.storedVersion
}));

const { issueSession, loadSessionUser, requireUser } = await import('../../src/lib/session.js');

const person = { id: '1', username: 'ethan', displayName: 'Ethan', avatar: 'a.png' };

//Mints a real cookie the way a login would, and hands back a request carrying it
function signedInAs(user, tokenVersion) {
    let token = null;
    issueSession({ cookie: (_name, value) => (token = value) }, user, tokenVersion);
    return { cookies: { sid: token } };
}

function fakeRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(body) {
            res.body = body;
            return res;
        }
    };
    return res;
}

describe('loadSessionUser', () => {
    beforeEach(() => {
        db.ready = true;
        db.storedVersion = 0;
    });

    it('reads the person out of a cookie signed with the current version', async () => {
        const user = await loadSessionUser(signedInAs(person, 0));
        expect(user).toEqual(person);
    });

    it('refuses a token from before a logout', async () => {
        const req = signedInAs(person, 0);
        db.storedVersion = 1;
        expect(await loadSessionUser(req)).toBe(null);
    });

    it('has nothing to say about a request with no cookie', async () => {
        expect(await loadSessionUser({ cookies: {} })).toBe(null);
    });

    it('refuses a cookie that was not signed by us', async () => {
        expect(await loadSessionUser({ cookies: { sid: 'not.a.token' } })).toBe(null);
    });

    it('stands the token up when the database is down', async () => {
        const req = signedInAs(person, 0);
        db.ready = false;
        db.storedVersion = 9;
        expect(await loadSessionUser(req)).toEqual(person);
    });

    it('stands the token up when the person has no record left', async () => {
        const req = signedInAs(person, 3);
        db.storedVersion = null;
        expect(await loadSessionUser(req)).toEqual(person);
    });

    it('treats a token from before revocation existed as version zero', async () => {
        const req = signedInAs(person, undefined);
        expect(await loadSessionUser(req)).toEqual(person);

        db.storedVersion = 1;
        expect(await loadSessionUser(req)).toBe(null);
    });
});

describe('requireUser', () => {
    beforeEach(() => {
        db.ready = true;
        db.storedVersion = 0;
    });

    it('hangs the person off the request and carries on', async () => {
        const req = signedInAs(person, 0);
        let passed = false;
        await requireUser(req, fakeRes(), () => (passed = true));

        expect(passed).toBe(true);
        expect(req.user).toEqual(person);
    });

    it('answers 401 once the session has been revoked', async () => {
        const req = signedInAs(person, 0);
        db.storedVersion = 1;

        const res = fakeRes();
        let passed = false;
        await requireUser(req, res, () => (passed = true));

        expect(passed).toBe(false);
        expect(res.statusCode).toBe(401);
    });
});
