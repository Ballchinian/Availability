<script lang="ts">
    import { onMount } from 'svelte';
    import { loadMe } from './auth.svelte.js';
    import UserBadge from './UserBadge.svelte';

    /*
        The one bar that sits above every screen, so wherever a Discord link drops
        you there is a way home and a way to your own dates. It asks who is logged
        in itself, since the legal pages and the not-found screen never do.
    */

    onMount(loadMe);
</script>

<header class="site-head">
    <a class="brand" href="#/">Availability</a>
    <nav class="site-nav">
        <a href="#/availability">My availability</a>
    </nav>
    <UserBadge />
</header>
