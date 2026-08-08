<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText, icsHref, isAuthError } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { isoOf, nextDay } from '../lib/calendar.js';
    import { formatDate, formatTime } from '../lib/format.js';
    import { recallMiss, rememberMiss } from '../lib/remember.js';
    import type { CompareScreen } from '../lib/types.js';
    import CompareGrid from '../lib/CompareGrid.svelte';
    import ClockNote from '../lib/ClockNote.svelte';
    import AddPeople from '../lib/compare/AddPeople.svelte';
    import AttendanceBoard from '../lib/compare/AttendanceBoard.svelte';
    import CancelPanel from '../lib/compare/CancelPanel.svelte';
    import ConfirmPanel from '../lib/compare/ConfirmPanel.svelte';
    import DaysEditor from '../lib/compare/DaysEditor.svelte';
    import EditDetails from '../lib/compare/EditDetails.svelte';
    import HistoryPanel from '../lib/compare/HistoryPanel.svelte';
    import PickPanel from '../lib/compare/PickPanel.svelte';
    import RangeEditor from '../lib/compare/RangeEditor.svelte';
    import RemindPanel from '../lib/compare/RemindPanel.svelte';
    import RepeatPanel from '../lib/compare/RepeatPanel.svelte';
    import VoidPanel from '../lib/compare/VoidPanel.svelte';

    /*
        The planner's screen: the heatmap of everyone's days, and the panels that
        act on the plan. Each panel in lib/compare owns its own form and its own
        message and asks for a reload when it changes something, so all this holds
        is the plan itself and what is picked on the grid.

        The panels sit in three groups: where the plan stands, what changes it, what
        ends it. Only the first is open on arrival, since the rest are errands.
    */
    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<CompareScreen | null>(null);
    let loadError = $state('');
    let cancelled = $state(false);

    //Held here rather than left on the <details>, which a reload would destroy and refold
    let changing = $state(false);
    let ending = $state(false);

    /*
        Quiet: nothing done from this page pings anybody. The pin, the confirmation and
        everyone's DM are still rewritten, so what people hold stays true, they just are
        not told it changed. For putting your own mistake right without announcing it.

        Deliberately not remembered across a load. A forgotten quiet mode is how a real
        date change reaches nobody, so arriving fresh is always loud.
    */
    let quiet = $state(false);

    /*
        The slider's own value, and the settled one everything else reads. Every step
        of a drag rebuilds every day's evaluation, which is 200ms of work on twenty
        people across two years, so the grid waits for the thumb to stop while the
        label beside it keeps up. The settled value is also the one written down, so a
        drag remembers itself once at the end rather than at every step.
    */
    let missInput = $state(0);
    let missAllowed = $state(0);
    //Nothing goes back to storage until what was there has been read, or the first settle erases it
    let recalled = false;
    let selectedDate = $state<string | null>(null);

    $effect(() => {
        const want = missInput;
        const t = setTimeout(() => {
            missAllowed = want;
            if (recalled) rememberMiss(params.planId, want);
        }, 100);
        return () => clearTimeout(t);
    });

    const maxMiss = $derived(data ? Math.max(0, data.confirmedCount - 1) : 0);

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

    /*
        How many confirmed people each day sits past the certainty horizon of. They
        are not busy, just too far out to say, so the overlap maths leaves them out
        of the denominator instead of counting them as missing. A day they marked
        free anyway still counts them free, a positive answer beats the horizon.
    */
    const unsureByDate = $derived.by(() => {
        const out: Record<string, number> = {};
        if (!data) return out;

        //Earliest horizon first, so the walk below can take them on one at a time
        const horizons: { userId: string; sureUntil: string }[] = [];
        for (const p of data.participants) {
            if (p.confirmed && p.sureUntil) horizons.push({ userId: p.userId, sureUntil: p.sureUntil });
        }
        if (!horizons.length) return out;
        horizons.sort((a, b) => (a.sureUntil < b.sureUntil ? -1 : 1));

        /*
            Every day before the earliest horizon sits inside everyone's certainty,
            so the walk starts at the first day that could be unsure. Across a two
            year range that is usually most of it skipped.
        */
        const dayAfterFirst = nextDay(horizons[0].sureUntil);
        const from = dayAfterFirst > data.plan.start ? dayAfterFirst : data.plan.start;
        if (from > data.plan.end) return out;

        const d = new Date(`${from}T00:00:00`);
        const endD = new Date(`${data.plan.end}T00:00:00`);
        const past = new Set<string>();
        let next = 0;

        while (d <= endD) {
            const date = isoOf(d);
            //Once a day is past someone's horizon every later day is too, so they stay in the set
            while (next < horizons.length && horizons[next].sureUntil < date) past.add(horizons[next++].userId);

            if (past.size) {
                let n = past.size;
                //A day they marked free anyway still counts them free, a positive answer beats the horizon
                const free = new Set<string>((data.freeByDate[date] || []).map((f) => f.userId));
                for (const id of free) if (past.has(id)) n--;
                if (n) out[date] = n;
            }
            d.setDate(d.getDate() + 1);
        }
        return out;
    });

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
        await load();
    }

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        await load();
        /*
            After the load, since how far the slider can go is how many confirmed, and
            both values at once so the grid is not drawn at nought first and again 100ms
            later at what was asked for.
        */
        missInput = missAllowed = recallMiss(params.planId, maxMiss);
        recalled = true;
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
                        confirmation and everyone's DM are still rewritten where they sit, so what people
                        are holding stays correct, they just are not told it changed. Turning the page off
                        and on again turns this off.
                    {:else}
                        Turn this on to put a mistake right without announcing it. Everyone's DM still gets
                        corrected, nobody is pinged about the correction.
                    {/if}
                </p>
            </div>
        {/if}

        <section class="group">
            <h2>Where it stands</h2>

            <!--Nought of everyone, for good, on a plan that was announced with its day already known-->
            {#if collecting || data.confirmedCount > 0}
                <p class="status">{data.confirmedCount} of {data.totalParticipants} have confirmed their dates.</p>
            {/if}

            {#if nudging}
                <RemindPanel planId={params.planId} waiting={unconfirmed} />
            {/if}

            {#if data.confirmedCount > 0}
                <div class="miss">
                    <label for="miss">How many people are you willing to miss out? <strong>{missInput}</strong></label>
                    <input id="miss" type="range" min="0" max={maxMiss} bind:value={missInput} />
                    <p class="legend small">Brighter means more hours work for everyone counted, and the small number on a day is how many are free. Dim days have no time that fits: tap one to see why.</p>
                    <!--Everyone's hours are read onto this clock before they are compared, so it is the one the grid is in-->
                    <ClockNote zone={data.plan.timeZone} what="The days and hours here" />
                </div>

                <CompareGrid
                    start={data.plan.start}
                    end={data.plan.end}
                    freeByDate={data.freeByDate}
                    confirmedCount={data.confirmedCount}
                    allowedWeekdays={data.plan.allowedWeekdays}
                    {unsureByDate}
                    {missAllowed}
                    bind:selectedDate
                />
            {:else if cancelled}
                <p class="muted">Nobody had filled their dates in before this was called off, so there is nothing to look back at.</p>
            {:else if collecting}
                <p class="muted">No one has confirmed dates yet, so there is nothing to compare.{nudging ? ' Give it a moment, or nudge the stragglers above.' : ''}</p>
            {/if}

            {#if chosen}
                <p class="prompt good">
                    <strong>{data.plan.name}</strong> {cancelled ? 'was set for' : 'is set for'}
                    {formatDate(chosen.date)}{chosen.time ? ` at ${formatTime(chosen.time)}` : ''}.
                    {#if chosen.time}<br /><ClockNote zone={data.plan.timeZone} what="That time is" />{/if}
                    {#if chosen.note}<br />{chosen.note}{/if}
                    {#if !cancelled}
                        <br /><a href={icsHref(params.planId)}>Add it to your calendar</a>
                        <br />Pick another day below to move it, and everyone gets told.
                    {/if}
                </p>
            {/if}

            <!--Straight under the grid, because it is the answer to clicking a day: anywhere
                further down and the response to the click is off the bottom of a phone-->
            {#if !cancelled}
                <PickPanel
                    planId={params.planId}
                    {selectedDate}
                    {missAllowed}
                    {unsureByDate}
                    {chosen}
                    freeByDate={data.freeByDate}
                    participants={data.participants}
                    confirmedCount={data.confirmedCount}
                    totalParticipants={data.totalParticipants}
                    probeActive={Boolean(data.plan.probeActive)}
                    {quiet}
                    onsaved={refresh}
                />

                {#if data.plan.chosenDate}
                    <ConfirmPanel
                        planId={params.planId}
                        active={Boolean(data.plan.probeActive)}
                        participants={data.participants}
                        {quiet}
                        onchanged={refresh}
                    />
                {/if}

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

            <HistoryPanel history={data.history} />
        </section>

        {#if cancelled}
            <p class="ways"><a href="#/">Back to your plans</a></p>
        {:else}
            <details class="group" bind:open={changing}>
                <summary>Change the plan <span class="hint">title, people, dates, days, repeat</span></summary>

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

                <RangeEditor planId={params.planId} start={data.plan.start} end={data.plan.end} {quiet} onsaved={reopen} />

                <DaysEditor planId={params.planId} allowedWeekdays={data.plan.allowedWeekdays} {quiet} onsaved={reopen} />

                <RepeatPanel
                    planId={params.planId}
                    repeatWeeks={data.plan.repeatWeeks}
                    repeatedFrom={data.plan.repeatedFrom}
                    repeatedInto={data.plan.repeatedInto}
                    onchanged={load}
                />
            </details>

            <details class="group" bind:open={ending}>
                <summary>Undo or end it <span class="hint">clear the date and start again, or call the whole thing off</span></summary>

                <VoidPanel planId={params.planId} dateSet={Boolean(chosen)} {quiet} onvoided={reopen} />

                <!--A reload rather than the local flag, so status and banner cannot disagree-->
                <CancelPanel planId={params.planId} {quiet} oncancelled={load} />
            </details>
        {/if}
    {/if}
</section>
