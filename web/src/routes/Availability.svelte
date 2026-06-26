<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate } from '../lib/format.js';
    import UserBadge from '../lib/UserBadge.svelte';
    import DayGrid from '../lib/DayGrid.svelte';

    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<any>(null);
    let loadError = $state('');

    let selection = $state<Record<string, number[]>>({});
    let submitting = $state(false);
    let saved = $state<any>(null);
    let saveError = $state('');

    let leaveArmed = $state(false);
    let leaving = $state(false);
    let left = $state(false);
    let leaveError = $state('');

    const freeCount = $derived(Object.keys(selection).length);
    const totalDays = $derived(data ? countDays(data.plan.start, data.plan.end) : 0);

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
            data = await api(`/plans/${params.planId}`);
            const obj: Record<string, number[]> = {};
            for (const a of data.availability) obj[a.date] = a.hours || [];
            selection = obj;
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
            const days = Object.entries(selection).map(([date, hours]) => ({ date, hours }));
            saved = await api(`/plans/${params.planId}/availability`, {
                method: 'POST',
                body: JSON.stringify({ days })
            });
            data.confirmed = true;
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

    function countDays(start: string, end: string) {
        const a = new Date(`${start}T00:00:00`);
        const b = new Date(`${end}T00:00:00`);
        return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
    }

    function nextDay(iso: string) {
        const d = new Date(`${iso}T00:00:00`);
        d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function daysSince(ts: string) {
        return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
    }
</script>

<section class="screen">
    <header class="screen-head">
        <h1>Your availability</h1>
        <UserBadge />
    </header>

    {#if loading}
        <p class="muted">Loading...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to fill in your dates.</p>
    {:else if loadError}
        <p class="status error">{loadError}</p>
    {:else if !data.isParticipant}
        <p class="muted">You are not on the guest list for this plan.</p>
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

        <p class="status">{freeCount} of {totalDays} day{totalDays === 1 ? '' : 's'} marked free.</p>
        <p class="muted small">Tap a day, or press and drag across several to mark them all at once.</p>

        <DayGrid start={data.plan.start} end={data.plan.end} highlightFrom={newFrom} bind:selection />

        {#if saveError}
            <p class="status error">{saveError}</p>
        {/if}

        {#if saved}
            <p class="prompt good">Confirmed. You are {saved.confirmedCount}/{saved.totalParticipants} of the group now.</p>
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
