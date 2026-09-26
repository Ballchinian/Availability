<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import PlanCards from '../lib/PlanCards.svelte';
    import type { UserPlan } from '../lib/types.js';

    let loading = $state(true);
    let loadError = $state('');
    let past = $state<UserPlan[]>([]);

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        try {
            past = (await api<{ past: UserPlan[] }>('/me/plans')).past;
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    });
</script>

<svelte:head><title>Past plans</title></svelte:head>

<section class="screen">
    <h1>Past plans</h1>

    {#if loading}
        <p class="muted">Loading your past plans...</p>
    {:else if !auth.user}
        <p class="muted">Log in above to see your past plans.</p>
    {:else if loadError}
        <p class="status error">{loadError}</p>
    {:else if past.length === 0}
        <p class="muted">Nothing here yet. A plan moves here once its day has been, or when it is called off.</p>
    {:else}
        <p class="muted">
            Nothing here can be changed. If you ran one of these, its overview still has who said what and everything that
            happened along the way, until you delete the thread in Discord.
        </p>
        <PlanCards plans={past} over />
    {/if}
</section>
