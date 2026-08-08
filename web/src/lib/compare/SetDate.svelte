<script lang="ts">
    import { api } from '../api.js';
    import { isWeekdayAllowed } from '../calendar.js';
    import { describeWeekdays, formatDate } from '../format.js';
    import { Panel } from './panel.svelte.js';

    /*
        Setting the day outright: type a date, a time and a note, and everyone is told.
        The grid is the other way to do this and the better one when people have filled
        dates in, but it needs somebody to have answered and a cell to click, so a plan
        nobody has answered yet used to have no way to a date at all.

        Everyone stays invited here. Narrowing the guest list to whoever can make it is
        PickPanel's, since working out who that is takes the availability this panel is
        for doing without.
    */
    let { planId, start = '', end = '', allowedWeekdays = null, probeActive = false, chosen = null, quiet = false, onsaved }: {
        planId: string;
        start?: string;
        end?: string;
        allowedWeekdays?: number[] | null;
        probeActive?: boolean;
        chosen?: { date: string; time: string; note: string } | null;
        quiet?: boolean;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let date = $state('');
    let time = $state('');
    let note = $state('');
    let probe = $state(false);
    let owned = $state(false);

    function open() {
        panel.show();
        date = chosen?.date || '';
        time = chosen?.time || '';
        note = chosen?.note || '';
        probe = false;
        owned = false;
    }

    //The day the plan is already on, so this edits the time and the note and moves nothing
    const isUpdate = $derived(Boolean(chosen && date === chosen.date));

    /*
        Said before the save rather than as a rejection from the server, which is where a
        plan pinned to weekends used to tell somebody their Wednesday was no good.
    */
    const wrongDay = $derived(Boolean(date) && !isWeekdayAllowed(date, allowedWeekdays));
    const outOfRange = $derived(Boolean(date) && (date < start || date > end));

    //Everything about it already as it is, which the server answers with a complaint rather than a save
    const noChange = $derived(Boolean(isUpdate && time === chosen!.time && note.trim() === chosen!.note));

    //An edited DM makes no sound, so a day set quietly never reaches anyone who read the old one
    const risky = $derived(quiet && !isUpdate);
    const blocked = $derived(!date || wrongDay || outOfRange || noChange || (risky && !owned));

    async function save() {
        if (!date) {
            panel.reject('Pick the day first.');
            return;
        }
        await panel.run(async () => {
            await api(`/plans/${planId}/choose`, {
                method: 'POST',
                body: JSON.stringify({
                    date,
                    time: time || null,
                    note: note.trim() || null,
                    inviteMode: 'all',
                    probe,
                    quiet
                })
            });
            panel.open = false;
            await onsaved();
            return quiet
                ? `Set for ${formatDate(date)}. Everyone's DM says so, nobody was pinged about it.`
                : `Set for ${formatDate(date)} and everyone has been told.`;
        });
    }
</script>

<div class="set-day" class:wide={panel.open || Boolean(panel.msg)}>
    {#if !panel.open}
        <button class="ghost" onclick={open}>{chosen ? 'Move it, or change the time or note' : 'Set the day yourself'}</button>
    {:else}
        <p class="muted small">
            Set the day straight out, without waiting on anybody's availability. Everyone still on the plan
            is told, in the thread and by DM, and the pinned post and their DMs are rewritten to match.
        </p>

        <label class="lbl" for="sdate">Day</label>
        <input id="sdate" type="date" bind:value={date} min={start} max={end} />

        <label class="lbl" for="stime">Time (optional)</label>
        <input id="stime" type="time" bind:value={time} />

        <label class="lbl" for="snote">Note (optional)</label>
        <input id="snote" type="text" bind:value={note} placeholder="e.g. meet at the station, bring boots" maxlength="200" />

        {#if outOfRange}
            <p class="status error small">This plan only covers {formatDate(start)} to {formatDate(end)}. Pick a day inside that, or move the range first.</p>
        {:else if wrongDay}
            <p class="status error small">This plan only asks about {describeWeekdays(allowedWeekdays)}. Pick one of those, or open the day up first.</p>
        {/if}

        {#if isUpdate}
            <p class="muted small">
                That is the day it is already on, so this changes the time or the note and nothing else.
                Nobody's answer is cleared and the guest list stays as it is.
            </p>
        {:else}
            <p class="muted small">Everyone on the plan stays invited. To narrow it to the people who can make the day, pick it off the grid instead.</p>
            {#if !probeActive}
                <label class="check"><input type="checkbox" bind:checked={probe} /> Ask everyone if they can make it (yes/no)</label>
                {#if probe}
                    <p class="muted small">Everyone gets yes/no buttons in the thread and by DM. I'll DM you when everyone is in, or if someone can't make it.</p>
                {/if}
            {/if}
        {/if}

        {#if risky}
            <p class="status error small">
                Quiet mode is on and this sets the day itself. Everyone's DM will say the new day,
                but nothing will tell them to look, so anyone who has read theirs keeps the old one.
            </p>
            <label class="check"><input type="checkbox" bind:checked={owned} /> I know, set it quietly anyway</label>
        {/if}

        <div class="btn-row">
            <button class="primary" onclick={save} disabled={panel.busy || blocked}>
                {#if panel.busy}Saving...{:else if !date}Pick a day{:else if noChange}Already set for {formatDate(date)}{:else if isUpdate}Update {formatDate(date)}{:else if chosen}Move it to {formatDate(date)}{:else}Set it to {formatDate(date)}{/if}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
