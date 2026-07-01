<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate, describeWeekdays } from '../lib/format.js';
    import { WEEKDAYS } from '../lib/calendar.js';
    import type { Member } from '../lib/types.js';
    import UserBadge from '../lib/UserBadge.svelte';
    import MemberPicker from '../lib/MemberPicker.svelte';

    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let guildInfo = $state<any>(null);
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

    //Collect mode notifies through the thread always, the DM is the optional extra
    let collectDm = $state(true);

    //Which weekdays a collect plan asks about, indexed Sunday (0) to Saturday (6) like the
    //calendar header. All on means the whole range, the default and how plans always were.
    let dayOn = $state<boolean[]>([true, true, true, true, true, true, true]);
    const chosenWeekdays = $derived(dayOn.map((on, i) => (on ? i : -1)).filter((i) => i >= 0));
    const daysHint = $derived.by(() => {
        if (chosenWeekdays.length === 0) return 'Pick at least one day people can mark.';
        if (chosenWeekdays.length === 7) return 'People can mark any day in the range.';
        return `People can only mark ${describeWeekdays(chosenWeekdays)}.`;
    });

    function setWeekends() {
        //Sunday and Saturday, the ends of the calendar row
        dayOn = [true, false, false, false, false, false, true];
    }
    function setEveryDay() {
        dayOn = [true, true, true, true, true, true, true];
    }
    function toggleDay(i: number) {
        dayOn = dayOn.map((v, idx) => (idx === i ? !v : v));
    }

    //Set-plan mode: a single day plus optional time and note, and how to announce it
    let setDate = $state('');
    let setTime = $state('');
    let setNote = $state('');
    let announceDm = $state(true);
    //Opt in to asking everyone to confirm they can make the date with yes/no buttons
    let announceProbe = $state(false);

    const todayIso = isoFromNow(0, 'day');
    const minStart = isoFromNow(1, 'day');
    const maxDate = isoFromNow(2, 'year');

    let submitting = $state(false);
    let formError = $state('');
    let result = $state<any>(null);

    onMount(async () => {
        await loadMe();
        if (!auth.user || !params.guildId) {
            loading = false;
            return;
        }
        try {
            guildInfo = await api(`/guilds/${params.guildId}`);
            if (guildInfo.isPlanner) {
                const res = await api(`/guilds/${params.guildId}/members`);
                members = res.members;
            }
        } catch (err) {
            loadError = errorText(err);
        }
        startDate = minStart;
        loading = false;
    });

    async function submit() {
        formError = '';
        result = null;
        if (!planName.trim()) return (formError = 'Give the plan a name.');

        if (mode === 'announce') {
            if (!setDate) return (formError = 'Pick the date the plan is on.');
        } else {
            if (!startDate || !endDate) return (formError = 'Pick a start and end date.');
            if (endDate < startDate) return (formError = 'The end date is before the start.');
            if (chosenWeekdays.length === 0) return (formError = 'Pick at least one day people can mark.');
        }
        if (selectedIds.length === 0) return (formError = 'Pick at least one person.');

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
                          note: setNote.trim() || null,
                          participantIds: selectedIds,
                          dm: announceDm,
                          probe: announceProbe
                      }
                    : {
                          name: planName.trim(),
                          description: planDescription.trim(),
                          start: startDate,
                          end: endDate,
                          participantIds: selectedIds,
                          dm: collectDm,
                          //All seven days is no restriction, so send nothing then
                          allowedWeekdays: chosenWeekdays.length === 7 ? null : chosenWeekdays
                      };
            result = await api(`/guilds/${params.guildId}/plans`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
        } catch (err) {
            formError = errorText(err);
        }
        submitting = false;
    }

    function isoFromNow(amount: number, unit: string) {
        const d = new Date();
        if (unit === 'day') d.setDate(d.getDate() + amount);
        if (unit === 'year') d.setFullYear(d.getFullYear() + amount);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }
</script>

