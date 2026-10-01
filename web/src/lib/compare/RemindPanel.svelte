<script lang="ts">
    import { api } from '../api.js';
    import type { Participant } from '../types.js';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        The nudge for whoever the plan is waiting on. Before a date is set that is
        whoever still has to say they're in or fill in days, and once there is one it is
        whoever hasn't said if they're coming. Either way the column above names them.

        The route picks which set to chase from the plan itself, so mode only decides
        the wording here.
    */
    let { planId, waiting = [], mode = 'availability' }: {
        planId: string;
        waiting?: Participant[];
        mode?: 'availability' | 'vote';
    } = $props();

    const panel = new Panel();

    const chasingVotes = $derived(mode === 'vote');

    async function remind() {
        await panel.run(async () => {
            const res = await api<{ pinged: number }>(`/plans/${planId}/remind`, { method: 'POST' });
            if (res.pinged) return `Nudged ${res.pinged} ${res.pinged === 1 ? 'person' : 'people'}.`;
            return chasingVotes ? 'Everyone has already answered.' : 'Everyone has already filled theirs in.';
        });
    }
</script>

<div class="waiting">
    <button class="ghost" onclick={remind} disabled={panel.busy}>
        {#if panel.busy}Nudging...{:else}Nudge the {waiting.length} still to answer{/if}
    </button>
</div>
<!--Outside the row above, where an empty line would still take a gap-->
<Status class="status small" msg={panel.msg} error={panel.failed} />
