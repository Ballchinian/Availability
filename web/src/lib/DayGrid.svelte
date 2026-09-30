<script lang="ts">
    import { fillTextStyle, headingColor } from './heatmap.js';
    import { buildMonths, isoOf, isoFromNow, stepDay, WEEKDAYS, isWeekdayAllowed, type Month } from './calendar.js';
    import { formatLong } from './format.js';
    import { HOUR_COUNT, formatHours } from './hours.js';
    import { refocus } from './focus.js';
    import { Press, fromKeyboard } from './paint.svelte.js';
    import { Brush } from './brush.svelte.js';
    import Status from './Status.svelte';
    import TimePicker from './TimePicker.svelte';

    /*
        The calendar. One block per month between the plan's start and end, each
        day a cell you tap to mark yourself free. Days outside the range, and days
        already gone, are dim and locked. The month heading carries how full it is as a colour and as a
        tally, so the heat is never the only thing saying it. A free day shows a
        small clock you can tap to set specific hours.

        You can also press and drag across days to paint a stretch in one go. The
        first day you press sets the mode: start on an empty day and the drag marks
        days free, start on a free day and it clears them. The cursor switches to a
        crosshair while you are dragging so it is obvious it is happening. On a
        phone a swipe up or down scrolls, so a finger paints once it moves sideways
        or holds still. Dragging is pointer only, so shift-click paints the same
        stretch from the last day pressed, which is all a keyboard gets. Escape
        before letting go puts the days back.
    */
    let { start, end, selection = $bindable({}), highlightFrom = null, allowedWeekdays = null, coveredUntil = null }: {
        start: string;
        end: string;
        selection?: Record<string, number[]>;
        highlightFrom?: string | null;
        allowedWeekdays?: number[] | null;
        coveredUntil?: string | null;
    } = $props();

    let editingDate = $state('');

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

    //On this device's clock, since everyone's days are stored the way they wrote them
    const today = isoFromNow(0, 'day');

    //A day can be marked only when it is in range, not gone, and on a weekday this plan asks about
    function selectable(date: string) {
        return date >= today && isWeekdayAllowed(date, allowedWeekdays);
    }

    function isFree(date: string) {
        return date in selection && selectable(date);
    }

    const brush = new Brush();
    let brushSaid = $state('');

    function markFree(date: string) {
        selection = brush.mark(selection, date);
    }
    function unmark(date: string) {
        if (date in selection) {
            //Rebuild without this day rather than delete, which strict mode blocks
            const { [date]: _removed, ...rest } = selection;
            selection = rest;
        }
    }

    function datesBetween(a: string, b: string) {
        const [from, to] = a <= b ? [a, b] : [b, a];
        const dates: string[] = [];
        const d = new Date(`${from}T00:00:00`);
        const last = new Date(`${to}T00:00:00`);
        while (d <= last) {
            dates.push(isoOf(d));
            d.setDate(d.getDate() + 1);
        }
        return dates;
    }

    //Every change makes a new selection object, so keeping the old one is the whole snapshot
    const press = new Press({
        isOn: isFree,
        set: (date: string, on: boolean) => {
            if (!selectable(date)) return;
            if (on) markFree(date);
            else unmark(date);
        },
        between: datesBetween,
        save: () => selection,
        restore: (saved) => (selection = saved)
    });

    function keyToggle(e: MouseEvent, date: string) {
        if (fromKeyboard(e) && selectable(date)) press.key(date, e.shiftKey);
    }

    //A free day shades up the ramp by how many hours of the day it keeps,
    //all of them (or none picked, which means all) sitting at the top
    function dayStyle(date: string) {
        const h = selection[date];
        const count = h && h.length ? h.length : HOUR_COUNT;
        return fillTextStyle(count, HOUR_COUNT);
    }

    /*
        The hours kept, beside the clock. A bare number read as a count of anything at
        all, so it carries its unit. Every hour picked is the same thing as none picked,
        which is what formatHours already says out loud, so both leave the clock alone.
    */
    function hourBadge(hours: number[]) {
        return !hours.length || hours.length === HOUR_COUNT ? '' : `${hours.length}h`;
    }

    //Starting with whatever the badge shows, so saying "5h" out loud finds it
    function clockLabel(date: string) {
        const badge = hourBadge(selection[date]);
        const rest = `hours for ${names[date]}, free ${formatHours(selection[date])}`;
        return badge ? `${badge}, set ${rest}` : `Set ${rest}`;
    }

    //Marked free or not, a day past it is not taken as their answer
    function pastCovered(date: string) {
        return Boolean(coveredUntil && date > coveredUntil);
    }

    //The whole date, since the button itself only says the day number
    function dayLabel(date: string) {
        return pastCovered(date) ? `${names[date]}, not counted as your answer` : names[date];
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
                    far: pastCovered(cell.date),
                    style: free ? dayStyle(cell.date) : '',
                    label: dayLabel(cell.date)
                };
            }
            tallies[monthKey(month)] = { filled, asked };
        }
        return { days, tallies };
    });

    /*
        The grid is one Tab stop, which the arrow keys move from day to day: two years of
        days was up to 730 stops to get past. The stop's clock is the only clock in the tab
        order, so the hours of the day with focus are one Tab away and nobody else's are.
    */
    let focusDate = $state('');
    const stop = $derived(
        view.days[focusDate]?.selectable ? focusDate : (Object.keys(view.days).find((d) => view.days[d].selectable) ?? '')
    );
    let wrap: HTMLDivElement;
    const uid = $props.id();

    //The button goes with the chip, and the grid is where the next day gets marked
    function allDay() {
        brushSaid = brush.reset();
        refocus(() => wrap.querySelector<HTMLElement>(`[data-date="${stop}"]`));
    }

    //Arrows only move focus and never mark anything, so a keyboard can look before it touches
    function arrow(e: KeyboardEvent, date: string) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const next = stepDay(date, e.key, (d) => Boolean(view.days[d]?.selectable), start, end);
        if (next === null) return;
        e.preventDefault();
        focusDate = next;
        wrap.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
    }
