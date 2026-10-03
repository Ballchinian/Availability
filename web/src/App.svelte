<script module lang="ts">
    import Home from './routes/Home.svelte';
    import Create from './routes/Create.svelte';
    import Availability from './routes/Availability.svelte';
    import GenericAvailability from './routes/GenericAvailability.svelte';
    import Overview from './routes/Overview.svelte';
    import Past from './routes/Past.svelte';
    import Terms from './routes/Terms.svelte';
    import Privacy from './routes/Privacy.svelte';
    import NotFound from './routes/NotFound.svelte';

    /*
        Hash based routes so the static build works anywhere with no server
        rewrites. The bot hands out links like /#/plan/<id>. The router maps each
        path to the screen that handles it.
    */
    export const routes = {
        '/': Home,
        '/g/:guildId': Create,
        '/availability': GenericAvailability,
        '/past': Past,
        '/plan/:planId': Availability,
        '/plan/:planId/overview': Overview,
        //What the overview was called, and what every DM sent before the rename links to
        '/plan/:planId/compare': Overview,
        //The edit form is the create form opened on the plan. /dates is what it was before, and what /mylink and older pages link to.
        '/plan/:planId/edit': Create,
        '/plan/:planId/dates': Create,
        '/terms': Terms,
        '/privacy': Privacy,
        '*': NotFound
    };
</script>

<script lang="ts">
    import Router from 'svelte-spa-router';
    import SiteHeader from './lib/SiteHeader.svelte';

    /*
        A hash route changes the page without the browser noticing, so a screen reader
        is left on the link that was pressed. Each move lands it on the new page's h1.
        Not the first route, which is the page loading and starts at the top anyway.
    */
    let arrived = false;
    function toHeading() {
        if (!arrived) {
            arrived = true;
            return;
        }
        const heading = document.querySelector<HTMLElement>('#content h1');
        if (!heading) return;
        heading.tabIndex = -1;
        heading.focus();
    }
</script>

<div class="page">
    <SiteHeader />
    <!--Focused by the skip link in the header-->
    <main id="content" tabindex="-1">
        <Router {routes} onRouteLoaded={toHeading} />
    </main>
    <footer class="site-foot">
        <a href="#/terms">Terms of Service</a>
        <a href="#/privacy">Privacy Policy</a>
    </footer>
</div>
