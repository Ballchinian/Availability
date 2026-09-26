<script lang="ts">
    import { formatDate, formatLong } from './format.js';
    import { DAY_HOURS, hourLabel, formatHours } from './hours.js';
    import { Press, fromKeyboard } from './paint.svelte.js';

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

    //In display order, so a run from 10pm to 2am goes through midnight
    function hoursBetween(a: number, b: number) {
        const i = DAY_HOURS.indexOf(a);
        const j = DAY_HOURS.indexOf(b);
        return DAY_HOURS.slice(Math.min(i, j), Math.max(i, j) + 1);
    }

    const press = new Press({
        isOn: (h: number) => set.has(h),
        set: (h: number, on: boolean) => (on ? add(h) : remove(h)),
        between: hoursBetween,
        save: () => hours,
        restore: (saved) => (hours = saved)
    });

    function allDay() {
        hours = [];
    }
</script>

<svelte:window onpointermove={press.move} onpointerup={press.up} onpointercancel={press.cancel} />

<dialog
    class="time-card"
    bind:this={dialog}
    aria-label={`Times free on ${formatLong(date)}`}
    onclose={onclose}
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

        <p class="muted small">
            {hours.length === 0 ? 'Free all day. Tap or drag to narrow it down.' : `Free ${formatHours(hours)}.`}
        </p>

        <div class="hours" class:painting={press.phase === 'painting'} {@attach press.stopScroll}>
            {#each DAY_HOURS as h (h)}
                <button
                    class="hour"
                    class:on={set.has(h)}
                    aria-pressed={set.has(h)}
                    onpointerdown={(e) => press.down(h, e)}
                    onpointerenter={() => press.enter(h)}
                    onclick={(e) => fromKeyboard(e) && press.key(h, e.shiftKey)}
                >{hourLabel(h)}</button>
            {/each}
        </div>

        <button class="link-btn" onclick={allDay}>Reset to all day</button>
    </div>
</dialog>
