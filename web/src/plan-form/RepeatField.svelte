<script lang="ts">
    import { repeatSeries } from '../calendar/calendar.js';
    import { REPEAT_WEEKS, describeRepeat, formatDate } from '../site/format.js';
    import RepeatDates from '../calendar/RepeatDates.svelte';

    /*
        Whether a plan comes round again, and where the picked interval would take it.

        from is the day a series would count off. A plan still out looking for a day has
        none, and nothing is drawn, which is the honest answer: the sweep makes nothing
        until this one has a day of its own.

        was is the repeat the plan already has. A plan that has one is not asked again,
        only offered the way to stop it, by whoever runs it with or without the planner
        role. Without canStart, which is that role, a plan with none can only stay a one off.
    */
    let { weeks = $bindable(null), from = null, time = null, canStart = true, was = null, by = null }: {
        weeks?: number | null;
        from?: string | null;
        time?: string | null;
        canStart?: boolean;
        was?: number | null;
        by?: string | null;
    } = $props();

    const series = $derived(
        weeks && from
            ? repeatSeries({ repeatWeeks: weeks, dateRange: { start: from, end: from }, chosenDate: from, chosenTime: time })
            : []
    );

    const every = $derived(was ? describeRepeat(was) : '');
    const standing = $derived(`${every.charAt(0).toUpperCase()}${every.slice(1)}${by ? `, set by ${by}` : ''}${from ? '.' : ', once it has a day.'}`);

    const group = $props.id();
</script>

<div class="repeat">
    {#if was}
        <fieldset>
            <legend class="lbl">Comes round again</legend>
            <p class="muted small">{standing}</p>
            <label class="check">
                <input type="checkbox" checked={weeks === null} onchange={(e) => (weeks = e.currentTarget.checked ? null : was)} />
                Make this the last time it comes round
            </label>
        </fieldset>
    {:else}
        <fieldset>
            <legend class="lbl">Does this come round again?</legend>
            <div class="repeat-row">
                <label class="ghost"><input class="offscreen" type="radio" name={group} value={null} bind:group={weeks} />one off</label>
                {#each REPEAT_WEEKS as w (w)}
                    <label class="ghost"><input class="offscreen" type="radio" name={group} value={w} bind:group={weeks} disabled={!canStart} />{describeRepeat(w)}</label>
                {/each}
            </div>
            {#if !canStart}<p class="muted small">Only someone with the planner role can make it come round again.</p>{/if}
        </fieldset>
    {/if}
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
