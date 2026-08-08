<script lang="ts">
    import { api } from '../api.js';
    import { nextPlanShape, shiftDate } from '../calendar.js';
    import { REPEAT_WEEKS, describeRepeat, formatDate, formatTime } from '../format.js';
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

    //Either chain note is a paragraph rather than a button, and cannot sit at a button's width
    const wide = $derived(panel.open || Boolean(panel.msg) || Boolean(repeatedFrom) || Boolean(repeatedInto));

    function open() {
        panel.show();
        choice = repeatWeeks;
    }

    /*
        Where the picked interval would put the next one, worked out with the same function
        the sweep uses. Read from two days past the set date, which is the earliest the sweep
        can fire: it only looks once the day has been and gone, and asks for dates from its
        own tomorrow. Reading from today instead would skip a window that has already started.
    */
    const next = $derived(
        choice && chosenDate
            ? nextPlanShape({ repeatWeeks: choice, dateRange: { start, end }, chosenDate, chosenTime }, shiftDate(chosenDate, 2))
            : null
    );

    async function save() {
        await panel.run(async () => {
            await api(`/plans/${planId}/repeat`, { method: 'POST', body: JSON.stringify({ repeatWeeks: choice }) });
            panel.open = false;
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
            This one has already come round again. <a href="#/plan/{repeatedInto}/compare">Open the plan that followed it</a>
            to change or stop the repeat.
        </p>
    {:else if !panel.open}
        <button class="ghost" onclick={open}>
            {repeatWeeks ? `Comes round ${describeRepeat(repeatWeeks)}, change it` : 'Make this repeat'}
        </button>
    {:else}
        <p class="muted small">
            The next one is only made once this day has been and gone, with the same people, the same
            length of window and the same weekdays. Cancelling this plan stops it too.
        </p>
        <span class="lbl">How often?</span>
        <div class="repeat-row">
            {#each REPEAT_WEEKS as weeks (weeks)}
                <button class="ghost" class:on={choice === weeks} onclick={() => (choice = weeks)}>
                    {describeRepeat(weeks)}
                </button>
            {/each}
            <button class="ghost" class:on={choice === null} onclick={() => (choice = null)}>one off</button>
        </div>

        <!--The whole reason there is a step before saving: what "every other week" actually lands on-->
        <p class="status small">
            {#if !choice}
                Nothing follows this one, it stands on its own.
            {:else if !chosenDate}
                Nothing is made while this plan has no day. Once you set one, the next plan follows
                {describeRepeat(choice)} after it.
            {:else if !next}
                No date left in the series: {describeRepeat(choice)} on from {formatDate(chosenDate)} lands past
                the two years anything here reaches. Pick a shorter interval or leave it as a one off.
            {:else if next.set && next.chosen}
                Once {formatDate(chosenDate)} has been, the next one goes out already set for
                <strong>{formatDate(next.chosen.date)}</strong>{next.chosen.time ? ` at ${formatTime(next.chosen.time)}` : ''}.
            {:else}
                Once {formatDate(chosenDate)} has been, the next one goes out asking everyone about
                <strong>{formatDate(next.dateRange.start)} to {formatDate(next.dateRange.end)}</strong>, and you pick
                the day from that.
            {/if}
        </p>

        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy || choice === repeatWeeks}>
                {#if panel.busy}Saving...{:else if choice === repeatWeeks}Already {choice ? describeRepeat(choice) : 'a one off'}{:else if choice}Repeat {describeRepeat(choice)}{:else}Stop repeating{/if}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}

    {#if repeatedFrom}
        <p class="muted small">
            This came round from <a href="#/plan/{repeatedFrom}/compare">the one before it</a>, which is where
            everything that happened last time still is.
        </p>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
