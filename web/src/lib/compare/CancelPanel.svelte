<script lang="ts">
    import { api } from '../api.js';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        Calling the whole plan off, which always tells everyone. The thread is left alone
        on purpose, deleting it is a Discord action nobody can undo from here.
    */
    let { planId, oncancelled }: {
        planId: string;
        oncancelled: () => void;
    } = $props();

    const panel = new Panel();

    async function doCancel() {
        await panel.run(async () => {
            await api(`/plans/${planId}/cancel`, { method: 'POST' });
            oncancelled();
        });
    }
</script>

<div class="danger">
    {#if !panel.open}
        <button class="ghost danger-btn" onclick={() => panel.show()} {@attach panel.opener}>Call it off</button>
    {:else}
        <div class="confirm">
            <p class="small">Call this plan off? I'll DM everyone, and the thread stays until you delete it by hand in Discord.</p>
            <div class="btn-row">
                <button class="ghost danger-btn" onclick={doCancel} disabled={panel.busy}>
                    {panel.busy ? 'Calling it off...' : 'Yes, call it off'}
                </button>
                <button class="ghost" onclick={() => panel.close()}>No</button>
            </div>
        </div>
    {/if}
</div>
<!--Outside the row above, where an empty line would still take a gap-->
<Status class="status" msg={panel.msg} error={panel.failed} />
