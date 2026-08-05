<script lang="ts">
    import { api } from '../api.js';
    import { REPEAT_WEEKS, describeRepeat } from '../format.js';
    import { Panel } from './panel.svelte.js';

    /*
        Whether this plan comes round again once its day has been and gone.

        Nothing is scheduled by saying yes. The next plan is only made after this one's
        day has passed, so there is never more than one live at a time and this stays a
        standing instruction on the plan in front of you rather than a calendar sitting
        somewhere else that you would have to go and find to stop.
    */
    let { planId, repeatWeeks = null, repeatedFrom = null, repeatedInto = null, onchanged }: {
        planId: string;
        repeatWeeks?: number | null;
        repeatedFrom?: string | null;
        repeatedInto?: string | null;
        onchanged: () => Promise<void>;
    } = $props();

    const panel = new Panel();

    //Each button saves as it is pressed, so there is no pending choice to hold: what is lit is what is stored
    async function save(weeks: number | null) {
        await panel.run(async () => {
            await api(`/plans/${planId}/repeat`, { method: 'POST', body: JSON.stringify({ repeatWeeks: weeks }) });
            panel.open = false;
            await onchanged();
            return weeks
                ? `Set. Once this day has been, the next one goes out ${describeRepeat(weeks)} later with the same people.`
                : 'Stopped. This one stands on its own now.';
        });
    }
</script>

<div class="repeat">
    {#if repeatedFrom}
        <p class="muted small">
            This came round from <a href="#/plan/{repeatedFrom}/compare">the one before it</a>, which is where
            everything that happened last time still is.
        </p>
    {/if}

    {#if repeatedInto}
        <!--Its turn is done, so the controls here would change nothing: the live plan is the next one-->
        <p class="muted small">
            This one has already come round again. <a href="#/plan/{repeatedInto}/compare">Open the plan that followed it</a>
            to change or stop the repeat.
        </p>
    {:else if !panel.open}
        <button class="link-btn" onclick={() => panel.show()}>
            {repeatWeeks ? `Comes round ${describeRepeat(repeatWeeks)}, change it` : 'Make this repeat'}
        </button>
    {:else}
        <p class="muted small">
            The next one is only made once this day has been and gone, with the same people, the same
            length of window and the same weekdays. Cancelling this plan stops it too.
        </p>
        <div class="repeat-row">
            {#each REPEAT_WEEKS as weeks (weeks)}
                <button class="ghost" class:on={repeatWeeks === weeks} disabled={panel.busy} onclick={() => save(weeks)}>
                    {describeRepeat(weeks)}
                </button>
            {/each}
            <button class="ghost" class:on={repeatWeeks === null} disabled={panel.busy} onclick={() => save(null)}>one off</button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
</div>
{#if panel.msg}<p class="status small" class:error={panel.failed}>{panel.msg}</p>{/if}
