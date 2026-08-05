import { describe, it, expect } from 'vitest';
import { clocksAgree, describeZone } from '../../src/lib/zone.js';

/*
    The maths itself is tested against shared/zones.js from the backend, which is the
    same file. What matters here is that the site's import path reaches it and that the
    one thing written on this side reads properly.
*/

describe('clocksAgree', () => {
    //What decides whether a page bothers mentioning a clock at all
    it('compares the offset on the day rather than the name', () => {
        expect(clocksAgree('Europe/London', 'UTC', new Date('2026-01-12T12:00:00Z'))).toBe(true);
        expect(clocksAgree('Europe/London', 'UTC', new Date('2026-08-12T12:00:00Z'))).toBe(false);
        expect(clocksAgree('Europe/London', 'Europe/Paris', new Date('2026-08-12T12:00:00Z'))).toBe(false);
    });
});

describe('describeZone', () => {
    it('names the clock and what it reads', () => {
        expect(describeZone('Asia/Tokyo')).toBe('Asia/Tokyo (GMT+9)');
    });

    it('says nothing about a zone nobody set', () => {
        expect(describeZone('')).toBe('');
    });
});
