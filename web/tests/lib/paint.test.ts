import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Press, fromKeyboard, SLOP, HOLD_MS } from '../../src/lib/paint.svelte.js';

/*
    A row of ten cells standing in for the calendar's days or the picker's hours.
    The events are bare objects, since these tests have no DOM to dispatch in.
*/
function grid(start: number[] = []) {
    const on = new Set(start);
    const press = new Press<number>({
        isOn: (k) => on.has(k),
        set: (k, v) => (v ? on.add(k) : on.delete(k)),
        between: (a, b) => {
            const keys = [];
            for (let k = Math.min(a, b); k <= Math.max(a, b); k++) keys.push(k);
            return keys;
        }
    });
    const lit = () => [...on].sort((a, b) => a - b);
    return { press, lit };
}

function ev(fields: Partial<PointerEvent> = {}) {
    return {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 100,
        clientY: 100,
        shiftKey: false,
        currentTarget: null,
        preventDefault: () => {},
        ...fields
    } as unknown as PointerEvent;
}
const finger = (fields: Partial<PointerEvent> = {}) => ev({ pointerType: 'touch', pointerId: 7, ...fields });

describe('a mouse press', () => {
    it('paints the day it lands on straight away', () => {
        const { press, lit } = grid();
        press.down(3, ev());
        expect(lit()).toEqual([3]);
        expect(press.phase).toBe('painting');
    });

    it('paints every day dragged across, then stops on release', () => {
        const { press, lit } = grid();
        press.down(3, ev());
        press.enter(4);
        press.enter(5);
        press.up(ev());
        press.enter(6);
        expect(lit()).toEqual([3, 4, 5]);
        expect(press.phase).toBe('idle');
    });

    it('clears when it starts on a day already marked', () => {
        const { press, lit } = grid([3, 4, 5]);
        press.down(3, ev());
        press.enter(4);
        expect(lit()).toEqual([5]);
    });

    it('leaves a right click alone', () => {
        const { press, lit } = grid();
        press.down(3, ev({ button: 2 }));
        expect(lit()).toEqual([]);
        expect(press.phase).toBe('idle');
    });

    it('paints from the last day pressed on shift', () => {
        const { press, lit } = grid();
        press.down(2, ev());
        press.up(ev());
        press.down(5, ev({ shiftKey: true }));
        expect(lit()).toEqual([2, 3, 4, 5]);
    });
});

describe('a finger', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('marks nothing as it lands', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        expect(lit()).toEqual([]);
        expect(press.phase).toBe('waiting');
    });

    it('toggles the one day on a quick tap, when it lifts', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        press.up(finger());
        expect(lit()).toEqual([3]);
        expect(press.phase).toBe('idle');
    });

    it('marks nothing when it swipes up the grid to scroll', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        press.move(finger({ clientY: 100 - SLOP - 5 }));
        press.enter(10);
        press.up(finger());
        expect(lit()).toEqual([]);
    });

    it('marks nothing when the browser takes it to scroll', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        press.cancel(finger());
        vi.advanceTimersByTime(HOLD_MS * 2);
        press.up(finger());
        expect(lit()).toEqual([]);
    });

    it('paints once it moves sideways', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        press.move(finger({ clientX: 100 + SLOP / 2 }));
        expect(lit()).toEqual([]);
        press.move(finger({ clientX: 100 + SLOP + 1 }));
        press.enter(5);
        expect(lit()).toEqual([3, 5]);
    });

    //Pressed near an edge, the next day can be under it before it has moved far enough to count
    it('paints the day it drifted onto before it started', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        press.enter(4);
        press.move(finger({ clientX: 100 + SLOP + 1 }));
        expect(lit()).toEqual([3, 4]);
    });

    it('paints once it has held still, and then goes any way', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        vi.advanceTimersByTime(HOLD_MS - 1);
        expect(lit()).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(press.phase).toBe('painting');
        press.move(finger({ clientY: 300 }));
        press.enter(10);
        expect(lit()).toEqual([3, 10]);
    });

    it('does not toggle again on lifting after a hold', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        vi.advanceTimersByTime(HOLD_MS);
        press.up(finger());
        expect(lit()).toEqual([3]);
    });

    it('ignores a second finger', () => {
        const { press, lit } = grid();
        press.down(3, finger());
        press.down(6, finger({ pointerId: 8 }));
        press.up(finger({ pointerId: 8 }));
        expect(lit()).toEqual([]);
        expect(press.phase).toBe('waiting');
    });
});

describe('the keyboard', () => {
    it('toggles one day at a time', () => {
        const { press, lit } = grid([4]);
        press.key(3, false);
        press.key(4, false);
        expect(lit()).toEqual([3]);
    });

    it('takes a run from the last day with shift', () => {
        const { press, lit } = grid();
        press.key(6, false);
        press.key(3, true);
        expect(lit()).toEqual([3, 4, 5, 6]);
    });

    it('is told apart from a tap by the click it makes', () => {
        expect(fromKeyboard({ detail: 0 } as MouseEvent)).toBe(true);
        expect(fromKeyboard({ detail: 1 } as MouseEvent)).toBe(false);
        expect(fromKeyboard({ detail: 0, pointerType: 'touch' } as unknown as MouseEvent)).toBe(false);
    });
});
