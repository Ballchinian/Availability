<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate } from '../lib/format.js';
    import { formatHours } from '../lib/hours.js';
    import { evaluateDay } from '../lib/overlap.js';
    import UserBadge from '../lib/UserBadge.svelte';
    import CompareGrid from '../lib/CompareGrid.svelte';
    import MemberPicker from '../lib/MemberPicker.svelte';
    import type { Member } from '../lib/types.js';

    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<any>(null);
    let loadError = $state('');

    let missAllowed = $state(0);
    let selectedDate = $state<string | null>(null);
    let pingAttending = $state(true);
    let pingAllInvited = $state(false);

    let submitting = $state(false);
    let chosen = $state<any>(null);
    let chooseError = $state('');

    let reminding = $state(false);
    let remindMsg = $state('');

    let newEnd = $state('');
    let extending = $state(false);
    let extendMsg = $state('');

    let cancelArmed = $state(false);
    let cancelling = $state(false);
    let cancelled = $state(false);
    let cancelError = $state('');

    let addOpen = $state(false);
    let addMembers = $state<Member[]>([]);
    let addSelectedIds = $state<string[]>([]);
    let addLoading = $state(false);
    let adding = $state(false);
    let addMsg = $state('');

    const maxMiss = $derived(data ? Math.max(0, data.confirmedCount - 1) : 0);

    //An extension has to land after the current end and inside the two year cap
    const extendMin = $derived(data ? nextDay(data.plan.end) : '');
    const extendMax = isoFromNow(2, 'year');

    const byId = $derived.by(() => {
        const m: Record<string, any> = {};
        if (data) for (const p of data.participants) m[p.userId] = p;
        return m;
    });

    const unconfirmed = $derived(data ? data.participants.filter((p: any) => !p.confirmed) : []);

    //The picked day, run through the same overlap maths the grid uses
    const sel = $derived.by(() => {
        if (!data || !selectedDate) return null;
        const free = data.freeByDate[selectedDate] || [];
        const ev = evaluateDay(free, data.confirmedCount, missAllowed);
        return { free, ev, keptSet: new Set(ev.keptIds) };
    });

    //Whether the picked day is already the one the plan is set for
    const isCurrent = $derived(Boolean(chosen && selectedDate === chosen.chosenDate));

    async function load() {
        loading = true;
        try {
            data = await api(`/plans/${params.planId}/compare`);
            //A cancelled plan is read only, the banner stands in for the controls
            if (data.plan.status === 'cancelled') cancelled = true;
            if (data.plan.chosenDate) {
                chosen = { chosenDate: data.plan.chosenDate };
                selectedDate = data.plan.chosenDate;
            }
            newEnd = '';
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    }

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        await load();
    });

    async function lockIn() {
        chooseError = '';
        submitting = true;
        try {
            chosen = await api(`/plans/${params.planId}/choose`, {
                method: 'POST',
                body: JSON.stringify({
                    date: selectedDate,
                    pingAttending,
                    pingAllInvited,
                    attendingIds: sel?.ev.keptIds || []
                })
            });
        } catch (err) {
            chooseError = errorText(err);
        }
        submitting = false;
    }

    async function remind() {
        remindMsg = '';
        reminding = true;
        try {
            const res = await api(`/plans/${params.planId}/remind`, { method: 'POST' });
            remindMsg = res.pinged ? `Nudged ${res.pinged} ${res.pinged === 1 ? 'person' : 'people'}.` : 'Everyone has already confirmed.';
        } catch (err) {
            remindMsg = errorText(err);
        }
        reminding = false;
    }

    async function doCancel() {
        cancelError = '';
        cancelling = true;
        try {
            await api(`/plans/${params.planId}/cancel`, { method: 'POST' });
            cancelled = true;
        } catch (err) {
            cancelError = errorText(err);
        }
        cancelling = false;
    }

    //Open the add panel and pull in the server members who are not already on the plan
    async function openAdd() {
        addOpen = true;
        addMsg = '';
        if (addMembers.length || addLoading) return;
        addLoading = true;
        try {
            const res = await api(`/guilds/${data.plan.guildId}/members`);
            const here = new Set(data.participants.map((p: any) => p.userId));
            addMembers = res.members.filter((m: Member) => !here.has(m.id));
        } catch (err) {
            addMsg = errorText(err);
        }
        addLoading = false;
    }

    async function addPeople() {
        addMsg = '';
        if (!addSelectedIds.length) {
            addMsg = 'Pick at least one person to add.';
            return;
        }
        adding = true;
        try {
            const res = await api(`/plans/${params.planId}/add`, {
                method: 'POST',
                body: JSON.stringify({ userIds: addSelectedIds })
            });
            addMsg = `Added ${res.added} ${res.added === 1 ? 'person' : 'people'} and let them know.`;
            addSelectedIds = [];
            addMembers = [];
            addOpen = false;
            await load();
        } catch (err) {
            addMsg = errorText(err);
        }
        adding = false;
    }

    async function extend() {
        extendMsg = '';
        if (!newEnd) {
            extendMsg = 'Pick a new end date first.';
            return;
        }
        extending = true;
        try {
            const res = await api(`/plans/${params.planId}/extend`, {
                method: 'POST',
                body: JSON.stringify({ newEnd })
            });
            extendMsg = `Extended to ${formatDate(res.end)} and everyone has been pinged and DM'd.`;
            chosen = null;
            selectedDate = null;
            await load();
        } catch (err) {
            extendMsg = errorText(err);
        }
        extending = false;
    }

    function nextDay(iso: string) {
        const d = new Date(`${iso}T00:00:00`);
        d.setDate(d.getDate() + 1);
        return isoOf(d);
    }
    function isoFromNow(amount: number, unit: string) {
        const d = new Date();
        if (unit === 'year') d.setFullYear(d.getFullYear() + amount);
        return isoOf(d);
    }
    function isoOf(d: Date) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
