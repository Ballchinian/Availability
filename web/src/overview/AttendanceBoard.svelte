<script module lang="ts">
    //Claims the DM only when the route says it landed. They were never taken out of the thread.
    export function invitedLine(name: string, dm: boolean): string {
        return dm ? `Invited ${name}. They have the yes/no in their DMs.` : `Invited ${name}, but I couldn't DM them. They can still answer in the thread.`;
    }
</script>

<script lang="ts">
    import { api } from '../site/api.js';
    import type { Participant } from '../site/types.js';
    import { inOf } from '../../../shared/coverage.js';
    import { refocus } from '../site/focus.js';
    import Status from '../site/Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        The attendance board for a set date. Everyone still invited lands in a
        column by where they stand, a host's manual call winning over their own
        answer, and someone who said Not for me with no answer for the day under Can't
        make it. The uninvited sit apart, and inviting one sends them the yes/no.

        Whoever runs the plan moves people between columns. A guest gets the three
        columns to read and nothing else: who was left off the day, and what anyone
        said before a host's call, are the host's own working.
    */
    let { planId, participants = [], chosenDate = null, host = true, readOnly = false, onmoved }: {
        planId: string;
        participants?: Participant[];
        chosenDate?: string | null;
        host?: boolean;
        //A plan that is over, where whoever ran it still reads all of it
        readOnly?: boolean;
        onmoved: () => Promise<void>;
    } = $props();

    const canMove = $derived(host && !readOnly);

    const panel = new Panel();
    let picked = $state<string | null>(null);
    //One row of moves is open at a time, so one id does for every chip
    const uid = $props.id();
    let root = $state<HTMLDivElement>();

    const board = $derived.by(() => {
        if (!chosenDate) return null;
        const invited = participants.filter((p) => p.invited !== false);
        const stand = (p: Participant) => p.override || p.vote || (inOf(p) === false ? 'no' : 'waiting');
        return {
            coming: invited.filter((p) => stand(p) === 'yes'),
            waiting: invited.filter((p) => stand(p) === 'waiting'),
            cant: invited.filter((p) => stand(p) === 'no'),
            uninvited: participants.filter((p) => p.invited === false)
        };
    });

    //What the person actually said, shown in brackets when a planner overrode it
    function bracket(p: Participant): string {
        const out = !p.vote && inOf(p) === false;
        if (out && !p.override) return "said it's not for them";
        if (!p.override || p.override === p.vote) return '';
        if (p.vote === 'yes') return 'said coming';
        if (p.vote === 'no') return "said can't make it";
        return out ? "said it's not for them" : "hasn't answered";
    }

    /*
        The other two columns someone can be moved to from where they stand now. Not back to
        waiting for someone out with nothing to put aside: nothing is sent to them to answer.
    */
    function moveTargets(p: Participant, from: string) {
        const all = [
            { key: 'coming', label: 'coming' },
            { key: 'waiting', label: 'still to answer' },
            { key: 'cant', label: "can't make it" }
        ];
        const stuck = !p.vote && !p.override && inOf(p) === false;
        return all.filter((t) => t.key !== from && !(stuck && t.key === 'waiting'));
    }

    /*
        The buttons pressed to move someone go with them, so focus goes on to whoever was
        next in the list they left, and to the person themselves once that list is empty.
        Only once run is done: until then the next Invite them is disabled, and focusing
        a disabled button does nothing.
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
            return said(res.dm === true);
        });
        refocus(() => root?.querySelector<HTMLElement>(`[data-user="${next.userId}"]`));
    }
</script>

<!--A name with what a host knows about it beside it. A guest is sent none of that, and is not shown what it would add up to either.-->
{#snippet who(p: Participant)}
    {p.displayName}
    {#if host}
        {#if p.dmsClosed}<span class="muted small">(DMs closed, only reachable in the thread)</span>{/if}
        {#if p.sentBack}<span class="muted small">(moved back by {p.sentBack.byName})</span>{/if}
        {#if bracket(p)}<span class="muted small">({bracket(p)})</span>{/if}
        {#if p.vote === 'no' && !p.override && p.voteReason}<span class="muted small">({p.voteReason})</span>{/if}
        {#if !p.vote && p.inReason}<span class="muted small">({p.inReason})</span>{/if}
    {/if}
{/snippet}

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
                                {#if canMove}
                                    <button
                                        class="bchip"
                                        data-user={p.userId}
                                        class:picked={picked === p.userId}
                                        aria-expanded={picked === p.userId}
                                        aria-controls={picked === p.userId ? `${uid}-moves` : undefined}
                                        onclick={() => (picked = picked === p.userId ? null : p.userId)}
                                    >
                                        {@render who(p)}
                                    </button>
                                {:else}
                                    <span class="bstatic">{@render who(p)}</span>
                                {/if}
                                {#if canMove && picked === p.userId}
                                    <div class="move-row" id="{uid}-moves">
                                        {#each moveTargets(p, colDef.key) as t (t.key)}
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
        {#if host && board.uninvited.length}
            <div class="uninvited">
                <h3>Not invited to this date ({board.uninvited.length})</h3>
                <ul>
                    {#each board.uninvited as p (p.userId)}
                        <li class:plain={!canMove}>
                            <span>
                                {p.displayName}
                                {#if p.dmsClosed}<span class="muted small">(DMs closed, only reachable in the thread)</span>{/if}
                            </span>
                            {#if canMove}
                                <button class="ghost" data-user={p.userId} disabled={panel.busy} onclick={() => move(p, 'invite', board.uninvited, (dm) => invitedLine(p.displayName, dm))}>Invite them</button>
                            {/if}
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}
        <Status class="status small" msg={panel.msg} error={panel.failed} />
    </div>
{/if}
