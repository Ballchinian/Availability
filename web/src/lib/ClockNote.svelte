<script lang="ts">
    import { browserZone, clocksAgree, describeZone } from './zone.js';

    /*
        Which clock the times on this page are written on, said only when it is not the
        one the reader is on. A group who all share a clock never sees this at all, which
        is most of them, and the person who has taken their laptop abroad sees it
        everywhere it matters.
    */
    let { zone = '', what = 'These times' }: { zone?: string; what?: string } = $props();

    const mine = browserZone();
    const differs = $derived(Boolean(zone && mine && !clocksAgree(zone, mine)));
</script>

{#if differs}
    <p class="muted small">{what} are on <strong>{describeZone(zone)}</strong>, and you are on {describeZone(mine)}.</p>
{/if}
