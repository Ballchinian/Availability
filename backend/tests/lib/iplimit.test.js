import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipLimit } from '../../src/lib/iplimit.js';

const WINDOW = 10 * 60 * 1000;

//Just enough express response to see which way the middleware went
function fakeRes() {
    const res = {
        headers: {},
        statusCode: 200,
        body: null,
        set(name, value) {
            res.headers[name] = value;
            return res;
        },
        status(code) {
            res.statusCode = code;
            return res;
        },
        type() {
            return res;
        },
        send(body) {
            res.body = body;
            return res;
        }
    };
    return res;
}

//Runs one request through and says whether it was let past
function call(limiter, ip) {
    const res = fakeRes();
    let passed = false;
    limiter({ ip }, res, () => {
        passed = true;
    });
    return { passed, res };
}

function build(limit = 3) {
    return ipLimit({ limit, windowMs: WINDOW, message: 'slow down' });
}

describe('ipLimit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-05T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('lets the allowance through and refuses the next one', () => {
        const limiter = build(3);

        expect(call(limiter, '1.1.1.1').passed).toBe(true);
        expect(call(limiter, '1.1.1.1').passed).toBe(true);
        expect(call(limiter, '1.1.1.1').passed).toBe(true);

        const fourth = call(limiter, '1.1.1.1');
        expect(fourth.passed).toBe(false);
        expect(fourth.res.statusCode).toBe(429);
        expect(fourth.res.body).toBe('slow down');
    });

    it('counts each address on its own', () => {
        const limiter = build(1);

        expect(call(limiter, '1.1.1.1').passed).toBe(true);
        expect(call(limiter, '1.1.1.1').passed).toBe(false);
        expect(call(limiter, '2.2.2.2').passed).toBe(true);
    });

    it('frees a slot once the oldest hit ages out', () => {
        const limiter = build(2);

        call(limiter, '1.1.1.1');
        vi.advanceTimersByTime(60000);
        call(limiter, '1.1.1.1');
        expect(call(limiter, '1.1.1.1').passed).toBe(false);

        //Past the first hit's window but not the second's, so exactly one slot is back
        vi.advanceTimersByTime(WINDOW - 60000 + 1);
        expect(call(limiter, '1.1.1.1').passed).toBe(true);
        expect(call(limiter, '1.1.1.1').passed).toBe(false);
    });

    it('says how long until the next slot frees up', () => {
        const limiter = build(1);

        call(limiter, '1.1.1.1');
        vi.advanceTimersByTime(WINDOW - 30000);

        const { res } = call(limiter, '1.1.1.1');
        expect(res.headers['Retry-After']).toBe('30');
    });

    it('keeps counting when there is no address to key on', () => {
        const limiter = build(1);

        expect(call(limiter, undefined).passed).toBe(true);
        expect(call(limiter, undefined).passed).toBe(false);
    });
});
