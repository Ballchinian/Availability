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

    //The key both the month blocks and their tallies go under
    function monthKey(m: Month) {
        return `${m.year}-${m.month}`;
    }

    /*
        Every in-range day said out loud, worked out once per range. Nothing here
        reads the selection, which is the whole point: formatLong parses a date, and
        painting a day used to redo all 730 of them.
    */
    const names = $derived.by(() => {
        const map: Record<string, string> = {};
        for (const month of months) {
            for (const cell of month.cells) {
                if (cell && cell.inRange) map[cell.date] = formatLong(cell.date);
            }
        }
        return map;
    });

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

    //A free day shades up the ramp by how many hours of the day it keeps,
    //all of them (or none picked, which means all) sitting at the top
    function dayStyle(date: string) {
        const h = selection[date];
        const count = h && h.length ? h.length : HOUR_COUNT;
        return fillTextStyle(count, HOUR_COUNT);
    }

    /*
        The hours kept, on the badge. A bare number read as a count of anything at all,
        so it carries its unit. Every hour picked is the same thing as none picked, which
        is what formatHours already says out loud, so both come out as the quiet dot.
    */
    function hourBadge(hours: number[]) {
        return !hours.length || hours.length === HOUR_COUNT ? '·' : `${hours.length}h`;
    }

    //Whether this day is past the point they said they can honestly plan to
    function beyondHorizon(date: string) {
        return Boolean(sureUntil && date > sureUntil && !isFree(date));
    }

    //The whole date, since the button itself only says the day number
    function dayLabel(date: string) {
        return beyondHorizon(date) ? `${names[date]}, past your sure-up-to date` : names[date];
    }

    /*
        Every day's state and every month's tally in one pass, so the template looks
        up rather than works out. Painting replaces the whole selection object, so
        anything reading it runs again for every day dragged across: that was two
        filters per month plus isFree four times a cell, and a two year grid is 730
        cells.
    */
    const view = $derived.by(() => {
        const days: Record<string, { selectable: boolean; free: boolean; far: boolean; style: string; label: string }> = {};
        const tallies: Record<string, { filled: number; asked: number }> = {};
        for (const month of months) {
            let filled = 0;
            let asked = 0;
            for (const cell of month.cells) {
                if (!cell || !cell.inRange) continue;
                const can = selectable(cell.date);
                const free = isFree(cell.date);
                if (can) asked += 1;
                if (free) filled += 1;
                days[cell.date] = {
                    selectable: can,
                    free,
                    far: beyondHorizon(cell.date),
                    style: free ? dayStyle(cell.date) : '',
                    label: dayLabel(cell.date)
                };
            }
            tallies[monthKey(month)] = { filled, asked };
        }
        return { days, tallies };
    });
</script>

<svelte:window onpointerup={stopPaint} />

<!--What the colours mean, which nothing said before: the same shading on the compare
    grid means something else entirely, and it has had a legend all along-->
<p class="legend small">Brighter means more of the day free. The badge on a day counts the hours you kept, a dot meaning all of them.</p>

<div class="grid-wrap" class:painting>
    {#each months as month (monthKey(month))}
        {@const tally = view.tallies[monthKey(month)]}
        <section class="cal">
            <h3 style="color: {headingColor(tally.filled, tally.asked)}">
                {month.label} {month.year} <span class="tally">{tally.filled}/{tally.asked}</span>
            </h3>
            <div class="weekdays">
                {#each WEEKDAYS as w (w)}<span>{w}</span>{/each}
            </div>
            <div class="days">
                {#each month.cells as cell, i (i)}
                    {#if !cell}
                        <span class="pad"></span>
                    {:else if !cell.inRange || !view.days[cell.date].selectable}
                        <span class="day out">{cell.day}</span>
                    {:else}
                        {@const day = view.days[cell.date]}
                        <span class="cell">
                            <button
                                class="day"
                                class:free={day.free}
                                class:is-new={highlightFrom && cell.date >= highlightFrom}
                                class:far={day.far}
                                style={day.style}
                                aria-label={day.label}
                                aria-pressed={day.free}
                                onpointerdown={(e) => startPaint(e, cell.date)}
                                onpointerenter={() => enterPaint(cell.date)}
                                onclick={(e) => keyToggle(e, cell.date)}
                                title={day.far ? 'Past your sure-up-to date, reads as too far to say rather than busy' : ''}
                            >
                                {cell.day}
                            </button>
                            {#if day.free}
                                <button
                                    class="clock"
                                    title="Set specific hours"
                                    aria-label={`Set hours for ${names[cell.date]}, free ${formatHours(selection[cell.date])}`}
                                    onpointerdown={(e) => e.stopPropagation()}
                                    onclick={() => (editingDate = cell.date)}
                                >{hourBadge(selection[cell.date])}</button>
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
