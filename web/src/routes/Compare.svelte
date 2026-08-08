<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText, icsHref, isAuthError } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate, formatTime } from '../lib/format.js';
    import type { CompareScreen } from '../lib/types.js';
    import ClockNote from '../lib/ClockNote.svelte';
    import AddPeople from '../lib/compare/AddPeople.svelte';
    import AttendanceBoard from '../lib/compare/AttendanceBoard.svelte';
    import CancelPanel from '../lib/compare/CancelPanel.svelte';
    import ConfirmPanel from '../lib/compare/ConfirmPanel.svelte';
    import DayCompare from '../lib/compare/DayCompare.svelte';
    import DaysEditor from '../lib/compare/DaysEditor.svelte';
    import EditDetails from '../lib/compare/EditDetails.svelte';
    import HistoryPanel from '../lib/compare/HistoryPanel.svelte';
    import RangeEditor from '../lib/compare/RangeEditor.svelte';
    import RemindPanel from '../lib/compare/RemindPanel.svelte';
    import RepairPanel from '../lib/compare/RepairPanel.svelte';
    import RepeatPanel from '../lib/compare/RepeatPanel.svelte';

    /*
        The planner's screen: where the plan stands, and the panels that act on it. Each
        panel in lib/compare owns its own form and its own message and asks for a reload
        when it changes something, so all this holds is the plan itself.

        Four sections: where it stands, what changes it, what has happened, and ending it.
        Only the first is open on arrival, since the rest are errands. Everyone's days
        leads the page while the day is still being found and folds into the change
        section once it is set, where all it answers is whether a better day exists.
    */
    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<CompareScreen | null>(null);
    let loadError = $state('');
    let cancelled = $state(false);

    //Held here rather than left on the <details>, which a reload would destroy and refold
    let changing = $state(false);
    //Whether the grid is unfolded on a plan whose day is already set
    let betterDay = $state(false);

    /*
        Quiet: nothing done from this page pings anybody. The pin, the confirmation and
        everyone's DM are still rewritten, so what people hold stays true, they just are
        not told it changed. For putting your own mistake right without announcing it.

        Deliberately not remembered across a load. A forgotten quiet mode is how a real
        date change reaches nobody, so arriving fresh is always loud.
    */
    let quiet = $state(false);

    let selectedDate = $state<string | null>(null);

    const unconfirmed = $derived(data ? data.participants.filter((p) => !p.confirmed) : []);

    /*
        A plan announced with its day already known never collects availability, so its
        confirmed count sits at nought of everyone for good. Everything about filling
        dates in hangs off this, or the page asks people for something it never wanted.
    */
    const collecting = $derived(Boolean(data && data.plan.status === 'collecting'));

    /*
        Chasing dates only makes sense while they are still being collected, a plan with
        a day already locked in is waiting on answers instead. Held here rather than
        written out twice, so the line under the grid cannot offer a nudge when there is
        no panel above it to do the nudging.
    */
    const nudging = $derived(Boolean(collecting && unconfirmed.length && !cancelled));

    /*
        Who a running confirmation probe is still waiting on: on the invite list, and
        with no answer of their own and no call from a planner standing in for one.
        Only ever populated while a probe is live, so the nudge cannot offer to chase
        people about a date nobody has been asked to confirm.
    */
    const pendingVoters = $derived(
        data && data.plan.probeActive && data.plan.chosenDate
            ? data.participants.filter((p) => p.invited && !p.override && !p.vote)
            : []
    );

    //What the plan is set for right now, null while it is still open
    const chosen = $derived(
        data?.plan?.chosenDate
            ? { date: data.plan.chosenDate, time: data.plan.chosenTime || '', note: data.plan.chosenNote || '' }
            : null
    );

    async function load() {
        loading = true;
        try {
            data = await api<CompareScreen>(`/plans/${params.planId}/compare`);
            //A cancelled plan is read only, the banner stands in for the controls
            if (data.plan.status === 'cancelled') cancelled = true;
            if (data.plan.chosenDate) selectedDate = data.plan.chosenDate;
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    }

    /*
        A quiet refetch for small changes like a board move, no loading flash. Quiet
        stops at a session that has gone or a role taken away: nothing forces a full
        load, so every panel on this page would go on looking like it worked.
    */
    async function refresh() {
        try {
            data = await api<CompareScreen>(`/plans/${params.planId}/compare`);
        } catch (err) {
            if (isAuthError(err)) loadError = errorText(err);
        }
    }

    //Changes that make the picked day meaningless: the plan reopens with nothing set
    async function reopen() {
        selectedDate = null;
        betterDay = false;
        await load();
    }

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        await load();
    });
