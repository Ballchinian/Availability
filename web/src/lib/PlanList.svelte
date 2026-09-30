<script lang="ts">
    import type { PlanLink } from './types.js';

    //Plans named in a sentence, each a link to its page: "A", "A and B", "A, B and C"
    let { plans }: { plans: PlanLink[] } = $props();

    const gap = (i: number) => (i < plans.length - 2 ? ', ' : i === plans.length - 2 ? ' and ' : '');
</script>

{#each plans as p, i (p.planId)}<a href="#/plan/{p.planId}">{p.name}</a>{gap(i)}{/each}
