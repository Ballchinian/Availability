<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { api, errorText } from './api.js';
    import { refocus } from './focus.js';
    import Status, { invalidIf } from './Status.svelte';
    import type { PracticePerson, UserGuild } from './types.js';

    /*
        A planner's made-up people, each for one server. Only servers where they plan are
        offered, and the list only holds people from those.
    */
    let { guilds }: { guilds: UserGuild[] } = $props();

    const planning = $derived(guilds.filter((g) => g.setupComplete && g.isPlanner));

    let people = $state<PracticePerson[]>([]);
    let loadError = $state('');

    let name = $state('');
    let planner = $state(false);
    let guildId = $state('');
    let adding = $state(false);
    let msg = $state('');
    let failed = $state(false);
    let nameField = $state<HTMLInputElement>();
    let line = $state<Status>();

    //One heading a server, and none when there is only the one
    const groups = $derived(
        planning
            .map((g) => ({ guild: g, people: people.filter((p) => p.guildId === g.guildId) }))
            .filter((group) => planning.length === 1 || group.people.length)
    );

    onMount(async () => {
        guildId = planning[0]?.guildId ?? '';
        try {
            people = (await api<{ people: PracticePerson[] }>('/practice')).people;
        } catch (err) {
            loadError = errorText(err);
        }
    });

    async function add(event: SubmitEvent) {
        event.preventDefault();
        msg = '';
        failed = false;
        if (!name.trim()) {
            failed = true;
            msg = 'Give them a name.';
            await tick();
            line?.focus();
            return;
        }
        adding = true;
        try {
            const { person } = await api<{ person: PracticePerson }>('/practice', {
                method: 'POST',
                body: JSON.stringify({ guildId, displayName: name, planner })
            });
            people = [...people, person];
            msg = `Added ${person.displayName}.`;
            name = '';
            planner = false;
        } catch (err) {
            failed = true;
            msg = errorText(err);
        }
        adding = false;
        refocus(() => nameField);
    }

    async function remove(person: PracticePerson) {
        msg = '';
        failed = false;
        const at = people.indexOf(person);
        try {
            await api(`/practice/${person.id}`, { method: 'DELETE' });
            people = people.filter((p) => p.id !== person.id);
            msg = `Removed ${person.displayName}.`;
        } catch (err) {
            failed = true;
            msg = errorText(err);
            return;
        }
        //The next one down takes its place, or the name field once the list is empty
        const next = people[Math.min(at, people.length - 1)];
        refocus(() => (next ? document.getElementById(`remove-${next.id}`) : nameField));
    }
</script>

{#if planning.length}
    <section class="group practice">
        <h2>Practice</h2>
        <p class="muted small">Made-up people to try a plan out on. Nobody real hears about it, apart from you.</p>

        {#if loadError}
            <p class="status error">{loadError}</p>
        {/if}

        {#each groups as group (group.guild.guildId)}
            {#if planning.length > 1}<h3>{group.guild.guildName}</h3>{/if}
            {#if group.people.length}
                <ul class="practice-people">
                    {#each group.people as person (person.id)}
                        <li>
                            <span class="who">{person.displayName}</span>
                            {#if person.planner}<span class="tag">planner role</span>{/if}
                            <button class="link-btn" id="remove-{person.id}" aria-label="Remove {person.displayName}" onclick={() => remove(person)}>
                                Remove
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        {/each}

        <form class="practice-add" onsubmit={add}>
            <div class="field">
                <label for="practice-name">Name</label>
                <input id="practice-name" type="text" maxlength="32" autocomplete="off" bind:value={name} bind:this={nameField} {...invalidIf(failed && !name.trim(), 'practice-status')} />
            </div>
            {#if planning.length > 1}
                <div class="field">
                    <label for="practice-guild">Server</label>
                    <select id="practice-guild" bind:value={guildId}>
                        {#each planning as g (g.guildId)}<option value={g.guildId}>{g.guildName}</option>{/each}
                    </select>
                </div>
            {/if}
            <label class="check"><input type="checkbox" bind:checked={planner} />Has the planner role</label>
            <button class="ghost" type="submit" disabled={adding}>{adding ? 'Adding...' : 'Add'}</button>
        </form>
        <!--What went wrong shows, what worked is only read out, since the list above already shows it-->
        <Status class={failed ? 'status' : 'offscreen'} id="practice-status" {msg} error={failed} bind:this={line} />
    </section>
{/if}
