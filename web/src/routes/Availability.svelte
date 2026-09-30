<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { api, errorText, ApiError } from '../lib/api.js';
    import { auth, loadMe, loginHref } from '../lib/auth.svelte.js';
    import { formatDate, formatTime } from '../lib/format.js';
    import { countDays, daysSince, isoFromNow, isWeekdayAllowed, nextDay } from '../lib/calendar.js';
    import { browserZone, clocksAgree } from '../lib/zone.js';
    import { guardUnsaved, selectionKey } from '../lib/unsaved.js';
    import { measureBar } from '../lib/actionbar.js';
    import { refocus } from '../lib/focus.js';
    import type { PlanScreen, SavedForPlan, LeftPlan } from '../lib/types.js';
    import DayGrid from '../lib/DayGrid.svelte';
    import PlanList from '../lib/PlanList.svelte';
    import ClockNote from '../lib/ClockNote.svelte';
    import Status from '../lib/Status.svelte';

    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<PlanScreen | null>(null);
    let loadError = $state('');

    //Logged out, the name is all the link gives away
    let publicName = $state('');
    let missing = $state(false);
    const planName = $derived(data?.plan.name || publicName);

    let selection = $state<Record<string, number[]>>({});
    //The grid as it last stood on the server, so a close can tell whether anything moved
    let savedKey = $state('');
    let submitting = $state(false);
    let saved = $state<SavedForPlan | null>(null);
    let saveError = $state('');
    let saveLine = $state<Status>();

    //The one date across every plan they are in, so the page takes the same ends as My calendar
    let coveredUntil = $state('');

    let leaveArmed = $state(false);
    let leaving = $state(false);
    let left = $state<LeftPlan | null>(null);
    let leaveError = $state('');

    /*
        Set by a save, and everything below about what they have not looked at yet reads
        it first. Both of those are worked out from where their timetable reached when
        the page loaded, which a save has just moved: without this, saving leaves the
        page still telling them to look at days they were looking at when they saved.
    */
    let reviewed = $state(false);

    const unsaved = $derived(selectionKey(selection) !== savedKey);
    guardUnsaved(() => unsaved);

    /*
        One question for the whole clock note, asked of the clock the reader is on rather
        than the one the server last wrote down. Those two can differ for a day after
        somebody travels, and each half of the note used to ask a different one, so the
        explanation could turn up on its own with nothing above it to explain.
    */
    const mine = browserZone();
    const clocksDiffer = $derived(Boolean(data && mine && !clocksAgree(data.plan.timeZone, mine)));

    //A day already picked and already been, so all this page has left to do is say so
    const todayIso = isoFromNow(0, 'day');
    const maxDate = isoFromNow(2, 'year');
    const beenAndGone = $derived(Boolean(data?.plan.chosenDate && data.plan.chosenDate < todayIso));

    //Which weekdays this plan asks about, null when it wants the whole range
    const allowedWeekdays = $derived<number[] | null>(data?.plan.allowedWeekdays ?? null);

    //Only days the plan still asks about count towards the tally and the total, the same days the grid leaves open
    const freeCount = $derived(Object.keys(selection).filter((d) => d >= todayIso && isWeekdayAllowed(d, allowedWeekdays)).length);
    const totalDays = $derived(data ? countDays(data.plan.start > todayIso ? data.plan.start : todayIso, data.plan.end, allowedWeekdays) : 0);

    //The first day past the front edge of their timetable, or null if it reaches the end
    const newFrom = $derived.by(() => {
        if (reviewed || !data || !data.lastFilled) return null;
        const { start, end } = data.plan;
        if (data.lastFilled >= end) return null;
        const nd = nextDay(data.lastFilled);
        return nd > start ? nd : start;
    });

    //Has it been a while since they last touched their availability
    const stale = $derived.by(() => {
        if (reviewed || !data || !data.lastUpdatedAt) return false;
        return daysSince(data.lastUpdatedAt) >= 30;
    });

    //The reminder line, built from how fresh and how complete their timetable is
    const promptText = $derived.by(() => {
        if (!data) return '';
        if (data.confirmed) {
            return 'Your dates are in for this plan. Change anything below and save again if your plans shift.';
        }
        //What to do with the grid is said under it either way, so this only says where they stand
        if (!data.lastFilled) {
            return 'First time filling in your calendar, so nothing is marked yet.';
        }
        const parts = [];
        if (stale) parts.push('It has been over a month since you last updated your calendar.');
        if (newFrom) parts.push(`You have not touched anything past ${formatDate(data.lastFilled)}. The days from there are highlighted below.`);
        if (!parts.length) parts.push('Your calendar already covers this range. Give it a once-over and save.');
        return parts.join(' ');
    });

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            try {
                publicName = (await api<{ name: string }>(`/plans/${params.planId}/name`)).name;
            } catch (err) {
                missing = err instanceof ApiError && err.status === 404;
            }
            loading = false;
            return;
        }
        try {
            data = await api<PlanScreen>(`/plans/${params.planId}`);
            const obj: Record<string, number[]> = {};
            for (const a of data.availability) obj[a.date] = a.hours || [];
            selection = obj;
            savedKey = selectionKey(obj);
            coveredUntil = data.coveredUntil || '';
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    });

    async function confirm() {
        saveError = '';
        saved = null;
        submitting = true;
        try {
            //Send only the days this plan asks about, the rest are locked in the grid anyway
            const days = Object.entries(selection)
                .filter(([date]) => isWeekdayAllowed(date, allowedWeekdays))
                .map(([date, hours]) => ({ date, hours }));
            saved = await api<SavedForPlan>(`/plans/${params.planId}/availability`, {
                method: 'POST',
                body: JSON.stringify({ days, coveredUntil: coveredUntil || null })
            });
            savedKey = selectionKey(selection);
            reviewed = true;
            if (data) data.confirmed = true;
        } catch (err) {
            saveError = errorText(err);
            tick().then(() => saveLine?.focus());
        }
        submitting = false;
    }

    //The button goes once pressed, so the date it cleared takes focus
    function clearCovered() {
        coveredUntil = '';
        refocus(() => document.getElementById('covered'));
    }

    let dropButton = $state<HTMLButtonElement>();
    let leftLine = $state<HTMLElement>();

    function keepPlan() {
        leaveArmed = false;
        refocus(() => dropButton);
    }

    async function leave() {
        leaveError = '';
        leaving = true;
        try {
            //An older backend answers without the names, which reads as nobody told
            const res = await api<Partial<LeftPlan>>(`/plans/${params.planId}/leave`, { method: 'POST' });
            left = { told: res.told ?? [], missed: res.missed ?? [] };
            refocus(() => leftLine);
        } catch (err) {
            leaveError = errorText(err);
        }
        leaving = false;
    }
