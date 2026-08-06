import { describe, it, expect, vi, afterEach } from 'vitest';
import { recallMiss, rememberMiss } from '../../src/lib/remember.js';

/*
    The tests run in node, where there is no localStorage at all, so the default
    here is the browser that has it turned off. Anything wanting a working one stubs
    the map below in.
*/
const withStorage = (start: Record<string, string> = {}) => {
    const store = new Map(Object.entries(start));
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v)
    });
    return store;
};

afterEach(() => vi.unstubAllGlobals());

describe('recallMiss', () => {
    it('hands back what was last put down', () => {
        withStorage();
        rememberMiss('p1', 3);
        expect(recallMiss('p1', 9)).toBe(3);
    });

    //A planner runs several plans at once and each gets its own allowance
    it('keeps one plan out of what another plan answers', () => {
        withStorage();
        rememberMiss('p1', 3);
        rememberMiss('p2', 1);
        expect(recallMiss('p1', 9)).toBe(3);
        expect(recallMiss('p2', 9)).toBe(1);
    });

    //People leaving the plan is what drops the top end between visits
    it('comes back no higher than the plan now allows', () => {
        withStorage();
        rememberMiss('p1', 5);
        expect(recallMiss('p1', 2)).toBe(2);
        expect(recallMiss('p1', 0)).toBe(0);
    });

    it('reads nought from a plan nobody has touched, and from junk', () => {
        withStorage({ 'miss:p2': 'two', 'miss:p3': '-4' });
        expect(recallMiss('p1', 9)).toBe(0);
        expect(recallMiss('p2', 9)).toBe(0);
        expect(recallMiss('p3', 9)).toBe(0);
    });

    it('forgets rather than throwing when there is no storage to read', () => {
        expect(() => rememberMiss('p1', 3)).not.toThrow();
        expect(recallMiss('p1', 9)).toBe(0);
    });
});
