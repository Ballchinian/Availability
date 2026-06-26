<script lang="ts">
    import { buildMonths, WEEKDAYS } from './calendar.js';
    import { fillColor } from './heatmap.js';
    import { HOUR_COUNT } from './hours.js';
    import { evaluateDay, type FreePerson } from './overlap.js';

    /*
        Read only calendar for the compare view. Each in range day is coloured by
        the size of the common window once the people you are willing to miss have
        been dropped: green means everyone shares the whole evening, redder means a
        narrow overlap, dim means no workable day. Tapping a workable day picks it.
    */
    let {
        start,
        end,
        freeByDate = {},
        confirmedCount = 0,
        missAllowed = 0,
        selectedDate = $bindable(null)
    }: {
        start: string;
        end: string;
        freeByDate?: Record<string, FreePerson[]>;
        confirmedCount?: number;
        missAllowed?: number;
        selectedDate?: string | null;
    } = $props();

    const months = $derived(buildMonths(start, end));

    function evalOf(date: string) {
        return evaluateDay(freeByDate[date] || [], confirmedCount, missAllowed);
    }

    function pick(date: string) {
        if (evalOf(date).viable) selectedDate = date;
    }
</script>

<div class="grid-wrap">
    {#each months as month (month.year + '-' + month.month)}
        <section class="cal">
            <h3>{month.label} {month.year}</h3>
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
                        {@const ev = evalOf(cell.date)}
                        <button
                            class="cday"
                            class:dim={!ev.viable}
                            class:chosen={selectedDate === cell.date}
                            style={ev.viable ? `background:${fillColor(ev.windowSize, HOUR_COUNT)}` : ''}
                            onclick={() => pick(cell.date)}
                            title={`${ev.freeCount} of ${confirmedCount} free, ${ev.windowSize}h common`}
                        >
                            <span class="num">{cell.day}</span>
                            <span class="count">{ev.freeCount || ''}</span>
                        </button>
                    {/if}
                {/each}
            </div>
        </section>
    {/each}
</div>
