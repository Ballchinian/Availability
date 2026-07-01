<script lang="ts">
    import Router from 'svelte-spa-router';
    import Create from './routes/Create.svelte';
    import Availability from './routes/Availability.svelte';
    import GenericAvailability from './routes/GenericAvailability.svelte';
    import Compare from './routes/Compare.svelte';
    import Terms from './routes/Terms.svelte';
    import Privacy from './routes/Privacy.svelte';
    import NotFound from './routes/NotFound.svelte';

    /*
        Hash based routes so the static build works anywhere with no server
        rewrites. The bot hands out links like /#/plan/<id>. The router maps each
        path to the screen that handles it.
    */
    const routes = {
        '/': Create,
        '/g/:guildId': Create,
        '/availability': GenericAvailability,
        '/plan/:planId': Availability,
        '/plan/:planId/compare': Compare,
        '/terms': Terms,
        '/privacy': Privacy,
        '*': NotFound
    };
</script>

<main>
    <Router {routes} />
</main>
