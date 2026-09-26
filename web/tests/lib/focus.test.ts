import { describe, it, expect, vi, afterEach } from 'vitest';
import { refocus } from '../../src/lib/focus.js';

//Just enough of a page to lose focus on, since these tests run with no DOM
const body = { tagName: 'BODY' };
const page = (active: unknown) => vi.stubGlobal('document', { body, activeElement: active });
const element = (tabIndex: number, disabled = false) =>
    ({
        tabIndex,
        isConnected: true,
        hasAttribute: () => false,
        matches: (selector: string) => selector === ':disabled' && disabled,
        focus: vi.fn()
    }) as unknown as HTMLElement & { focus: ReturnType<typeof vi.fn> };

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('refocus', () => {
    it('sends focus on when the control that had it has gone', async () => {
        page(body);
        const next = element(0);
        await refocus(() => next);
        expect(next.focus).toHaveBeenCalled();
    });

    it('leaves focus alone while something still has it', async () => {
        page(element(0));
        const next = element(0);
        await refocus(() => next);
        expect(next.focus).not.toHaveBeenCalled();
    });

    //Add all goes disabled once everyone is added, and Chrome only lets go of it a frame later
    it('counts a control gone disabled as having lost focus', async () => {
        page(element(0, true));
        const next = element(0);
        await refocus(() => next);
        expect(next.focus).toHaveBeenCalled();
    });

    //A result line is not a control, so it is focusable from here and from nowhere else
    it('lets a line of text take focus without putting it in the tab order', async () => {
        page(body);
        const line = element(-1);
        await refocus(() => line);
        expect(line.tabIndex).toBe(-1);
        expect(line.focus).toHaveBeenCalled();
    });

    it('does nothing when there is nowhere to go', async () => {
        page(body);
        await expect(refocus(() => null)).resolves.toBeUndefined();
    });
});