</script>

<svelte:head><title>{planName ? `${planName} · your dates` : 'Your dates'}</title></svelte:head>

{#snippet savedLine()}
    Saved. I'll DM you when a day is picked.
    {#if saved?.answers?.length}Your calendar now answers <PlanList plans={saved.answers} /> too.{/if}
{/snippet}

<!--Offered while a plan is still ahead of you, whether or not it is still asking for dates:
    a day that is already set is exactly when somebody finds out they cannot come-->
{#snippet dropOut()}
    <div class="danger">
        {#if !leaveArmed}
            <button class="ghost danger-btn" onclick={() => (leaveArmed = true)} bind:this={dropButton}>Drop out of this plan</button>
        {:else}
            <span class="small">Drop out of this plan? You come off the guest list, and I'll DM whoever set it up.</span>
            <button class="ghost danger-btn" onclick={leave} disabled={leaving}>
                {leaving ? 'Dropping out...' : 'Yes, drop me out'}
            </button>
            <button class="ghost" onclick={keepPlan}>No</button>
        {/if}
    </div>
    <!--Outside the row above, where an empty line would still take a gap-->
    <Status class="status" msg={leaveError} error />
{/snippet}

<section class="screen">
    <!--The plan's name, since the other availability page is this one's twin and the
        heading was the one place they had nothing to tell them apart-->
    <h1>{planName || 'Your dates'}</h1>

    {#if loading}
        <p class="muted">Loading this plan...</p>
    {:else if !auth.user}
        {#if missing}
            <p class="status error">That plan does not exist.</p>
        {:else}
            <p class="prompt">A plan on Discord to find a day that works for everyone.</p>
            <p><a class="discord-btn big" href={loginHref()}>Log in with Discord to add your dates</a></p>
            <p class="muted small">Logging in shares your Discord ID, name and avatar with me, and nothing else.</p>
        {/if}
    {:else if loadError || !data}
        <p class="status error">{loadError || 'Could not load this plan.'}</p>
    {:else if left}
        <p class="prompt good" bind:this={leftLine}>
            You have dropped out of <strong>{data.plan.name}</strong>, and you will not get any more nudges about it.
            {#if left.told.length}I DMed {left.told.join(', ')} to say so.{/if}
            {#if left.missed.length}I could not DM {left.missed.join(', ')}, so let them know yourself.{/if}
        </p>
    {:else if data.plan.status === 'cancelled'}
        <p class="prompt">This plan was called off, so there is nothing to fill in. Your group will sort out a new one if they still want to meet.</p>
    {:else if data.plan.status === 'closed'}
        <!--The day is picked, so asking which days suit is asking about a question that has been
            answered. This is where the plans under Past plans end up too.-->
        {#if data.plan.guildName}<p class="muted">In {data.plan.guildName}</p>{/if}
        {#if data.plan.description}
            <p class="muted small">{data.plan.description}</p>
        {/if}

        <div class="prompt good">
            <p>
                {beenAndGone ? 'This was set for' : 'This is set for'}
                {formatDate(data.plan.chosenDate)}{data.plan.chosenTime ? ` at ${formatTime(data.plan.chosenTime)}` : ''},
                so there is nothing left to fill in here.
            </p>
            {#if data.plan.chosenTime}<ClockNote zone={data.plan.timeZone} date={data.plan.chosenDate} time={data.plan.chosenTime} />{/if}
            {#if data.plan.chosenNote}<p>{data.plan.chosenNote}</p>{/if}
        </div>

        <p class="muted small">
            Your saved days are still yours to change for everything else, in
            <a href="#/availability">your calendar</a>.
        </p>

        {#if !beenAndGone}{@render dropOut()}{/if}
    {:else}
        <p class="muted">
            {data.plan.guildName ? `${data.plan.guildName} · ` : ''}{formatDate(data.plan.start)} to {formatDate(data.plan.end)}
        </p>
        {#if data.plan.description}
            <p class="muted small">{data.plan.description}</p>
        {/if}

        <p class="prompt">{promptText}</p>

        <p class="muted small">Press and drag to mark several days.</p>
        {#if clocksDiffer}
            <ClockNote zone={data.plan.timeZone} what={`${data.plan.guildName || 'This server'} plans`} />
        {/if}

        <DayGrid start={data.plan.start} end={data.plan.end} highlightFrom={newFrom} {allowedWeekdays} bind:selection />

        <div class="horizon">
            <div class="horizon-row">
                <label class="lbl" for="covered">Take my calendar as my answer up to</label>
                <input id="covered" type="date" bind:value={coveredUntil} min={todayIso} max={maxDate} />
                {#if coveredUntil}<button class="link-btn" onclick={clearCovered}>clear</button>{/if}
            </div>
            <p class="muted small">These will be counted as your answers on any plan this window covers.</p>
        </div>

        <p class="muted small">These are your days for every plan, not just this one. <a href="#/availability">Open your calendar</a>.</p>

        <!--Pinned to the bottom while the grid runs on above it, so the count, the button
            and whatever the last save said are all in reach of a two year page-->
        <div class="actionbar" {@attach measureBar}>
            <div class="bar-row">
                <p class="status">{freeCount} of {totalDays} day{totalDays === 1 ? '' : 's'} marked free.</p>
                <button class="primary" onclick={confirm} disabled={submitting}>
                    {submitting ? 'Saving...' : data.confirmed ? 'Update my dates' : 'Save my dates'}
                </button>
            </div>
            <Status
                class="status msg {saved ? 'good' : ''}"
                msg={saveError}
                error={Boolean(saveError)}
                children={saved ? savedLine : undefined}
                bind:this={saveLine}
            />
        </div>

        {@render dropOut()}
    {/if}
</section>
