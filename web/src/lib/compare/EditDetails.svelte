<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        The plan's name, on its own. Renaming reaches into Discord, so the copy says so:
        the thread gets renamed and its pinned post rewritten, and nobody is pinged.

        The description shares this endpoint but not this panel, since "the name is wrong"
        and "what it says it is about is wrong" are two different reasons to be here. It is
        sent back unchanged, because details takes the pair together.
    */
    let { planId, name = '', description = '', onsaved }: {
        planId: string;
        name?: string;
        description?: string;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let title = $state('');

    //Prefilled on open rather than at load, so a cancel leaves no half-typed edit behind
    function open() {
        panel.show();
        title = name;
    }

    async function save() {
        if (!title.trim()) {
            panel.reject('Give the plan a name.');
            return;
        }
        if (title.trim() === name) {
            panel.reject('That is already the name. Change it to update it.');
            return;
        }
        await panel.run(async () => {
            await api(`/plans/${planId}/details`, {
                method: 'POST',
                body: JSON.stringify({ name: title.trim(), description: description || '' })
            });
            panel.open = false;
            await onsaved();
        });
    }
</script>

<div class="edit" class:wide={panel.open || Boolean(panel.msg)}>
    {#if !panel.open}
        <button class="ghost" onclick={open}>The name is wrong</button>
    {:else}
        <p class="muted small">The thread gets renamed with it and its pinned post rewritten. Nobody is pinged or DMed.</p>
        <label class="lbl" for="ename">Name</label>
        <input id="ename" type="text" bind:value={title} maxlength="90" />
        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy}>
                {panel.busy ? 'Saving...' : 'Save the name'}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
