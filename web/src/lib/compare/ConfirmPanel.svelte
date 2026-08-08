<script lang="ts">
    import { api } from '../api.js';
    import type { Participant } from '../types.js';
    import { Panel } from './panel.svelte.js';

    /*
        The yes/no confirmation on a set date, as a switch. Closing keeps every answer,
        so reopening brings the tally back rather than starting people over.
    */
    let { planId, active = false, participants = [], quiet = false, onchanged }: {
        planId: string;
        active?: boolean;
        quiet?: boolean;
        participants?: Participant[];
        onchanged: () => Promise<void>;
    } = $props();

    const panel = new Panel();

    const tally = $derived.by(() => {
        const invited = participants.filter((p) => p.invited !== false);
        const stand = (p: Participant) => p.override || p.vote;
        return {
            total: invited.length,
            answered: invited.filter((p) => stand(p)).length,
            coming: invited.filter((p) => stand(p) === 'yes').length
        };
    });

    async function flip(want: boolean) {
        await panel.run(async () => {
            const res = await api<{ revived: boolean }>(`/plans/${planId}/confirmations`, {
                method: 'POST',
                body: JSON.stringify({ active: want, quiet })
            });
            await onchanged();
            if (!want) return 'Confirmations closed. Everyone keeps the answer they gave.';
            /*
                A revived poll is an edit, and Discord does not notify on an edit, so saying
                it reopened would leave a planner thinking people had been told.
            */
            return res.revived
                ? 'Reopened on the message that was already in the thread, with every answer still on it. Nobody was pinged, so nudge them if you want them chased.'
                : 'Asked everyone to confirm.';
        });
    }
</script>

<div class="confirms">
    {#if active}
        <p class="muted small">
            Confirmations are <strong>running</strong>: {tally.answered} of {tally.total} have answered,
            {tally.coming} coming. Closing keeps every answer, and you can open it again later.
        </p>
        <button class="ghost" disabled={panel.busy} onclick={() => flip(false)}>
            {panel.busy ? 'Closing...' : 'Close the confirmations'}
        </button>
    {:else}
        <p class="muted small">
            Nobody has been asked to confirm this date.
            {#if tally.answered}Answers from before are still here, and reopening brings them back.{/if}
        </p>
        <button class="ghost" disabled={panel.busy} onclick={() => flip(true)}>
            {panel.busy ? 'Asking...' : 'Ask everyone to confirm they can make it'}
        </button>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
