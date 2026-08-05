<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        The nudge for people who have not filled in their dates yet. The planner
        never has to wait for them, so this sits above the grid rather than in the
        way of it.
    */
    let { planId, waiting = [] }: {
        planId: string;
        waiting?: any[];
    } = $props();

    const panel = new Panel();

    async function remind() {
        await panel.run(async () => {
            const res = await api(`/plans/${planId}/remind`, { method: 'POST' });
            return res.pinged
                ? `Nudged ${res.pinged} ${res.pinged === 1 ? 'person' : 'people'}.`
                : 'Everyone has already confirmed.';
        });
    }
</script>

<div class="waiting">
    <p class="muted small">
        You do not have to wait for everyone, pick whenever you are ready. Still out:
        {waiting.map((p: any) => p.displayName).join(', ')}.
    </p>
    <button class="ghost" onclick={remind} disabled={panel.busy}>
        {panel.busy ? 'Nudging...' : 'Remind the stragglers'}
    </button>
    {#if panel.msg}<span class="status small" class:error={panel.failed}>{panel.msg}</span>{/if}
</div>
