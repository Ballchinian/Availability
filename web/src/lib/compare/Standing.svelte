<script lang="ts">
    import type { CompareScreen } from '../types.js';
    import { inOf } from '../../../../shared/coverage.js';
    import { todayIn } from '../zone.js';
    import PersonDialog from '../PersonDialog.svelte';
    import AnswerBoard, { owing } from './AnswerBoard.svelte';
    import AttendanceBoard from './AttendanceBoard.svelte';
    import RemindPanel from './RemindPanel.svelte';

    /*
        Where everyone stands: once the plan has a day, who is coming, and before that,
        where each person is with their answer. Whoever runs the plan can move people and
        nudge them from here. A guest reads the same columns, and so does everyone once
        the plan is over. Everything arrives as props so a test can draw it.

        While the plan is finding its day, a name also leads to that person's days. Not
        once it has one: someone coming has often marked that day busy since, and their
        calendar would say not free beside a name that says coming.
    */
    let { planId, data, host = true, over = false, onmoved }: {
        planId: string;
        data: CompareScreen;
        host?: boolean;
        //Called off, or its day has been, so nothing here can be changed
        over?: boolean;
        onmoved: () => Promise<void>;
    } = $props();

    const collecting = $derived(data.plan.status === 'collecting');
    const acting = $derived(host && !over);

    const waiting = $derived(owing(data.participants));

    //On the list, with no answer of their own and no call from a host standing in for one. Nobody out is nudged.
    const pendingVoters = $derived(
        data.plan.probeActive && data.plan.chosenDate
            ? data.participants.filter((p) => p.invited && !p.override && !p.vote && inOf(p) !== false)
            : []
    );

    /*
        Whose days the reader may look at: anyone who is in, when the days on this page
        came with names on them. A guest on a plan from before guests could see days is
        sent none, and nobody's days count until they are in.
    */
    const viewable = $derived(
        new Set((data.seesDays ?? true) ? data.participants.filter((p) => inOf(p) === true).map((p) => p.userId) : [])
    );
    let viewing = $state<string | null>(null);
    const viewed = $derived(data.participants.find((p) => p.userId === viewing));
</script>

<section class="group">
    <h2>{data.plan.chosenDate ? 'Where it stands' : 'Who has answered'}</h2>

    {#if data.plan.chosenDate}
        <AttendanceBoard {planId} participants={data.participants} chosenDate={data.plan.chosenDate} {host} readOnly={over} {onmoved} />

        {#if acting && pendingVoters.length}
            <RemindPanel {planId} waiting={pendingVoters} mode="vote" />
        {/if}
    {:else}
        <AnswerBoard {planId} participants={data.participants} {host} readOnly={over} {viewable} onview={(p) => (viewing = p.userId)} {onmoved} />

        <!--A plan with a day is waiting on answers, not dates-->
        {#if acting && collecting && waiting.length}
            <RemindPanel {planId} {waiting} />
        {/if}
    {/if}
</section>

{#if viewed}
    <PersonDialog
        person={viewed}
        freeByDate={data.freeByDate}
        asked={{ start: data.plan.start, end: data.plan.end, allowedWeekdays: data.plan.allowedWeekdays }}
        today={todayIn(data.plan.timeZone)}
        onclose={() => (viewing = null)}
    />
{/if}
