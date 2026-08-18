<script lang="ts">
    import { untrack } from 'svelte';
    import { api } from '../api.js';
    import { formatTime } from '../format.js';
    import { Panel } from './panel.svelte.js';

    /*
        The time on the day the plan is already on, for the planner who came here wanting
        only that. Goes through the same choose endpoint as moving the day, which sees the
        day it is already on and edits in place: no answer is cleared, the confirmation
        stands and the invite list stays as it is.
    */
    let { planId, chosenDate, time = '', quiet = false, onsaved }: {
        planId: string;
        chosenDate: string;
        time?: string;
        quiet?: boolean;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let newTime = $state(untrack(() => time));

    function open() {
        panel.show();
        newTime = time;
    }

    async function save() {
        if ((newTime || '') === (time || '')) {
            panel.reject('That is already the time. Move it to update it.');
            return;
        }
        await panel.run(async () => {
            await api(`/plans/${planId}/choose`, {
                method: 'POST',
                body: JSON.stringify({ date: chosenDate, time: newTime || null, quiet })
            });
            panel.open = false;
            const said = newTime ? `It starts at ${formatTime(newTime)} now.` : 'There is no set time any more.';
            await onsaved();
            return `${said}${quiet ? ' Nobody was told.' : " Everyone still invited has been DM'd."}`;
        });
    }
</script>

<div class="edit" class:wide={panel.open || Boolean(panel.msg)}>
    {#if !panel.open}
        <button class="ghost" onclick={open}>The time is wrong</button>
    {:else}
        <label class="lbl" for="wtime">Time</label>
        <input id="wtime" type="time" bind:value={newTime} />
        <p class="muted small">
            {quiet ? 'Nobody is told, their DM is corrected where it sits.' : "Everyone still invited gets a DM saying what moved. Nothing else about the plan changes."}
        </p>
        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy}>
                {panel.busy ? 'Saving...' : 'Update the time'}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
