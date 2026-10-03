<script module lang="ts">
    import type { PlanScreen } from '../lib/types.js';

    //A plan with its day set has no dates left to ask for, and its overview is where someone says if they're coming
    export function belongsOnOverview(screen: PlanScreen): boolean {
        return screen.plan.status === 'closed';
    }
</script>

<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { replace } from 'svelte-spa-router';
    import { api, errorText, ApiError } from '../lib/api.js';
    import { auth, loadMe, loginHref } from '../lib/auth.svelte.js';
    import { formatDate } from '../lib/format.js';
    import { countDays, isoFromNow, isWeekdayAllowed } from '../lib/calendar.js';
    import { browserZone, clocksAgree } from '../lib/zone.js';
    import { guardUnsaved, selectionKey } from '../lib/unsaved.js';
    import { measureBar } from '../lib/actionbar.js';
    import { refocus } from '../lib/focus.js';
    import type { SavedForPlan, LeftPlan, Joined } from '../lib/types.js';
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

    //Count me in or Not for me, and the reason box the second one opens
    let answering = $state(false);
    let answerError = $state('');
    let outArmed = $state(false);
    let reason = $state('');
    //Who heard about a Not for me just now, which a reload has no way of knowing
    let outTold = $state<LeftPlan | null>(null);

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

    const todayIso = isoFromNow(0, 'day');
    const maxDate = isoFromNow(2, 'year');

    //Which weekdays this plan asks about, null when it wants the whole range
    const allowedWeekdays = $derived<number[] | null>(data?.plan.allowedWeekdays ?? null);

    //Only days the plan still asks about count towards the tally and the total, the same days the grid leaves open
    const freeCount = $derived(Object.keys(selection).filter((d) => d >= todayIso && isWeekdayAllowed(d, allowedWeekdays)).length);
    const totalDays = $derived(data ? countDays(data.plan.start > todayIso ? data.plan.start : todayIso, data.plan.end, allowedWeekdays) : 0);

    //Read the way the backend reads a participant from before the question, for a backend from before it too
    const joined = $derived(data ? (data.in !== undefined ? data.in : data.confirmed ? true : null) : null);

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
            const screen = await api<PlanScreen>(`/plans/${params.planId}`);
            //Replaced rather than pushed, so Back does not land here and bounce straight on again
            if (belongsOnOverview(screen)) return replace(`/plan/${params.planId}/overview`);
            data = screen;
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
            if (data) Object.assign(data, { confirmed: true, in: saved.in ?? true, ask: saved.ask ?? '', toFill: saved.toFill ?? [] });
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

    let answerLine = $state<HTMLElement>();
    let outButton = $state<HTMLButtonElement>();

    function armOut() {
        outArmed = true;
        refocus(() => document.getElementById('reason'));
    }

    function keepOn() {
        outArmed = false;
        refocus(() => outButton);
    }

    //The buttons go with the answer, so the line saying where they now stand takes focus
    async function answer(value: boolean) {
        answerError = '';
        answering = true;
        try {
            const res = await api<Joined>(`/plans/${params.planId}/join`, {
                method: 'POST',
                body: JSON.stringify({ in: value, reason: value ? null : reason })
            });
            if (data) Object.assign(data, { in: res.in, ask: res.ask, toFill: res.toFill });
            outTold = value ? null : { told: res.told, missed: res.missed };
            outArmed = false;
            reason = '';
            refocus(() => answerLine);
        } catch (err) {
            answerError = errorText(err);
        }
        answering = false;
    }
</script>

<svelte:head><title>{planName ? `${planName} · your dates` : 'Your dates'}</title></svelte:head>

{#snippet savedLine()}
    Saved. I'll DM you when a day is picked.
    {#if saved?.answers?.length}Your calendar now answers <PlanList plans={saved.answers} /> too.{/if}
{/snippet}

{#snippet notForMe()}
    {#if !outArmed}
        <button class="ghost danger-btn" onclick={armOut} bind:this={outButton}>Not for me</button>
    {:else}
        <form
            class="confirm"
            onsubmit={(e) => {
                e.preventDefault();
                answer(false);
            }}
        >
            <div class="field">
                <label for="reason">Why not? (optional)</label>
                <input id="reason" type="text" maxlength="200" bind:value={reason} aria-describedby="reason-who" />
            </div>
            <p class="muted small" id="reason-who">Only whoever runs the plan sees this.</p>
            <div class="answer">
                <button class="ghost danger-btn" disabled={answering}>{answering ? 'Saving...' : 'Not for me'}</button>
                <button type="button" class="ghost" onclick={keepOn}>Back</button>
            </div>
        </form>
    {/if}
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
    {:else if data.plan.status === 'cancelled'}
        <p class="prompt">This plan was called off, so there is nothing to fill in. Your group will sort out a new one if they still want to meet.</p>
    {:else}
        <p class="muted">
            {data.plan.guildName ? `${data.plan.guildName} · ` : ''}{formatDate(data.plan.start)} to {formatDate(data.plan.end)}
        </p>
        {#if data.plan.description}
            <p class="muted small">{data.plan.description}</p>
        {/if}

        {#if joined === false}
            <div class="prompt">
                <p tabindex="-1" bind:this={answerLine}>
                    You said this one's not for you.
                    {#if outTold?.told.length}I DMed {outTold.told.join(', ')} to say so.{/if}
                    {#if outTold?.missed.length}I could not DM {outTold.missed.join(', ')}, so let them know yourself.{/if}
                </p>
                <div class="answer">
                    <button class="primary" onclick={() => answer(true)} disabled={answering}>Count me in</button>
                </div>
            </div>
            <Status class="status" msg={answerError} error />
        {:else}
            <div class="prompt">
                <p tabindex="-1" bind:this={answerLine}>{joined ? "You're in." : 'Are you in?'} {data.ask ?? ''}</p>
                {#if joined === null}
                    <div class="answer">
                        {#if !outArmed}
                            <button class="primary" onclick={() => answer(true)} disabled={answering}>Count me in</button>
                        {/if}
                        {@render notForMe()}
                    </div>
                {/if}
            </div>
            <Status class="status" msg={answerError} error />

            <p class="muted small">Press and drag to mark several days.</p>
            {#if clocksDiffer}
                <ClockNote zone={data.plan.timeZone} what={`${data.plan.guildName || 'This server'} plans`} />
            {/if}

            <DayGrid start={data.plan.start} end={data.plan.end} toFill={data.toFill ?? null} {allowedWeekdays} bind:selection />

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

            {#if joined}<div class="danger">{@render notForMe()}</div>{/if}
        {/if}
    {/if}
</section>
