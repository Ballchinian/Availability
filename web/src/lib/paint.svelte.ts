/*
    One press on a grid of on/off cells, the calendar's days or the picker's hours.
    Mouse and pen paint the moment they go down. A finger has to show it means it
    first, by moving sideways or holding still, because a finger going up or down
    is someone scrolling past. A finger that lifts before either is a tap, and
    flips the one cell it landed on.

    Nothing a press paints is kept until the pointer lifts. The browser taking the
    pointer, or Escape, puts the cells back how the press found them.
*/
export const SLOP = 10;
export const HOLD_MS = 300;

export interface Cells<K, S> {
    isOn(key: K): boolean;
    //Cells that cannot be marked ignore this
    set(key: K, on: boolean): void;
    //Every key from one to the other, both ends included, given in either order
    between(a: K, b: K): K[];
    save(): S;
    restore(saved: S): void;
}

export class Press<K, S> {
    phase = $state<'idle' | 'waiting' | 'painting'>('idle');
    //The last cell pressed, the far end a shift-click paints back to
    anchor: K | null = null;

    #cells: Cells<K, S>;
    #saved: S | undefined;
    #on = true;
    #pointer = -1;
    #first: K | null = null;
    //Where a waiting finger has drifted to, painted along with the first cell once it starts
    #over: K | null = null;
    #x = 0;
    #y = 0;
    #timer: ReturnType<typeof setTimeout> | undefined;

    constructor(cells: Cells<K, S>) {
        this.#cells = cells;
    }

    down(key: K, e: PointerEvent) {
        if (this.phase !== 'idle' || e.button !== 0) return;
        e.preventDefault();
        //Mouse has no implicit capture, but release it for pen and touch so the
        //drag can cross into neighbouring cells
        try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
            //Fine, nothing to release
        }
        this.#pointer = e.pointerId;
        this.#saved = this.#cells.save();
        if (e.shiftKey && this.anchor !== null) {
            this.#stretch(key);
            this.anchor = key;
            this.phase = 'painting';
            return;
        }
        this.#first = key;
        this.#over = key;
        if (e.pointerType !== 'touch') {
            this.#begin();
            return;
        }
        this.phase = 'waiting';
        this.#x = e.clientX;
        this.#y = e.clientY;
        this.#timer = setTimeout(() => this.#begin(), HOLD_MS);
    }

    enter(key: K) {
        if (this.phase === 'waiting') this.#over = key;
        else if (this.phase === 'painting') this.#cells.set(key, this.#on);
    }

    move = (e: PointerEvent) => {
        if (this.phase !== 'waiting' || e.pointerId !== this.#pointer) return;
        const dx = Math.abs(e.clientX - this.#x);
        const dy = Math.abs(e.clientY - this.#y);
        if (dx > SLOP && dx > dy) this.#begin();
        else if (dy > SLOP) this.#end();
    };

    up = (e: PointerEvent) => {
        if (this.phase === 'idle' || e.pointerId !== this.#pointer) return;
        if (this.phase === 'waiting' && this.#first !== null) {
            this.#cells.set(this.#first, !this.#cells.isOn(this.#first));
            this.anchor = this.#first;
        }
        this.#end();
    };

    //The browser took the pointer, most often to scroll the page
    cancel = (e: PointerEvent) => {
        if (e.pointerId === this.#pointer) this.revert();
    };

    //True when there was paint to take back, so Escape can be kept from doing anything else
    revert() {
        const painted = this.phase === 'painting';
        if (painted) this.#cells.restore(this.#saved as S);
        this.#end();
        return painted;
    }

    keydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.revert()) e.preventDefault();
    };

    //Enter or space on a focused cell, where shift takes the run from the last one pressed
    key(key: K, shift: boolean) {
        if (shift && this.anchor !== null) this.#stretch(key);
        else this.#cells.set(key, !this.#cells.isOn(key));
        this.anchor = key;
    }

    /*
        Under pan-y the browser owns up and down, so a finger that is painting
        only keeps the page still through a touchmove it is told no on. That
        needs a listener that is not passive, and svelte's own ontouchmove is.
        The long-press menu would end the press too.
    */
    stopScroll = (node: HTMLElement) => {
        const still = (e: Event) => {
            if (this.phase === 'painting') e.preventDefault();
        };
        node.addEventListener('touchmove', still, { passive: false });
        node.addEventListener('contextmenu', still);
        return () => {
            node.removeEventListener('touchmove', still);
            node.removeEventListener('contextmenu', still);
            this.#end();
        };
    };

    #begin() {
        if (this.#first === null) return;
        clearTimeout(this.#timer);
        this.phase = 'painting';
        this.#on = !this.#cells.isOn(this.#first);
        this.#cells.set(this.#first, this.#on);
        if (this.#over !== null && this.#over !== this.#first) this.#cells.set(this.#over, this.#on);
        this.anchor = this.#first;
    }

    //Every cell from the anchor to here, painted the way the anchor ended up
    #stretch(key: K) {
        if (this.anchor === null) return;
        this.#on = this.#cells.isOn(this.anchor);
        for (const k of this.#cells.between(this.anchor, key)) this.#cells.set(k, this.#on);
    }

    #end() {
        clearTimeout(this.#timer);
        this.phase = 'idle';
        this.#pointer = -1;
        this.#first = null;
        this.#saved = undefined;
    }
}

/*
    Enter or space on a focused cell fires no pointer events at all, so down()
    never sees it. A keyboard activation is the click with nothing behind it:
    detail 0, and an empty pointerType where click carries one. Both, since a
    real tap fails only one of them depending on the browser, and letting a tap
    through would undo what the press just did.
*/
export function fromKeyboard(e: MouseEvent) {
    return e.detail === 0 && !(e as PointerEvent).pointerType;
}
