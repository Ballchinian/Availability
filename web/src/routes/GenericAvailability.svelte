<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate } from '../lib/format.js';
    import UserBadge from '../lib/UserBadge.svelte';
    import DayGrid from '../lib/DayGrid.svelte';

    /*
        The plan-free availability page. Same grid as a plan, but you choose the
        window. We load the whole timetable up front so widening the window never
        loses anything, and only the shown window is what gets saved.
    */

    let loading = $state(true);
    let loadError = $state('');
    let lastFilled = $state<string | null>(null);
    let lastUpdatedAt = $state<string | null>(null);

    let displayStart = $state(fromNow(0, 'day'));
    let displayEnd = $state(fromNow(3, 'month'));
    const minStart = fromNow(0, 'day');
    const maxDate = fromNow(2, 'year');

    let selection = $state<Record<string, number[]>>({});
    let autoConfirm = $state(true);
    let saving = $state(false);
    let saved = $state<any>(null);
    let saveError = $state('');

    const newFrom = $derived.by(() => {
        if (!lastFilled || lastFilled >= displayEnd) return null;
        const nd = nextDay(lastFilled);
        return nd > displayStart ? nd : displayStart;
    });

    const stale = $derived(lastUpdatedAt ? daysSince(lastUpdatedAt) >= 30 : false);

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        try {
            const res = await api(`/availability?start=${minStart}&end=${maxDate}`);
            const obj: Record<string, number[]> = {};
            for (const a of res.availability) obj[a.date] = a.hours || [];
            selection = obj;
            lastFilled = res.lastFilled;
            lastUpdatedAt = res.lastUpdatedAt;
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    });

    async function save() {
        saveError = '';
        saved = null;
        if (displayEnd < displayStart) {
            saveError = 'The end is before the start.';
            return;
        }
        saving = true;
        try {
            const days = Object.entries(selection)
                .filter(([date]) => date >= displayStart && date <= displayEnd)
                .map(([date, hours]) => ({ date, hours }));
            saved = await api('/availability', {
                method: 'POST',
                body: JSON.stringify({ start: displayStart, end: displayEnd, days, autoConfirm })
            });
            lastFilled = days.length ? days.map((d) => d.date).sort().at(-1) ?? lastFilled : lastFilled;
            lastUpdatedAt = new Date().toISOString();
        } catch (err) {
            saveError = errorText(err);
        }
        saving = false;
    }

    function fromNow(amount: number, unit: string) {
        const d = new Date();
        if (unit === 'day') d.setDate(d.getDate() + amount);
        if (unit === 'month') d.setMonth(d.getMonth() + amount);
        if (unit === 'year') d.setFullYear(d.getFullYear() + amount);
        return iso(d);
    }
    function nextDay(value: string) {
        const d = new Date(`${value}T00:00:00`);
        d.setDate(d.getDate() + 1);
        return iso(d);
    }
    function iso(d: Date) {
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
        <p class="muted">Log in above to set your availability.</p>
    {:else if loadError}
        <p class="status error">{loadError}</p>
    {:else}
        <p class="muted">Mark when you are free ahead of time. It carries into any plan you are part of.</p>

        {#if stale}
            <p class="prompt">It has been over a month since you last updated this, so it is worth a fresh look.</p>
        {/if}

        <div class="field range">
            <div>
                <label for="start">From</label>
                <input id="start" type="date" bind:value={displayStart} min={minStart} max={maxDate} />
            </div>
            <div>
                <label for="end">To</label>
                <input id="end" type="date" bind:value={displayEnd} min={displayStart} max={maxDate} />
            </div>
        </div>

        <p class="muted small">Tap a day, or press and drag across several. The clock on a free day narrows it to certain hours.</p>

        <DayGrid start={displayStart} end={displayEnd} highlightFrom={newFrom} bind:selection />

        <label class="check"><input type="checkbox" bind:checked={autoConfirm} /> Auto-confirm any plan this window fully covers</label>

        {#if saveError}<p class="status error">{saveError}</p>{/if}
        {#if saved}
            <p class="prompt good">
                Saved {saved.savedDays} day{saved.savedDays === 1 ? '' : 's'}.
                {#if saved.confirmedPlans.length}Auto-confirmed: {saved.confirmedPlans.join(', ')}.{/if}
            </p>
        {/if}

        <button class="primary" onclick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save availability'}
        </button>
    {/if}
</section>
