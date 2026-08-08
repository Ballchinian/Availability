<script lang="ts">
    import { api } from '../api.js';
    import type { Participant } from '../types.js';
    import { Panel } from './panel.svelte.js';

    /*
        The nudge for whoever the plan is waiting on. Before a date is set that is
        the people who have not filled their dates in, and the planner never has to
        wait for them, so it sits above the grid rather than in the way of it. Once a
        probe is running it is the people who have not said whether they are coming,
        and it sits under the board that shows who is still out.

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
    <p class="muted small">
        {#if chasingVotes}
            Still to say whether they are coming: {waiting.map((p) => p.displayName).join(', ')}.
        {:else}
            You do not have to wait for everyone, pick whenever you are ready. Still out:
            {waiting.map((p) => p.displayName).join(', ')}.
        {/if}
    </p>
    <button class="ghost" onclick={remind} disabled={panel.busy}>
        {#if panel.busy}
            Nudging...
        {:else if chasingVotes}
            Nudge the ones who have not answered
        {:else}
            Nudge the stragglers
        {/if}
    </button>
    {#if panel.msg}<p class="status small said" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
