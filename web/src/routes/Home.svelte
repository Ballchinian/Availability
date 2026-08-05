<script lang="ts">
    import { onMount } from 'svelte';
    import { api, errorText } from '../lib/api.js';
    import { auth, loadMe } from '../lib/auth.svelte.js';
    import UserBadge from '../lib/UserBadge.svelte';

    /*
        The front door. Every other screen knows which server or plan it is about
        because the link the bot posted said so, so this is the one that has to
        work out for itself what the person in front of it can do.
    */

    let loading = $state(true);
    let loadError = $state('');
    let guilds = $state<any[]>([]);

    onMount(async () => {
        await loadMe();
        if (!auth.user) {
            loading = false;
            return;
        }
        try {
            const res = await api('/me/guilds');
            guilds = res.guilds;
        } catch (err) {
            loadError = errorText(err);
        }
        loading = false;
    });

    //Whether a server can be planned in at all, and if so whether by this person
    function serverNote(g: any) {
        if (!g.setupComplete) return 'Nobody has run /setup here yet, so planning is not switched on.';
        if (!g.isPlanner) return 'You need the planner role here to start a plan. Ask an admin for it.';
        return '';
    }
</script>

<section class="screen">
    <header class="screen-head">
        <h1>Availability</h1>
        <UserBadge />
    </header>

    {#if loading}
        <p class="muted">Loading...</p>
    {:else if !auth.user}
        <p>Work out when a group is actually free, without the twenty message back and forth.</p>
        <p class="muted">
            Log in above and you will see the servers you share with the bot and the plans you are part of. If you have not met
            the bot yet, someone in your server needs to invite it and run <code>/setup</code>.
        </p>
    {:else if loadError}
        <p class="status error">{loadError}</p>
    {:else}
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

        <h2>Your availability</h2>
        <p class="muted">
            Mark the days you are free ahead of time and every plan you are invited to starts already filled in.
            <a href="#/availability">Set your general availability</a>.
        </p>
    {/if}
</section>
