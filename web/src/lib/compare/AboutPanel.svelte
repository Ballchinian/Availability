<script lang="ts">
    import { api } from '../api.js';
    import { Panel } from './panel.svelte.js';

    /*
        What the plan says it is about. Two stored fields a planner thinks of as one thing:
        the description belongs to the plan and shows wherever it is mentioned, the note
        belongs to the day and only exists once there is one, which is why the note half
        disappears on a plan still out looking for a date.

        Two endpoints for the same press, since they live in different places: the
        description on details, the note on choose alongside the day it hangs off. Only the
        half that actually moved is sent, so editing a note never renames a thread.
    */
    let { planId, name = '', description = '', chosenDate = null, time = '', note = '', quiet = false, onsaved }: {
        planId: string;
        name?: string;
        description?: string;
        chosenDate?: string | null;
        time?: string;
        note?: string;
        quiet?: boolean;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let desc = $state('');
    let dayNote = $state('');

    //A plan still out looking for a day has no note to edit, so the button cannot offer one
    const hasNote = $derived(Boolean(chosenDate));

    /*
        How far a save reaches, which nothing on screen shows. The description is rewritten
        where it already sits and stops there; the note is the half that sends a fresh DM,
        and quiet is what stops that one.
    */
    const reach = $derived(
        hasNote && !quiet
            ? "The pinned post and everyone's DM are rewritten in place, and a changed note DMs everyone still invited."
            : "The pinned post and everyone's DM are rewritten in place. Nobody is pinged."
    );

    //Prefilled on open rather than at load, so a cancel leaves no half-typed edit behind
    function open() {
        panel.show();
        desc = description || '';
        dayNote = note || '';
    }

    async function save() {
        const wantDesc = desc.trim();
        const wantNote = dayNote.trim();
        const descMoved = wantDesc !== (description || '');
        const noteMoved = Boolean(chosenDate) && wantNote !== (note || '');

        if (!descMoved && !noteMoved) {
            panel.reject(hasNote ? 'Nothing changed there. Edit the description or the note to update it.' : 'Nothing changed there. Edit the description to update it.');
            return;
        }

        await panel.run(async () => {
            if (descMoved) {
                await api(`/plans/${planId}/details`, {
                    method: 'POST',
                    body: JSON.stringify({ name, description: wantDesc })
                });
            }
            if (noteMoved) {
                await api(`/plans/${planId}/choose`, {
                    method: 'POST',
                    body: JSON.stringify({ date: chosenDate, time: time || null, note: wantNote || null, quiet })
                });
            }
            panel.open = false;
            await onsaved();
            //The note is the only half that reaches anybody, and only when it is not quiet
            return noteMoved && !quiet ? "Saved. Everyone still invited has been DM'd the new note." : 'Saved. Nobody was pinged.';
        });
    }
</script>

<div class="edit" class:wide={panel.open || Boolean(panel.msg)}>
    {#if !panel.open}
        <button class="ghost" onclick={open}>{hasNote ? 'The note or description is wrong' : 'The description is wrong'}</button>
    {:else}
        <p class="muted small">{reach}</p>
        <label class="lbl" for="adesc">What it is about</label>
        <textarea id="adesc" bind:value={desc} maxlength="280" rows="2" placeholder="A line or two so people know what they are signing up for."></textarea>
        {#if hasNote}
            <label class="lbl" for="anote">Note on the day</label>
            <input id="anote" type="text" bind:value={dayNote} placeholder="e.g. meet at the station, bring boots" maxlength="200" />
        {/if}
        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy}>
                {panel.busy ? 'Saving...' : 'Save it'}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
