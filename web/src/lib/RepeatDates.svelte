<script lang="ts">
    import { buildMonths, WEEKDAYS, type PlanShape } from './calendar.js';
    import { formatLong } from './format.js';

    /*
        Which days a repeat lands on, drawn rather than written out. A month at a time
        with arrows either side, since a plan late in a month has its next turn in the
        one after and a single fixed month would show none of them.

        Shared by the create form, the screen it lands on and the overview's repeat
        panel, so the dates a planner is shown before saving are the dates they are shown
        after it.
    */
    let { first, shapes = [] }: { first: string; shapes?: PlanShape[] } = $props();

    const marks = $derived.by(() => {
        const map: Record<string, string> = { [first]: 'first' };
        for (const shape of shapes) map[shape.chosen.date] = 'next';
        return map;
    });

    const dates = $derived(Object.keys(marks).sort());
    const months = $derived(buildMonths(dates[0], dates[dates.length - 1]));

    let at = $state(0);
    //Clamped rather than reset: a shorter series after an interval change would otherwise leave this out of bounds
    const index = $derived(Math.min(at, months.length - 1));
    const shown = $derived(months[index]);

    //The same series in words, for anyone who cannot see the grid
    const spoken = $derived.by(() => {
        const rest = shapes.map((s) => formatLong(s.chosen.date));
        return rest.length ? `${formatLong(first)}, then ${rest.join(', ')}.` : `${formatLong(first)}.`;
    });

    function label(date: string) {
        return marks[date] === 'first' ? `${formatLong(date)}, this one` : `${formatLong(date)}, it comes round again`;
    }
</script>

{#if shown}
    <div class="rcal">
        <div class="rcal-head">
            <!--A single month has nowhere to go, so it gets the line on its own. Not a heading:
                the grid it names is hidden from screen readers, who get the dates in words below-->
            {#if months.length > 1}
                <button class="ghost arrow" onclick={() => (at = index - 1)} disabled={index === 0} aria-label="Earlier month">&lsaquo;</button>
            {/if}
            <p class="month">{shown.label} {shown.year}</p>
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
                            title={marks[cell.date] ? label(cell.date) : undefined}
                        >{cell.day}</span>
                    {/if}
                {/each}
            </div>
            <!--One filled day with nothing beside it needs no key, it is the only thing marked-->
            {#if shapes.length}
                <p class="rkey small">
                    <span class="rswatch first"></span> this one
                    <span class="rswatch next"></span> after it
                </p>
            {/if}
        </div>

        <p class="offscreen">{spoken}</p>
    </div>
{/if}
