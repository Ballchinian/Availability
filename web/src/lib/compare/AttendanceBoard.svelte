<script module lang="ts">
    //Claims the DM only when the route says it landed. They were never taken out of the thread.
    export function invitedLine(name: string, dm: boolean): string {
        return dm ? `Invited ${name}. They have the yes/no in their DMs.` : `Invited ${name}, but I couldn't DM them. They can still answer in the thread.`;
    }
</script>

<script lang="ts">
    import { api } from '../api.js';
    import type { Participant } from '../types.js';
    import { refocus } from '../focus.js';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        The attendance board for a set date. Everyone still invited lands in a
        column by where they stand, a planner's manual call winning over their own
        answer. The uninvited sit apart, and inviting one sends them the yes/no.
    */
    let { planId, participants = [], chosenDate = null, onmoved }: {
        planId: string;
        participants?: Participant[];
        chosenDate?: string | null;
        onmoved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let picked = $state<string | null>(null);
    //One row of moves is open at a time, so one id does for every chip
    const uid = $props.id();
    let root = $state<HTMLDivElement>();

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

    /*
        The buttons pressed to move someone go with them, so focus goes on to whoever was
        next in the list they left, and to the person themselves once that list is empty.
    */
    async function move(p: Participant, status: string, from: Participant[], said: (dm: boolean) => string) {
        const at = from.findIndex((q) => q.userId === p.userId);
        const next = from[at + 1] ?? from[at - 1] ?? p;
        await panel.run(async () => {
            const res = await api<{ dm?: boolean }>(`/plans/${planId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ userId: p.userId, status })
            });
            picked = null;
            await onmoved();
            refocus(() => root?.querySelector<HTMLElement>(`[data-user="${next.userId}"]`));
            return said(res.dm === true);
        });
    }
</script>

{#if board && chosenDate}
    <div class="votes" bind:this={root}>
        <div class="board">
            {#each [
                { key: 'coming', title: 'Coming', people: board.coming },
                { key: 'waiting', title: 'Waiting to answer', people: board.waiting },
                { key: 'cant', title: "Can't make it", people: board.cant }
            ] as colDef (colDef.key)}
                <div class="bcol">
                    <h3>{colDef.title} ({colDef.people.length})</h3>
                    <ul>
                        {#each colDef.people as p (p.userId)}
                            <li>
                                <button
                                    class="bchip"
                                    data-user={p.userId}
                                    class:picked={picked === p.userId}
                                    aria-expanded={picked === p.userId}
                                    aria-controls={picked === p.userId ? `${uid}-moves` : undefined}
                                    onclick={() => (picked = picked === p.userId ? null : p.userId)}
                                >
                                    {p.displayName}
                                    {#if bracket(p)}<span class="muted small">({bracket(p)})</span>{/if}
                                    {#if p.vote === 'no' && !p.override && p.voteReason}<span class="muted small">({p.voteReason})</span>{/if}
                                </button>
                                {#if picked === p.userId}
                                    <div class="move-row" id="{uid}-moves">
                                        {#each moveTargets(colDef.key) as t (t.key)}
                                            <button class="ghost" disabled={panel.busy} onclick={() => move(p, t.key, colDef.people, () => `Marked ${p.displayName} as ${t.label}.`)}>Mark as {t.label}</button>
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
                            <button class="ghost" data-user={p.userId} disabled={panel.busy} onclick={() => move(p, 'invite', board.uninvited, (dm) => invitedLine(p.displayName, dm))}>Invite them</button>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}
        <Status class="status small" msg={panel.msg} error={panel.failed} />
    </div>
{/if}
