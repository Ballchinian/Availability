<script module lang="ts">
    import { datesPassed } from '../../../shared/coverage.js';
    import type { PlanShape } from '../calendar/calendar.js';
    import { describeRepeat, formatDate, formatTime } from '../site/format.js';
    import type { ComparePlan } from '../site/types.js';

    //What kind of plan it is and where it has got to, the line under its name
    export function planState(plan: ComparePlan, today: string): string {
        const when = plan.chosenDate ? `${formatDate(plan.chosenDate)}${plan.chosenTime ? ` at ${formatTime(plan.chosenTime)}` : ''}` : '';
        if (plan.status === 'cancelled') return when ? `Called off. It was set for ${when}` : 'Called off';
        if (!when) return datesPassed(plan, today) ? 'The dates it asked about have passed' : `Finding a day, ${formatDate(plan.start)} to ${formatDate(plan.end)}`;
        return plan.chosenDate! < today ? `Was on ${when}` : `Set for ${when}`;
    }

    //How a plan comes round, who set it to, and when next, which is nothing to say until it has a day
    export function repeatLine(plan: ComparePlan, series: PlanShape[]): string {
        const every = describeRepeat(plan.repeatWeeks);
        const how = `${every.charAt(0).toUpperCase()}${every.slice(1)}${plan.repeatBy ? `, set by ${plan.repeatBy}` : ''}`;
        if (!plan.chosenDate) return `${how}, once it has a day.`;
        if (!series.length) return `${how}. Nothing follows this one, since the next would land past the two years anything here reaches.`;
        return `${how}. Next one ${formatDate(series[0].chosen.date)}, made once this day has been.`;
    }
</script>

<script lang="ts">
    import { untrack } from 'svelte';
    import { repeatSeries } from '../calendar/calendar.js';
    import { listNames } from '../site/format.js';
    import type { CompareScreen, LeftPlan } from '../site/types.js';
    import { todayIn } from '../calendar/zone.js';
    import { refocus } from '../site/focus.js';
    import ClockNote from '../calendar/ClockNote.svelte';
    import CancelPanel from './CancelPanel.svelte';
    import DayCompare from './DayCompare.svelte';
    import HistoryPanel from './HistoryPanel.svelte';
    import KeptMessages from '../practice/KeptMessages.svelte';
    import RepeatDates from '../calendar/RepeatDates.svelte';
    import RepairPanel from './RepairPanel.svelte';
    import Standing from './Standing.svelte';
    import TakeOn from './TakeOn.svelte';
    import YourAnswer from './YourAnswer.svelte';

    /*
        A plan's overview, for everyone on it. Whoever runs the plan gets the way to the
        edit form and the few things done from here, each of which owns its own message
        and asks for a refetch when it changes something. A guest gets the same picture to
        read: where everyone stands, everyone's days, what has happened. Once a plan is
        over, called off or its day been, nobody changes anything.

        Everything arrives as props so a test can draw it, which the route around it,
        loading in onMount, never can be.
    */
    let { planId, data, onrefresh, onleft = () => {} }: {
        planId: string;
        data: CompareScreen;
        //A quiet refetch, with no loading flash to rebuild every panel and lose what one had just said
        onrefresh: () => Promise<void>;
        //They took themselves off the plan, so a refetch may have nothing left to show them
        onleft?: (heard: LeftPlan) => void;
    } = $props();

    const host = $derived((data.role ?? 'host') === 'host');
    const today = $derived(todayIn(data.plan.timeZone));
    const cancelled = $derived(data.plan.status === 'cancelled');
    const over = $derived(cancelled || Boolean(data.plan.chosenDate && data.plan.chosenDate < today));
    const collecting = $derived(data.plan.status === 'collecting');
    //Still finding its day with every day it asked about gone, so there are none left to fill in
    const passed = $derived(collecting && datesPassed(data.plan, today));

    //Where coming round takes it, the same turns the sweep would make
    const series = $derived(
        data.plan.repeatWeeks
            ? repeatSeries({ repeatWeeks: data.plan.repeatWeeks, dateRange: { start: data.plan.start, end: data.plan.end }, chosenDate: data.plan.chosenDate, chosenTime: data.plan.chosenTime })
            : []
    );

    //What the plan is set for right now, null while it is still open
    const chosen = $derived(
        data.plan.chosenDate ? { date: data.plan.chosenDate, time: data.plan.chosenTime || '', note: data.plan.chosenNote || '' } : null
    );

    //A day already gone is out on the grid, so it cannot be the one picked there
    let selectedDate = $state<string | null>(
        untrack(() => (data.plan.chosenDate && data.plan.chosenDate >= todayIn(data.plan.timeZone) ? data.plan.chosenDate : null))
    );

    /*
        Setting a day takes the grid away, calling the plan off takes every control, and
        taking it on takes the button, so focus goes to the line that says what is now so.
    */
    let stateLine = $state<HTMLElement>();
    let runLine = $state<HTMLElement>();

    async function changed() {
        await onrefresh();
        refocus(() => stateLine);
    }

    async function taken() {
        await onrefresh();
        refocus(() => runLine);
    }
</script>

