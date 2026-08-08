<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText, icsHref } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate, formatTime, describeWeekdays } from '../lib/format.js';
    import { countDays, daysSince, isoFromNow, isWeekdayAllowed, nextDay } from '../lib/calendar.js';
    import { clocksAgree } from '../lib/zone.js';
    import { guardUnsaved, selectionKey } from '../lib/unsaved.js';
    import type { PlanScreen, SavedForPlan } from '../lib/types.js';
    import DayGrid from '../lib/DayGrid.svelte';
    import ClockNote from '../lib/ClockNote.svelte';

    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<PlanScreen | null>(null);
    let loadError = $state('');

    let selection = $state<Record<string, number[]>>({});
    //The grid as it last stood on the server, so a close can tell whether anything moved
    let savedKey = $state('');
    let submitting = $state(false);
    let saved = $state<SavedForPlan | null>(null);
    let saveError = $state('');

    //Auto-accept any other plan this save fully covers, same as the general page
    let autoConfirm = $state(true);
    //How far ahead they can honestly plan, empty for no limit
    let sureUntil = $state('');

    let leaveArmed = $state(false);
    let leaving = $state(false);
    let left = $state(false);
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

    //A day already picked and already been, so all this page has left to do is say so
    const todayIso = isoFromNow(0, 'day');
    //The horizon is one date across everything they are in, so it takes the same ends here as it does on the general page
    const maxDate = isoFromNow(2, 'year');
    const beenAndGone = $derived(Boolean(data?.plan.chosenDate && data.plan.chosenDate < todayIso));

    //Which weekdays this plan asks about, null when it wants the whole range
    const allowedWeekdays = $derived<number[] | null>(data?.plan.allowedWeekdays ?? null);
    const weekdayLabel = $derived(describeWeekdays(allowedWeekdays));

    //Only days the plan actually asks about count towards the tally and the total
    const freeCount = $derived(Object.keys(selection).filter((d) => isWeekdayAllowed(d, allowedWeekdays)).length);
    const totalDays = $derived(data ? countDays(data.plan.start, data.plan.end, allowedWeekdays) : 0);

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
            return 'First time filling in your timetable, so nothing is marked yet.';
        }
        const parts = [];
        if (stale) parts.push('It has been over a month since you last updated your availability.');
        if (newFrom) parts.push(`You have not touched anything past ${formatDate(data.lastFilled)}. The days from there are highlighted below.`);
        if (!parts.length) parts.push('Your timetable already covers this range. Give it a once-over and save.');
        return parts.join(' ');
    });

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        try {
            data = await api<PlanScreen>(`/plans/${params.planId}`);
            const obj: Record<string, number[]> = {};
            for (const a of data.availability) obj[a.date] = a.hours || [];
            selection = obj;
            savedKey = selectionKey(obj);
            sureUntil = data.sureUntil || '';
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
                body: JSON.stringify({ days, autoConfirm, sureUntil: sureUntil || null })
            });
            savedKey = selectionKey(selection);
            reviewed = true;
            if (data) data.confirmed = true;
        } catch (err) {
            saveError = errorText(err);
        }
        submitting = false;
    }

    async function leave() {
        leaveError = '';
        leaving = true;
        try {
            await api(`/plans/${params.planId}/leave`, { method: 'POST' });
            left = true;
        } catch (err) {
            leaveError = errorText(err);
        }
        leaving = false;
    }
</script>

<svelte:head><title>{data ? `${data.plan.name} · your dates` : 'Your availability'}</title></svelte:head>

