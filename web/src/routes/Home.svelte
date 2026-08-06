<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText, icsHref } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import { formatDate, formatTime } from '../lib/format.js';
    import { browserZone, clocksAgree } from '../lib/zone.js';
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
    let past = $state<UserPlan[]>([]);

    const mine = browserZone();

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
                api<{ plans: UserPlan[]; past: UserPlan[] }>('/me/plans')
            ]);
            guilds = g.guilds;
            plans = p.plans;
            past = p.past;
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    });

    //Whether a server can be planned in at all, and if so whether by this person
    function serverNote(g: UserGuild) {
        if (!g.setupComplete) return 'Nobody has run /setup here yet, so planning is not switched on.';
        if (!g.isPlanner) return 'You need the planner role here to start a plan. Ask an admin for it.';
        return '';
    }

    function rank(p: UserPlan) {
        if (p.status !== 'collecting') return 2;
        return p.inIt && !p.filledIn ? 0 : 1;
    }

    //What this plan is waiting on, said from where this person stands in it
    function planNote(p: UserPlan, over: boolean) {
        const where = p.guildName ? `${p.guildName} · ` : '';
        if (p.status === 'cancelled') return `${where}called off`;
        if (p.status !== 'collecting') {
            /*
                This list spans servers, which need not run on one clock, so a time gets the
                clock named after it when that is not the reader's own. A plan with no time
                needs nothing: a day is a day.
            */
            const elsewhere = p.chosenTime && mine && !clocksAgree(p.timeZone, mine) ? ` ${p.timeZone}` : '';
            const when = over ? 'was set for' : 'set for';
            return `${where}${when} ${formatDate(p.chosenDate)}${p.chosenTime ? ` at ${formatTime(p.chosenTime)}${elsewhere}` : ''}`;
        }
        if (!p.inIt) return `${where}yours to run · ${formatDate(p.start)} to ${formatDate(p.end)}`;
        const state = p.filledIn ? 'your dates are in' : 'waiting on your dates';
        return `${where}${state} · ${formatDate(p.start)} to ${formatDate(p.end)}`;
    }
</script>

<!--The front door keeps the name the bot's links carry until there is somebody to name it for-->
<svelte:head><title>{auth.user ? "What you've got on" : 'Plan a meetup'}</title></svelte:head>

<!--Both lists of plans are the same card, so the live ones and the ones that are over share it-->
{#snippet planCards(list: UserPlan[], over: boolean)}
    <ul class="cards">
        {#each list as p (p.planId)}
            <li class="card">
                <div class="body">
                    <a class="name" href={p.inIt ? `#/plan/${p.planId}` : `#/plan/${p.planId}/compare`}>{p.name}</a>
                    <span class="muted note">{planNote(p, over)}</span>
                    {#if p.mine && p.inIt}
                        <a class="action" href="#/plan/{p.planId}/compare">Compare everyone's dates</a>
                    {/if}
                    <!--No calendar link on a day that has already been-->
                    {#if !over && p.status === 'closed' && p.chosenDate}
                        <a class="action" href={icsHref(p.planId)}>Add to your calendar</a>
                    {/if}
                </div>
            </li>
        {/each}
    </ul>
{/snippet}

<section class="screen">
    {#if loading}
        <p class="muted">Loading...</p>
    {:else if !auth.user}
        <h1>When is everyone free?</h1>
        <p>Work out when a group is actually free, without the twenty message back and forth.</p>
        <p class="muted">
            Log in above and you will see the servers you share with the bot and the plans you are part of. If you have not met
            the bot yet, someone in your server needs to invite it and run <code>/setup</code>.
        </p>
    {:else if loadError}
        <h1>What you've got on</h1>
        <p class="status error">{loadError}</p>
    {:else}
        <h1>What you've got on</h1>

        <h2>Your servers</h2>
        {#if guilds.length === 0}
            <p class="muted">
                You are not in any server the bot is in. Once someone invites it to yours and runs <code>/setup</code>, it turns
                up here.
            </p>
        {:else}
            <ul class="cards">
                {#each guilds as g (g.guildId)}
                    <li class="card">
                        {#if g.iconUrl}
                            <img class="icon" src={g.iconUrl} alt="" width="40" height="40" />
                        {:else}
                            <span class="icon blank" aria-hidden="true">{g.guildName.slice(0, 1)}</span>
                        {/if}
                        <div class="body">
                            <span class="name">{g.guildName}</span>
                            {#if serverNote(g)}
                                <span class="muted note">{serverNote(g)}</span>
                            {:else}
                                <a class="action" href="#/g/{g.guildId}">Start a plan</a>
                            {/if}
                        </div>
                    </li>
                {/each}
            </ul>
        {/if}

        <h2>Your plans</h2>
        {#if plans.length === 0}
            <p class="muted">
                Nothing on the go. When someone invites you to a plan it turns up here, and you get a DM with the link as well.
            </p>
        {:else}
            {@render planCards(sortedPlans, false)}
        {/if}

        {#if past.length}
            <details class="group">
                <summary>Been and gone <span class="hint">days that have passed, and plans that were called off</span></summary>
                <p class="muted small">
                    Nothing here can be changed. Who said what, and everything that happened along the way, is still on
                    the compare page until you delete the thread in Discord.
                </p>
                {@render planCards(past, true)}
            </details>
        {/if}

        <h2>Your availability</h2>
        <p class="muted">
            Mark the days you are free ahead of time and every plan you are invited to starts already filled in.
            <a href="#/availability">Set your general availability</a>.
        </p>
    {/if}
</section>
