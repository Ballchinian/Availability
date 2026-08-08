<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        The plan's title and description. Renaming reaches into Discord, so the
        copy says so: the thread gets renamed and its pinned post rewritten.
    */
    let { planId, name = '', description = '', onsaved }: {
        planId: string;
        name?: string;
        description?: string;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let title = $state('');
    let desc = $state('');

    //Prefilled on open rather than at load, so a cancel leaves no half-typed edit behind
    function open() {
        panel.show();
        title = name;
        desc = description || '';
    }

    async function save() {
        if (!title.trim()) {
            panel.reject('Give the plan a name.');
            return;
        }
        if (title.trim() === name && desc.trim() === (description || '')) {
            panel.reject('Nothing changed there. Edit the title or the description to update it.');
            return;
        }
        await panel.run(async () => {
            await api(`/plans/${planId}/details`, {
                method: 'POST',
                body: JSON.stringify({ name: title.trim(), description: desc.trim() })
            });
            panel.open = false;
            await onsaved();
        });
    }
</script>

<div class="edit" class:wide={panel.open || Boolean(panel.msg)}>
    {#if !panel.open}
        <button class="ghost" onclick={open}>Edit title or description</button>
    {:else}
        <p class="muted small">Change the plan's title or description. The thread gets renamed and its pinned post updated. Nobody is pinged or DMed.</p>
        <label class="lbl" for="ename">Title</label>
        <input id="ename" type="text" bind:value={title} maxlength="90" />
        <label class="lbl" for="edesc">Description (optional)</label>
        <textarea id="edesc" bind:value={desc} maxlength="280" rows="2"></textarea>
        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy}>
                {panel.busy ? 'Saving...' : 'Save changes'}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
