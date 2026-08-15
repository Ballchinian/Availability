<script lang="ts">
    import { buildMonths, shiftDate, WEEKDAYS, type PlanShape } from './calendar.js';
    import { formatLong } from './format.js';

    /*
        Which days a repeat lands on, drawn rather than written out. A month at a time
        with arrows either side, since a plan late in a month has its next turn in the
        one after and a single fixed month would show none of them.

        Shared by the create form, the screen it lands on and the compare page's repeat
        panel, so the dates a planner is shown before saving are the dates they are shown
        after it.
    */
    let { first, shapes = [] }: { first: string; shapes?: PlanShape[] } = $props();

    const marks = $derived.by(() => {
        const map: Record<string, string> = { [first]: 'first' };
        for (const shape of shapes) {
            if (shape.chosen) {
                map[shape.chosen.date] = 'next';
                continue;
            }
            //A window rather than a day, so every day of it, never over one already spoken for
            for (let d = shape.dateRange.start; d <= shape.dateRange.end; d = shiftDate(d, 1)) {
                if (!map[d]) map[d] = 'asks';
            }
        }
        return map;
    });

    const dates = $derived(Object.keys(marks).sort());
    const months = $derived(buildMonths(dates[0], dates[dates.length - 1]));

    let at = $state(0);
    //Clamped rather than reset: a shorter series after an interval change would otherwise leave this out of bounds
    const index = $derived(Math.min(at, months.length - 1));
    const shown = $derived(months[index]);

    //A window carries a key of its own, and only a plan that collected dates ever comes back as one
    const asksWindow = $derived(shapes.some((s) => !s.chosen));
    const hasNext = $derived(shapes.some((s) => Boolean(s.chosen)));

    /*
        The same series in words, for anyone who cannot see the grid. Read off the shapes
        rather than the marked days so a window comes out as its two ends instead of every
        date inside it.
    */
    const spoken = $derived.by(() => {
        const rest = shapes.map((s) =>
            s.chosen ? formatLong(s.chosen.date) : `${formatLong(s.dateRange.start)} to ${formatLong(s.dateRange.end)}`
        );
        return rest.length ? `${formatLong(first)}, then ${rest.join(', ')}.` : `${formatLong(first)}.`;
    });

    function label(date: string) {
        if (marks[date] === 'first') return `${formatLong(date)}, this one`;
        if (marks[date] === 'next') return `${formatLong(date)}, it comes round again`;
        return `${formatLong(date)}, one of the days the next one asks about`;
    }
</script>

{#if shown}
    <div class="rcal">
        <div class="rcal-head">
            <!--A single month has nowhere to go, so it gets the heading on its own-->
            {#if months.length > 1}
                <button class="ghost arrow" onclick={() => (at = index - 1)} disabled={index === 0} aria-label="Earlier month">&lsaquo;</button>
            {/if}
            <h4>{shown.label} {shown.year}</h4>
            {#if months.length > 1}
                <button class="ghost arrow" onclick={() => (at = index + 1)} disabled={index >= months.length - 1} aria-label="Later month">&rsaquo;</button>
            {/if}
        </div>

        <div aria-hidden="true">
            <div class="weekdays">
                {#each WEEKDAYS as w (w)}<span>{w}</span>{/each}
            </div>
            <div class="days">
                {#each shown.cells as cell, i (i)}
                    {#if !cell}
                        <span class="pad"></span>
                    {:else}
                        <span
                            class="rday"
                            class:first={marks[cell.date] === 'first'}
                            class:next={marks[cell.date] === 'next'}
                            class:asks={marks[cell.date] === 'asks'}
                            title={marks[cell.date] ? label(cell.date) : undefined}
                        >{cell.day}</span>
                    {/if}
                {/each}
            </div>
            <!--One filled day with nothing beside it needs no key, it is the only thing marked-->
            {#if shapes.length}
                <p class="rkey small">
                    <span class="rswatch first"></span> this one
                    {#if hasNext}<span class="rswatch next"></span> after it{/if}
                    {#if asksWindow}<span class="rswatch asks"></span> the days it asks about{/if}
                </p>
            {/if}
        </div>

        <p class="offscreen">{spoken}</p>
    </div>
{/if}
