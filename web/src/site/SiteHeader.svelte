<script lang="ts">
    import { onMount } from 'svelte';
    import { router } from 'svelte-spa-router';
    import { auth, backToMe, loadMe } from './auth.svelte.js';
    import UserBadge from './UserBadge.svelte';

    /*
        The one bar that sits above every screen, so wherever a Discord link drops
        you there is a way to your plans and your calendar. It asks who is logged
        in itself, since the legal pages and the not-found screen never do.
    */

    //The calendar keeps /availability, which old DMs link to
    const tabs = [
        { path: '/', label: 'My plans' },
        { path: '/availability', label: 'My calendar' },
        { path: '/past', label: 'Past plans' }
    ];

    onMount(() => {
        loadMe();
        //A request turned away because practice had to end has already signed the planner back in
        const ended = () => loadMe(true);
        window.addEventListener('practiceended', ended);
        return () => window.removeEventListener('practiceended', ended);
    });

    //The router reads any hash without a slash as home, so a plain #content would navigate there
    function skip(event: MouseEvent) {
        event.preventDefault();
        document.getElementById('content')?.focus();
    }
</script>

<header class="site-head">
    <a class="skip" href="#content" onclick={skip}>Skip to content</a>
    <!--Not a link: My plans already goes home-->
    <span class="brand">Availability</span>
    <nav class="tabs">
        {#each tabs as tab (tab.path)}
            <a href="#{tab.path}" aria-current={router.location === tab.path ? 'page' : undefined}>{tab.label}</a>
        {/each}
    </nav>
    <UserBadge />
    {#if auth.real && auth.user}
        <p class="practising">
            Viewing as <strong>{auth.user.displayName}</strong> (practice) ·
            <button class="link-btn" onclick={() => backToMe().catch(() => {})}>Back to you</button>
        </p>
    {/if}
</header>
