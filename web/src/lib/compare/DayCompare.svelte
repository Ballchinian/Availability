<script lang="ts">
    import { onMount } from 'svelte';
    import { recallMiss, rememberMiss } from '../remember.js';
    import type { Participant } from '../types.js';
    import type { FreePerson } from '../overlap.js';
    import { todayIn } from '../zone.js';
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
        timeZone = '',
        chosen = null,
        quiet = false,
        readOnly = false,
        level = 3,
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
        timeZone?: string;
        chosen?: { date: string; time: string; note: string } | null;
        quiet?: boolean;
        //A cancelled plan, where the grid is only there to look back at
        readOnly?: boolean;
        //The month headings' level, 2 on a page with nothing between them and its h1
        level?: 2 | 3;
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
    const missSaid = $derived(missInput === 0 ? 'nobody' : missInput === 1 ? '1 person' : `${missInput} people`);

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
        <!--The number is the slider's value, said by aria-valuetext, so the name stays put while it moves-->
        <label for="miss">How many people are you willing to leave out? <strong aria-hidden="true">{missInput}</strong></label>
        <input id="miss" type="range" min="0" max={maxMiss} aria-valuetext={missSaid} bind:value={missInput} />
    {/if}
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
    today={readOnly ? null : todayIn(timeZone)}
    {missAllowed}
    {level}
    bind:selectedDate
/>

<!--Straight under the grid, because it is the answer to clicking a day: anywhere
    further down and the response to the click is off the bottom of a phone-->
{#if !readOnly}
    <PickPanel
        {planId}
        {selectedDate}
        {missAllowed}
        {chosen}
        {freeByDate}
        {participants}
        {confirmedCount}
        {totalParticipants}
        {quiet}
        {onsaved}
    />
{/if}
