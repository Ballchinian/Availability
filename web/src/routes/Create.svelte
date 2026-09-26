<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { router } from 'svelte-spa-router';
    import { api, errorText } from '../lib/api.js';
    import { refocus } from '../lib/focus.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { isoFromNow, repeatSeries } from '../lib/calendar.js';
    import type { CreatedPlan, GuildInfo, Member, PlanTemplate } from '../lib/types.js';
    import MemberPicker from '../lib/MemberPicker.svelte';
    import RangeField from '../lib/RangeField.svelte';
    import RepeatDates from '../lib/RepeatDates.svelte';
    import RepeatField from '../lib/RepeatField.svelte';
    import Status, { invalidIf } from '../lib/Status.svelte';
    import WeekdayPicker, { chosenDays } from '../lib/WeekdayPicker.svelte';

    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let guildInfo = $state<GuildInfo | null>(null);
    let members = $state<Member[]>([]);
    let loadError = $state('');

    //Collect availability to find a day, or announce a plan whose day is already set
    let mode = $state('collect');

    //The form
    let planName = $state('');
    let planDescription = $state('');
    let startDate = $state('');
    let endDate = $state('');
    let selectedIds = $state<string[]>([]);

    //Which weekdays a collect plan asks about, indexed Sunday (0) to Saturday (6). All on
    //means the whole range, the default and how plans always were.
    let dayOn = $state<boolean[]>([true, true, true, true, true, true, true]);
    const chosenWeekdays = $derived(chosenDays(dayOn));

    /*
        Set-plan mode: a single day plus an optional time. Anything people need on the day
        goes in the description above, which is the one field for what a plan is about: a
        day used to carry a line of its own and the two were never tellable apart.
    */
    let setDate = $state('');
    let setTime = $state('');

    /*
        Whether this comes round again once its day has been. Shared by both modes, since
        a standing arrangement is a standing arrangement whether or not the day is already
        known. Null is a one off, which is nearly every plan.
    */
    let repeatWeeks = $state<number | null>(null);

    /*
        The turns the picked interval takes, to draw rather than describe. Only announce
        mode has them: a plan out collecting dates has no day of its own yet for a series
        to count from, and nothing is made until it gets one.
    */
    const repeatDates = $derived(
        mode === 'announce' && setDate && repeatWeeks
            ? repeatSeries({
                  repeatWeeks,
                  dateRange: { start: setDate, end: setDate },
                  chosenDate: setDate,
                  chosenTime: setTime || null
              })
            : []
    );

    const todayIso = isoFromNow(0, 'day');
    const minStart = isoFromNow(1, 'day');
    const maxDate = isoFromNow(2, 'year');

    let submitting = $state(false);
    let formError = $state('');
    //The field formError is about, empty when it is about the form as a whole
    let fault = $state('');
    let errorLine = $state<Status>();
    let result = $state<CreatedPlan | null>(null);
    //The form goes once the plan is made, so what was made takes focus in its place
    let resultLine = $state<HTMLElement>();
    let copied = $state(false);

    /*
        "Plan another like this" on the compare page arrives as ?like=<planId>, so a form
        can be opened off a plan made weeks ago. startAnother only carries one made in
        this sitting, which is why both exist.
    */
    const likeId = new URLSearchParams(router.querystring || '').get('like');
    //Set only once the copy has landed, since it is what the note at the top of the form reads
    let likeName = $state('');

    /*
        Everything about the shape of a plan except when it runs. The range is left at
        its default on purpose, since a plan made again is the same crowd in a different
        month, and the quick picks above it are one click.
    */
    async function prefillFrom(planId: string) {
        let from: PlanTemplate;
        try {
            from = await api<PlanTemplate>(`/plans/${planId}/template`);
        } catch {
            //Gone, or not theirs to copy any more. An empty form is a fine answer to that.
            return;
        }
        planName = from.name;
        planDescription = from.description;
        dayOn = dayOn.map((_, i) => !from.allowedWeekdays || from.allowedWeekdays.includes(i));
        //Only people still in the server, so the picker's count is what actually gets invited
        const here = new Set(members.map((m) => m.id));
        selectedIds = from.participantIds.filter((id) => here.has(id));
        likeName = from.name;
    }

    onMount(async () => {
        await loadMe();
        if (!auth.user || !params.guildId) {
            loading = false;
            return;
        }
        try {
            guildInfo = await api<GuildInfo>(`/guilds/${params.guildId}`);
            if (guildInfo.isPlanner) {
                const res = await api<{ members: Member[] }>(`/guilds/${params.guildId}/members`);
                members = res.members;
            }
        } catch (err) {
            loadError = errorText(err);
        }
        startDate = minStart;
        //After the member list, which the crowd is filtered against
        if (likeId && guildInfo?.isPlanner) await prefillFrom(likeId);
        loading = false;
    });

    function fail(field: string, msg: string) {
        fault = field;
        formError = msg;
        //Once the line holds the text, so that is what gets read with focus on it
        tick().then(() => errorLine?.focus());
    }

    async function submit() {
        formError = '';
        fault = '';
        result = null;
        if (!planName.trim()) return fail('name', 'Give the plan a name.');

        if (mode === 'announce') {
            if (!setDate) return fail('date', 'Pick the date the plan is on.');
        } else {
            if (!startDate || !endDate) return fail(startDate ? 'end' : 'start', 'Pick a start and end date.');
            if (endDate < startDate) return fail('end', 'The end date is before the start.');
            if (chosenWeekdays.length === 0) return fail('days', 'Pick at least one day people can mark.');
        }
        if (selectedIds.length === 0) return fail('people', 'Pick at least one person.');

        submitting = true;
        try {
            const body =
                mode === 'announce'
                    ? {
                          name: planName.trim(),
                          description: planDescription.trim(),
                          announce: true,
                          date: setDate,
                          time: setTime || null,
                          participantIds: selectedIds,
                          repeatWeeks
                      }
                    : {
                          name: planName.trim(),
                          description: planDescription.trim(),
                          start: startDate,
                          end: endDate,
                          participantIds: selectedIds,
                          //All seven days is no restriction, so send nothing then
                          allowedWeekdays: chosenWeekdays.length === 7 ? null : chosenWeekdays,
                          repeatWeeks
                      };
            result = await api<CreatedPlan>(`/guilds/${params.guildId}/plans`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            refocus(() => resultLine);
        } catch (err) {
            fail('', errorText(err));
        }
        submitting = false;
    }

    async function copyLink() {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result.url);
            copied = true;
            setTimeout(() => (copied = false), 2000);
        } catch {
            //Blocked, or an old browser. The link is written out next to the button either way.
        }
    }

    //Back to an empty form. The crowd, the range and the notify toggles stay, since a second
    //plan is usually the same people again, and only what makes this plan itself is cleared.
    function startAnother() {
        result = null;
        formError = '';
        fault = '';
        copied = false;
        //The note about what this was copied from, which no longer describes an empty form
        likeName = '';
        planName = '';
        planDescription = '';
        setDate = '';
        setTime = '';
        //Cleared with the rest of it: a standing arrangement is about the plan that made it,
        //and inheriting one silently is how a one off ends up coming round every fortnight
        repeatWeeks = null;
        refocus(() => document.getElementById('planName'));
    }
