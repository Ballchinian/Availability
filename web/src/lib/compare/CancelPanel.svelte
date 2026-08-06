<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        Calling the whole plan off. The thread is left alone on purpose, deleting
        it is a Discord action nobody can undo from here.
    */
    let { planId, oncancelled }: {
        planId: string;
        oncancelled: () => void;
    } = $props();

    const panel = new Panel();
    let post = $state(true);
    let dm = $state(true);

    async function doCancel() {
        await panel.run(async () => {
            await api(`/plans/${planId}/cancel`, {
                method: 'POST',
                body: JSON.stringify({ post, dm })
            });
            oncancelled();
        });
    }
</script>

<div class="danger">
    {#if !panel.open}
        <button class="ghost danger-btn" onclick={() => panel.show()}>Cancel this plan</button>
    {:else}
        <div class="confirm">
            <p class="small">Cancel this plan? The thread stays until you delete it by hand in Discord.</p>
            <label class="check"><input type="checkbox" bind:checked={post} /> Post the cancellation in the thread</label>
            <label class="check"><input type="checkbox" bind:checked={dm} /> DM everyone</label>
            <div class="void-row">
                <button class="ghost danger-btn" onclick={doCancel} disabled={panel.busy}>
                    {panel.busy ? 'Cancelling...' : 'Yes, cancel it'}
                </button>
                <button class="ghost" onclick={() => (panel.open = false)}>No</button>
            </div>
        </div>
    {/if}
    {#if panel.msg}<p class="status" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
