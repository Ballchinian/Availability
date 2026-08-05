<script lang="ts">
    import { formatDate, formatLong } from './format.js';
    import { DAY_HOURS, hourLabel, formatHours } from './hours.js';

    /*
        Narrow a free day down to certain hours, anywhere in the day. Tap an
        hour, press and drag across a run of them, or shift-click to take the run
        from the last hour pressed, which is what a keyboard gets instead of a
        drag. With none selected the day counts as free all day, which is the
        common case and the default.

        A real dialog, not a styled div: Escape, the focus trap, focus going back
        where it came from and the backdrop all come from showModal for nothing.
    */
    let { date = '', hours = $bindable([]), onclose }: {
        date?: string;
        hours?: number[];
        onclose?: () => void;
    } = $props();

    let dialog: HTMLDialogElement;

    const set = $derived(new Set(hours));

    let painting = $state(false);
    let paintMode = $state('add');
    //The last hour pressed, the far end a shift-click paints back to
    let anchor = $state<number | null>(null);

    //Mounted only while a day is being edited, so opening is the whole of it
    $effect(() => {
        dialog.showModal();
    });

    function add(h: number) {
        if (!set.has(h)) hours = [...hours, h];
    }
    function remove(h: number) {
        hours = hours.filter((x) => x !== h);
    }
    function apply(h: number) {
        if (paintMode === 'add') add(h);
        else remove(h);
    }

    /*
        Every hour from the anchor to here in display order, painted the way the
        anchor ended up: an anchor left on fills the run, an anchor cleared clears it.
    */
    function extendTo(h: number) {
        if (anchor === null) return;
        const a = DAY_HOURS.indexOf(anchor);
        const b = DAY_HOURS.indexOf(h);
        const [from, to] = a <= b ? [a, b] : [b, a];
        paintMode = set.has(anchor) ? 'add' : 'remove';
        for (let i = from; i <= to; i++) apply(DAY_HOURS[i]);
    }

    function startPaint(e: PointerEvent, h: number) {
        e.preventDefault();
        if (e.shiftKey && anchor !== null) {
            extendTo(h);
            anchor = h;
            return;
        }
        try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
            //Fine, nothing to release
        }
        painting = true;
        paintMode = set.has(h) ? 'remove' : 'add';
        apply(h);
        anchor = h;
    }
    function enterPaint(h: number) {
        if (painting) apply(h);
    }
    function stopPaint() {
        painting = false;
    }

    /*
        Enter or space on a focused hour, which fires no pointer events at all so
        startPaint never sees it. A keyboard activation is the click with nothing
        behind it: detail 0, and an empty pointerType where click carries one.
        Both, since a real tap fails only one of them depending on the browser,
        and letting a tap through here would undo what startPaint just did.
    */
    function keyToggle(e: MouseEvent, h: number) {
        if (e.detail !== 0 || (e as PointerEvent).pointerType) return;
        if (e.shiftKey && anchor !== null) {
            extendTo(h);
        } else {
            paintMode = set.has(h) ? 'remove' : 'add';
            apply(h);
        }
        anchor = h;
    }

    function allDay() {
        hours = [];
    }
</script>

<svelte:window onpointerup={stopPaint} />

<dialog
    class="time-card"
    bind:this={dialog}
    aria-label={`Times free on ${formatLong(date)}`}
    onclose={onclose}
    onclick={(e) => {
        if (e.target === dialog) dialog.close();
    }}
>
    <div class="time-body">
        <header>
            <span>Times free on {formatDate(date)}</span>
            <button class="link-btn" onclick={() => dialog.close()}>Done</button>
        </header>

        <p class="muted small">
            {hours.length === 0 ? 'Free all day. Tap or drag to narrow it down.' : `Free ${formatHours(hours)}.`}
        </p>

        <div class="hours" class:painting>
            {#each DAY_HOURS as h (h)}
                <button
                    class="hour"
                    class:on={set.has(h)}
                    aria-pressed={set.has(h)}
                    onpointerdown={(e) => startPaint(e, h)}
                    onpointerenter={() => enterPaint(h)}
                    onclick={(e) => keyToggle(e, h)}
                >{hourLabel(h)}</button>
            {/each}
        </div>

        <button class="link-btn" onclick={allDay}>Reset to all day</button>
    </div>
</dialog>
