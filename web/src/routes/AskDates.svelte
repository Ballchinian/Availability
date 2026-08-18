<script lang="ts">
    import { onMount } from 'svelte';
    import { push } from 'svelte-spa-router';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { isoFromNow, isWeekdayAllowed } from '../lib/calendar.js';
    import { formatDate } from '../lib/format.js';
    import type { CompareScreen, Member } from '../lib/types.js';
    import DayCompare from '../lib/compare/DayCompare.svelte';
    import MemberPicker from '../lib/MemberPicker.svelte';
    import RangeField from '../lib/RangeField.svelte';
    import RepeatField from '../lib/RepeatField.svelte';
    import WeekdayPicker, { chosenDays } from '../lib/WeekdayPicker.svelte';

    /*
        When is it: the create form again, opened on the plan that already exists. The same
        two modes, because they are the same two questions. Name the day yourself, or go
        back out and ask everyone which days work. The window, the days, the crowd and the
        repeat all come in filled, and one press sends the lot to /dates so the thread gets
        one message however many of them moved.

        Naming a day is not held to the window: the route stretches it to reach whatever is
        picked, so a day the plan never asked about is a day you can simply choose. The grid
        comes along for the ride, since on a plan people have answered it is the only place
        that says which day actually suits them.

        A screen of its own rather than another panel on the compare page. It is the one
        action here whose shape genuinely matches the create form, and the form does not
        have to know it is a modal: the back button works and the url can be passed on.
    */
    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let loadError = $state('');
    let data = $state<CompareScreen | null>(null);
    let members = $state<Member[]>([]);

    //Name the day, or go back out and ask about a window. The same fork the create form takes.
    let mode = $state('set');

    let startDate = $state('');
    let endDate = $state('');
    let dayOn = $state<boolean[]>([true, true, true, true, true, true, true]);
    let selectedIds = $state<string[]>([]);
    let repeatWeeks = $state<number | null>(null);
    let note = $state('');
    let post = $state(true);
    let dm = $state(true);

    //The day being named, and the day the grid has under the cursor, which are the same thing
    let setDate = $state('');
    let setTime = $state('');

    let saving = $state(false);
    let formError = $state('');

    //A plan already running can be pulled back to today, unlike one being made
    const todayIso = isoFromNow(0, 'day');
    //The far end everything here is held to, window and named day alike
    const maxDate = isoFromNow(2, 'year');

    const chosenWeekdays = $derived(chosenDays(dayOn));
    //Everyone on the plan now, so the picker opens on them and can only be added to
    const alreadyOn = $derived(new Set(data ? data.participants.map((p) => p.userId) : []));
    const adding = $derived(selectedIds.filter((id) => !alreadyOn.has(id)).length);

    /*
        Whether this round is going out again. Moving the window always sends everyone back,
        and so does opening a weekday nobody has been asked about; a pure narrowing costs
        nobody their answer. The server decides it the same way, this only says so first.
    */
    const movedWindow = $derived(Boolean(data) && (startDate !== data!.plan.start || endDate !== data!.plan.end));
    const opensADay = $derived.by(() => {
        if (!data) return false;
        const was = data.plan.allowedWeekdays;
        //No restriction already asks about everything, so nothing can be opened on top of it
        if (!was || was.length === 0) return false;
        return chosenWeekdays.some((d) => !was.includes(d));
    });
    const reopening = $derived(mode === 'ask' && (movedWindow || opensADay));

    //Naming a day never asks anyone anything, so the window only ever stretches to reach it
    const stretching = $derived.by(() => {
        if (mode !== 'set' || !setDate || !data) return '';
        if (setDate < data.plan.start) return `${formatDate(setDate)} is before the dates this plan asks about, so the window stretches back to reach it.`;
        if (setDate > data.plan.end) return `${formatDate(setDate)} is past the dates this plan asks about, so the window stretches out to reach it.`;
        return '';
    });

    //What the day is now, so the button can say whether this moves it or only sets a time
    const dayMoved = $derived(mode === 'set' && setDate !== (data?.plan.chosenDate || ''));

    /*
        Whether the day this plan is on survives the change. A reopened round drops it, and
        so does narrowing the weekdays past the one it sits on, which is the case that looks
        harmless: every answer stands and the day still goes. Read before the save, since
        after it there is nothing left to read.
    */
    const keepsDay = $derived(
        Boolean(data?.plan.chosenDate) && !reopening && isWeekdayAllowed(data!.plan.chosenDate!, chosenWeekdays)
    );

    //The day a repeat would count off: the one being named, or the one that survives asking again
    const seriesFrom = $derived(mode === 'set' ? setDate || null : keepsDay ? data!.plan.chosenDate : null);

    onMount(async () => {
        await loadMe();
        if (!auth.user || !params.planId) {
            loading = false;
            return;
        }
        try {
            data = await api<CompareScreen>(`/plans/${params.planId}/compare`);
            const res = await api<{ members: Member[] }>(`/guilds/${data.plan.guildId}/members`);
            members = res.members;
        } catch (err) {
            loadError = errorText(err);
        }
        if (data) {
            startDate = data.plan.start;
            endDate = data.plan.end;
            dayOn = dayOn.map((_, i) => !data!.plan.allowedWeekdays || data!.plan.allowedWeekdays.includes(i));
            selectedIds = data.participants.map((p) => p.userId);
            repeatWeeks = data.plan.repeatWeeks;
            setDate = data.plan.chosenDate || '';
            setTime = data.plan.chosenTime || '';
            /*
                A plan still looking for a day is here because the days it asked about are
                wrong, so it opens on asking again. One that has a day is here because that
                day is, so it opens on naming the new one.
            */
            mode = data.plan.chosenDate ? 'set' : 'ask';
        }
        loading = false;
    });

    async function save() {
        formError = '';
        if (mode === 'set') {
            if (!setDate) return (formError = 'Pick the day it is on.');
        } else {
            if (!startDate || !endDate) return (formError = 'Pick a start and end date.');
            if (endDate < startDate) return (formError = 'The end date is before the start.');
            if (chosenWeekdays.length === 0) return (formError = 'Pick at least one day people can mark.');
        }

        saving = true;
        try {
            /*
                One route either way, the same as the create form: naming a day sends the day
                and lets the route stretch the window to reach it, asking again sends the
                window. The crowd and the repeat ride along with both.
            */
            const body =
                mode === 'set'
                    ? {
                          date: setDate,
                          time: setTime || null,
                          participantIds: selectedIds,
                          repeatWeeks,
                          post,
                          dm
                      }
                    : {
                          start: startDate,
                          end: endDate,
                          //All seven days is no restriction, so send nothing then
                          allowedWeekdays: chosenWeekdays.length === 7 ? null : chosenWeekdays,
                          participantIds: selectedIds,
                          repeatWeeks,
                          note: note.trim() || null,
                          post,
                          dm
                      };
            await api(`/plans/${params.planId}/dates`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            /*
                Straight back, since the compare page is where the answers to this land.
                saving deliberately stays on: the button must not flash back to life while
                the route is changing under it.
            */
            push(`/plan/${params.planId}/compare`);
            return;
        } catch (err) {
            formError = errorText(err);
        }
        saving = false;
    }
</script>

<svelte:head><title>{data ? `${data.plan.name} · when is it?` : 'When is it?'}</title></svelte:head>

<section class="screen">
    <h1>When is it?</h1>

    {#if loading}
        <p class="muted">Loading the plan...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to change this plan.</p>
    {:else if loadError || !data}
        <p class="status error">{loadError || 'Could not load this plan.'}</p>
    {:else if data.plan.status === 'cancelled'}
        <p class="muted">This plan has been called off, so there is nothing left to ask about.</p>
        <p class="ways"><a href="#/plan/{params.planId}/compare">Back to the plan</a></p>
    {:else}
        <p class="muted">
            <strong>{data.plan.name}</strong>{data.plan.guildName ? ` in ${data.plan.guildName}` : ''} ·
            {#if data.plan.chosenDate}
                on {formatDate(data.plan.chosenDate)} now
            {:else}
                asking about {formatDate(data.plan.start)} to {formatDate(data.plan.end)} now
            {/if}
        </p>

        <div class="field" role="radiogroup" aria-labelledby="modeLabel">
            <span class="group-label" id="modeLabel">Which is it?</span>
            <label class="check"><input type="radio" name="mode" value="set" bind:group={mode} /> I know the day, set it</label>
            <label class="check"><input type="radio" name="mode" value="ask" bind:group={mode} /> Ask everyone which days work</label>
        </div>

        {#if mode === 'set'}
            <div class="field range">
                <div>
                    <label for="setdate">Date</label>
                    <input id="setdate" type="date" bind:value={setDate} min={todayIso} max={maxDate} />
                </div>
                <div>
                    <label for="settime">Time (optional)</label>
                    <input id="settime" type="time" bind:value={setTime} />
                </div>
            </div>

            <!--Any day at all, inside the window or not. The grid below only reaches the days
                people were asked about, which is the honest limit of what it knows.-->
            {#if stretching}<p class="status small">{stretching}</p>{/if}

            <!--Read only: the day is set by the button at the bottom with everything else, not
                by a panel of its own halfway up the form-->
            <div class="field">
                <span class="group-label">Who is free when?</span>
                <DayCompare
                    planId={params.planId}
                    start={data.plan.start}
                    end={data.plan.end}
                    allowedWeekdays={data.plan.allowedWeekdays}
                    freeByDate={data.freeByDate}
                    participants={data.participants}
                    confirmedCount={data.confirmedCount}
                    totalParticipants={data.totalParticipants}
                    timeZone={data.plan.timeZone}
                    chosen={data.plan.chosenDate ? { date: data.plan.chosenDate, time: '', note: '' } : null}
                    readOnly
                    bind:selectedDate={setDate}
                    onsaved={async () => {}}
                />
            </div>
        {:else}
            <RangeField bind:start={startDate} bind:end={endDate} min={todayIso} />

            <div class="field" role="group" aria-labelledby="daysLabel">
                <span class="group-label" id="daysLabel">Which days count?</span>
                <WeekdayPicker bind:dayOn />
            </div>
        {/if}

        <div class="field" role="group" aria-labelledby="whoLabel">
            <span class="group-label" id="whoLabel">Who is coming?</span>
            <MemberPicker {members} bind:selectedIds />
        </div>

        <!--Counted off whichever day survives this, which in set mode is the one being named-->
        <RepeatField bind:weeks={repeatWeeks} from={seriesFrom} time={mode === 'set' ? setTime : data.plan.chosenTime} />

        {#if mode === 'ask'}
            <div class="field">
                <label for="asknote">Anything to say with it? (optional)</label>
                <input id="asknote" type="text" bind:value={note} placeholder="e.g. added another weekend" maxlength="200" />
            </div>
        {/if}

        <label class="check"><input type="checkbox" bind:checked={post} /> Post the change in the thread</label>
        <label class="check"><input type="checkbox" bind:checked={dm} /> DM everyone</label>

        <!--The consequence that belongs to this action rather than to a heading above it: asking
            again is the one thing on the plan that can cost everyone their answer-->
        <p class="muted small">
            {#if reopening}
                Everyone goes back over their dates, and their saved days stay put for them to change.
            {:else}
                Nobody has to answer again, the days people have already filled in still stand.
            {/if}
            <!--The quiet one: nobody is asked anything, and the day still goes-->
            {#if mode === 'ask' && data.plan.chosenDate && !keepsDay}
                {formatDate(data.plan.chosenDate)} comes off, since it is not a day this asks about any more.
            {/if}
            {#if adding}
                {adding === 1 ? '1 person is' : `${adding} people are`} being added and
                {adding === 1 ? 'gets' : 'get'} the invitation instead.
            {/if}
            {#if !post && !dm}
                Nothing goes out, though everyone's DM is still corrected where it sits.
            {/if}
        </p>

        {#if formError}
            <p class="status error" aria-live="polite">{formError}</p>
        {/if}

        <div class="btn-row">
            <button class="primary" onclick={save} disabled={saving}>
                {#if saving}
                    Saving...
                {:else if mode === 'ask'}
                    Ask about these dates
                {:else if dayMoved && data.plan.chosenDate}
                    Move it to {setDate ? formatDate(setDate) : 'that day'}
                {:else if dayMoved}
                    Set it to {setDate ? formatDate(setDate) : 'that day'}
                {:else}
                    Update the time
                {/if}
            </button>
            <a class="link-btn" href="#/plan/{params.planId}/compare">Cancel</a>
        </div>
    {/if}
</section>
