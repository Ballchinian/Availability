<script lang="ts">
    import { onMount } from 'svelte';
    import { push } from 'svelte-spa-router';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { isoFromNow, isWeekdayAllowed } from '../lib/calendar.js';
    import { formatDate } from '../lib/format.js';
    import type { CompareScreen, Member } from '../lib/types.js';
    import MemberPicker from '../lib/MemberPicker.svelte';
    import RangeField from '../lib/RangeField.svelte';
    import RepeatField from '../lib/RepeatField.svelte';
    import WeekdayPicker, { chosenDays } from '../lib/WeekdayPicker.svelte';

    /*
        None of these days work: the same form as making a plan, opened on the plan that
        already exists. The window, the days, the crowd and the repeat all come in filled,
        and one press sends the lot to /dates so the thread gets one message about it.

        A screen of its own rather than another panel on the compare page. It is the one
        action here whose shape genuinely matches the create form, and the form does not
        have to know it is a modal: the back button works and the url can be passed on.
    */
    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let loadError = $state('');
    let data = $state<CompareScreen | null>(null);
    let members = $state<Member[]>([]);

    let startDate = $state('');
    let endDate = $state('');
    let dayOn = $state<boolean[]>([true, true, true, true, true, true, true]);
    let selectedIds = $state<string[]>([]);
    let repeatWeeks = $state<number | null>(null);
    let note = $state('');
    let post = $state(true);
    let dm = $state(true);

    let saving = $state(false);
    let formError = $state('');

    //A plan already running can be pulled back to today, unlike one being made
    const todayIso = isoFromNow(0, 'day');

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
    const reopening = $derived(movedWindow || opensADay);

    /*
        Whether the day this plan is on survives the change. A reopened round drops it, and
        so does narrowing the weekdays past the one it sits on, which is the case that looks
        harmless: every answer stands and the day still goes. Read before the save, since
        after it there is nothing left to read.
    */
    const keepsDay = $derived(
        Boolean(data?.plan.chosenDate) && !reopening && isWeekdayAllowed(data!.plan.chosenDate!, chosenWeekdays)
    );

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
        }
        loading = false;
    });

    async function save() {
        formError = '';
        if (!startDate || !endDate) return (formError = 'Pick a start and end date.');
        if (endDate < startDate) return (formError = 'The end date is before the start.');
        if (chosenWeekdays.length === 0) return (formError = 'Pick at least one day people can mark.');

        saving = true;
        try {
            await api(`/plans/${params.planId}/dates`, {
                method: 'POST',
                body: JSON.stringify({
                    start: startDate,
                    end: endDate,
                    //All seven days is no restriction, so send nothing then
                    allowedWeekdays: chosenWeekdays.length === 7 ? null : chosenWeekdays,
                    participantIds: selectedIds,
                    repeatWeeks,
                    note: note.trim() || null,
                    post,
                    dm
                })
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

<svelte:head><title>{data ? `${data.plan.name} · ask about different dates` : 'Ask about different dates'}</title></svelte:head>

<section class="screen">
    <h1>Ask about different dates</h1>

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
            <strong>{data.plan.name}</strong>{data.plan.guildName ? ` in ${data.plan.guildName}` : ''} · asking about
            {formatDate(data.plan.start)} to {formatDate(data.plan.end)} now
        </p>

        <RangeField bind:start={startDate} bind:end={endDate} min={todayIso} />

        <div class="field" role="group" aria-labelledby="daysLabel">
            <span class="group-label" id="daysLabel">Which days count?</span>
            <WeekdayPicker bind:dayOn />
        </div>

        <div class="field" role="group" aria-labelledby="whoLabel">
            <span class="group-label" id="whoLabel">Who is coming?</span>
            <MemberPicker {members} bind:selectedIds />
        </div>

        <!--Counted off the day only while the day is still going to be there afterwards-->
        <RepeatField bind:weeks={repeatWeeks} from={keepsDay ? data.plan.chosenDate : null} time={data.plan.chosenTime} />

        <input type="text" bind:value={note} placeholder="Optional note for the message (e.g. added another weekend)" maxlength="200" />

        <label class="check"><input type="checkbox" bind:checked={post} /> Post the change in the thread</label>
        <label class="check"><input type="checkbox" bind:checked={dm} /> DM everyone</label>

        <!--The consequence that belongs to this action rather than to a heading above it: this is
            the one thing on the plan that can cost everyone their answer-->
        <p class="muted small">
            {#if reopening}
                Everyone goes back over their dates, and their saved days stay put for them to change.
            {:else}
                Nobody has to answer again, the days people have already filled in still stand.
            {/if}
            <!--The quiet one: nobody is asked anything, and the day still goes-->
            {#if data.plan.chosenDate && !keepsDay}
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
                {saving ? 'Saving...' : 'Ask about these dates'}
            </button>
            <a class="link-btn" href="#/plan/{params.planId}/compare">Cancel</a>
        </div>
    {/if}
</section>
