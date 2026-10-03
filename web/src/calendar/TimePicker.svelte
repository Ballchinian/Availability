<script lang="ts">
    import { formatDate, formatLong } from '../site/format.js';
    import { DAY_HOURS, HOUR_COUNT, hourLabel, formatHours, hoursOf, storedHours, withHour } from './hours.js';
    import { Press, fromKeyboard } from './paint.svelte.js';

    /*
        Narrow a free day down to certain hours, anywhere in the day. A day free
        all day, the common case and the default, opens with every hour lit. Tap
        an hour to take it off, press and drag across a run of them, or
        shift-click to take the run from the last hour pressed, which is what a
        keyboard gets instead of a drag. Switching every hour off takes the day
        itself off once the picker closes.

        A real dialog, not a styled div: Escape, the focus trap, focus going back
        where it came from and the backdrop all come from showModal for nothing.
    */
    let { date = '', hours = $bindable([]), onclose }: {
        date?: string;
        hours?: number[];
        onclose?: (empty: boolean) => void;
    } = $props();

    let dialog: HTMLDialogElement;

    //Every hour off, which hours cannot hold since an empty list already means all day
    let none = $state(false);
    const lit = $derived(none ? [] : hoursOf(hours));

    //Mounted only while a day is being edited, so opening is the whole of it
    $effect(() => {
        dialog.showModal();
    });

    function light(next: number[]) {
        none = next.length === 0;
        if (!none) hours = storedHours(next);
    }

    //In display order, so a run from 10pm to 2am goes through midnight
    function hoursBetween(a: number, b: number) {
        const i = DAY_HOURS.indexOf(a);
        const j = DAY_HOURS.indexOf(b);
        return DAY_HOURS.slice(Math.min(i, j), Math.max(i, j) + 1);
    }

    const press = new Press({
        isOn: (h: number) => lit.includes(h),
        set: (h: number, on: boolean) => {
            if (lit.includes(h) !== on) light(withHour(lit, h, on));
        },
        between: hoursBetween,
        save: () => lit,
        restore: light
    });

    const summary = $derived(
        none
            ? 'No hours left. Done takes this day off.'
            : lit.length === HOUR_COUNT
              ? 'Free all day. Tap or drag across hours to take them off.'
              : `Free ${formatHours(lit)}.`
    );
</script>

<svelte:window onpointermove={press.move} onpointerup={press.up} onpointercancel={press.cancel} />

<dialog
    class="time-card"
    bind:this={dialog}
    aria-label={`Times free on ${formatLong(date)}`}
    onclose={() => onclose?.(none)}
    oncancel={(e) => {
        //Escape mid-drag takes the drag back and leaves the picker open
        if (press.revert()) e.preventDefault();
    }}
    onclick={(e) => {
        if (e.target === dialog) dialog.close();
    }}
>
    <div class="time-body">
        <header>
            <span>Times free on {formatDate(date)}</span>
            <button class="link-btn" onclick={() => dialog.close()}>Done</button>
        </header>

        <!--Live, since an hour's pressed state never says that switching off the last one takes the day off-->
        <p class="muted small" aria-live="polite">{summary}</p>

        <div class="hours" class:painting={press.phase === 'painting'} {@attach press.stopScroll}>
            {#each DAY_HOURS as h (h)}
                <button
                    class="hour"
                    class:on={lit.includes(h)}
                    aria-pressed={lit.includes(h)}
                    onpointerdown={(e) => press.down(h, e)}
                    onpointerenter={() => press.enter(h)}
                    onclick={(e) => fromKeyboard(e) && press.key(h, e.shiftKey)}
                >{hourLabel(h)}</button>
            {/each}
        </div>

        <button class="link-btn" onclick={() => light(DAY_HOURS)}>Reset to all day</button>
    </div>
</dialog>
