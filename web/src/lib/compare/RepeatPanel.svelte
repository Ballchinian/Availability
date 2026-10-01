<script lang="ts">
    import { api } from '../api.js';
    import { repeatSeries } from '../calendar.js';
    import { REPEAT_WEEKS, describeRepeat, formatDate } from '../format.js';
    import RepeatDates from '../RepeatDates.svelte';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        Whether this plan comes round again once its day has been and gone.

        Nothing is scheduled by saying yes. The next plan is only made after this one's
        day has passed, so there is never more than one live at a time and this stays a
        standing instruction on the plan in front of you rather than a calendar sitting
        somewhere else that you would have to go and find to stop.
    */
    let { planId, repeatWeeks = null, repeatedFrom = null, repeatedInto = null, start = '', end = '', chosenDate = null, chosenTime = null, onchanged }: {
        planId: string;
        repeatWeeks?: number | null;
        repeatedFrom?: string | null;
        repeatedInto?: string | null;
        start?: string;
        end?: string;
        chosenDate?: string | null;
        chosenTime?: string | null;
        onchanged: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    //Held rather than saved on the press, so the dates below can be read before anything is stored
    let choice = $state<number | null>(null);
    const group = $props.id();

    //Either chain note is a paragraph rather than a button, and cannot sit at a button's width
    const wide = $derived(panel.open || Boolean(panel.msg) || Boolean(repeatedFrom) || Boolean(repeatedInto));

    function open() {
        panel.show();
        choice = repeatWeeks;
    }

    //Where the picked interval would take this plan, for drawing on the calendar below the buttons
    const series = $derived(
        choice && chosenDate
            ? repeatSeries({ repeatWeeks: choice, dateRange: { start, end }, chosenDate, chosenTime })
            : []
    );

    async function save() {
        await panel.run(async () => {
            await api(`/plans/${planId}/repeat`, { method: 'POST', body: JSON.stringify({ repeatWeeks: choice }) });
            panel.close();
            //Held before the reload, since that is what replaces the date it reads off
            const said = !choice
                ? 'Stopped. This one stands on its own now.'
                : chosenDate
                    ? `Set. Once ${formatDate(chosenDate)} has been, the next one goes out ${describeRepeat(choice)} on with the same people.`
                    : `Set to come round ${describeRepeat(choice)}. Nothing is made until this plan has a day of its own.`;
            await onchanged();
            return said;
        });
    }
</script>

<div class="repeat" class:wide>
    {#if repeatedInto}
        <!--Its turn is done, so the controls here would change nothing: the live plan is the next one-->
        <p class="muted small">
            This one has already come round again. <a href="#/plan/{repeatedInto}/overview">Open the plan that followed it</a>
            to change or stop the repeat.
        </p>
    {:else if !panel.open}
        <button class="ghost" onclick={open} {@attach panel.opener}>
            {repeatWeeks ? `Comes round ${describeRepeat(repeatWeeks)}, change it` : 'It should come round again'}
        </button>
    {:else}
        <p class="muted small">
            The next one is only made once this day has been and gone, with the same people, the same
            length of window and the same weekdays. Cancelling this plan stops it too.
        </p>
        <fieldset>
            <legend class="lbl">How often?</legend>
            <div class="repeat-row">
                {#each REPEAT_WEEKS as weeks (weeks)}
                    <label class="ghost"><input class="offscreen" type="radio" name={group} value={weeks} bind:group={choice} />{describeRepeat(weeks)}</label>
                {/each}
                <label class="ghost"><input class="offscreen" type="radio" name={group} value={null} bind:group={choice} />one off</label>
            </div>
        </fieldset>

        <!--The whole reason there is a step before saving: what "every other week" actually lands on-->
        {#if chosenDate && series.length}
            <RepeatDates first={chosenDate} shapes={series} />
        {:else}
            <p class="status small">
                {#if !choice}
                    Nothing follows this one, it stands on its own.
                {:else if !chosenDate}
                    Nothing is made while this plan has no day. Once you set one, the next plan follows
                    {describeRepeat(choice)} after it.
                {:else}
                    No date left in the series: {describeRepeat(choice)} on from {formatDate(chosenDate)} lands past
                    the two years anything here reaches. Pick a shorter interval or leave it as a one off.
                {/if}
            </p>
        {/if}

        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy || choice === repeatWeeks}>
                {#if panel.busy}Saving...{:else if choice === repeatWeeks}Already {choice ? describeRepeat(choice) : 'a one off'}{:else if choice}Repeat {describeRepeat(choice)}{:else}Stop repeating{/if}
            </button>
            <button class="ghost" onclick={() => panel.close()}>Cancel</button>
        </div>
    {/if}

    {#if repeatedFrom}
        <p class="muted small">
            This came round from <a href="#/plan/{repeatedFrom}/overview">the one before it</a>, which is where
            everything that happened last time still is.
        </p>
    {/if}
    <Status class="status small" msg={panel.msg} error={panel.failed} />
</div>
