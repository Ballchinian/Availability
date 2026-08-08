<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        Undoing a set date so the plan reopens for a new one. The controls only
        make sense while a date is set, but the message outlives it, since undoing
        is exactly what clears the date.
    */
    let { planId, dateSet = false, quiet = false, onvoided }: {
        planId: string;
        dateSet?: boolean;
        quiet?: boolean;
        onvoided: () => Promise<void>;
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
            await onvoided();
            return dm && !quiet
                ? 'Date undone and everyone has been DMed. Pick a new one whenever you are ready.'
                : 'Date undone. Pick a new one whenever you are ready.';
        });
    }
</script>

{#if dateSet}
    <div class="void">
        {#if !panel.open}
            <button class="ghost danger-btn" onclick={() => panel.show()}>Undo this date / reschedule</button>
        {:else}
            <p class="muted small">This clears the set date and reopens the plan so a new day can be picked. Their saved dates stay, no thread message goes out.</p>
            <input type="text" bind:value={reason} placeholder="Optional reason (e.g. the venue fell through)" maxlength="200" />
            <label class="check" class:off={quiet}><input type="checkbox" bind:checked={dm} disabled={quiet} /> DM everyone that you are rescheduling</label>
            {#if quiet}<p class="muted small">Quiet mode is on, so nobody is DMed. Their DM stops saying a day is set either way.</p>{/if}
            <div class="void-row">
                <button class="ghost danger-btn" onclick={doVoid} disabled={panel.busy}>
                    {panel.busy ? 'Undoing...' : 'Yes, undo the date'}
                </button>
                <button class="ghost" onclick={() => (panel.open = false)}>No</button>
            </div>
        {/if}
    </div>
{/if}
{#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