</script>

<svelte:window onpointermove={press.move} onpointerup={press.up} onpointercancel={press.cancel} onkeydown={press.keydown} />

<!--Only the keys: the brightness and the clocks read for themselves, and each day's name carries its hours-->
<p class="offscreen" id="{uid}-keys">Arrow keys move between days. Shift+Enter marks the stretch back to the last day you pressed.</p>

{#if !brush.allDay}
    <p class="brush">New days get {formatHours(brush.hours)} <button class="ghost" aria-label="All day for new days" onclick={allDay}>All day</button></p>
{/if}
<!--The chip says it on screen, so this only reads it out-->
<Status class="offscreen" msg={brushSaid} />

<!--A group so the keys are read out on the way in, whichever day Tab lands on-->
<div
    class="grid-wrap"
    class:painting={press.phase === 'painting'}
    role="group"
    aria-describedby="{uid}-keys"
    bind:this={wrap}
    {@attach press.stopScroll}
>
    {#each months as month (monthKey(month))}
        {@const tally = view.tallies[monthKey(month)]}
        <section class="cal">
            <h2 style="color: {headingColor(tally.filled, tally.asked)}">
                {month.label} {month.year} <span class="tally">{tally.filled}/{tally.asked}</span>
            </h2>
            <div class="weekdays">
                {#each WEEKDAYS as w (w)}<span>{w}</span>{/each}
            </div>
            <div class="days with-clocks">
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
                                tabindex={cell.date === stop ? 0 : -1}
                                data-date={cell.date}
                                onpointerdown={(e) => press.down(cell.date, e)}
                                onpointerenter={() => press.enter(cell.date)}
                                onclick={(e) => keyToggle(e, cell.date)}
                                onkeydown={(e) => arrow(e, cell.date)}
                                onfocus={() => (focusDate = cell.date)}
                            >
                                {cell.day}
                            </button>
                            {#if day.free}
                                <button
                                    class="clock"
                                    aria-label={clockLabel(cell.date)}
                                    tabindex={cell.date === stop ? 0 : -1}
                                    onpointerdown={(e) => e.stopPropagation()}
                                    onpointerenter={() => press.enter(cell.date)}
                                    onclick={() => (editingDate = cell.date)}
                                >
                                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                        <circle cx="8" cy="8" r="6.25" />
                                        <path d="M8 4.5V8l2.5 1.5" />
                                    </svg>{hourBadge(selection[cell.date])}
                                </button>
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
        onclose={(empty) => {
            const date = editingDate;
            //The clock focus came back to goes with the day, so the day takes it instead
            if (empty) {
                unmark(date);
                refocus(() => wrap.querySelector<HTMLElement>(`[data-date="${date}"]`));
            }
            brushSaid = brush.closed(selection[date], empty) || brushSaid;
            editingDate = '';
        }}
    />
{/if}
