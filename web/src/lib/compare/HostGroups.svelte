<script module lang="ts">
    import type { Participant } from '../types.js';
    import type { Standing } from '../../../../shared/coverage.js';

    export const GROUPS: { key: Standing; title: string }[] = [
        { key: 'not-said', title: 'Not said yet' },
        { key: 'done', title: 'In, done' },
        { key: 'days-left', title: 'In, days left' },
        { key: 'no-dates', title: 'In, no dates yet' },
        { key: 'out', title: "Can't make it" }
    ];

    //An older backend sends no standing, only whether they filled in
    export function standingOf(p: Participant): Standing {
        return p.standing ?? (p.confirmed ? 'done' : 'not-said');
    }

    //Who the plan is still waiting on, which is who a nudge reaches
    export function owing(people: Participant[]): Participant[] {
        return people.filter((p) => ['not-said', 'days-left', 'no-dates'].includes(standingOf(p)));
    }

    export function updatedLine(days: number | null): string {
        if (days === null) return '';
        if (days < 1) return 'calendar updated today';
        return days === 1 ? 'calendar updated yesterday' : `calendar updated ${days} days ago`;
    }

    //Claims the DM only when the route says it landed
    export function askedLine(name: string, dm: boolean): string {
        return dm ? `Asked ${name} again. I DMed them.` : `Asked ${name} again, but I couldn't DM them. They can still answer in the thread.`;
    }
</script>

<script lang="ts">
    import { api } from '../api.js';
    import { daysSince } from '../calendar.js';
    import { refocus } from '../focus.js';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        Where everyone stands on a plan still finding its day, worked out from their
        calendars every load, so a moved window moves people on its own. Whoever runs
        the plan can ask again anyone who hasn't said it's not for them. A guest reads
        the groups, with how many days someone has left and nothing else beside a name.
    */
    let { planId, participants = [], host = true, readOnly = false, onmoved }: {
        planId: string;
        participants?: Participant[];
        host?: boolean;
        //A plan that is over, only there to look back at
        readOnly?: boolean;
        onmoved: () => Promise<void>;
    } = $props();

    const canAsk = $derived(host && !readOnly);

    const panel = new Panel();
    let picked = $state<string | null>(null);
    const uid = $props.id();
    let root = $state<HTMLDivElement>();

    const groups = $derived(
        GROUPS.map((g) => ({ ...g, people: participants.filter((p) => standingOf(p) === g.key) })).filter((g) => g.people.length)
    );

    function notes(p: Participant): string {
        const bits: string[] = [];
        if (standingOf(p) === 'days-left' && p.daysLeft) bits.push(`${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left`);
        //The rest is what whoever runs the plan works from. A guest is sent none of it, and is shown none either way.
        if (!host) return bits.join(', ');
        if (p.sentBack) bits.push(`moved back by ${p.sentBack.byName}`);
        if (p.inReason) bits.push(p.inReason);
        if (p.dmsClosed) bits.push('DMs closed, only reachable in the thread');
        const updated = updatedLine(p.updatedAt ? daysSince(p.updatedAt) : null);
        if (updated) bits.push(updated);
        return bits.join(', ');
    }

    //Asking someone in sends them back, which moves them to no dates yet, so focus follows them there
    async function ask(p: Participant) {
        await panel.run(async () => {
            const res = await api<{ dm?: boolean }>(`/plans/${planId}/askagain`, {
                method: 'POST',
                body: JSON.stringify({ userId: p.userId })
            });
            picked = null;
            await onmoved();
            return askedLine(p.displayName, res.dm === true);
        });
        refocus(() => root?.querySelector<HTMLElement>(`[data-user="${p.userId}"]`));
    }
</script>

<div class="votes" bind:this={root}>
    <div class="board">
        {#each groups as g (g.key)}
            <div class="bcol">
                <h3>{g.title} ({g.people.length})</h3>
                <ul>
                    {#each g.people as p (p.userId)}
                        <li>
                            {#if !canAsk || g.key === 'out'}
                                <span class="bstatic">
                                    {p.displayName}
                                    {#if notes(p)}<span class="muted small">{notes(p)}</span>{/if}
                                </span>
                            {:else}
                                <button
                                    class="bchip"
                                    data-user={p.userId}
                                    class:picked={picked === p.userId}
                                    aria-expanded={picked === p.userId}
                                    aria-controls={picked === p.userId ? `${uid}-moves` : undefined}
                                    onclick={() => (picked = picked === p.userId ? null : p.userId)}
                                >
                                    {p.displayName}
                                    {#if notes(p)}<span class="muted small">{notes(p)}</span>{/if}
                                </button>
                                {#if picked === p.userId}
                                    <div class="move-row" id="{uid}-moves">
                                        <button class="ghost" disabled={panel.busy} onclick={() => ask(p)}>Ask again</button>
                                        <span class="muted small aside">
                                            {g.key === 'not-said'
                                                ? "I'll DM them now. They can answer whenever they like."
                                                : "I'll DM them now. Their calendar stops counting here until they save again."}
                                        </span>
                                    </div>
                                {/if}
                            {/if}
                        </li>
                    {/each}
                </ul>
            </div>
        {/each}
    </div>
    <Status class="status small" msg={panel.msg} error={panel.failed} />
</div>
