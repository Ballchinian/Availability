<script lang="ts">
    import { fillTextStyle, headingColor } from './heatmap.js';
    import { buildMonths, isoOf, WEEKDAYS, isWeekdayAllowed, type Month } from './calendar.js';
    import { formatLong } from './format.js';
    import { HOUR_COUNT, formatHours } from './hours.js';
    import TimePicker from './TimePicker.svelte';

    /*
        The calendar. One block per month between the plan's start and end, each
        day a cell you tap to mark yourself free. Days outside the range are dim
        and locked. The month heading carries how full it is as a colour and as a
        tally, so the heat is never the only thing saying it. A free day shows a
        small clock you can tap to set specific hours.

        You can also press and drag across days to paint a stretch in one go. The
        first day you press sets the mode: start on an empty day and the drag marks
        days free, start on a free day and it clears them. The cursor switches to a
        crosshair while you are dragging so it is obvious it is happening. Dragging
        is pointer only, so shift-click paints the same stretch from the last day
        pressed, which is all a keyboard gets.
    */
    let { start, end, selection = $bindable({}), highlightFrom = null, allowedWeekdays = null, sureUntil = null }: {
        start: string;
        end: string;
        selection?: Record<string, number[]>;
        highlightFrom?: string | null;
        allowedWeekdays?: number[] | null;
        sureUntil?: string | null;
    } = $props();

    let editingDate = $state('');
    let painting = $state(false);
    let paintMode = $state('add');
    //The last day pressed, the far end a shift-click paints back to
    let anchor = $state('');

    const months = $derived(buildMonths(start, end));

    //A day can be marked only when it is in range and on a weekday this plan asks about
    function selectable(date: string) {
        return isWeekdayAllowed(date, allowedWeekdays);
    }

    function isFree(date: string) {
        return date in selection && selectable(date);
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
        if (!selectable(date)) return;
        if (paintMode === 'add') markFree(date);
        else unmark(date);
    }

    /*
        Every day from the anchor to here, painted the way the anchor ended up: an
        anchor left free marks the stretch free, an anchor cleared clears it.
    */
    function extendTo(date: string) {
        const [from, to] = anchor <= date ? [anchor, date] : [date, anchor];
        paintMode = isFree(anchor) ? 'add' : 'remove';
        const d = new Date(`${from}T00:00:00`);
        const last = new Date(`${to}T00:00:00`);
        while (d <= last) {
            apply(isoOf(d));
            d.setDate(d.getDate() + 1);
        }
    }

    function startPaint(e: PointerEvent, date: string) {
        if (!selectable(date)) return;
        e.preventDefault();
        if (e.shiftKey && anchor) {
            extendTo(date);
            anchor = date;
            return;
        }
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
        anchor = date;
    }
    function enterPaint(date: string) {
        if (painting) apply(date);
    }
    function stopPaint() {
        painting = false;
    }

    /*
        Enter or space on a focused day, which fires no pointer events at all so
        startPaint never sees it. A keyboard activation is the click with nothing
        behind it: detail 0, and an empty pointerType where click carries one.
        Both, since a real tap fails only one of them depending on the browser,
        and letting a tap through here would undo what startPaint just did.
    */
    function keyToggle(e: MouseEvent, date: string) {
        if (e.detail !== 0 || (e as PointerEvent).pointerType || !selectable(date)) return;
        if (e.shiftKey && anchor) {
            extendTo(date);
        } else {
            paintMode = isFree(date) ? 'remove' : 'add';
            apply(date);
        }
        anchor = date;
    }

    function filledIn(month: Month) {
        return month.cells.filter((c) => c && c.inRange && isFree(c.date)).length;
    }

    //How many days in the month this plan actually asks about, the denominator for its heat
    function askedCount(month: Month) {
        return month.cells.filter((c) => c && c.inRange && selectable(c.date)).length;
    }

    //A free day shades up the ramp by how many of the sociable hours it keeps,
    //all of them (or none picked, which means all) sitting at the top
    function dayStyle(date: string) {
        const h = selection[date];
        const count = h && h.length ? h.length : HOUR_COUNT;
        return fillTextStyle(count, HOUR_COUNT);
    }

    //Whether this day is past the point they said they can honestly plan to
    function beyondHorizon(date: string) {
        return Boolean(sureUntil && date > sureUntil && !isFree(date));
    }

    //The whole date, since the button itself only says the day number
    function dayLabel(date: string) {
        return beyondHorizon(date) ? `${formatLong(date)}, past your sure-up-to date` : formatLong(date);
    }
</script>

<svelte:window onpointerup={stopPaint} />

<div class="grid-wrap" class:painting>
    {#each months as month (month.year + '-' + month.month)}
        {@const filled = filledIn(month)}
        {@const asked = askedCount(month)}
        <section class="cal">
            <h3 style="color: {headingColor(filled, asked)}">
                {month.label} {month.year} <span class="tally">{filled}/{asked}</span>
            </h3>
            <div class="weekdays">
                {#each WEEKDAYS as w (w)}<span>{w}</span>{/each}
            </div>
            <div class="days">
                {#each month.cells as cell, i (i)}
                    {#if !cell}
                        <span class="pad"></span>
                    {:else if !cell.inRange || !selectable(cell.date)}
                        <span class="day out">{cell.day}</span>
                    {:else}
                        <span class="cell">
                            <button
                                class="day"
                                class:free={isFree(cell.date)}
                                class:is-new={highlightFrom && cell.date >= highlightFrom}
                                class:far={beyondHorizon(cell.date)}
                                style={isFree(cell.date) ? dayStyle(cell.date) : ''}
                                aria-label={dayLabel(cell.date)}
                                aria-pressed={isFree(cell.date)}
                                onpointerdown={(e) => startPaint(e, cell.date)}
                                onpointerenter={() => enterPaint(cell.date)}
                                onclick={(e) => keyToggle(e, cell.date)}
                                title={beyondHorizon(cell.date) ? 'Past your sure-up-to date, reads as too far to say rather than busy' : ''}
                            >
                                {cell.day}
                            </button>
                            {#if isFree(cell.date)}
                                <button
                                    class="clock"
                                    title="Set specific hours"
                                    aria-label={`Set hours for ${formatLong(cell.date)}, free ${formatHours(selection[cell.date])}`}
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
