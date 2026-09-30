<script lang="ts">
    import { buildMonths, stepDay, WEEKDAYS, isWeekdayAllowed } from './calendar.js';
    import { fillTextStyle } from './heatmap.js';
    import { formatLong } from './format.js';
    import { HOUR_COUNT } from './hours.js';
    import { evaluateDay, type DayEval, type FreePerson } from './overlap.js';

    /*
        Read only calendar for the compare view. Each in range day is coloured by
        the size of the common window once the people you are willing to miss have
        been dropped: the bright end of the ramp means everyone shares the whole
        evening, the dark end a narrow overlap, dim means no workable day. The
        colours are a guide, not a gate, so any in range day from today on can be
        picked, even a dim one you already know works.
    */
    let {
        start,
        end,
        freeByDate = {},
        confirmedCount = 0,
        missAllowed = 0,
        allowedWeekdays = null,
        unsureByDate = {},
        chosenDate = null,
        today = null,
        level = 3,
        selectedDate = $bindable(null)
    }: {
        start: string;
        end: string;
        freeByDate?: Record<string, FreePerson[]>;
        confirmedCount?: number;
        missAllowed?: number;
        allowedWeekdays?: number[] | null;
        unsureByDate?: Record<string, number>;
        //The day the plan is actually set for, marked apart from whichever day is being looked at
        chosenDate?: string | null;
        //Days before it are out. Null keeps every day, for a grid that is only looked back at.
        today?: string | null;
        //One under whatever heads the section the grid sits in
        level?: 2 | 3;
        selectedDate?: string | null;
    } = $props();

    const months = $derived(buildMonths(start, end));

    function pickable(date: string) {
        return (!today || date >= today) && isWeekdayAllowed(date, allowedWeekdays);
    }

    /*
        Every day evaluated once per data change, not once per cell per render.
        evaluateDay leans on bestWindow, which is people times hours per person
        dropped, and dragging the miss slider rerenders the whole grid continuously.
    */
    const evals = $derived.by(() => {
        const map: Record<string, DayEval> = {};
        for (const month of months) {
            for (const cell of month.cells) {
                if (!cell || !cell.inRange || !pickable(cell.date)) continue;
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
        //First, since it is the one thing about a day that beats how good the day looks
        const set = date === chosenDate ? 'the day this plan is set for. ' : '';
        return `${set}${formatLong(date)}: ${ev.freeCount} of ${countedOn(date)} free, ${window}${unsure ? `, ${unsure} too far out to say` : ''}`;
    }

    function pick(date: string) {
        selectedDate = date;
    }

    //One Tab stop for the whole grid, on the picked day until the arrows move it
    let focusDate = $state('');
    const stop = $derived(
        evals[focusDate] ? focusDate : selectedDate && evals[selectedDate] ? selectedDate : (Object.keys(evals)[0] ?? '')
    );
    let wrap: HTMLDivElement;
    const uid = $props.id();

    //Moves focus only: the day is picked by Enter or a click, as before
    function arrow(e: KeyboardEvent, date: string) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const next = stepDay(date, e.key, (d) => Boolean(evals[d]), start, end);
        if (next === null) return;
        e.preventDefault();
        focusDate = next;
        wrap.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
    }
</script>

<p class="offscreen" id="{uid}-keys">Arrow keys move between days.</p>

<div class="grid-wrap" role="group" aria-describedby="{uid}-keys" bind:this={wrap}>
    {#each months as month (month.year + '-' + month.month)}
        <section class="cal">
            <svelte:element this={`h${level}`}>{month.label} {month.year}</svelte:element>
            <div class="weekdays">
                {#each WEEKDAYS as w (w)}<span>{w}</span>{/each}
            </div>
            <div class="days with-hours">
                {#each month.cells as cell, i (i)}
                    {#if !cell}
                        <span class="pad"></span>
                    {:else if !cell.inRange || !pickable(cell.date)}
                        <span class="day out">{cell.day}</span>
                    {:else}
                        {@const ev = evals[cell.date]}
                        <button
                            class="cday"
                            class:dim={!ev.viable}
                            class:chosen={selectedDate === cell.date}
                            class:isset={chosenDate === cell.date}
                            style={ev.viable ? fillTextStyle(ev.windowSize, HOUR_COUNT) : ''}
                            aria-label={describe(cell.date, ev)}
                            aria-pressed={selectedDate === cell.date}
                            tabindex={cell.date === stop ? 0 : -1}
                            data-date={cell.date}
                            onclick={() => pick(cell.date)}
                            onkeydown={(e) => arrow(e, cell.date)}
                            onfocus={() => (focusDate = cell.date)}
                        >
                            <span class="num">{cell.day}{#if chosenDate === cell.date}<svg class="tick" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>{/if}</span>
                            <span class="count">{ev.freeCount || ''}</span>
                            <span class="shared">{ev.viable ? `${ev.windowSize}h` : ''}</span>
                        </button>
                    {/if}
                {/each}
            </div>
        </section>
    {/each}
</div>
