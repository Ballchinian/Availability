<script module lang="ts">
    import { formatDate, formatTime } from '../format.js';
    import type { ComparePlan } from '../types.js';

    //What kind of plan it is and where it has got to, the line under its name
    export function planState(plan: ComparePlan, today: string): string {
        const when = plan.chosenDate ? `${formatDate(plan.chosenDate)}${plan.chosenTime ? ` at ${formatTime(plan.chosenTime)}` : ''}` : '';
        if (plan.status === 'cancelled') return when ? `Called off. It was set for ${when}` : 'Called off';
        if (!when) return `Finding a day, ${formatDate(plan.start)} to ${formatDate(plan.end)}`;
        return plan.chosenDate! < today ? `Was on ${when}` : `Set for ${when}`;
    }
</script>

<script lang="ts">
    import { untrack } from 'svelte';
    import { listNames } from '../format.js';
    import type { CompareScreen } from '../types.js';
    import { todayIn } from '../zone.js';
    import { refocus } from '../focus.js';
    import ClockNote from '../ClockNote.svelte';
    import AboutPanel from './AboutPanel.svelte';
    import AddPeople from './AddPeople.svelte';
    import CancelPanel from './CancelPanel.svelte';
    import DayCompare from './DayCompare.svelte';
    import EditDetails from './EditDetails.svelte';
    import HistoryPanel from './HistoryPanel.svelte';
    import RepairPanel from './RepairPanel.svelte';
    import RepeatPanel from './RepeatPanel.svelte';
    import Standing from './Standing.svelte';
    import TakeOn from './TakeOn.svelte';
    import WhenPanel from './WhenPanel.svelte';

    /*
        A plan's overview, for everyone on it. Whoever runs the plan gets the panels that
        change it, each of which owns its own form and its own message and asks for a
        refetch when it changes something. A guest gets the same picture to read: where
        everyone stands, everyone's days, what has happened. Once a plan is over, called
        off or its day been, nobody changes anything.

        Everything arrives as props so a test can draw it, which the route around it,
        loading in onMount, never can be.
    */
    let { planId, data, onrefresh }: {
        planId: string;
        data: CompareScreen;
        //A quiet refetch, with no loading flash to rebuild every panel and lose what one had just said
        onrefresh: () => Promise<void>;
    } = $props();

    const host = $derived((data.role ?? 'host') === 'host');
    const today = $derived(todayIn(data.plan.timeZone));
    const cancelled = $derived(data.plan.status === 'cancelled');
    const over = $derived(cancelled || Boolean(data.plan.chosenDate && data.plan.chosenDate < today));
    const collecting = $derived(data.plan.status === 'collecting');

    //What the plan is set for right now, null while it is still open
    const chosen = $derived(
        data.plan.chosenDate ? { date: data.plan.chosenDate, time: data.plan.chosenTime || '', note: data.plan.chosenNote || '' } : null
    );

    //Held here rather than left on the <details>, which a refetch would refold
    let changing = $state(false);

    /*
        Quiet: nothing done from this page pings anybody. The pin and everyone's DM are
        still rewritten, so what people hold stays true, they just are not told it
        changed. Deliberately not remembered across a load: a forgotten quiet mode is
        how a real date change reaches nobody.
    */
    let quiet = $state(false);

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
    {planState(data.plan, today)}{data.plan.guildName ? ` · ${data.plan.guildName}` : ''}
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

<p class="ways">
    {#if data.plan.threadUrl}
        <a href={data.plan.threadUrl} target="_blank" rel="noopener">Open the thread in Discord</a>
    {/if}
    {#if data.youAreIn && collecting}
        <a href="#/plan/{planId}">Fill in your own dates</a>
    {/if}
    <!--Offered on a cancelled or finished plan too, since one that fell through or has
        already been is the likeliest to be run again-->
    {#if data.isPlanner ?? true}
        <a href="#/g/{data.plan.guildId}?like={planId}">Plan another like this</a>
    {/if}
</p>

{#if host && cancelled}
    <p class="muted small">Deleting its thread in Discord clears it for good.</p>
{/if}

{#if host && !over}
    <div class="hush" class:on={quiet}>
        <label class="check"><input type="checkbox" bind:checked={quiet} /> Quiet: fix things without telling anyone</label>
        <p class="muted small">
            {#if quiet}
                Nothing you do here pings anybody until you turn this off. The pinned post and
                everyone's DM are still rewritten where they sit, so what people
                are holding stays correct, they just are not told it changed. Reloading the page
                turns this off again.
            {:else}
                Turn this on to put a mistake right without announcing it. Everyone's DM still gets
                corrected, nobody is pinged about the correction.
            {/if}
        </p>
    </div>
{/if}

<Standing {planId} {data} {host} {over} onmoved={onrefresh} />

<!--Everyone's days leads the page while the day is still open, since which day is the
    whole question then. Once it is set this section is gone and the grid is one button
    inside Edit plan. A cancelled plan keeps it either way, to look back at.-->
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
                {quiet}
                bind:selectedDate
                onsaved={changed}
            />
        {:else}
            <p class="muted">Nobody had filled their dates in before this was called off, so there is nothing to look back at.</p>
        {/if}
    </section>
{/if}

{#if host && !over}
    <!--A list of what you came here wanting, not of what the app would have to do about it.
        Whether a change costs everyone their answer is worked out from the change itself,
        so it is said on the button that does it rather than by filing it under a heading.-->
    <details class="group" bind:open={changing}>
        <summary>Edit plan</summary>

        <div class="tools">
            <!--A screen rather than a panel: it is the create form again, both of its modes,
                and the only way to a day outside the window. Named for where the plan stands,
                since "the day is wrong" says nothing on one that has no day yet.-->
            <a class="ghost" href="#/plan/{planId}/dates">
                {chosen ? 'The day is wrong' : 'None of these days work'}
            </a>

            <!--Only on a plan that has a day. The one small edit that costs nobody their
                answer, which is why it stays a panel rather than joining the screen above.-->
            {#if chosen}
                <WhenPanel {planId} chosenDate={chosen.date} time={chosen.time} {quiet} onsaved={onrefresh} />
            {/if}

            <AboutPanel
                {planId}
                name={data.plan.name}
                description={data.plan.description}
                note={chosen?.note ?? ''}
                chosenDate={data.plan.chosenDate}
                {quiet}
                onsaved={onrefresh}
            />

            <EditDetails {planId} name={data.plan.name} description={data.plan.description} onsaved={onrefresh} />

            <AddPeople {planId} guildId={data.plan.guildId} participants={data.participants} {quiet} onadded={onrefresh} />

            <RepeatPanel
                {planId}
                repeatWeeks={data.plan.repeatWeeks}
                repeatedFrom={data.plan.repeatedFrom}
                repeatedInto={data.plan.repeatedInto}
                start={data.plan.start}
                end={data.plan.end}
                chosenDate={data.plan.chosenDate}
                chosenTime={data.plan.chosenTime}
                canStart={data.isPlanner ?? true}
                onchanged={onrefresh}
            />

            <RepairPanel {planId} />
        </div>
    </details>
{/if}

<HistoryPanel history={data.history} />

{#if host && !over}
    <section class="group">
        <h2>End this plan</h2>
        <CancelPanel {planId} oncancelled={changed} />
    </section>
{/if}
