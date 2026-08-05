<script lang="ts">
    import { buildMonths, WEEKDAYS, isWeekdayAllowed } from './calendar.js';
    import { fillTextStyle } from './heatmap.js';
    import { formatLong } from './format.js';
    import { HOUR_COUNT } from './hours.js';
    import { evaluateDay, type DayEval, type FreePerson } from './overlap.js';

    /*
        Read only calendar for the compare view. Each in range day is coloured by
        the size of the common window once the people you are willing to miss have
        been dropped: the bright end of the ramp means everyone shares the whole
        evening, the dark end a narrow overlap, dim means no workable day. The
        colours are a guide, not a gate, so any in range day can be picked, even a
        dim one you already know works.
    */
    let {
        start,
        end,
        freeByDate = {},
        confirmedCount = 0,
        missAllowed = 0,
        allowedWeekdays = null,
        unsureByDate = {},
        selectedDate = $bindable(null)
    }: {
        start: string;
        end: string;
        freeByDate?: Record<string, FreePerson[]>;
        confirmedCount?: number;
        missAllowed?: number;
        allowedWeekdays?: number[] | null;
        unsureByDate?: Record<string, number>;
        selectedDate?: string | null;
    } = $props();

    const months = $derived(buildMonths(start, end));

    /*
        Every day evaluated once per data change, not once per cell per render.
        evaluateDay leans on bestWindow, which is roughly people squared times
        hours, and dragging the miss slider rerenders the whole grid continuously.
    */
    const evals = $derived.by(() => {
        const map: Record<string, DayEval> = {};
        for (const month of months) {
            for (const cell of month.cells) {
                if (!cell || !cell.inRange || !isWeekdayAllowed(cell.date, allowedWeekdays)) continue;
                map[cell.date] = evaluateDay(freeByDate[cell.date] || [], confirmedCount, missAllowed, unsureByDate[cell.date] || 0);
            }
        }
        return map;
    });

    //The day's honest denominator: the confirmed people who can actually say
    function countedOn(date: string) {
        return confirmedCount - (unsureByDate[date] || 0);
    }

    /*
        What the colour and the count mean, spelled out. Carries the date because
        it is the accessible name too, and the cell itself only says a number.
    */
    function describe(date: string, ev: DayEval) {
        const unsure = unsureByDate[date] || 0;
        const window = ev.viable ? `${ev.windowSize}h in common` : 'no time that fits everyone counted';
        return `${formatLong(date)}: ${ev.freeCount} of ${countedOn(date)} free, ${window}${unsure ? `, ${unsure} too far out to say` : ''}`;
    }

    function pick(date: string) {
        selectedDate = date;
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
                    {:else if !cell.inRange || !isWeekdayAllowed(cell.date, allowedWeekdays)}
                        <span class="day out">{cell.day}</span>
                    {:else}
                        {@const ev = evals[cell.date]}
                        <button
                            class="cday"
                            class:dim={!ev.viable}
                            class:chosen={selectedDate === cell.date}
                            style={ev.viable ? fillTextStyle(ev.windowSize, HOUR_COUNT) : ''}
                            aria-label={describe(cell.date, ev)}
                            aria-pressed={selectedDate === cell.date}
                            onclick={() => pick(cell.date)}
                            title={describe(cell.date, ev)}
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
