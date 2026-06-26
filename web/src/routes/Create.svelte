<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import type { Member } from '../lib/types.js';
    import UserBadge from '../lib/UserBadge.svelte';
    import MemberPicker from '../lib/MemberPicker.svelte';

    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let guildInfo = $state<any>(null);
    let members = $state<Member[]>([]);
    let loadError = $state('');

    //The form
    let planName = $state('');
    let planDescription = $state('');
    let startDate = $state('');
    let endDate = $state('');
    let selectedIds = $state<string[]>([]);

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
        if (!planDescription.trim()) return (formError = 'Say a little about what the plan is.');
        if (!startDate || !endDate) return (formError = 'Pick a start and end date.');
        if (endDate < startDate) return (formError = 'The end date is before the start.');
        if (selectedIds.length === 0) return (formError = 'Pick at least one person.');

        submitting = true;
        try {
            result = await api(`/guilds/${params.guildId}/plans`, {
                method: 'POST',
                body: JSON.stringify({
                    name: planName.trim(),
                    description: planDescription.trim(),
                    start: startDate,
                    end: endDate,
                    participantIds: selectedIds
                })
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
            <p>Done. I opened a thread for <strong>{planName}</strong> and pinged and DM'd the {result.invited} {result.invited === 1 ? 'person' : 'people'} you picked.</p>
            {#if result.dropped > 0}
                <p class="status">{result.dropped} {result.dropped === 1 ? 'person was' : 'people were'} no longer in the server, so I left them out.</p>
            {/if}
            <p class="muted">Their availability link:</p>
            <a class="plan-link" href={result.url}>{result.url}</a>
        </div>
    {:else}
        <p class="muted">Planning for <strong>{guildInfo.guildName}</strong>.</p>

        <div class="field">
            <label for="planName">Plan name</label>
            <input id="planName" type="text" bind:value={planName} placeholder="e.g. Camping weekend" maxlength="90" />
        </div>

        <div class="field">
            <label for="planDescription">What is it about?</label>
            <textarea id="planDescription" bind:value={planDescription} placeholder="A line or two so people know what they are signing up for." maxlength="280" rows="2"></textarea>
        </div>

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
            <label>Who is coming?</label>
            <MemberPicker {members} bind:selectedIds />
        </div>

        <p class="muted small">Everyone you pick gets pinged in a new thread and a DM with the link, so they can fill in their dates or drop out from wherever they are.</p>

        {#if formError}
            <p class="status error">{formError}</p>
        {/if}

        <button class="primary" onclick={submit} disabled={submitting}>
            {submitting ? 'Setting it up...' : 'Create plan'}
        </button>
    {/if}
</section>
