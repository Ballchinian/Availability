<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { api, errorText } from '../site/api.js';
    import { auth, loadMe } from '../site/auth.svelte.js';
    import { countDays, daysSince, isoFromNow, nextDay } from '../calendar/calendar.js';
    import { describeZone } from '../calendar/zone.js';
    import { guardUnsaved, selectionKey } from '../site/unsaved.js';
    import { measureBar } from '../site/actionbar.js';
    import { refocus } from '../site/focus.js';
    import type { SavedTimetable, TimetableScreen } from '../site/types.js';
    import DayGrid from '../calendar/DayGrid.svelte';
    import PlanList from '../calendar/PlanList.svelte';
    import Status, { invalidIf } from '../site/Status.svelte';

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
    /*
        The date this calendar answers plans up to. Until one is stored or typed, it is
        the end of the window being saved, and moves with it.
    */
    let coveredUntil = $state('');
    let coveredOwn = $state(false);
    const coveredShown = $derived(coveredOwn ? coveredUntil : displayEnd);
    //The clock these hours are read on, which is whatever the browser last told the server
    let timeZone = $state('');
    let saving = $state(false);
    let saved = $state<SavedTimetable | null>(null);
    let saveError = $state('');
    //Set when saveError is about the window rather than the save
    let endAtFault = $state(false);
    let saveLine = $state<Status>();

    function fail(msg: string) {
        saveError = msg;
        tick().then(() => saveLine?.focus());
    }

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
            coveredUntil = res.coveredUntil || '';
            coveredOwn = Boolean(res.coveredUntil);
            timeZone = res.timeZone || '';
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    });

    function setCovered(date: string) {
        coveredUntil = date;
        coveredOwn = true;
    }

    //The button goes once pressed, so the date it cleared takes focus
    function clearCovered() {
        setCovered('');
        refocus(() => document.getElementById('covered'));
    }

    async function save() {
        saveError = '';
        saved = null;
        endAtFault = displayEnd < displayStart;
        if (endAtFault) return fail('The end is before the start.');
        saving = true;
        try {
            const days = Object.entries(selection)
                .filter(([date]) => date >= displayStart && date <= displayEnd)
                .map(([date, hours]) => ({ date, hours }));
            saved = await api<SavedTimetable>('/availability', {
                method: 'POST',
                body: JSON.stringify({ start: displayStart, end: displayEnd, days, coveredUntil: coveredShown || null })
            });
            setCovered(coveredShown);
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
            fail(errorText(err));
        }
        saving = false;
    }
</script>

<svelte:head><title>My calendar</title></svelte:head>

{#snippet savedLine()}
    {#if saved}
        Saved {saved.savedDays} day{saved.savedDays === 1 ? '' : 's'}.
        {#if saved.answers?.length}Your calendar now answers <PlanList plans={saved.answers} />.{/if}
    {/if}
{/snippet}

<section class="screen">
    <h1>My calendar</h1>

    {#if loading}
        <p class="muted">Loading your calendar...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to fill in your calendar.</p>
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
                <input id="end" type="date" bind:value={displayEnd} min={displayStart} max={maxDate} {...invalidIf(endAtFault, 'save-line')} />
            </div>
        </div>

        <p class="muted small">Press and drag to mark several days.</p>
        {#if timeZone}
            <p class="muted small">Times are {describeZone(timeZone)}.</p>
        {/if}

        <DayGrid start={displayStart} end={displayEnd} highlightFrom={newFrom} coveredUntil={coveredShown || null} bind:selection />

        <div class="horizon">
            <div class="horizon-row">
                <label class="lbl" for="covered">Take my calendar as my answer up to</label>
                <input id="covered" type="date" bind:value={() => coveredShown, setCovered} min={minStart} max={maxDate} />
                {#if coveredShown}<button class="link-btn" onclick={clearCovered}>clear</button>{/if}
            </div>
            <p class="muted small">These will be counted as your answers on any plan this window covers.</p>
        </div>

        <!--Pinned to the bottom while the grid runs on above it, so the count, the button
            and whatever the last save said are all in reach of a two year page-->
        <div class="actionbar" {@attach measureBar}>
            <div class="bar-row">
                <p class="status">{freeCount} of {totalDays} day{totalDays === 1 ? '' : 's'} marked free.</p>
                <button class="primary" onclick={save} disabled={saving}>
                    {saving ? 'Saving...' : 'Save availability'}
                </button>
            </div>
            <Status
                class="status msg {saved ? 'good' : ''}"
                id="save-line"
                msg={saveError}
                error={Boolean(saveError)}
                children={saved ? savedLine : undefined}
                bind:this={saveLine}
            />
        </div>
    {/if}
</section>