<!--Offered while a plan is still ahead of you, whether or not it is still asking for dates:
    a day that is already set is exactly when somebody finds out they cannot come-->
{#snippet dropOut()}
    <div class="danger">
        {#if !leaveArmed}
            <button class="ghost danger-btn" onclick={() => (leaveArmed = true)}>Drop out of this plan</button>
        {:else}
            <span class="small">Drop out of this plan? The group gets told and you come off the guest list.</span>
            <button class="ghost danger-btn" onclick={leave} disabled={leaving}>
                {leaving ? 'Dropping out...' : 'Yes, drop me out'}
            </button>
            <button class="ghost" onclick={() => (leaveArmed = false)}>No</button>
        {/if}
        {#if leaveError}<p class="status error" aria-live="polite">{leaveError}</p>{/if}
    </div>
{/snippet}

<section class="screen">
    <!--The plan's name, since the other availability page is this one's twin and the
        heading was the one place they had nothing to tell them apart-->
    <h1>{data ? data.plan.name : 'Your availability'}</h1>

    {#if loading}
        <p class="muted">Loading this plan...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to fill in your dates.</p>
    {:else if loadError || !data}
        <p class="status error">{loadError || 'Could not load this plan.'}</p>
    {:else if left}
        <p class="prompt good">You have dropped out of <strong>{data.plan.name}</strong>. The group has been told, and you will not get any more nudges about it.</p>
    {:else if data.plan.status === 'cancelled'}
        <p class="prompt">This plan was cancelled, so there is nothing to fill in. Your group will sort out a new one if they still want to meet.</p>
    {:else if data.plan.status === 'closed'}
        <!--The day is picked, so asking which days suit is asking about a question that has been
            answered. This is where the plans on the landing page that are over end up too.-->
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
            {#if data.plan.chosenTime}<ClockNote zone={data.plan.timeZone} what="That time is" />{/if}
            {#if data.plan.chosenNote}<p>{data.plan.chosenNote}</p>{/if}
            {#if !beenAndGone}<p><a href={icsHref(params.planId)}>Add it to your calendar</a></p>{/if}
        </div>

        <p class="muted small">
            Your saved days are still yours to change for everything else:
            <a href="#/availability">set your general availability</a>.
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

        {#if weekdayLabel}
            <p class="prompt">This plan only asks about {weekdayLabel}, so the other days are greyed out.</p>
        {/if}

        <p class="muted small">Tap a day, press and drag across several, or shift-click the other end of a stretch. The clock on a free day narrows it to certain hours.</p>
        <ClockNote zone={data.plan.timeZone} what={`${data.plan.guildName || 'This server'} plans`} />
        {#if !clocksAgree(data.plan.timeZone, data.timeZone)}
            <p class="muted small">
                Mark your own days and hours as you read them. Everyone's get lined up against each other
                when the group compares, so a night out that starts at 8 for you counts against whatever
                that comes to for the rest of them.
            </p>
        {/if}

        <DayGrid start={data.plan.start} end={data.plan.end} highlightFrom={newFrom} {allowedWeekdays} sureUntil={sureUntil || null} bind:selection />

        <div class="horizon">
            <div class="horizon-row">
                <label class="lbl" for="sure">Sure up to (optional)</label>
                <input id="sure" type="date" bind:value={sureUntil} min={todayIso} max={maxDate} />
                {#if sureUntil}<button class="link-btn" onclick={() => (sureUntil = '')}>clear</button>{/if}
            </div>
            <p class="muted small">
                Can't plan that far ahead? Days past this date count as "too far to say" instead of busy,
                so you don't have to mark no on months you just can't call yet. It is one date for every
                plan you are in rather than this one on its own.
            </p>
        </div>

        <label class="check"><input type="checkbox" bind:checked={autoConfirm} /> Count these as my answer on any other plan they fully cover</label>

        <p class="muted small">
            These dates save to your availability everywhere, not just this plan, so every other plan sees them too.
            For days outside {formatDate(data.plan.start)} to {formatDate(data.plan.end)},
            <a href="#/availability">set your general availability</a>.
        </p>

        <!--Pinned to the bottom while the grid runs on above it, so the count, the button
            and whatever the last save said are all in reach of a two year page-->
        <div class="actionbar">
            <p class="status">{freeCount} of {totalDays} day{totalDays === 1 ? '' : 's'} marked free.</p>
            <button class="primary" onclick={confirm} disabled={submitting}>
                {submitting ? 'Saving...' : data.confirmed ? 'Update my dates' : 'Save my dates'}
            </button>
            {#if saveError}
                <p class="status msg error" aria-live="polite">{saveError}</p>
            {:else if saved}
                <p class="status msg good" aria-live="polite">
                    Saved. That is {saved.confirmedCount} of {saved.totalParticipants} on this plan with their dates in.
                    {#if saved.confirmedPlans?.length}These also answered: {saved.confirmedPlans.join(', ')}.{/if}
                </p>
            {/if}
        </div>

        {@render dropOut()}
    {/if}
</section>
