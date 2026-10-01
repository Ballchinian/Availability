<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText, isAuthError } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate } from '../lib/format.js';
    import type { CompareScreen } from '../lib/types.js';
    import { todayIn } from '../lib/zone.js';
    import { refocus } from '../lib/focus.js';
    import AboutPanel from '../lib/compare/AboutPanel.svelte';
    import AddPeople from '../lib/compare/AddPeople.svelte';
    import CancelPanel from '../lib/compare/CancelPanel.svelte';
    import DayCompare from '../lib/compare/DayCompare.svelte';
    import EditDetails from '../lib/compare/EditDetails.svelte';
    import HistoryPanel from '../lib/compare/HistoryPanel.svelte';
    import RepairPanel from '../lib/compare/RepairPanel.svelte';
    import RepeatPanel from '../lib/compare/RepeatPanel.svelte';
    import Standing from '../lib/compare/Standing.svelte';
    import WhenPanel from '../lib/compare/WhenPanel.svelte';

    /*
        The planner's screen: where the plan stands, and the panels that act on it. Each
        panel in lib/compare owns its own form and its own message and asks for a reload
        when it changes something, so all this holds is the plan itself.

        Four sections: where it stands, what changes it, what has happened, and ending it.
        Only the first is open on arrival, since the rest are errands. Everyone's days
        leads the page while the day is still being found and is gone once it is set: the
        question it answers has been answered, and the screen that changes the day carries
        its own copy for the one case that still wants it.
    */
    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<CompareScreen | null>(null);
    let loadError = $state('');
    let cancelled = $state(false);

    //Held here rather than left on the <details>, which a reload would destroy and refold
    let changing = $state(false);

    /*
        Quiet: nothing done from this page pings anybody. The pin and
        everyone's DM are still rewritten, so what people hold stays true, they just are
        not told it changed. For putting your own mistake right without announcing it.

        Deliberately not remembered across a load. A forgotten quiet mode is how a real
        date change reaches nobody, so arriving fresh is always loud.
    */
    let quiet = $state(false);

    let selectedDate = $state<string | null>(null);

    //Only while collecting: a plan set from the start stores its one day as the range
    const range = $derived(data?.plan.status === 'collecting' ? ` · ${formatDate(data.plan.start)} to ${formatDate(data.plan.end)}` : '');

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
            //A day already gone is out on the grid, so it cannot be the one picked there
            if (data.plan.chosenDate && data.plan.chosenDate >= todayIn(data.plan.timeZone)) selectedDate = data.plan.chosenDate;
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    }

    /*
        A quiet refetch for everything a panel does, no loading flash. The flash is not
        only cosmetic: it swaps the whole page out and back, which builds every panel
        again from nothing, so the line one had just written about who was DMed went
        with it. Only cancelling still takes the full load, since it needs the banner.

        Quiet stops at a session that has gone or a role taken away: nothing forces a
        full load, so every panel on this page would go on looking like it worked.
    */
    async function refresh() {
        try {
            data = await api<CompareScreen>(`/plans/${params.planId}/compare`);
        } catch (err) {
            if (isAuthError(err)) loadError = errorText(err);
        }
    }

    /*
        Setting a day takes the grid away and calling the plan off takes every control, so
        focus goes to the line that says what just happened.
    */
    let standing = $state<HTMLElement>();
    let calledOff = $state<HTMLElement>();

    async function daySet() {
        await refresh();
        refocus(() => standing);
    }

    async function afterCancel() {
        await load();
        refocus(() => calledOff);
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
<svelte:head><title>{data ? `${data.plan.name} · overview` : 'Overview'}</title></svelte:head>

<section class="screen">
    <h1>Overview</h1>

    {#if loading}
        <p class="muted">Loading everyone's dates...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to see the overview.</p>
    {:else if loadError || !data}
        <p class="status error">{loadError || 'Could not load this plan.'}</p>
    {:else}
        {#if cancelled}
            <p class="prompt good" bind:this={calledOff}>
                This plan has been called off and everyone has been told, so nothing here can be changed now. What people
                said is below. Delete its thread in Discord when you are ready to clear it for good.
            </p>
        {/if}

        <p class="muted">
            <strong>{data.plan.name}</strong>{data.plan.guildName ? ` in ${data.plan.guildName}` : ''}{range}
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

        <Standing planId={params.planId} {data} {chosen} {cancelled} onmoved={refresh} bind:box={standing} />

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
                        totalParticipants={data.totalParticipants}
                        timeZone={data.plan.timeZone}
                        readOnly={cancelled}
                        {chosen}
                        {quiet}
                        bind:selectedDate
                        onsaved={daySet}
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
            <!--A list of what you came here wanting, not of what the app would have to do about it.
                Whether a change costs everyone their answer is worked out from the change itself,
                so it is said on the button that does it rather than by filing it under a heading.-->
            <details class="group" bind:open={changing}>
                <summary>Change the plan</summary>

                <div class="tools">
                    <!--A screen rather than a panel: it is the create form again, both of its modes,
                        and the only way to a day outside the window. Named for where the plan stands,
                        since "the day is wrong" says nothing on one that has no day yet.-->
                    <a class="ghost" href="#/plan/{params.planId}/dates">
                        {chosen ? 'The day is wrong' : 'None of these days work'}
                    </a>

                    <!--Only on a plan that has a day. The one small edit that costs nobody their
                        answer, which is why it stays a panel rather than joining the screen above.-->
                    {#if chosen}
                        <WhenPanel
                            planId={params.planId}
                            chosenDate={chosen.date}
                            time={chosen.time}
                            {quiet}
                            onsaved={refresh}
                        />
                    {/if}

                    <AboutPanel
                        planId={params.planId}
                        name={data.plan.name}
                        description={data.plan.description}
                        note={chosen?.note ?? ''}
                        chosenDate={data.plan.chosenDate}
                        {quiet}
                        onsaved={refresh}
                    />

                    <EditDetails
                        planId={params.planId}
                        name={data.plan.name}
                        description={data.plan.description}
                        onsaved={refresh}
                    />

                    <AddPeople
                        planId={params.planId}
                        guildId={data.plan.guildId}
                        participants={data.participants}
                        {quiet}
                        onadded={refresh}
                    />

                    <RepeatPanel
                        planId={params.planId}
                        repeatWeeks={data.plan.repeatWeeks}
                        repeatedFrom={data.plan.repeatedFrom}
                        repeatedInto={data.plan.repeatedInto}
                        start={data.plan.start}
                        end={data.plan.end}
                        chosenDate={data.plan.chosenDate}
                        chosenTime={data.plan.chosenTime}
                        onchanged={refresh}
                    />

                    <RepairPanel planId={params.planId} />
                </div>
            </details>

            <HistoryPanel history={data.history} />

            <section class="group">
                <h2>End this plan</h2>
                <!--A reload rather than the local flag, so status and banner cannot disagree-->
                <CancelPanel planId={params.planId} {quiet} oncancelled={afterCancel} />
            </section>
        {/if}
    {/if}
</section>
