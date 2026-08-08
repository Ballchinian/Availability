<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        Calling the whole plan off. The thread is left alone on purpose, deleting
        it is a Discord action nobody can undo from here.
    */
    let { planId, quiet = false, oncancelled }: {
        planId: string;
        quiet?: boolean;
        oncancelled: () => void;
    } = $props();

    const panel = new Panel();
    let post = $state(true);
    let dm = $state(true);

    /*
        Every other quiet action leaves people holding something true. This one leaves them
        free to turn up to nothing, so it is still obeyed, but only once it has been said twice.
    */
    let owned = $state(false);
    const blocked = $derived(quiet && !owned);

    async function doCancel() {
        await panel.run(async () => {
            await api(`/plans/${planId}/cancel`, {
                method: 'POST',
                body: JSON.stringify({ post, dm, quiet })
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
            {#if quiet}
                <p class="status error small">
                    Quiet mode is on, so nothing goes in the thread and nobody is DMed. Everyone's DM
                    will say the plan is off, but nothing will tell them to look, so anyone who has
                    already read theirs could still turn up.
                </p>
                <label class="check"><input type="checkbox" bind:checked={owned} /> I know, cancel it quietly anyway</label>
            {:else}
                <label class="check"><input type="checkbox" bind:checked={post} /> Post the cancellation in the thread</label>
                <label class="check"><input type="checkbox" bind:checked={dm} /> DM everyone</label>
            {/if}
            <div class="void-row">
                <button class="ghost danger-btn" onclick={doCancel} disabled={panel.busy || blocked}>
                    {panel.busy ? 'Cancelling...' : quiet ? 'Yes, cancel it quietly' : 'Yes, cancel it'}
                </button>
                <button class="ghost" onclick={() => (panel.open = false)}>No</button>
            </div>
        </div>
    {/if}
    {#if panel.msg}<p class="status" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
