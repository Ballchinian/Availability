<script lang="ts">
    import { untrack } from 'svelte';
    import { api } from '../api.js';
    import { isoFromNow } from '../calendar.js';
    import { formatDate } from '../format.js';
    import { Panel } from './panel.svelte.js';

    /*
        Moving the window a plan asks about. Always open, since needing more days
        is the usual reason a planner comes back to this page at all.
    */
    let { planId, start = '', end = '', quiet = false, onsaved }: {
        planId: string;
        start?: string;
        end?: string;
        quiet?: boolean;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    /*
        The plan's window is where the form starts and nothing more: from then on
        these are the planner's, so a reload cannot wipe what they have typed.
    */
    let newStart = $state(untrack(() => start));
    let newEnd = $state(untrack(() => end));
    let note = $state('');
    let post = $state(true);
    let dm = $state(true);

    //A range edit can run from today out to the two year cap, with start no later than end
    const todayIso = isoFromNow(0, 'day');
    const rangeMax = isoFromNow(2, 'year');

    async function save() {
        if (!newStart || !newEnd) {
            panel.reject('Pick a start and end date first.');
            return;
        }
        if (newStart > newEnd) {
            panel.reject('The start date is after the end date.');
            return;
        }
        if (newStart === start && newEnd === end) {
            panel.reject('That is already the range. Move the start or the end to change it.');
            return;
        }
        await panel.run(async () => {
            const res = await api<{ start: string; end: string }>(`/plans/${planId}/range`, {
                method: 'POST',
                body: JSON.stringify({ start: newStart, end: newEnd, note: note.trim() || null, post, dm, quiet })
            });
            const loud = post && !quiet;
            const dmed = dm && !quiet;
            const told = loud && dmed ? ' and everyone has been pinged and DM\'d' : loud ? ' and the thread has been pinged' : dmed ? " and everyone has been DM'd" : ', quietly';
            note = '';
            await onsaved();
            return `Range set to ${formatDate(res.start)} to ${formatDate(res.end)}${told}.`;
        });
    }
</script>

<div class="extend">
    <p class="muted small">Need different days? Set a new start or end for the range and everyone gets asked to fill in the new window.</p>
    <div class="extend-row">
        <label class="lbl" for="rstart">Start</label>
        <input id="rstart" type="date" bind:value={newStart} min={todayIso} max={newEnd || rangeMax} />
        <label class="lbl" for="rend">End</label>
        <input id="rend" type="date" bind:value={newEnd} min={newStart || todayIso} max={rangeMax} />
    </div>
    <input type="text" bind:value={note} placeholder="Optional note for the DM (e.g. added another weekend)" maxlength="200" />
    <!--Taken away rather than greyed out while quiet is on: a ticked box saying everyone gets
        DMed, next to a line saying nobody does, is the page arguing with itself-->
    {#if quiet}
        <p class="muted small">Quiet mode is on, so nothing goes in the thread and nobody is DMed. Everyone's DM still gets the new window where it sits.</p>
    {:else}
        <label class="check"><input type="checkbox" bind:checked={post} /> Post the new dates in the thread</label>
        <label class="check"><input type="checkbox" bind:checked={dm} /> DM everyone the new dates</label>
    {/if}
    <!--Last, like every other panel here. Up in the row with the dates it was above the note
        and the two toggles it sends, so the way to find them was to have already pressed it.-->
    <div class="edit-row">
        <button class="ghost" onclick={save} disabled={panel.busy}>
            {panel.busy ? 'Saving...' : 'Update the date range'}
        </button>
    </div>
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
