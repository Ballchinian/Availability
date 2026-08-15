<script lang="ts">
    import { isoFromNow, isoPlus } from './calendar.js';

    /*
        The window a plan asks about: three one-click spans and the two dates themselves.
        Shared by the create form and the screen that goes back out for different dates, so
        the spans on offer and the bounds a planner is held to cannot come apart between them.

        min is the one thing the two screens disagree on: a plan being made cannot start
        before tomorrow, one already running can be pulled back to today.
    */
    let { start = $bindable(''), end = $bindable(''), min = '' }: {
        start?: string;
        end?: string;
        min?: string;
    } = $props();

    const maxDate = isoFromNow(2, 'year');
    const floor = $derived(min || isoFromNow(1, 'day'));

    /*
        Each span ends off whatever the start is rather than off today, so a start moved out
        still gets the span the button names. The day back off the month one keeps it a month
        counting both ends.
    */
    const SPANS = [
        { label: 'Two weeks', endOf: (from: string) => isoPlus(from, 13, 'day') },
        { label: 'A month', endOf: (from: string) => isoPlus(isoPlus(from, 1, 'month'), -1, 'day') },
        { label: 'Rest of the year', endOf: (from: string) => `${from.slice(0, 4)}-12-31` }
    ];

    function setSpan(endOf: (from: string) => string) {
        const from = start || floor;
        const to = endOf(from);
        start = from;
        //A span off a late start can reach past the two years the api takes
        end = to > maxDate ? maxDate : to;
    }
</script>

<div class="field" role="group" aria-labelledby="rangeLabel">
    <span class="group-label" id="rangeLabel">Which dates should I ask about?</span>
    <div class="quick-row">
        {#each SPANS as span (span.label)}
            <button type="button" class="quick" onclick={() => setSpan(span.endOf)}>{span.label}</button>
        {/each}
    </div>
    <div class="range">
        <div>
            <label for="start">From</label>
            <input id="start" type="date" bind:value={start} min={floor} max={maxDate} />
        </div>
        <div>
            <label for="end">To</label>
            <input id="end" type="date" bind:value={end} min={start || floor} max={maxDate} />
        </div>
    </div>
</div>
