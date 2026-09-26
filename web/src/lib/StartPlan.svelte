<script lang="ts">
    import type { UserGuild } from './types.js';

    //One server goes straight to its form, and several ask which first
    let { guilds }: { guilds: UserGuild[] } = $props();

    const planning = $derived(guilds.filter((g) => g.setupComplete && g.isPlanner));
    let picking = $state(false);
</script>

{#if planning.length}
    <div class="start">
        {#if planning.length === 1}
            <a class="primary" href="#/g/{planning[0].guildId}">Start a plan</a>
        {:else}
            <button class="primary" aria-expanded={picking} aria-controls="start-in" onclick={() => (picking = !picking)}>
                Start a plan
            </button>
            <div id="start-in" class="start-in" hidden={!picking}>
                <p class="muted" id="start-in-label">Which server is it for?</p>
                <ul aria-labelledby="start-in-label">
                    {#each planning as g (g.guildId)}
                        <li><a class="ghost" href="#/g/{g.guildId}">{g.guildName}</a></li>
                    {/each}
                </ul>
            </div>
        {/if}
    </div>
{/if}