</script>

<svelte:head><title>{guildInfo?.guildName ? `Plan a meetup in ${guildInfo.guildName}` : 'Plan a meetup'}</title></svelte:head>

<section class="screen">
    <h1>Plan a meetup</h1>

    {#if loading}
        <p class="muted">Loading the server...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to start a plan.</p>
    {:else if !params.guildId}
        <p class="muted">I need to know which server this plan is for. <a href="#/">Start one from My plans</a>.</p>
    {:else if loadError}
        <p class="status">Could not load this server: {loadError}</p>
    {:else if !guildInfo?.isMember}
        <p class="muted">You are not in that server.</p>
    {:else if !guildInfo?.isPlanner}
        <p class="muted">You need the planner role in {guildInfo.guildName} to start a plan. Ask an admin to give it to you.</p>
    {:else if result}
        <div class="result" bind:this={resultLine}>
            {#if result.set}
                <p>Done. <strong>{planName}</strong> is set. I opened a thread for the {result.invited} {result.invited === 1 ? 'person' : 'people'} you picked and DM'd them a yes/no so you know who is coming.</p>
                <!--The date it is set for, and where a repeat takes it, drawn rather than said-->
                {#if setDate}<RepeatDates first={setDate} shapes={repeatDates} />{/if}
            {:else}
                <p>Done. I opened a thread for <strong>{planName}</strong> and pinged the {result.invited} {result.invited === 1 ? 'person' : 'people'} you picked and DM'd them.</p>
            {/if}
            {#if result.dropped > 0}
                <p class="status">{result.dropped} {result.dropped === 1 ? 'person was' : 'people were'} no longer in the server, so I left them out.</p>
            {/if}
            <p class="muted">{result.set ? 'Plan link:' : 'Their availability link:'}</p>
            <div class="link-row">
                <a class="plan-link" href={result.url}>{result.url}</a>
                <button class="ghost" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
            </div>

            <p class="ways">
                <a href="#/plan/{result.planId}/compare">{result.set ? 'See who is coming' : 'Open the overview'}</a>
                <button class="link-btn" onclick={startAnother}>Start another plan</button>
            </p>
        </div>
    {:else}
        <p class="muted">Planning for <strong>{guildInfo.guildName}</strong>.</p>

        {#if likeName}
            <p class="prompt">
                Set up like <strong>{likeName}</strong>, with the same days and everyone from it who is still in the
                server. The dates did not come across, so pick the new window below, and nor did whether it repeats,
                since the one you copied is still doing that on its own.
            </p>
        {/if}

        <div class="field">
            <label for="planName">Plan name</label>
            <input id="planName" type="text" bind:value={planName} placeholder="e.g. Camping weekend" maxlength="90" {...invalidIf(fault === 'name', 'form-error')} />
        </div>

        <div class="field">
            <label for="planDescription">What is it about? (optional)</label>
            <textarea id="planDescription" bind:value={planDescription} placeholder="A line or two so people know what they are signing up for." maxlength="280" rows="2"></textarea>
        </div>

        <fieldset class="field">
            <legend class="group-label">What kind of plan?</legend>
            <label class="check"><input type="radio" name="mode" value="collect" bind:group={mode} /> Collect availability, find a day that works</label>
            <label class="check"><input type="radio" name="mode" value="announce" bind:group={mode} /> Announce a set plan, you already know the day</label>
        </fieldset>

        {#if mode === 'collect'}
            <RangeField bind:start={startDate} bind:end={endDate} min={minStart} {fault} errorId="form-error" />

            <fieldset class="field" {...invalidIf(fault === 'days', 'form-error')}>
                <legend class="group-label">Which days count?</legend>
                <WeekdayPicker bind:dayOn />
            </fieldset>
        {:else}
            <div class="field range">
                <div>
                    <label for="setdate">Date</label>
                    <input id="setdate" type="date" bind:value={setDate} min={todayIso} max={maxDate} {...invalidIf(fault === 'date', 'form-error')} />
                </div>
                <div>
                    <label for="settime">Time (optional)</label>
                    <input id="settime" type="time" bind:value={setTime} />
                </div>
            </div>
        {/if}

        <fieldset class="field" {...invalidIf(fault === 'people', 'form-error')}>
            <legend class="group-label">Who is coming?</legend>
            <MemberPicker {members} bind:selectedIds />
        </fieldset>

        <!--Only announce mode has a day for a series to count off, so only it draws a calendar-->
        <RepeatField bind:weeks={repeatWeeks} from={mode === 'announce' ? setDate : null} time={setTime} />

        <Status class="status" id="form-error" msg={formError} error bind:this={errorLine} />

        <button class="primary" onclick={submit} disabled={submitting}>
            {#if submitting}Setting it up...{:else if mode === 'announce'}Announce the plan{:else}Create plan{/if}
        </button>
    {/if}
</section>
