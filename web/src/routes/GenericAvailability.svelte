<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { countDays, daysSince, isoFromNow, nextDay } from '../lib/calendar.js';
    import { describeZone } from '../lib/zone.js';
    import { guardUnsaved, selectionKey } from '../lib/unsaved.js';
    import type { SavedTimetable, TimetableScreen } from '../lib/types.js';
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

    let displayStart = $state(isoFromNow(0, 'day'));
    let displayEnd = $state(isoFromNow(3, 'month'));
    const minStart = isoFromNow(0, 'day');
    const maxDate = isoFromNow(2, 'year');

    let selection = $state<Record<string, number[]>>({});
    //What the server holds, mirrored so a close can tell whether anything moved
    let savedDays = $state<Record<string, number[]>>({});
    let autoConfirm = $state(true);
    //How far ahead they can honestly plan, empty for no limit
    let sureUntil = $state('');
    //The clock these hours are read on, which is whatever the browser last told the server
    let timeZone = $state('');
    let saving = $state(false);
    let saved = $state<SavedTimetable | null>(null);
    let saveError = $state('');

    const newFrom = $derived.by(() => {
        if (!lastFilled || lastFilled >= displayEnd) return null;
        const nd = nextDay(lastFilled);
        return nd > displayStart ? nd : displayStart;
    });

    const stale = $derived(lastUpdatedAt ? daysSince(lastUpdatedAt) >= 30 : false);

    //Only the window on screen counts, since the whole timetable is loaded but only that part is saved
    const freeCount = $derived(Object.keys(selection).filter((d) => d >= displayStart && d <= displayEnd).length);
    const totalDays = $derived(countDays(displayStart, displayEnd));

    const unsaved = $derived(selectionKey(selection) !== selectionKey(savedDays));
    guardUnsaved(() => unsaved);

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        try {
            const res = await api<TimetableScreen>(`/availability?start=${minStart}&end=${maxDate}`);
            const obj: Record<string, number[]> = {};
            for (const a of res.availability) obj[a.date] = a.hours || [];
            selection = obj;
            savedDays = { ...obj };
            lastFilled = res.lastFilled;
            lastUpdatedAt = res.lastUpdatedAt;
            sureUntil = res.sureUntil || '';
            timeZone = res.timeZone || '';
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
            saved = await api<SavedTimetable>('/availability', {
                method: 'POST',
                body: JSON.stringify({ start: displayStart, end: displayEnd, days, autoConfirm, sureUntil: sureUntil || null })
            });
            //Only the shown window went up, so only that part of the mirror is now vouched for
            const mirror = { ...savedDays };
            for (const date of Object.keys(mirror)) {
                if (date >= displayStart && date <= displayEnd) delete mirror[date];
            }
            for (const d of days) mirror[d.date] = d.hours;
            savedDays = mirror;
            lastFilled = days.length ? days.map((d) => d.date).sort().at(-1) ?? lastFilled : lastFilled;
            lastUpdatedAt = new Date().toISOString();
        } catch (err) {
            saveError = errorText(err);
        }
        saving = false;
    }
</script>

<svelte:head><title>Your availability</title></svelte:head>

<section class="screen">
    <h1>Your availability</h1>

    {#if loading}
        <p class="muted">Loading your timetable...</p>
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

        <p class="muted small">Tap a day, press and drag across several, or shift-click the other end of a stretch. The clock on a free day narrows it to certain hours.</p>
        {#if timeZone}
            <p class="muted small">
                Your days and hours are read on {describeZone(timeZone)}, which this device told me. Say 8pm and
                you mean 8pm where you are: a plan works out what that comes to for everyone else.
            </p>
        {/if}

        <DayGrid start={displayStart} end={displayEnd} highlightFrom={newFrom} sureUntil={sureUntil || null} bind:selection />

        <div class="horizon">
            <div class="horizon-row">
                <label class="lbl" for="sure">Sure up to (optional)</label>
                <input id="sure" type="date" bind:value={sureUntil} min={minStart} max={maxDate} />
                {#if sureUntil}<button class="link-btn" onclick={() => (sureUntil = '')}>clear</button>{/if}
            </div>
            <p class="muted small">
                Can't plan that far ahead? Days past this date count as "too far to say" instead of busy,
                so you don't have to mark no on months you just can't call yet.
            </p>
        </div>

        <label class="check"><input type="checkbox" bind:checked={autoConfirm} /> Auto-confirm any plan this window fully covers</label>

        <!--Pinned to the bottom while the grid runs on above it, so the count, the button
            and whatever the last save said are all in reach of a two year page-->
        <div class="actionbar">
            <p class="status">{freeCount} of {totalDays} day{totalDays === 1 ? '' : 's'} marked free.</p>
            <button class="primary" onclick={save} disabled={saving}>
                {saving ? 'Saving...' : 'Save availability'}
            </button>
            {#if saveError}
                <p class="status msg error" aria-live="polite">{saveError}</p>
            {:else if saved}
                <p class="status msg good" aria-live="polite">
                    Saved {saved.savedDays} day{saved.savedDays === 1 ? '' : 's'}. Every plan you are part of sees these dates.
                    {#if saved.confirmedPlans.length}Auto-confirmed: {saved.confirmedPlans.join(', ')}.{/if}
                </p>
            {/if}
        </div>
    {/if}
</section>
