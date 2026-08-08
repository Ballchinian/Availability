<script lang="ts">
    import { onMount } from 'svelte';
    import { isoOf, nextDay } from '../calendar.js';
    import { recallMiss, rememberMiss } from '../remember.js';
    import type { Participant } from '../types.js';
    import type { FreePerson } from '../overlap.js';
    import ClockNote from '../ClockNote.svelte';
    import CompareGrid from '../CompareGrid.svelte';
    import PickPanel from './PickPanel.svelte';

    /*
        Everyone's days as a heatmap, with the slider that reads it and the panel that
        acts on whichever day is clicked. One component because the three only mean
        anything together, and because the page shows them in two different places: out
        in the open while the day is still being found, and behind a button once it is
        set, where the only question left is whether a better day exists.
    */
    let {
        planId,
        start,
        end,
        allowedWeekdays = null,
        freeByDate = {},
        participants = [],
        confirmedCount = 0,
        totalParticipants = 0,
        probeActive = false,
        timeZone = '',
        chosen = null,
        quiet = false,
        readOnly = false,
        selectedDate = $bindable(null),
        onsaved
    }: {
        planId: string;
        start: string;
        end: string;
        allowedWeekdays?: number[] | null;
        freeByDate?: Record<string, FreePerson[]>;
        participants?: Participant[];
        confirmedCount?: number;
        totalParticipants?: number;
        probeActive?: boolean;
        timeZone?: string;
        chosen?: { date: string; time: string; note: string } | null;
        quiet?: boolean;
        //A cancelled plan, where the grid is only there to look back at
        readOnly?: boolean;
        selectedDate?: string | null;
        onsaved: () => Promise<void>;
    } = $props();

    /*
        The slider's own value, and the settled one everything else reads. Every step
        of a drag rebuilds every day's evaluation, which is 200ms of work on twenty
        people across two years, so the grid waits for the thumb to stop while the
        label beside it keeps up. The settled value is also the one written down, so a
        drag remembers itself once at the end rather than at every step.
    */
    let missInput = $state(0);
    let missAllowed = $state(0);
    //Nothing goes back to storage until what was there has been read, or the first settle erases it
    let recalled = false;

    $effect(() => {
        const want = missInput;
        const t = setTimeout(() => {
            missAllowed = want;
            if (recalled) rememberMiss(planId, want);
        }, 100);
        return () => clearTimeout(t);
    });

    const maxMiss = $derived(Math.max(0, confirmedCount - 1));

    /*
        How many confirmed people each day sits past the certainty horizon of. They
        are not busy, just too far out to say, so the overlap maths leaves them out
        of the denominator instead of counting them as missing. A day they marked
        free anyway still counts them free, a positive answer beats the horizon.
    */
    const unsureByDate = $derived.by(() => {
        const out: Record<string, number> = {};

        //Earliest horizon first, so the walk below can take them on one at a time
        const horizons: { userId: string; sureUntil: string }[] = [];
        for (const p of participants) {
            if (p.confirmed && p.sureUntil) horizons.push({ userId: p.userId, sureUntil: p.sureUntil });
        }
        if (!horizons.length) return out;
        horizons.sort((a, b) => (a.sureUntil < b.sureUntil ? -1 : 1));

        /*
            Every day before the earliest horizon sits inside everyone's certainty,
            so the walk starts at the first day that could be unsure. Across a two
            year range that is usually most of it skipped.
        */
        const dayAfterFirst = nextDay(horizons[0].sureUntil);
        const from = dayAfterFirst > start ? dayAfterFirst : start;
        if (from > end) return out;

        const d = new Date(`${from}T00:00:00`);
        const endD = new Date(`${end}T00:00:00`);
        const past = new Set<string>();
        let next = 0;

        while (d <= endD) {
            const date = isoOf(d);
            //Once a day is past someone's horizon every later day is too, so they stay in the set
            while (next < horizons.length && horizons[next].sureUntil < date) past.add(horizons[next++].userId);

            if (past.size) {
                let n = past.size;
                //A day they marked free anyway still counts them free, a positive answer beats the horizon
                const free = new Set<string>((freeByDate[date] || []).map((f) => f.userId));
                for (const id of free) if (past.has(id)) n--;
                if (n) out[date] = n;
            }
            d.setDate(d.getDate() + 1);
        }
        return out;
    });

    /*
        Both at once, so the grid is not drawn at nought first and again 100ms later at
        what was asked for. Safe in onMount because nothing renders this until the plan
        has loaded, so how far the slider can go is already known.
    */
    onMount(() => {
        missInput = missAllowed = recallMiss(planId, maxMiss);
        recalled = true;
    });
</script>

<div class="miss">
    <!--With one person in there is nobody to leave out, and a slider whose two ends
        are the same place is a control that looks broken rather than settled-->
    {#if maxMiss > 0}
        <label for="miss">How many people are you willing to leave out? <strong>{missInput}</strong></label>
        <input id="miss" type="range" min="0" max={maxMiss} bind:value={missInput} />
    {/if}
    <p class="legend small">Brighter means more hours work for everyone counted, and the small number on a day is how many are free. Dim days have no time that fits: tap one to see why.</p>
    <!--Everyone's hours are read onto this clock before they are compared, so it is the one the grid is in-->
    <ClockNote zone={timeZone} what="The days and hours here" />
</div>

<CompareGrid
    {start}
    {end}
    {freeByDate}
    {confirmedCount}
    {allowedWeekdays}
    chosenDate={chosen?.date ?? null}
    {unsureByDate}
    {missAllowed}
    bind:selectedDate
/>

<!--Straight under the grid, because it is the answer to clicking a day: anywhere
    further down and the response to the click is off the bottom of a phone-->
{#if !readOnly}
    <PickPanel
        {planId}
        {selectedDate}
        {missAllowed}
        {unsureByDate}
        {chosen}
        {freeByDate}
        {participants}
        {confirmedCount}
        {totalParticipants}
        {probeActive}
        {quiet}
        {onsaved}
    />
{/if}
