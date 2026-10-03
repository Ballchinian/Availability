<script module lang="ts">
    import MyPlans from './pages/MyPlans.svelte';
    import PlanForm from './pages/PlanForm.svelte';
    import PlanDates from './pages/PlanDates.svelte';
    import MyCalendar from './pages/MyCalendar.svelte';
    import Overview from './pages/Overview.svelte';
    import PastPlans from './pages/PastPlans.svelte';
    import Terms from './pages/Terms.svelte';
    import Privacy from './pages/Privacy.svelte';
    import NotFound from './pages/NotFound.svelte';

    /*
        Hash based routes so the static build works anywhere with no server
        rewrites. The bot hands out links like /#/plan/<id>. The router maps each
        path to the screen that handles it.
    */
    export const routes = {
        '/': MyPlans,
        '/g/:guildId': PlanForm,
        '/availability': MyCalendar,
        '/past': PastPlans,
        '/plan/:planId': PlanDates,
        '/plan/:planId/overview': Overview,
        //What the overview was called, and what every DM sent before the rename links to
        '/plan/:planId/compare': Overview,
        //The edit form is the create form opened on the plan. /dates is what it was before, and what /mylink and older pages link to.
        '/plan/:planId/edit': PlanForm,
        '/plan/:planId/dates': PlanForm,
        '/terms': Terms,
        '/privacy': Privacy,
        '*': NotFound
    };
</script>

<script lang="ts">
    import Router from 'svelte-spa-router';
    import SiteHeader from './site/SiteHeader.svelte';

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