</script>

<section class="screen">
    <header class="screen-head">
        <h1>Compare dates</h1>
        <UserBadge />
    </header>

    {#if loading}
        <p class="muted">Loading...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to compare.</p>
    {:else if loadError}
        <p class="status error">{loadError}</p>
    {:else if cancelled}
        <p class="prompt good">This plan has been cancelled and everyone has been told. Delete its thread in Discord when you are ready to clear it for good.</p>
    {:else}
        <p class="muted">
            <strong>{data.plan.name}</strong>{data.plan.guildName ? ` in ${data.plan.guildName}` : ''} ·
            {formatDate(data.plan.start)} to {formatDate(data.plan.end)}
        </p>
        {#if data.plan.description}
            <p class="muted small">{data.plan.description}</p>
        {/if}

        <p class="status">{data.confirmedCount} of {data.totalParticipants} have confirmed their dates.</p>

        {#if unconfirmed.length}
            <div class="waiting">
                <p class="muted small">
                    You do not have to wait for everyone, pick whenever you are ready. Still out:
                    {unconfirmed.map((p: any) => p.displayName).join(', ')}.
                </p>
                <button class="ghost" onclick={remind} disabled={reminding}>
                    {reminding ? 'Nudging...' : 'Remind the stragglers'}
                </button>
                {#if remindMsg}<span class="status small">{remindMsg}</span>{/if}
            </div>
        {/if}

        {#if data.confirmedCount > 0}
            <div class="miss">
                <label for="miss">How many people are you willing to miss out? <strong>{missAllowed}</strong></label>
                <input id="miss" type="range" min="0" max={maxMiss} bind:value={missAllowed} />
                <p class="legend small">Greener means more hours work for everyone counted. Dim days have no time that fits.</p>
            </div>

            <CompareGrid
                start={data.plan.start}
                end={data.plan.end}
                freeByDate={data.freeByDate}
                confirmedCount={data.confirmedCount}
                {missAllowed}
                bind:selectedDate
            />
        {:else}
            <p class="muted">No one has confirmed dates yet, so there is nothing to compare. Give it a moment, or nudge the stragglers above.</p>
        {/if}

        {#if chosen}
            <p class="prompt good">
                <strong>{data.plan.name}</strong> is set for {formatDate(chosen.chosenDate)}. Pick another day below to move it, and everyone gets told.
            </p>
        {/if}

        {#if sel && selectedDate}
            <div class="pick-panel">
                <p><strong>{formatDate(selectedDate)}</strong> works for {sel.ev.keptIds.length} of {data.confirmedCount}, common time <strong>{formatHours(sel.ev.window)}</strong>.</p>

                <ul class="who">
                    {#each sel.free as f (f.userId)}
                        <li class:dropped={!sel.keptSet.has(f.userId)}>
                            {byId[f.userId]?.displayName || 'Someone'}: {formatHours(f.hours)}
                            {#if !sel.keptSet.has(f.userId)}<span class="muted small">(not counted)</span>{/if}
                        </li>
                    {/each}
                </ul>

                <label class="check"><input type="checkbox" bind:checked={pingAttending} /> Ping the people who can make it</label>
                <label class="check"><input type="checkbox" bind:checked={pingAllInvited} /> Ping everyone invited (even those who cannot)</label>
                <p class="muted small">Everyone invited gets a DM with the date either way.</p>
                {#if chooseError}<p class="status error">{chooseError}</p>{/if}
                <button class="primary" onclick={lockIn} disabled={submitting || isCurrent}>
                    {#if submitting}Saving...{:else if isCurrent}Already set for {formatDate(selectedDate)}{:else if chosen}Move it to {formatDate(selectedDate)}{:else}Confirm {formatDate(selectedDate)}{/if}
                </button>
            </div>
        {/if}

        <div class="add">
            {#if !addOpen}
                <button class="ghost" onclick={openAdd}>Add someone to this plan</button>
                {#if addMsg}<p class="status small">{addMsg}</p>{/if}
            {:else}
                <p class="muted small">Pick anyone in the server to pull into this plan. They get added to the thread and a DM with the link.</p>
                {#if addLoading}
                    <p class="muted small">Loading the member list...</p>
                {:else if addMembers.length === 0}
                    <p class="muted small">Everyone in the server is already on this plan.</p>
                {:else}
                    <MemberPicker members={addMembers} bind:selectedIds={addSelectedIds} />
                    <div class="add-row">
                        <button class="primary" onclick={addPeople} disabled={adding}>
                            {adding ? 'Adding...' : 'Add to the plan'}
                        </button>
                        <button class="ghost" onclick={() => (addOpen = false)}>Cancel</button>
                    </div>
                {/if}
                {#if addMsg}<p class="status small">{addMsg}</p>{/if}
            {/if}
        </div>

        <div class="extend">
            <p class="muted small">Nothing in this range works? Push the end date out and everyone gets asked for the new days.</p>
            <div class="extend-row">
                <input type="date" bind:value={newEnd} min={extendMin} max={extendMax} />
                <button class="ghost" onclick={extend} disabled={extending}>
                    {extending ? 'Extending...' : 'Extend the range'}
                </button>
            </div>
            {#if extendMsg}<p class="status small">{extendMsg}</p>{/if}
        </div>

        <div class="danger">
            {#if !cancelArmed}
                <button class="ghost danger-btn" onclick={() => (cancelArmed = true)}>Cancel this plan</button>
            {:else}
                <span class="small">Cancel this plan? Everyone gets told. The thread stays until you delete it by hand in Discord.</span>
                <button class="ghost danger-btn" onclick={doCancel} disabled={cancelling}>
                    {cancelling ? 'Cancelling...' : 'Yes, cancel it'}
                </button>
                <button class="ghost" onclick={() => (cancelArmed = false)}>No</button>
            {/if}
            {#if cancelError}<p class="status error">{cancelError}</p>{/if}
        </div>
    {/if}
</section>
