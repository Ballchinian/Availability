<script lang="ts">
    import { fillColor } from './heatmap.js';
    import { buildMonths, WEEKDAYS, type Month } from './calendar.js';
    import { HOUR_COUNT } from './hours.js';
    import TimePicker from './TimePicker.svelte';

    /*
        The calendar. One block per month between the plan's start and end, each
        day a cell you tap to mark yourself free. Days outside the range are dim
        and locked. The month heading shifts red to green as you fill it in, the
        same idea as the original site. A free day shows a small clock you can tap
        to set specific hours.

        You can also press and drag across days to paint a stretch in one go. The
        first day you press sets the mode: start on an empty day and the drag marks
        days free, start on a free day and it clears them. The cursor switches to a
        crosshair while you are dragging so it is obvious it is happening.
    */
    let { start, end, selection = $bindable({}), highlightFrom = null }: {
        start: string;
        end: string;
        selection?: Record<string, number[]>;
        highlightFrom?: string | null;
    } = $props();

    let editingDate = $state('');
    let painting = $state(false);
    let paintMode = $state('add');

    const months = $derived(buildMonths(start, end));

    function isFree(date: string) {
        return date in selection;
    }

    function markFree(date: string) {
        if (!(date in selection)) selection = { ...selection, [date]: [] };
    }
    function unmark(date: string) {
        if (date in selection) {
            //Rebuild without this day rather than delete, which strict mode blocks
            const { [date]: _removed, ...rest } = selection;
            selection = rest;
        }
    }
    function apply(date: string) {
        if (paintMode === 'add') markFree(date);
        else unmark(date);
    }

    function startPaint(e: PointerEvent, date: string) {
        e.preventDefault();
        //Mouse has no implicit capture, but release it for pen and touch so the
        //drag can cross into neighbouring day cells
        try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
            //Fine, nothing to release
        }
        painting = true;
        paintMode = isFree(date) ? 'remove' : 'add';
        apply(date);
    }
    function enterPaint(date: string) {
        if (painting) apply(date);
    }
    function stopPaint() {
        painting = false;
    }

    function filledIn(month: Month) {
        return month.cells.filter((c) => c && c.inRange && isFree(c.date)).length;
    }

    //A free day shades green to red by how many of the sociable hours it keeps,
    //all of them (or none picked, which means all) being green
    function dayColour(date: string) {
        const h = selection[date];
        const count = h && h.length ? h.length : HOUR_COUNT;
        return fillColor(count, HOUR_COUNT);
    }
</script>

<svelte:window onpointerup={stopPaint} />

<div class="grid-wrap" class:painting>
    {#each months as month (month.year + '-' + month.month)}
        <section class="cal">
            <h3 style="color: {fillColor(filledIn(month), month.inRangeCount)}">{month.label} {month.year}</h3>
            <div class="weekdays">
                {#each WEEKDAYS as w}<span>{w}</span>{/each}
            </div>
            <div class="days">
                {#each month.cells as cell, i (i)}
                    {#if !cell}
                        <span class="pad"></span>
                    {:else if !cell.inRange}
                        <span class="day out">{cell.day}</span>
                    {:else}
                        <span class="cell">
                            <button
                                class="day"
                                class:free={isFree(cell.date)}
                                class:is-new={highlightFrom && cell.date >= highlightFrom}
                                style={isFree(cell.date) ? `background:${dayColour(cell.date)}` : ''}
                                onpointerdown={(e) => startPaint(e, cell.date)}
                                onpointerenter={() => enterPaint(cell.date)}
                            >
                                {cell.day}
                            </button>
                            {#if isFree(cell.date)}
                                <button
                                    class="clock"
                                    title="Set specific hours"
                                    onpointerdown={(e) => e.stopPropagation()}
                                    onclick={() => (editingDate = cell.date)}
                                >{selection[cell.date].length ? selection[cell.date].length : '·'}</button>
                            {/if}
                        </span>
                    {/if}
                {/each}
            </div>
        </section>
    {/each}
</div>

{#if editingDate}
    <TimePicker
        date={editingDate}
        bind:hours={() => selection[editingDate] || [], (v) => (selection = { ...selection, [editingDate]: v })}
        onclose={() => (editingDate = '')}
    />
{/if}
