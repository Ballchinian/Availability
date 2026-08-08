<script lang="ts">
    import { api } from '../api.js';
    import type { Participant } from '../types.js';
    import { Panel } from './panel.svelte.js';

    /*
        The attendance board for a set date. Everyone still invited lands in a
        column by where they stand, a planner's manual call winning over their own
        answer. The uninvited sit apart with a way back in.
    */
    let { planId, participants = [], chosenDate = null, onmoved }: {
        planId: string;
        participants?: Participant[];
        chosenDate?: string | null;
        onmoved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let picked = $state<string | null>(null);

    const board = $derived.by(() => {
        if (!chosenDate) return null;
        const invited = participants.filter((p) => p.invited !== false);
        const stand = (p: Participant) => p.override || p.vote || 'waiting';
        return {
            coming: invited.filter((p) => stand(p) === 'yes'),
            waiting: invited.filter((p) => stand(p) === 'waiting'),
            cant: invited.filter((p) => stand(p) === 'no'),
            uninvited: participants.filter((p) => p.invited === false)
        };
    });

    //What the person actually said, shown in brackets when a planner overrode it
    function bracket(p: Participant): string {
        if (!p.override || p.override === p.vote) return '';
        if (p.vote === 'yes') return 'said coming';
        if (p.vote === 'no') return "said can't make it";
        return "hasn't answered";
    }

    //The other two columns someone can be moved to from where they stand now
    function moveTargets(from: string) {
        const all = [
            { key: 'coming', label: 'coming' },
            { key: 'waiting', label: 'still to answer' },
            { key: 'cant', label: "can't make it" }
        ];
        return all.filter((t) => t.key !== from);
    }

    async function move(userId: string, status: string) {
        await panel.run(async () => {
            await api(`/plans/${planId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ userId, status })
            });
            picked = null;
            await onmoved();
        });
    }
</script>

{#if board && chosenDate}
    <div class="votes">
        <div class="board">
            {#each [
                { key: 'coming', title: 'Coming', people: board.coming },
                { key: 'waiting', title: 'Waiting to answer', people: board.waiting },
                { key: 'cant', title: "Can't make it", people: board.cant }
            ] as colDef (colDef.key)}
                <div class="bcol">
                    <h4>{colDef.title} ({colDef.people.length})</h4>
                    <ul>
                        {#each colDef.people as p (p.userId)}
                            <li>
                                <button class="bchip" class:picked={picked === p.userId} onclick={() => (picked = picked === p.userId ? null : p.userId)}>
                                    {p.displayName}
                                    {#if bracket(p)}<span class="muted small">({bracket(p)})</span>{/if}
                                    {#if p.vote === 'no' && !p.override && p.voteReason}<span class="muted small">({p.voteReason})</span>{/if}
                                </button>
                                {#if picked === p.userId}
                                    <div class="move-row">
                                        {#each moveTargets(colDef.key) as t (t.key)}
                                            <button class="ghost" disabled={panel.busy} onclick={() => move(p.userId, t.key)}>Mark as {t.label}</button>
                                        {/each}
                                        <!--The one thing the columns cannot show, said where the move is made-->
                                        <span class="muted small aside">They are not told, and answering later replaces this.</span>
                                    </div>
                                {/if}
                            </li>
                        {/each}
                        {#if !colDef.people.length}
                            <li class="bempty">Nobody here.</li>
                        {/if}
                    </ul>
                </div>
            {/each}
        </div>
        {#if board.uninvited.length}
            <div class="uninvited">
                <p class="muted small">Not invited to this date, so no ping and no DM. Moving or undoing the date invites everyone back.</p>
                <ul>
                    {#each board.uninvited as p (p.userId)}
                        <li>
                            <span>{p.displayName}</span>
                            <button class="ghost" disabled={panel.busy} onclick={() => move(p.userId, 'coming')}>Let them come</button>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}
        {#if panel.msg}<p class="status error small" aria-live="polite">{panel.msg}</p>{/if}
    </div>
{/if}
