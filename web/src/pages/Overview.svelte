<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText, isAuthError } from '../site/api.js';
    import { auth, loadMe } from '../site/auth.svelte.js';
    import { listNames } from '../site/format.js';
    import { refocus } from '../site/focus.js';
    import type { CompareScreen, LeftPlan, TakeOnOffer } from '../site/types.js';
    import PlanOverview from '../overview/PlanOverview.svelte';
    import TakeOn from '../overview/TakeOn.svelte';

    /*
        A plan's overview, for everyone on it. This holds the plan and how it loaded, and
        PlanOverview draws it from there.
    */
    let { params = {} }: { params?: Record<string, string> } = $props();

    let loading = $state(true);
    let data = $state<CompareScreen | null>(null);
    //For someone who is not on the plan but could take it on, which is all they are sent
    let offer = $state<TakeOnOffer | null>(null);
    let loadError = $state('');

    const name = $derived(data?.plan.name ?? offer?.plan.name ?? '');

    async function fetchPlan() {
        const res = await api<CompareScreen | TakeOnOffer>(`/plans/${params.planId}/compare`);
        if (res.role === null) {
            offer = res;
            data = null;
        } else {
            data = res;
            offer = null;
        }
    }

    async function load() {
        loading = true;
        loadError = '';
        try {
            await fetchPlan();
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    }

    /*
        A quiet refetch for everything a panel does, no loading flash. The flash is not
        only cosmetic: it swaps the whole page out and back, which builds every panel
        again from nothing, so the line one had just written about who was DMed went
        with it.

        Quiet stops at a session that has gone or a place on the plan taken away:
        nothing forces a full load, so every panel on this page would go on looking
        like it worked.
    */
    async function refresh() {
        try {
            await fetchPlan();
        } catch (err) {
            if (isAuthError(err)) loadError = errorText(err);
        }
    }

    let heading = $state<HTMLElement>();

    //The offer and its button go once it is taken, and the whole page arrives in their place
    async function taken() {
        await load();
        refocus(() => heading);
    }

    /*
        Someone who leaves a plan they do not run has no overview to come back to, so the
        page becomes the line saying they have left. Someone who runs it still has one.
    */
    let left = $state<LeftPlan | null>(null);
    let leftLine = $state<HTMLElement>();

    async function gone(heard: LeftPlan) {
        let still = false;
        try {
            await fetchPlan();
            still = data !== null;
        } catch {
            //No longer on it, which is what the refusal says
        }
        if (still) return;
        left = heard;
        refocus(() => leftLine);
    }

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        await load();
    });
</script>

<!--The plan's name first, since two of these open at once is the whole reason for the title
    and a tab cuts off the end-->
<svelte:head><title>{name ? `${name} · overview` : 'Overview'}</title></svelte:head>

<section class="screen">
    <!--There before the plan is, since a move from another page sends focus to it-->
    <h1 bind:this={heading}>{name || 'Overview'}</h1>

    {#if loading}
        <p class="muted">Loading the plan...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to see this plan.</p>
    {:else if loadError}
        <p class="status error">{loadError}</p>
    {:else if left}
        <p class="prompt good" bind:this={leftLine}>
            You have left this plan.
            {#if left.told.length}I DMed {left.told.join(', ')} to say so.{/if}
            {#if left.missed.length}I could not DM {left.missed.join(', ')}, so let them know yourself.{/if}
        </p>
    {:else if offer}
        <p class="muted">{offer.plan.guildName}</p>
        <p class="muted small">
            You are not on this plan.
            {offer.hosts.length ? `It is run by ${listNames(offer.hosts)}.` : 'Nobody who runs it is still in the server.'}
        </p>
        <TakeOn planId={params.planId} ontaken={taken} />
    {:else if data}
        <PlanOverview planId={params.planId} {data} onrefresh={refresh} onleft={gone} />
    {:else}
        <p class="status error">Could not load this plan.</p>
    {/if}
</section>
