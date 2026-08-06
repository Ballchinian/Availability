import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError, errorText, isAuthError } from '../../src/lib/api.js';

/*
    What a caller can tell from a failure, which is the whole point of the status
    riding along: a quiet refetch stays quiet for most of them and has to speak up
    for the two that mean the page is stale.
*/

const reply = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', async () => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: 'Whatever',
        headers: { get: () => 'application/json' },
        json: async () => body
    }));

afterEach(() => vi.unstubAllGlobals());

describe('isAuthError', () => {
    it('is the logged out and the not allowed', () => {
        expect(isAuthError(new ApiError('gone', 401))).toBe(true);
        expect(isAuthError(new ApiError('not yours', 403))).toBe(true);
    });

    it('is nothing else, including the ones that read like a refusal', () => {
        for (const status of [400, 404, 409, 429, 500]) {
            expect(isAuthError(new ApiError('no', status))).toBe(false);
        }
    });

    //Anything can land in a catch, so it has to cope with what never came from here
    it('is not fooled by a plain error or a thrown string', () => {
        expect(isAuthError(new Error('gone'))).toBe(false);
        expect(isAuthError('401')).toBe(false);
        expect(isAuthError(null)).toBe(false);
    });
});

describe('api', () => {
    it('throws the status alongside the message the server sent', async () => {
        reply(403, { error: 'You need the planner role.' });
        const err = (await api('/plans/x/compare').catch((e) => e)) as ApiError;
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(403);
        expect(err.message).toBe('You need the planner role.');
        expect(isAuthError(err)).toBe(true);
    });

    //Screens render whatever is thrown, so it still has to read as an ordinary error
    it('stays something errorText can read', async () => {
        reply(429, { error: 'You have saved 200 times today.' });
        const err = await api('/availability', { method: 'POST' }).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(errorText(err)).toBe('You have saved 200 times today.');
        expect(isAuthError(err)).toBe(false);
    });

    it('hands the body back when it worked', async () => {
        reply(200, { ok: true });
        expect(await api('/me')).toEqual({ ok: true });
    });
});
