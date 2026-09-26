<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import PlanCards from '../lib/PlanCards.svelte';
    import StartPlan from '../lib/StartPlan.svelte';
    import type { UserGuild, UserPlan } from '../lib/types.js';

    /*
        The front door. Every other screen knows which server or plan it is about
        because the link the bot posted said so, so this is the one that has to
        work out for itself what the person in front of it can do.
    */

    let loading = $state(true);
    let loadError = $state('');
    let guilds = $state<UserGuild[]>([]);
    let plans = $state<UserPlan[]>([]);

    /*
        Anything still waiting on them first, then the rest of the open ones, then
        the days already set, soonest first. Whatever needs doing is at the top.
    */
    const sortedPlans = $derived(
        [...plans].sort((a, b) => rank(a) - rank(b) || (a.chosenDate || a.start).localeCompare(b.chosenDate || b.start))
    );

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        try {
            const [g, p] = await Promise.all([
                api<{ guilds: UserGuild[] }>('/me/guilds'),
                api<{ plans: UserPlan[] }>('/me/plans')
            ]);
            guilds = g.guilds;
            plans = p.plans;
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    });

    function rank(p: UserPlan) {
        if (p.status !== 'collecting') return 2;
        return p.inIt && !p.filledIn ? 0 : 1;
    }
</script>

<!--The front door keeps the name the bot's links carry until there is somebody to name it for-->
<svelte:head><title>{auth.user ? 'My plans' : 'Plan a meetup'}</title></svelte:head>

<section class="screen">
    {#if loading}
        <p class="muted">Loading your plans...</p>
    {:else if !auth.user}
        <h1>When is everyone free?</h1>
        <p>Work out when a group is actually free, without the twenty message back and forth.</p>
        <p class="muted">
            Log in above to see the plans you are part of. If you have not met the bot yet, someone in your server needs to
            invite it and run <code>/setup</code>.
        </p>
    {:else if loadError}
        <h1>My plans</h1>
        <p class="status error">{loadError}</p>
    {:else}
        <h1>My plans</h1>

        <StartPlan {guilds} />

        {#if plans.length === 0}
            <p class="muted">
                Nothing on the go. When someone invites you to a plan it turns up here, and you get a DM with the link as well.
            </p>
        {:else}
            <PlanCards plans={sortedPlans} />
        {/if}
    {/if}
</section>
