<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate, describeWeekdays } from '../lib/format.js';
    import { countDays, daysSince, isWeekdayAllowed, nextDay } from '../lib/calendar.js';
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

    const unsaved = $derived(selectionKey(selection) !== savedKey);
    guardUnsaved(() => unsaved);

    //Which weekdays this plan asks about, null when it wants the whole range
    const allowedWeekdays = $derived<number[] | null>(data?.plan.allowedWeekdays ?? null);
    const weekdayLabel = $derived(describeWeekdays(allowedWeekdays));

    //Only days the plan actually asks about count towards the tally and the total
    const freeCount = $derived(Object.keys(selection).filter((d) => isWeekdayAllowed(d, allowedWeekdays)).length);
    const totalDays = $derived(data ? countDays(data.plan.start, data.plan.end, allowedWeekdays) : 0);

    //The first day past the front edge of their timetable, or null if it reaches the end
    const newFrom = $derived.by(() => {
        if (!data || !data.lastFilled) return null;
        const { start, end } = data.plan;
        if (data.lastFilled >= end) return null;
        const nd = nextDay(data.lastFilled);
        return nd > start ? nd : start;
    });

    //Has it been a while since they last touched their availability
    const stale = $derived.by(() => {
        if (!data || !data.lastUpdatedAt) return false;
        return daysSince(data.lastUpdatedAt) >= 30;
    });

    //The reminder line, built from how fresh and how complete their timetable is
    const promptText = $derived.by(() => {
        if (!data) return '';
        if (data.confirmed && !saved) {
            return 'You are confirmed for this plan. Change anything below and confirm again if your plans shift.';
        }
        if (!data.lastFilled) {
            return 'First time filling in your timetable. Tap the days you are free, and the clock on a day narrows it to certain hours.';
        }
        const parts = [];
        if (stale) parts.push('It has been over a month since you last updated your availability.');
        if (newFrom) parts.push(`You have not touched anything past ${formatDate(data.lastFilled)}. The days from there are highlighted below.`);
        if (!parts.length) parts.push('Your timetable already covers this range. Give it a once-over and confirm.');
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
            if (data) data.confirmed = true;
        } catch (err) {
            saveError = errorText(err);
        }
        submitting = false;
    }

    async function dropOut() {
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

<section class="screen">
    <h1>Your availability</h1>

    {#if loading}
        <p class="muted">Loading...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to fill in your dates.</p>
    {:else if loadError || !data}
        <p class="status error">{loadError || 'Could not load this plan.'}</p>
    {:else if left}
        <p class="prompt good">You have dropped out of <strong>{data.plan.name}</strong>. The group has been told, and you will not get any more nudges about it.</p>
    {:else if data.plan.status === 'cancelled'}
        <p class="prompt">This plan was cancelled, so there is nothing to fill in. Your group will sort out a new one if they still want to meet.</p>
    {:else}
        <p class="muted">
            <strong>{data.plan.name}</strong>{data.plan.guildName ? ` in ${data.plan.guildName}` : ''} ·
            {formatDate(data.plan.start)} to {formatDate(data.plan.end)}
        </p>
        {#if data.plan.description}
            <p class="muted small">{data.plan.description}</p>
        {/if}

        <p class="prompt">{promptText}</p>

        {#if weekdayLabel}
            <p class="prompt">This plan only asks about {weekdayLabel}, so the other days are greyed out.</p>
        {/if}

        <p class="status">{freeCount} of {totalDays} day{totalDays === 1 ? '' : 's'} marked free.</p>
        <p class="muted small">Tap a day, or press and drag across several to mark them all at once. Shift-click the other end of a stretch to do the same without dragging.</p>
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
                <input id="sure" type="date" bind:value={sureUntil} min={data.plan.start} />
                {#if sureUntil}<button class="link-btn" onclick={() => (sureUntil = '')}>clear</button>{/if}
            </div>
            <p class="muted small">
                Can't plan that far ahead? Days past this date count as "too far to say" instead of busy,
                so you don't have to mark no on months you just can't call yet.
            </p>
        </div>

        <label class="check"><input type="checkbox" bind:checked={autoConfirm} /> Auto-confirm me for any other plan these dates fully cover</label>

        <p class="muted small">
            Heads up: this saves to your availability everywhere, not just this plan, so other plans see it too.
            Free outside {formatDate(data.plan.start)} to {formatDate(data.plan.end)}?
            <a href="#/availability">Set your general availability</a> for the dates beyond this plan's range.
        </p>

        {#if saveError}
            <p class="status error">{saveError}</p>
        {/if}

        {#if saved}
            <p class="prompt good">
                Confirmed. You are {saved.confirmedCount}/{saved.totalParticipants} of the group now.
                {#if saved.confirmedPlans?.length}Also auto-confirmed: {saved.confirmedPlans.join(', ')}.{/if}
            </p>
        {/if}

        <button class="primary" onclick={confirm} disabled={submitting}>
            {submitting ? 'Saving...' : data.confirmed ? 'Update my dates' : 'Confirm my dates'}
        </button>

        <div class="danger">
            {#if !leaveArmed}
                <button class="ghost danger-btn" onclick={() => (leaveArmed = true)}>Drop out of this plan</button>
            {:else}
                <span class="small">Drop out of this plan? The group gets told and you come off the guest list.</span>
                <button class="ghost danger-btn" onclick={dropOut} disabled={leaving}>
                    {leaving ? 'Dropping out...' : 'Yes, drop me out'}
                </button>
                <button class="ghost" onclick={() => (leaveArmed = false)}>No</button>
            {/if}
            {#if leaveError}<p class="status error">{leaveError}</p>{/if}
        </div>
    {/if}
</section>
