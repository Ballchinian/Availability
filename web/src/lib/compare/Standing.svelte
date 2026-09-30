<script lang="ts">
    import { formatDate, formatTime } from '../format.js';
    import type { CompareScreen } from '../types.js';
    import ClockNote from '../ClockNote.svelte';
    import AttendanceBoard from './AttendanceBoard.svelte';
    import RemindPanel from './RemindPanel.svelte';

    /*
        Where the plan stands: once it has a day, the day and who is coming, and before
        that, how many have filled in. Everything arrives as props so a test can draw it,
        which the page around it, loading in onMount, never can be.
    */
    let { planId, data, chosen, cancelled = false, onmoved, box = $bindable() }: {
        planId: string;
        data: CompareScreen;
        chosen: { date: string; time: string; note: string } | null;
        cancelled?: boolean;
        onmoved: () => Promise<void>;
        //The line saying what the plan is set for, where focus goes once a day is set
        box?: HTMLElement;
    } = $props();

    const collecting = $derived(data.plan.status === 'collecting');

    const unconfirmed = $derived(data.participants.filter((p) => !p.confirmed));

    //A plan with a day is waiting on answers, not dates
    const nudging = $derived(collecting && unconfirmed.length > 0 && !cancelled);

    //On the list, with no answer of their own and no call from a planner standing in for one
    const pendingVoters = $derived(
        data.plan.probeActive && data.plan.chosenDate
            ? data.participants.filter((p) => p.invited && !p.override && !p.vote)
            : []
    );
</script>

<section class="group">
    <h2>{chosen ? 'Where it stands' : 'Which day?'}</h2>

    {#if chosen}
        <!--A box rather than one paragraph: the clock note is a paragraph of its own that
            says nothing at all when everyone shares a clock, and hanging it off a <br />
            left an empty line in the box for everybody who does-->
        <div class="prompt good" bind:this={box}>
            <p>
                <strong>{data.plan.name}</strong> {cancelled ? 'was set for' : 'is set for'}
                {formatDate(chosen.date)}{chosen.time ? ` at ${formatTime(chosen.time)}` : ''}.
            </p>
            {#if chosen.time}<ClockNote zone={data.plan.timeZone} date={chosen.date} time={chosen.time} />{/if}
            {#if chosen.note}<p>{chosen.note}</p>{/if}
        </div>

        {#if !cancelled}
            <AttendanceBoard {planId} participants={data.participants} chosenDate={data.plan.chosenDate} {onmoved} />

            {#if pendingVoters.length}
                <RemindPanel {planId} waiting={pendingVoters} mode="vote" />
            {/if}
        {/if}
    {/if}

    <!--Never once there is a day. Under the nudge on a set day it read as if the nudge were about dates.-->
    {#if !chosen && (collecting || data.confirmedCount > 0)}
        <p class="status">{data.confirmedCount} of {data.totalParticipants} have filled in their dates.</p>
    {/if}

    {#if nudging}
        <RemindPanel {planId} waiting={unconfirmed} />
    {/if}
</section>
