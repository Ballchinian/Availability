<script lang="ts">
    import { untrack } from 'svelte';
    import { api } from '../api.js';
    import { formatDate } from '../format.js';
    import { formatHours } from '../hours.js';
    import { evaluateDay, type FreePerson } from '../overlap.js';
    import { Panel } from './panel.svelte.js';

    /*
        The picked day: who it works for, and the controls that set the plan to it.
        Stays mounted while nothing is picked so the time and note survive clicking
        around the grid, which is how a planner compares two days.
    */
    let {
        planId,
        selectedDate = null,
        missAllowed = 0,
        freeByDate = {},
        unsureByDate = {},
        participants = [],
        confirmedCount = 0,
        totalParticipants = 0,
        probeActive = false,
        chosen = null,
        onsaved
    }: {
        planId: string;
        selectedDate?: string | null;
        missAllowed?: number;
        freeByDate?: Record<string, FreePerson[]>;
        unsureByDate?: Record<string, number>;
        participants?: any[];
        confirmedCount?: number;
        totalParticipants?: number;
        probeActive?: boolean;
        chosen?: { date: string; time: string; note: string } | null;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();

    /*
        What the plan is already set for is only where these start: from then on
        they are the planner's working copy, so clicking a second day to compare
        it never costs them what they typed for the first.
    */
    let time = $state(untrack(() => chosen?.time || ''));
    let note = $state(untrack(() => chosen?.note || ''));
    //A live probe shows as ticked, so the box reads as the state the plan is in
    let probe = $state(untrack(() => probeActive));
    //Who stays invited once the date is set: just the people who fit, or everyone
    let inviteMode = $state('attending');

    const byId = $derived.by(() => {
        const m: Record<string, any> = {};
        for (const p of participants) m[p.userId] = p;
        return m;
    });

    //The picked day, run through the same overlap maths the grid uses
    const sel = $derived.by(() => {
        if (!selectedDate) return null;
        const day = selectedDate;
        const free = freeByDate[day] || [];
        const unsure = unsureByDate[day] || 0;
        const ev = evaluateDay(free, confirmedCount, missAllowed, unsure);
        const freeSet = new Set(free.map((f) => f.userId));
        const unsurePeople = participants.filter(
            (p: any) => p.confirmed && p.sureUntil && day > p.sureUntil && !freeSet.has(p.userId)
        );
        return { free, ev, keptSet: new Set(ev.keptIds), counted: confirmedCount - unsure, unsurePeople };
    });

    /*
        Who counts as able to make the picked day. On a viable day it is the kept set
        from the miss slider, on a day outside the slider it falls back to whoever
        marked the day free, so "just the people who can make it" always means something.
    */
    const attendIds = $derived.by<string[]>(() => {
        if (!sel) return [];
        return sel.ev.viable ? sel.ev.keptIds : sel.free.map((f) => f.userId);
    });

    //Whether the picked day, time and note all already match what the plan is set for
    const sameDetails = $derived(Boolean(
        chosen &&
        selectedDate === chosen.date &&
        time === chosen.time &&
        note.trim() === chosen.note
    ));

    /*
        Asking for a confirmation round is a change in its own right. Without it in
        the check, a date set without one leaves the button greyed out for good and
        the only way to start a probe is fiddling with the time or note.
    */
    const probeWanted = $derived(probe && !probeActive);

    const isCurrent = $derived(sameDetails && !probeWanted);

    async function lockIn() {
        await panel.run(async () => {
            await api(`/plans/${planId}/choose`, {
                method: 'POST',
                body: JSON.stringify({
                    date: selectedDate,
                    time: time || null,
                    note: note.trim() || null,
                    inviteMode,
                    attendingIds: attendIds,
                    probe
                })
            });
            //Refetch so the invite list and the board reflect what was just set
            await onsaved();
        });
    }
</script>

{#if sel && selectedDate}
    <div class="pick-panel">
        {#if sel.ev.viable}
            <p><strong>{formatDate(selectedDate)}</strong> works for {sel.ev.keptIds.length} of {sel.counted}, common time <strong>{formatHours(sel.ev.window)}</strong>.</p>
        {:else}
            <p><strong>{formatDate(selectedDate)}</strong>: {sel.free.length} of {sel.counted} marked this day free. It is outside your miss slider, but you can still set it.</p>
        {/if}

        <ul class="who">
            {#each sel.free as f (f.userId)}
                <li class:dropped={!sel.keptSet.has(f.userId)}>
                    {byId[f.userId]?.displayName || 'Someone'}: {formatHours(f.hours)}
                    {#if !sel.keptSet.has(f.userId)}<span class="muted small">(not counted)</span>{/if}
                </li>
            {/each}
        </ul>

        {#if sel.unsurePeople.length}
            <p class="muted small">
                Too far ahead to say for {sel.unsurePeople.map((p: any) => p.displayName).join(', ')}.
                They are not counted either way, and once the date is set you can move them onto the board yourself.
            </p>
        {/if}

        <label class="lbl" for="when">Time (optional)</label>
        <input id="when" type="time" bind:value={time} />

        <label class="lbl" for="cnote">Note (optional)</label>
        <input id="cnote" type="text" bind:value={note} placeholder="e.g. meet at the station, bring boots" maxlength="200" />

        <p class="muted small">Who is still invited?</p>
        <label class="check"><input type="radio" name="invitemode" value="attending" bind:group={inviteMode} /> Just the people who can make it ({attendIds.length})</label>
        <label class="check"><input type="radio" name="invitemode" value="all" bind:group={inviteMode} /> Everyone on the plan, even those who cannot ({totalParticipants})</label>
        <p class="muted small">The outcome goes in the thread and everyone still invited gets a DM.</p>
        <label class="check"><input type="checkbox" bind:checked={probe} /> Ask everyone to confirm they're coming (yes/no)</label>
        {#if probe}
            <p class="muted small">Everyone still invited gets yes/no buttons in the thread and by DM. I'll DM you when everyone is in, or if someone can't make it. Their votes show up below.</p>
        {/if}
        {#if panel.msg}<p class="status" class:error={panel.failed}>{panel.msg}</p>{/if}
        <button class="primary" onclick={lockIn} disabled={panel.busy || isCurrent}>
            {#if panel.busy}Saving...{:else if isCurrent}Already set for {formatDate(selectedDate)}{:else if sameDetails}Ask everyone to confirm{:else if chosen && selectedDate === chosen.date}Update {formatDate(selectedDate)}{:else if chosen}Move it to {formatDate(selectedDate)}{:else}Confirm {formatDate(selectedDate)}{/if}
        </button>
    </div>
{/if}
