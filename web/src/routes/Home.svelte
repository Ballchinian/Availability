<script module lang="ts">
    import PlanCards, { stepFor } from '../lib/PlanCards.svelte';
    import type { UserGuild, UserPlan } from '../lib/types.js';

    /*
        Anything still waiting on them first, then the rest of the open ones, then
        the days already set, soonest first. Whatever needs doing is at the top.
    */
    export function sortPlans(plans: UserPlan[]): UserPlan[] {
        const rank = (p: UserPlan) => (stepFor(p).asks ? 0 : p.status === 'collecting' ? 1 : 2);
        return [...plans].sort((a, b) => rank(a) - rank(b) || (a.chosenDate || a.start).localeCompare(b.chosenDate || b.start));
    }
</script>

<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import Practice from '../lib/Practice.svelte';
    import StartPlan from '../lib/StartPlan.svelte';

    /*
        The front door. Every other screen knows which server or plan it is about
        because the link the bot posted said so, so this is the one that has to
        work out for itself what the person in front of it can do.
    */

    let loading = $state(true);
    let loadError = $state('');
    let guilds = $state<UserGuild[]>([]);
    let plans = $state<UserPlan[]>([]);

    const sortedPlans = $derived(sortPlans(plans));

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
</script>

<!--The front door keeps the name the bot's links carry until there is somebody to name it for-->
<svelte:head><title>{auth.user ? 'My plans' : 'Plan a meetup'}</title></svelte:head>

<!--The heading comes as soon as it is known who is here rather than with the plans,
    since a move from another page sends focus to it-->
<section class="screen">
    {#if !auth.loaded}
        <p class="muted">Loading your plans...</p>
    {:else if !auth.user}
        <h1>When is everyone free?</h1>
        <p>Work out when a group is actually free, without the twenty message back and forth.</p>
        <p class="muted">
            Log in above to see the plans you are part of. If you have not met the bot yet, someone in your server needs to
            invite it and run <code>/setup</code>.
        </p>
    {:else}
        <h1>My plans</h1>

        {#if loading}
            <p class="muted">Loading your plans...</p>
        {:else if loadError}
            <p class="status error">{loadError}</p>
        {:else}
            <StartPlan {guilds} />

            {#if plans.length === 0}
                <p class="muted">
                    Nothing on the go. When someone invites you to a plan it turns up here, and you get a DM with the link as well.
                </p>
            {:else}
                <PlanCards plans={sortedPlans} />
            {/if}

            <Practice {guilds} />
        {/if}
    {/if}
</section>
