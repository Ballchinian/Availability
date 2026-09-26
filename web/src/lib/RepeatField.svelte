<script lang="ts">
    import { repeatSeries } from './calendar.js';
    import { REPEAT_WEEKS, describeRepeat, formatDate } from './format.js';
    import RepeatDates from './RepeatDates.svelte';

    /*
        Whether a plan comes round again, and where the picked interval would take it.
        Shared by the create form and the dates screen so the intervals on offer and the
        calendar drawn under them cannot come apart between the two.

        from is the day a series would count off. A plan still out looking for a day has
        none, and nothing is drawn, which is the honest answer: the sweep makes nothing
        until this one has a day of its own.
    */
    let { weeks = $bindable(null), from = null, time = null }: {
        weeks?: number | null;
        from?: string | null;
        time?: string | null;
    } = $props();

    const series = $derived(
        weeks && from
            ? repeatSeries({ repeatWeeks: weeks, dateRange: { start: from, end: from }, chosenDate: from, chosenTime: time })
            : []
    );

    const group = $props.id();
</script>

<div class="repeat">
    <fieldset>
        <legend class="lbl">Does this come round again?</legend>
        <div class="repeat-row">
            <label class="ghost"><input class="offscreen" type="radio" name={group} value={null} bind:group={weeks} />one off</label>
            {#each REPEAT_WEEKS as w (w)}
                <label class="ghost"><input class="offscreen" type="radio" name={group} value={w} bind:group={weeks} />{describeRepeat(w)}</label>
            {/each}
        </div>
    </fieldset>
    {#if from && weeks}
        {#if series.length}
            <RepeatDates first={from} shapes={series} />
        {:else}
            <!--The one thing the calendar cannot draw, since there is nothing to put on it-->
            <p class="status small">
                Nothing follows it: {describeRepeat(weeks)} on from {formatDate(from)} lands past the two years anything
                here reaches.
            </p>
        {/if}
    {/if}
</div>