<section class="screen">
    <header class="screen-head">
        <h1>Plan a meetup</h1>
        <UserBadge />
    </header>

    {#if loading}
        <p class="muted">Loading...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to start a plan.</p>
    {:else if !params.guildId}
        <p class="muted">Open this from your server's planner thread so I know which server you mean.</p>
    {:else if loadError}
        <p class="status">Could not load this server: {loadError}</p>
    {:else if !guildInfo?.isMember}
        <p class="muted">You are not in that server.</p>
    {:else if !guildInfo?.isPlanner}
        <p class="muted">You need the planner role in {guildInfo.guildName} to start a plan. Ask an admin to give it to you.</p>
    {:else if result}
        <div class="result">
            {#if result.set}
                <p>Done. <strong>{planName}</strong> is set{setDate ? ` for ${formatDate(setDate)}` : ''}. I opened a thread for the {result.invited} {result.invited === 1 ? 'person' : 'people'} you picked{announceDm ? " and DM'd them" : ''}{announceProbe ? ' with a yes/no to confirm they can make it' : ''}.</p>
            {:else}
                <p>Done. I opened a thread for <strong>{planName}</strong> and pinged the {result.invited} {result.invited === 1 ? 'person' : 'people'} you picked{collectDm ? " and DM'd them" : ''}.</p>
            {/if}
            {#if result.dropped > 0}
                <p class="status">{result.dropped} {result.dropped === 1 ? 'person was' : 'people were'} no longer in the server, so I left them out.</p>
            {/if}
            <p class="muted">{result.set ? 'Plan link:' : 'Their availability link:'}</p>
            <a class="plan-link" href={result.url}>{result.url}</a>
        </div>
    {:else}
        <p class="muted">Planning for <strong>{guildInfo.guildName}</strong>.</p>

        <div class="field">
            <label for="planName">Plan name</label>
            <input id="planName" type="text" bind:value={planName} placeholder="e.g. Camping weekend" maxlength="90" />
        </div>

        <div class="field">
            <label for="planDescription">What is it about? (optional)</label>
            <textarea id="planDescription" bind:value={planDescription} placeholder="A line or two so people know what they are signing up for." maxlength="280" rows="2"></textarea>
        </div>

        <div class="field">
            <label>What kind of plan?</label>
            <label class="check"><input type="radio" name="mode" value="collect" bind:group={mode} /> Collect availability, find a day that works</label>
            <label class="check"><input type="radio" name="mode" value="announce" bind:group={mode} /> Announce a set plan, you already know the day</label>
        </div>

        {#if mode === 'collect'}
            <div class="field range">
                <div>
                    <label for="start">From</label>
                    <input id="start" type="date" bind:value={startDate} min={minStart} max={maxDate} />
                </div>
                <div>
                    <label for="end">To</label>
                    <input id="end" type="date" bind:value={endDate} min={startDate || minStart} max={maxDate} />
                </div>
            </div>

            <div class="field">
                <label>Which days count?</label>
                <div class="quick-row">
                    <button type="button" class="quick" onclick={setWeekends}>Weekends</button>
                    <button type="button" class="quick" onclick={setEveryDay}>Every day</button>
                </div>
                <div class="wdays">
                    {#each WEEKDAYS as w, i (i)}
                        <button type="button" class="wday" class:on={dayOn[i]} onclick={() => toggleDay(i)}>{w}</button>
                    {/each}
                </div>
                <p class="muted small">{daysHint} Anything else is greyed out on their calendar.</p>
            </div>
        {:else}
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
            <div class="field">
                <label for="setnote">Note (optional)</label>
                <input id="setnote" type="text" bind:value={setNote} placeholder="e.g. meet at the station, bring boots" maxlength="200" />
            </div>
        {/if}

        <div class="field">
            <label>Who is coming?</label>
            <MemberPicker {members} bind:selectedIds />
        </div>

        {#if mode === 'collect'}
            <label class="check"><input type="checkbox" bind:checked={collectDm} /> Also DM everyone the link</label>
            <p class="muted small">Everyone you pick gets pinged in a new thread either way. {collectDm ? 'They also get a DM with the link, so they can fill in their dates or drop out from wherever they are.' : 'No DMs go out, they just see the thread.'}</p>
        {:else}
            <label class="check"><input type="checkbox" bind:checked={announceDm} /> DM everyone the date</label>
            <label class="check"><input type="checkbox" bind:checked={announceProbe} /> Ask everyone to confirm they're coming</label>
            <p class="muted small">A thread always opens and adding people to it pings them. {announceProbe ? 'Everyone gets yes/no buttons to confirm they can make it, in the thread' + (announceDm ? ' and in their DMs' : '') + ", and I'll DM you when everyone is in or if someone can't make it." : 'Tick the box above to ask everyone to confirm with yes/no buttons.'}</p>
        {/if}

        {#if formError}
            <p class="status error">{formError}</p>
        {/if}

        <button class="primary" onclick={submit} disabled={submitting}>
            {#if submitting}Setting it up...{:else if mode === 'announce'}Announce the plan{:else}Create plan{/if}
        </button>
    {/if}
</section>
