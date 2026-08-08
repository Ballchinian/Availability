<script lang="ts">
    import { describeEvent, hasActor, timeAgo } from '../history.js';
    import type { PlanEvent } from '../types.js';

    /*
        What has happened to this plan, latest first. A planner explaining why the day
        moved twice has nothing else to go on: the DMs said all of it at the time, but
        only to the people who got them.

        Folded away by default. It is reference rather than a control, and on a plan
        that has been through a few rounds it is longer than everything above it.
    */
    let { history = [] }: { history?: PlanEvent[] } = $props();

    //The stored order is oldest first, which is how it happened but not how it is read
    const latestFirst = $derived([...history].reverse());
</script>

<!--A <details> like every other foldable section on this page. As a small underlined
    link between two headings it read as a footnote rather than as one of the sections.-->
{#if history.length}
    <details class="group history">
        <summary>
            What has happened
            <span class="hint">{history.length} {history.length === 1 ? 'entry' : 'entries'}, latest first</span>
        </summary>
        <ol>
            {#each latestFirst as event (event.at + event.type + event.by)}
                <li>
                    {#if hasActor(event)}<span class="who">{event.byName || 'Someone'}</span>{/if}
                    {describeEvent(event)}
                    <time datetime={event.at} title={new Date(event.at).toLocaleString()}>{timeAgo(event.at)}</time>
                </li>
            {/each}
        </ol>
    </details>
{/if}
