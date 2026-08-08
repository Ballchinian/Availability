<script lang="ts">
    import { api } from '../api.js';
    import type { Participant } from '../types.js';
    import { Panel } from './panel.svelte.js';

    /*
        The yes/no headcount on a set date, as a switch. Closing keeps every answer,
        so reopening brings the tally back rather than starting people over.

        Said here the way the thread says it, "can you make it", rather than as
        confirming: this page already uses that word for filling dates in.
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
            //The panel flipping back to "Ask everyone if they can make it" is the confirmation
            if (!want) return;
            /*
                A revived poll is an edit, and Discord does not notify on an edit, so saying
                it reopened would leave a planner thinking people had been told.
            */
            return res.revived
                ? 'Asking again on the message that was already in the thread, with every answer still on it. Nobody was pinged, so nudge them if you want them chased.'
                : 'Asked everyone if they can make it.';
        });
    }
</script>

<div class="confirms">
    {#if active}
        <p class="muted small">
            You are <strong>asking who can make it</strong>: {tally.answered} of {tally.total} have answered,
            {tally.coming} coming. Stopping keeps every answer, and you can ask again later.
        </p>
        <button class="ghost" disabled={panel.busy} onclick={() => flip(false)}>
            {panel.busy ? 'Stopping...' : 'Stop asking'}
        </button>
    {:else}
        <p class="muted small">
            Nobody has been asked whether they can make this date.
            {#if tally.answered}Answers from before are still here, and asking again brings them back.{/if}
        </p>
        <button class="ghost" disabled={panel.busy} onclick={() => flip(true)}>
            {panel.busy ? 'Asking...' : 'Ask everyone if they can make it'}
        </button>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
