<script lang="ts">
    import { api } from '../api.js';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        For when Discord and the plan have drifted apart: somebody deleted the pinned post,
        or an announcement went out while Discord was down and only the log knows. Sends
        nothing and pings nobody, so it needs no step before it.
    */
    let { planId }: { planId: string } = $props();

    const panel = new Panel();

    async function repair() {
        await panel.run(async () => {
            const res = await api<{ cards: number; holders: number; thread: boolean }>(`/plans/${planId}/repair`, { method: 'POST' });
            const thread = res.thread ? 'Pinned post put right. ' : '';
            if (!res.holders) return `${thread}Nobody is holding a DM about this plan, so there was none to correct.`;
            //Named rather than glossed: the gap is people who binned their DM or have them closed
            const missed = res.holders - res.cards;
            return `${thread}Corrected ${res.cards} of ${res.holders} DMs.` +
                (missed ? ` ${missed} could not be reached, which usually means they deleted theirs or have DMs off.` : '');
        });
    }
</script>

<p class="muted small repair">
    Something missing in Discord?
    <button class="link-btn" onclick={repair} disabled={panel.busy}>{panel.busy ? 'Putting it back...' : 'Put it back'}</button>
</p>
<Status class="status small" msg={panel.msg} error={panel.failed} />
