<script lang="ts">
    import { browserZone, clocksAgree, describeZone, planInstant, wallTime } from './zone.js';
    import { formatTime } from '../site/format.js';

    /*
        Which clock the times on this page are written on, said only when it is not the
        one the reader is on. A group who all share a clock never sees this at all, which
        is most of them, and the person who has taken their laptop abroad sees it
        everywhere it matters.

        Handed a date and time, it says what that one time comes to on their clock instead,
        and asks both clocks about that day: two can agree in January and not in July.
    */
    let {
        zone = '',
        what = 'These times',
        date = '',
        time = ''
    }: { zone?: string; what?: string; date?: string | null; time?: string | null } = $props();

    const mine = browserZone();
    const at = $derived(zone ? planInstant(zone, date, time) : null);
    const differs = $derived(Boolean(zone && mine && !clocksAgree(zone, mine, at ?? undefined)));
</script>

{#if differs}
    {#if at}
        <p class="muted small">
            That is {formatTime(time)} on <strong>{describeZone(zone, at)}</strong>. For you, on {describeZone(mine, at)}, it is
            <strong>{wallTime(mine, at)}</strong>.
        </p>
    {:else}
        <p class="muted small">{what} are on <strong>{describeZone(zone)}</strong>, and you are on {describeZone(mine)}.</p>
    {/if}
{/if}
