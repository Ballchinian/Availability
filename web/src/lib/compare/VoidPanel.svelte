<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        The second way to reschedule: clear the day and go back out for dates, as against
        moving the day yourself in SetDate.

        What it did goes up to the page rather than staying here, since clearing the date
        is exactly what takes this panel off the screen, and a line nobody sees is no
        confirmation at all.
    */
    let { planId, dateSet = false, quiet = false, onvoided }: {
        planId: string;
        dateSet?: boolean;
        quiet?: boolean;
        onvoided: (said: string) => Promise<void>;
    } = $props();

    const panel = new Panel();
    let reason = $state('');
    let dm = $state(true);

    async function doVoid() {
        await panel.run(async () => {
            await api(`/plans/${planId}/void`, {
                method: 'POST',
                body: JSON.stringify({ reason: reason.trim() || null, dm, quiet })
            });
            panel.open = false;
            reason = '';
            await onvoided(dm && !quiet
                ? 'Open again, and everyone has been DMed to go over their dates. The grid fills back in as they answer.'
                : 'Open again. The grid fills back in as people go over their dates.');
        });
    }
</script>

{#if dateSet}
    <div class="void" class:wide={panel.open || Boolean(panel.msg)}>
        {#if !panel.open}
            <button class="ghost" onclick={() => panel.show()}>Ask everyone for new days</button>
        {:else}
            <p class="muted small">
                Clears the day this is set for and opens the plan back up, so everyone goes over their
                dates and you pick again from the grid. Nothing anybody has saved is lost, and no thread
                post goes out. To move it yourself without asking anyone, set a new day instead.
            </p>
            <input type="text" bind:value={reason} placeholder="Optional reason (e.g. the venue fell through)" maxlength="200" />
            {#if quiet}
                <p class="muted small">Quiet mode is on, so nobody is DMed. Their DM stops saying a day is set either way.</p>
            {:else}
                <label class="check"><input type="checkbox" bind:checked={dm} /> DM everyone that you are rescheduling</label>
            {/if}
            <div class="btn-row">
                <button class="primary" onclick={doVoid} disabled={panel.busy}>
                    {panel.busy ? 'Opening it up...' : 'Clear the day and ask again'}
                </button>
                <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
            </div>
        {/if}
        {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
    </div>
{/if}
