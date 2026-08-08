<script lang="ts">
    import { untrack } from 'svelte';
    import { api } from '../api.js';
    import { formatDate } from '../format.js';
    import { formatHours } from '../hours.js';
    import { evaluateDay, explainDay, type FreePerson } from '../overlap.js';
    import type { Participant } from '../types.js';
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
        quiet = false,
        onsaved
    }: {
        planId: string;
        selectedDate?: string | null;
        missAllowed?: number;
        freeByDate?: Record<string, FreePerson[]>;
        unsureByDate?: Record<string, number>;
        participants?: Participant[];
        confirmedCount?: number;
        totalParticipants?: number;
        probeActive?: boolean;
        quiet?: boolean;
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
    //Only ever starts one. A confirmation already running is ConfirmPanel's, since a box
    //captured at mount cannot show a state that moves under it.
    let probe = $state(false);
    //Who stays invited once the date is set: just the people who fit, or everyone
    let inviteMode = $state('attending');

    const byId = $derived.by(() => {
        const m: Record<string, Participant> = {};
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
            (p) => p.confirmed && p.sureUntil && day > p.sureUntil && !freeSet.has(p.userId)
        );
        const unsureIds = new Set(unsurePeople.map((p) => p.userId));
        //Confirmed, near enough to say, and did not mark the day: the half of "why is this dim" that has names
        const missing = participants.filter((p) => p.confirmed && !freeSet.has(p.userId) && !unsureIds.has(p.userId));
        /*
            Nobody is dropped on a day that failed. keptIds comes back empty there,
            which read as everyone having been left out and struck the whole list through.
        */
        const droppedSet = new Set(ev.viable ? ev.droppedIds : []);
        return {
            free,
            ev,
            droppedSet,
            counted: confirmedCount - unsure,
            unsurePeople,
            missing,
            reason: ev.viable ? null : explainDay(free, confirmedCount, missAllowed, unsure)
        };
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

    //The day the plan is already on, so the button edits the time and note rather than moving anything
    const isUpdate = $derived(Boolean(chosen && selectedDate === chosen.date));

    //Whether the picked day, time and note all already match what the plan is set for
    const sameDetails = $derived(Boolean(isUpdate && time === chosen!.time && note.trim() === chosen!.note));

    /*
        Asking for a confirmation is a change in its own right, so the button cannot grey
        out on it. Only offered on a day that is moving, since ConfirmPanel owns a
        confirmation on the day the plan is already on.
    */
    const probeWanted = $derived(probe && !probeActive && !isUpdate);

    const isCurrent = $derived(sameDetails && !probeWanted);

    /*
        An edited DM makes no sound, so a day moved quietly never reaches anyone who read
        the old one. Editing a time or note on a day that is staying put is what quiet mode
        is for and goes without this.
    */
    let owned = $state(false);
    const risky = $derived(quiet && !isUpdate);
    const blocked = $derived(risky && !owned);

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
                    probe,
                    quiet
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
            <!--Says which of the two dim days this is, since the grid can only say that it is one.
                The title attribute carried this and never showed up on a phone.-->
            <p>
                <strong>{formatDate(selectedDate)}</strong>
                {#if sel.reason?.block === 'nobody'}
                    is past everyone's sure-up-to date, so nobody is counted on it.
                {:else if sel.reason?.block === 'missing'}
                    is dim because {sel.missing.length} of {sel.counted} did not mark it free, and you are
                    {missAllowed ? `only willing to miss ${missAllowed}` : 'not willing to miss anyone'}.
                {:else}
                    is dim because the {sel.free.length} people free on it share no hour between them.
                {/if}
                {#if sel.reason?.needMiss != null}
                    Willing to miss {sel.reason.needMiss}? Then it works.
                {/if}
                You can still set it.
            </p>
        {/if}

        <ul class="who">
            {#each sel.free as f (f.userId)}
                <li class:dropped={sel.droppedSet.has(f.userId)}>
                    {byId[f.userId]?.displayName || 'Someone'}: {formatHours(f.hours)}
                    {#if sel.droppedSet.has(f.userId)}<span class="muted small">(not counted)</span>{/if}
                </li>
            {/each}
        </ul>

        {#if sel.missing.length}
            <p class="muted small">Not free on this day: {sel.missing.map((p) => p.displayName).join(', ')}.</p>
        {/if}

        {#if sel.unsurePeople.length}
            <p class="muted small">
                Too far ahead to say for {sel.unsurePeople.map((p) => p.displayName).join(', ')}.
                They are not counted either way, and once the date is set you can move them onto the board yourself.
            </p>
        {/if}

        <label class="lbl" for="when">Time (optional)</label>
        <input id="when" type="time" bind:value={time} />

        <label class="lbl" for="cnote">Note (optional)</label>
        <input id="cnote" type="text" bind:value={note} placeholder="e.g. meet at the station, bring boots" maxlength="200" />

        <!--Both only make sense for a day that is moving. On the day the plan is already on
            there is no invite list to redraw, and the confirmation belongs to ConfirmPanel.-->
        {#if !isUpdate}
            <div role="radiogroup" aria-labelledby="invitelabel">
                <span class="lbl" id="invitelabel">Who is still invited?</span>
                <label class="check"><input type="radio" name="invitemode" value="attending" bind:group={inviteMode} /> Just the people who can make it ({attendIds.length})</label>
                <label class="check"><input type="radio" name="invitemode" value="all" bind:group={inviteMode} /> Everyone on the plan, even those who cannot ({totalParticipants})</label>
            </div>
            <p class="muted small">The outcome goes in the thread and everyone still invited gets a DM.</p>
            {#if !probeActive}
                <label class="check"><input type="checkbox" bind:checked={probe} /> Ask everyone to confirm they're coming (yes/no)</label>
                {#if probe}
                    <p class="muted small">Everyone still invited gets yes/no buttons in the thread and by DM. I'll DM you when everyone is in, or if someone can't make it.</p>
                {/if}
            {/if}
        {:else}
            <p class="muted small">
                Changing the time or the note leaves everything else alone: nobody's answer is cleared,
                the confirmation keeps running, and the invite list stays as it is. Everyone's DM and the
                pinned post are rewritten where they sit, and the people coming get told what moved.
            </p>
        {/if}
        {#if risky}
            <p class="status error small">
                Quiet mode is on and this sets the day itself. Everyone's DM will say the new day,
                but nothing will tell them to look, so anyone who has read theirs keeps the old one.
            </p>
            <label class="check"><input type="checkbox" bind:checked={owned} /> I know, set it quietly anyway</label>
        {/if}
        {#if panel.msg}<p class="status" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
        <button class="primary" onclick={lockIn} disabled={panel.busy || isCurrent || blocked}>
            {#if panel.busy}Saving...{:else if isCurrent}Already set for {formatDate(selectedDate)}{:else if isUpdate}Update {formatDate(selectedDate)}{:else if chosen}Move it to {formatDate(selectedDate)}{:else}Confirm {formatDate(selectedDate)}{/if}
        </button>
    </div>
{/if}
