<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        What the plan says it is about. One field: the day used to carry a note of its own
        beside this, always drawn on the next line down in every message the bot sends and
        never tellable apart from it on screen.

        A plan made before that carries both, so the box opens on the two joined up and the
        save stores them as one, which is where the old note is let go of.
    */
    let { planId, name = '', description = '', note = '', chosenDate = null, quiet = false, onsaved }: {
        planId: string;
        name?: string;
        description?: string;
        note?: string;
        chosenDate?: string | null;
        quiet?: boolean;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let desc = $state('');

    //Both halves of what an older plan holds, capped where the field is
    const joined = $derived([description, note].filter(Boolean).join(' ').slice(0, 280));

    /*
        Who hears. A plan with a day set DMs everyone still invited, since this field now
        carries what the day's own note did and a moved meeting point has to reach people.
        One with no day yet is rewritten where it sits and says nothing.
    */
    const reach = $derived(
        !chosenDate || quiet
            ? "The pinned post and everyone's DM are rewritten in place. Nobody is pinged."
            : "The pinned post and everyone's DM are rewritten, and everyone still invited is DM'd the change."
    );

    //Prefilled on open rather than at load, so a cancel leaves no half-typed edit behind
    function open() {
        panel.show();
        desc = joined;
    }

    async function save() {
        const want = desc.trim();
        //A stored note counts as a change on its own: saving is what folds it in and drops it
        if (want === (description || '') && !note) {
            panel.reject('Nothing changed there. Edit it to update it.');
            return;
        }

        await panel.run(async () => {
            await api(`/plans/${planId}/details`, {
                method: 'POST',
                body: JSON.stringify({ name, description: want, quiet })
            });
            panel.open = false;
            await onsaved();
            return chosenDate && !quiet ? "Saved. Everyone still invited has been DM'd." : 'Saved. Nobody was pinged.';
        });
    }
</script>

<div class="edit" class:wide={panel.open || Boolean(panel.msg)}>
    {#if !panel.open}
        <button class="ghost" onclick={open}>What it is about is wrong</button>
    {:else}
        <p class="muted small">{reach}</p>
        <label class="lbl" for="adesc">What it is about</label>
        <textarea id="adesc" bind:value={desc} maxlength="280" rows="3" placeholder="A line or two so people know what they are signing up for, and anything they need on the day."></textarea>
        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy}>
                {panel.busy ? 'Saving...' : 'Save it'}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
