<script lang="ts">
    import { formatDate } from './format.js';
    import { SOCIABLE_HOURS, hourLabel, formatHours } from './hours.js';

    /*
        Narrow a free day down to certain hours, anywhere from 8am to 2am. Tap an
        hour, or press and drag across a run of them. With none selected the day
        counts as free all day, which is the common case and the default.
    */
    let { date = '', hours = $bindable([]), onclose }: {
        date?: string;
        hours?: number[];
        onclose?: () => void;
    } = $props();

    const set = $derived(new Set(hours));

    let painting = $state(false);
    let paintMode = $state('add');

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

    function startPaint(e: PointerEvent, h: number) {
        e.preventDefault();
        try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
            //Fine, nothing to release
        }
        painting = true;
        paintMode = set.has(h) ? 'remove' : 'add';
        apply(h);
    }
    function enterPaint(h: number) {
        if (painting) apply(h);
    }
    function stopPaint() {
        painting = false;
    }

    function allDay() {
        hours = [];
    }
</script>

<svelte:window onpointerup={stopPaint} />

<div class="overlay" onclick={onclose} role="presentation">
    <div class="time-card" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Pick times">
        <header>
            <span>Times free on {formatDate(date)}</span>
            <button class="link-btn" onclick={onclose}>Done</button>
        </header>

        <p class="muted small">
            {hours.length === 0 ? 'Free all day. Tap or drag to narrow it down.' : `Free ${formatHours(hours)}.`}
        </p>

        <div class="hours" class:painting>
            {#each SOCIABLE_HOURS as h (h)}
                <button
                    class="hour"
                    class:on={set.has(h)}
                    onpointerdown={(e) => startPaint(e, h)}
                    onpointerenter={() => enterPaint(h)}
                >{hourLabel(h)}</button>
            {/each}
        </div>

        <button class="link-btn" onclick={allDay}>Reset to all day</button>
    </div>
</div>