{#snippet state()}
    {planState(data.plan, today)}{data.plan.guildName ? ` · ${data.plan.guildName}` : ''}{data.plan.practice ? ' · practice' : ''}
{/snippet}

<!--A day still to come is the one thing on the page everyone came for, so it gets the box.
    A box rather than one paragraph: the clock note is a paragraph of its own that says
    nothing at all when everyone shares a clock.-->
{#if chosen && !over}
    <div class="prompt good" bind:this={stateLine}>
        <p>{@render state()}</p>
        {#if chosen.time}<ClockNote zone={data.plan.timeZone} date={chosen.date} time={chosen.time} />{/if}
        {#if chosen.note}<p>{chosen.note}</p>{/if}
    </div>
{:else}
    <p class="muted" bind:this={stateLine}>{@render state()}</p>
    {#if chosen?.note}<p class="muted small">{chosen.note}</p>{/if}
{/if}
{#if data.plan.description}
    <p class="muted small">{data.plan.description}</p>
{/if}

<!--Missing altogether from a backend that predates hosts, which is different from nobody being left-->
{#if data.hosts}
    <p class="muted small" bind:this={runLine}>
        {data.hosts.length ? `Run by ${listNames(data.hosts)}.` : 'Nobody who runs this is still in the server.'}
    </p>
{/if}
{#if data.canTakeOn && !over}
    <TakeOn {planId} ontaken={taken} />
{/if}
{#if data.plan.repeatedFrom}
    <p class="muted small">This came round from <a href="#/plan/{data.plan.repeatedFrom}/overview">the one before it</a>.</p>
{/if}
{#if data.plan.repeatedInto}
    <p class="muted small">This one has come round again. <a href="#/plan/{data.plan.repeatedInto}/overview">Open the one after it</a>.</p>
{/if}

<p class="ways">
    {#if data.plan.threadUrl}
        <a href={data.plan.threadUrl} target="_blank" rel="noopener">Open the thread in Discord</a>
    {/if}
    {#if data.youAreIn && collecting && !passed}
        <a href="#/plan/{planId}">Fill in your own dates</a>
    {/if}
    <!--Offered on a cancelled or finished plan too, since one that fell through or has
        already been is the likeliest to be run again-->
    {#if data.isPlanner ?? true}
        <a href="#/g/{data.plan.guildId}?like={planId}{data.plan.practice ? '&practice=1' : ''}">Plan another like this</a>
    {/if}
</p>

<!--Neither of these is so of a practice plan, whose thread and DMs only the bot writes to-->
{#if host && over && !data.plan.practice}
    <p class="muted small">Deleting its thread in Discord clears it for good.</p>
{/if}

<!--For anyone on the guest list, whoever runs the plan included: the board moves people, and this is their own word-->
{#if data.you && chosen && !over}
    <YourAnswer
        {planId}
        vote={data.you.vote}
        invited={data.you.invited}
        repeats={Boolean(data.plan.repeatWeeks)}
        onanswered={onrefresh}
        {onleft}
    />
{/if}

<Standing {planId} {data} {host} {over} onmoved={onrefresh} />

<!--Everyone's days leads the page while the day is still open, since which day is the
    whole question then. Once it is set this section is gone and the grid is on the edit
    form, under the date. A cancelled plan keeps it either way, to look back at.-->
{#if !chosen || cancelled}
    <section class="group">
        <h2>Everyone's days</h2>

        <!--Drawn even with nobody in. Every day in the window is clickable whether or not
            anyone has marked it, so the grid is the way to a date on a plan nobody has
            answered yet, and there is no second control for setting one by hand.-->
        {#if data.confirmedCount > 0 || !cancelled}
            <DayCompare
                {planId}
                start={data.plan.start}
                end={data.plan.end}
                allowedWeekdays={data.plan.allowedWeekdays}
                freeByDate={data.freeByDate}
                participants={data.participants}
                totalParticipants={data.totalParticipants}
                timeZone={data.plan.timeZone}
                readOnly={over}
                guest={!host}
                names={data.seesDays ?? true}
                unansweredCounts={data.unansweredCounts ?? null}
                {chosen}
                bind:selectedDate
                onsaved={changed}
            />
        {:else}
            <p class="muted">Nobody had filled their dates in before this was called off, so there is nothing to look back at.</p>
        {/if}
    </section>
{/if}

<!--Not on a plan that is over, which has handed its repeat on to the next one-->
{#if data.plan.repeatWeeks && !over}
    <section class="group">
        <h2>Comes round again</h2>
        <p class="muted small">{repeatLine(data.plan, series)}</p>
        {#if chosen && series.length}<RepeatDates first={chosen.date} shapes={series} />{/if}
    </section>
{/if}

<!--One way in to changing it, since the form holds every part of the plan and says what a save sends before it does-->
{#if host && !over}
    <p class="edit-plan"><a class="ghost" href="#/plan/{planId}/edit">Edit plan</a></p>
{/if}

<!--A practice plan's thread is kept here rather than in Discord-->
{#if data.plan.practice}
    <KeptMessages path="/plans/{planId}/thread" title="The thread" empty="Nothing has been posted in it yet." stamp={data} onanswered={onrefresh} />
{/if}

<HistoryPanel history={data.history} />

{#if host && !over}
    <section class="group">
        <h2>End this plan</h2>
        <CancelPanel {planId} repeats={Boolean(data.plan.repeatWeeks)} oncancelled={changed} />
    </section>
    {#if !data.plan.practice}<RepairPanel {planId} />{/if}
{/if}
