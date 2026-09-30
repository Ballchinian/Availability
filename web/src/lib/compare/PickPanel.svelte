<script module lang="ts">
    //Who a narrowed list keeps, both what is sent and what the line above the button counts
    export function invitees(canMake: string[], unanswered: string[], askThem: boolean): string[] {
        return askThem ? [...canMake, ...unanswered] : canMake;
    }
</script>

<script lang="ts">
    import { untrack } from 'svelte';
    import { api } from '../api.js';
    import { formatDate } from '../format.js';
    import { formatHours } from '../hours.js';
    import { evaluateDay, type FreePerson } from '../overlap.js';
    import type { Participant } from '../types.js';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        The picked day: who it works for, and the controls that set the plan to it.
        Stays mounted while nothing is picked so the time survives clicking around the
        grid, which is how a planner compares two days.
    */
    let {
        planId,
        selectedDate = null,
        missAllowed = 0,
        freeByDate = {},
        unansweredByDate = {},
        participants = [],
        inCount = 0,
        totalParticipants = 0,
        chosen = null,
        quiet = false,
        onsaved
    }: {
        planId: string;
        selectedDate?: string | null;
        missAllowed?: number;
        freeByDate?: Record<string, FreePerson[]>;
        unansweredByDate?: Record<string, string[]>;
        participants?: Participant[];
        inCount?: number;
        totalParticipants?: number;
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
    //Who stays invited once the date is set: just the people who fit, or everyone
    let inviteMode = $state('attending');
    //Most of them just have not got round to it, and would say yes once there is a day
    let askUnanswered = $state(true);

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
        const ev = evaluateDay(free, inCount, missAllowed, unansweredByDate[day]?.length || 0);
        const freeSet = new Set(free.map((f) => f.userId));
        const missing = participants.filter((p) => p.confirmed && !freeSet.has(p.userId));
        const unanswered = participants.filter((p) => !p.confirmed);
        /*
            Nobody is dropped on a day that failed. keptIds comes back empty there,
            which read as everyone having been left out and struck the whole list through.
        */
        const droppedSet = new Set(ev.viable ? ev.droppedIds : []);
        return {
            free,
            ev,
            droppedSet,
            missing,
            unanswered
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

    /*
        Whether narrowing the guest list means anything. With nobody free on the day, and on
        a plan nobody has answered at all, "just the people who can make it" is nought people,
        and offering it as the default reads as an invitation to nobody.
    */
    const canNarrow = $derived(attendIds.length > 0);

    const inviteIds = $derived(invitees(attendIds, sel ? sel.unanswered.map((p) => p.userId) : [], askUnanswered));

    //The day the plan is already on, so the button edits the time rather than moving anything
    const isUpdate = $derived(Boolean(chosen && selectedDate === chosen.date));

    /*
        How many the invite list would lose if it were narrowed to the people who fit. Nought
        on the day the plan is already on: that edit never touches the list, so counting a
        narrowing there had the line naming fewer people than it goes on to DM.
    */
    const dropping = $derived(
        !isUpdate && canNarrow && inviteMode === 'attending' ? Math.max(0, totalParticipants - inviteIds.length) : 0
    );

    //Who an edit to a day that is staying put reaches: the list as it already stands, narrowed or not
    const invitedNow = $derived(participants.filter((p) => p.invited !== false).length);

    //Whether the picked day and time both already match what the plan is set for
    const isCurrent = $derived(Boolean(isUpdate && time === chosen!.time));

    /*
        An edited DM makes no sound, so a day moved quietly never reaches anyone who read
        the old one. Editing the time on a day that is staying put is what quiet mode is
        for and goes without this.
    */
    let owned = $state(false);
    const risky = $derived(quiet && !isUpdate);
    const blocked = $derived(risky && !owned);

    /*
        What pressing the button does to people, given the switches as they stand. Quiet
        and the invite radio each pull it a different way, and what they add up to is the
        one thing about this panel nothing else on screen shows.

        Takes a thread for granted the same way the invite list does: a plan whose thread has
        gone is what the repair panel is for.
    */
    const outcome = $derived.by(() => {
        const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
        const invited = people(totalParticipants - dropping);

        if (isUpdate) {
            return quiet
                ? 'Rewrites the pinned post and the DMs everyone already holds, and tells nobody.'
                : `Rewrites the pinned post and DMs ${people(invitedNow)} to say what changed.`;
        }

        if (quiet) {
            return 'Posts the yes/no in the thread pinging nobody, and quietly rewrites the DMs everyone already holds.';
        }
        return `Posts the yes/no in the thread, pings ${invited} and DMs them the same buttons. I'll DM you when everyone is in, or if someone can't make it.`;
    });

    async function lockIn() {
        await panel.run(async () => {
            await api(`/plans/${planId}/choose`, {
                method: 'POST',
                body: JSON.stringify({
                    date: selectedDate,
                    time: time || null,
                    inviteMode: canNarrow ? inviteMode : 'all',
                    attendingIds: inviteIds,
                    quiet
                })
            });
            //Refetch so the invite list and the board reflect what was just set
            await onsaved();
        });
    }
</script>

{#snippet lead()}
    <strong>{formatDate(selectedDate ?? '')}</strong>
{/snippet}

<!--Just the day: the grid's colouring and the slider already say how it came out.
    Mounted with nothing picked, so the day is read out when one is.-->
<div class:pick-panel={Boolean(sel)}>
    <Status children={sel ? lead : undefined} />
    {#if sel && selectedDate}
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

        {#if sel.unanswered.length && inCount > 0}
            <p class="muted small">Haven't answered this day: {sel.unanswered.map((p) => p.displayName).join(', ')}.</p>
        {/if}

        <label class="lbl" for="when">Time (optional)</label>
        <input id="when" type="time" bind:value={time} />

        <!--Only for a day that is moving. On the day the plan is already on there is no
            invite list to redraw.-->
        {#if !isUpdate && canNarrow}
            <fieldset>
                <legend class="lbl">Who is still invited?</legend>
                <label class="check"><input type="radio" name="invitemode" value="attending" bind:group={inviteMode} /> Just the people who can make it ({attendIds.length})</label>
                {#if inviteMode === 'attending' && sel.unanswered.length}
                    <label class="check sub"><input type="checkbox" bind:checked={askUnanswered} /> Ask the {sel.unanswered.length} who {sel.unanswered.length === 1 ? "hasn't" : "haven't"} answered this day too</label>
                {/if}
                <label class="check"><input type="radio" name="invitemode" value="all" bind:group={inviteMode} /> Everyone on the plan, even those who cannot ({totalParticipants})</label>
            </fieldset>
        {/if}

        <!--Said before it happens rather than found afterwards on the board, since the switches
            above show what they are set to and never what they come to together-->
        <p class="muted small">{outcome}</p>

        {#if risky}
            <p class="status error small">Anyone who has already read their DM keeps the old day, since nothing tells them to look again.</p>
            <label class="check"><input type="checkbox" bind:checked={owned} /> I know, set it quietly anyway</label>
        {/if}
        <Status class="status" msg={panel.msg} error={panel.failed} />
        <button class="primary" onclick={lockIn} disabled={panel.busy || isCurrent || blocked}>
            {#if panel.busy}Saving...{:else if isCurrent}Already set for {formatDate(selectedDate)}{:else if isUpdate}Update {formatDate(selectedDate)}{:else if chosen}Move it to {formatDate(selectedDate)}{:else}Set it to {formatDate(selectedDate)}{/if}
        </button>
    {/if}
</div>
