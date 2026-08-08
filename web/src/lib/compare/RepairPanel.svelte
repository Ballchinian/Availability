<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        For when Discord and the plan have drifted apart: somebody deleted the pinned post,
        or an announcement went out while Discord was down and only the log knows.
    */
    let { planId }: { planId: string } = $props();

    const panel = new Panel();

    async function repair() {
        await panel.run(async () => {
            const res = await api<{ cards: number; holders: number; thread: boolean }>(
                `/plans/${planId}/repair`,
                { method: 'POST' }
            );
            const thread = res.thread ? 'Thread post and yes/no message put right. ' : '';
            if (!res.holders) return `${thread}Nobody is holding a DM about this plan, so there was none to correct.`;
            //Named rather than glossed: the gap is people who binned their DM or have them closed
            const missed = res.holders - res.cards;
            return `${thread}Corrected ${res.cards} of ${res.holders} DMs.` +
                (missed ? ` ${missed} could not be reached, which usually means they deleted theirs or have DMs off.` : '');
        });
    }
</script>

<div class="repair">
    <p class="muted small">
        Out of step with Discord? This rewrites the pinned post, the yes/no message and everyone's DM
        from the plan as it stands, and puts back anything that has been deleted. Nothing is sent and
        nobody is pinged, so it is safe to press whenever something looks wrong.
    </p>
    <button class="ghost" onclick={repair} disabled={panel.busy}>
        {panel.busy ? 'Fixing up...' : 'Fix up Discord'}
    </button>
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