</script>

<!--The plan's name first, since two of these open at once is the whole reason for the title
    and a tab cuts off the end-->
<svelte:head><title>{data ? `${data.plan.name} · compare dates` : 'Compare dates'}</title></svelte:head>

<section class="screen">
    <h1>Compare dates</h1>

    {#if loading}
        <p class="muted">Loading everyone's dates...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to compare.</p>
    {:else if loadError || !data}
        <p class="status error">{loadError || 'Could not load this plan.'}</p>
    {:else}
        {#if cancelled}
            <p class="prompt good">
                This plan has been cancelled and everyone has been told, so nothing here can be changed now. What people
                said is below. Delete its thread in Discord when you are ready to clear it for good.
            </p>
        {/if}

        <p class="muted">
            <strong>{data.plan.name}</strong>{data.plan.guildName ? ` in ${data.plan.guildName}` : ''} ·
            {formatDate(data.plan.start)} to {formatDate(data.plan.end)}
        </p>
        {#if data.plan.description}
            <p class="muted small">{data.plan.description}</p>
        {/if}

        <p class="ways">
            {#if data.plan.threadUrl}
                <a href={data.plan.threadUrl} target="_blank" rel="noopener">Open the thread in Discord</a>
            {/if}
            {#if data.youAreIn}
                <a href="#/plan/{params.planId}">Fill in your own dates</a>
            {/if}
            <!--Offered on a cancelled or finished plan too, since one that fell through or has
                already been is the likeliest to be run again-->
            <a href="#/g/{data.plan.guildId}?like={params.planId}">Plan another like this</a>
        </p>

        {#if !cancelled}
            <div class="hush" class:on={quiet}>
                <label class="check"><input type="checkbox" bind:checked={quiet} /> Quiet: fix things without telling anyone</label>
                <p class="muted small">
                    {#if quiet}
                        Nothing you do here pings anybody until you turn this off. The pinned post, the
                        yes/no message and everyone's DM are still rewritten where they sit, so what people
                        are holding stays correct, they just are not told it changed. Reloading the page
                        turns this off again.
                    {:else}
                        Turn this on to put a mistake right without announcing it. Everyone's DM still gets
                        corrected, nobody is pinged about the correction.
                    {/if}
                </p>
            </div>
        {/if}

        <section class="group">
            <h2>{chosen ? 'Where it stands' : 'Which day?'}</h2>

            {#if chosen}
                <!--A box rather than one paragraph: the clock note is a paragraph of its own that
                    says nothing at all when everyone shares a clock, and hanging it off a <br />
                    left an empty line in the box for everybody who does-->
                <div class="prompt good">
                    <p>
                        <strong>{data.plan.name}</strong> {cancelled ? 'was set for' : 'is set for'}
                        {formatDate(chosen.date)}{chosen.time ? ` at ${formatTime(chosen.time)}` : ''}.
                    </p>
                    {#if chosen.time}<ClockNote zone={data.plan.timeZone} what="That time is" />{/if}
                    {#if chosen.note}<p>{chosen.note}</p>{/if}
                    {#if !cancelled}
                        <p><a href={icsHref(params.planId)}>Add it to your calendar</a></p>
                    {/if}
                </div>

                {#if !cancelled}
                    <ConfirmPanel
                        planId={params.planId}
                        active={Boolean(data.plan.probeActive)}
                        participants={data.participants}
                        {quiet}
                        onchanged={refresh}
                    />

                    <AttendanceBoard
                        planId={params.planId}
                        participants={data.participants}
                        chosenDate={data.plan.chosenDate}
                        onmoved={refresh}
                    />

                    {#if pendingVoters.length}
                        <RemindPanel planId={params.planId} waiting={pendingVoters} mode="vote" />
                    {/if}
                {/if}
            {/if}

            <!--Nought of everyone, for good, on a plan that was announced with its day already known-->
            {#if collecting || data.confirmedCount > 0}
                <p class="status">{data.confirmedCount} of {data.totalParticipants} have filled in their dates.</p>
            {/if}

            {#if nudging}
                <RemindPanel planId={params.planId} waiting={unconfirmed} />
            {/if}
        </section>

        <!--Everyone's days leads the page while the day is still open, since which day is the
            whole question then. Once it is set this section is gone and the grid is one button
            inside Change the plan. A cancelled plan keeps it either way, to look back at.-->
        {#if !chosen || cancelled}
            <section class="group">
                <h2>Everyone's days</h2>

                <!--Drawn even with nobody in. Every day in the window is clickable whether or not
                    anyone has marked it, so the grid is the way to a date on a plan nobody has
                    answered yet, and there is no second control for setting one by hand.-->
                {#if data.confirmedCount > 0 || !cancelled}
                    <DayCompare
                        planId={params.planId}
                        start={data.plan.start}
                        end={data.plan.end}
                        allowedWeekdays={data.plan.allowedWeekdays}
                        freeByDate={data.freeByDate}
                        participants={data.participants}
                        confirmedCount={data.confirmedCount}
                        totalParticipants={data.totalParticipants}
                        probeActive={Boolean(data.plan.probeActive)}
                        timeZone={data.plan.timeZone}
                        readOnly={cancelled}
                        {chosen}
                        {quiet}
                        bind:selectedDate
                        onsaved={refresh}
                    />
                {:else}
                    <p class="muted">Nobody had filled their dates in before this was called off, so there is nothing to look back at.</p>
                {/if}
            </section>
        {/if}

        {#if cancelled}
            <HistoryPanel history={data.history} />
            <p class="ways"><a href="#/">Back to your plans</a></p>
        {:else}
            <details class="group" bind:open={changing}>
                <summary>Change the plan</summary>

                <!--Only once a day is set. While it is still open the grid above is where the day
                    is picked, and everything here would be a second way to do the same thing.-->
                {#if chosen}
                    <h3>The day it is on</h3>
                    <div class="tools">
                        <!--The grid is the only way to a different day, and to the time and note on
                            the one it is on, so it is offered whether or not anybody has answered-->
                        <div class="better" class:wide={betterDay}>
                            {#if !betterDay}
                                <button class="ghost" onclick={() => (betterDay = true)}>Move it, or change the time or note</button>
                            {:else}
                                <p class="muted small">The day it is set for is ringed in green.</p>
                                <DayCompare
                                    planId={params.planId}
                                    start={data.plan.start}
                                    end={data.plan.end}
                                    allowedWeekdays={data.plan.allowedWeekdays}
                                    freeByDate={data.freeByDate}
                                    participants={data.participants}
                                    confirmedCount={data.confirmedCount}
                                    totalParticipants={data.totalParticipants}
                                    probeActive={Boolean(data.plan.probeActive)}
                                    timeZone={data.plan.timeZone}
                                    {chosen}
                                    {quiet}
                                    bind:selectedDate
                                    onsaved={refresh}
                                />
                                <div class="btn-row">
                                    <button class="ghost" onclick={() => (betterDay = false)}>Close the grid</button>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}

                <h3>The days it asks about</h3>
                <div class="tools">
                    <RangeEditor planId={params.planId} start={data.plan.start} end={data.plan.end} {quiet} onsaved={reopen} />

                    <DaysEditor planId={params.planId} allowedWeekdays={data.plan.allowedWeekdays} {quiet} onsaved={reopen} />

                    <RepeatPanel
                        planId={params.planId}
                        repeatWeeks={data.plan.repeatWeeks}
                        repeatedFrom={data.plan.repeatedFrom}
                        repeatedInto={data.plan.repeatedInto}
                        start={data.plan.start}
                        end={data.plan.end}
                        chosenDate={data.plan.chosenDate}
                        chosenTime={data.plan.chosenTime}
                        onchanged={load}
                    />
                </div>

                <h3>The plan itself</h3>
                <div class="tools">
                    <EditDetails
                        planId={params.planId}
                        name={data.plan.name}
                        description={data.plan.description}
                        onsaved={load}
                    />

                    <AddPeople
                        planId={params.planId}
                        guildId={data.plan.guildId}
                        participants={data.participants}
                        {quiet}
                        onadded={load}
                    />

                    <RepairPanel planId={params.planId} />
                </div>
            </details>

            <HistoryPanel history={data.history} />

            <section class="group">
                <h2>End this plan</h2>
                <!--A reload rather than the local flag, so status and banner cannot disagree-->
                <CancelPanel planId={params.planId} {quiet} oncancelled={load} />
            </section>
        {/if}
    {/if}
</section>
