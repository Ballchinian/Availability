<script lang="ts">
    import { api } from '../api.js';
    import WeekdayPicker, { chosenDays } from '../WeekdayPicker.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        Which weekdays a plan counts, editable mid-plan so a planner can open up
        Mondays without starting again. Opening a day resets confirmations, a pure
        narrowing leaves them be, which is why the message waits on the answer.
    */
    let { planId, allowedWeekdays = null, quiet = false, onsaved }: {
        planId: string;
        allowedWeekdays?: number[] | null;
        quiet?: boolean;
        onsaved: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    //Filled in from the plan on open, since nothing shows it until then
    let dayOn = $state<boolean[]>([true, true, true, true, true, true, true]);
    let note = $state('');
    let post = $state(true);
    let dm = $state(true);

    const chosen = $derived(chosenDays(dayOn));

    //A seven long on/off array from a plan's stored weekdays, all on when there is no restriction
    function dayOnFrom(allowed: number[] | null): boolean[] {
        if (!allowed || allowed.length === 0) return [true, true, true, true, true, true, true];
        return [0, 1, 2, 3, 4, 5, 6].map((i) => allowed.includes(i));
    }

    function open() {
        panel.show();
        dayOn = dayOnFrom(allowedWeekdays);
    }

    async function save() {
        if (chosen.length === 0) {
            panel.reject('Pick at least one day people can mark.');
            return;
        }
        await panel.run(async () => {
            //All seven days is no restriction, so send nothing then
            const payload = chosen.length === 7 ? null : chosen;
            const res = await api<{ reopened: boolean }>(`/plans/${planId}/weekdays`, {
                method: 'POST',
                body: JSON.stringify({ allowedWeekdays: payload, note: note.trim() || null, post, dm, quiet })
            });
            const loud = post && !quiet;
            const dmed = dm && !quiet;
            const told = loud && dmed ? ' Everyone was pinged and DMed.' : loud ? ' The thread was pinged.' : dmed ? ' Everyone was DMed.' : ' Nobody was told.';
            note = '';
            panel.open = false;
            await onsaved();
            return (res.reopened
                ? 'Days updated. A new day opened, so everyone was asked to look again.'
                : 'Days narrowed. The dates people have already filled in still stand, nobody has to redo anything.') + told;
        });
    }
</script>

<div class="days-edit">
    {#if !panel.open}
        <button class="ghost" onclick={open}>Change which days count</button>
    {:else}
        <p class="muted small">Open or close days for this plan, like turning on Mondays. Everyone gets asked to look again, and their saved days stay put.</p>
        <WeekdayPicker bind:dayOn />
        <input type="text" bind:value={note} placeholder="Optional note for the DM (e.g. Mondays are open now)" maxlength="200" />
        {#if quiet}
            <p class="muted small">Quiet mode is on, so nothing goes in the thread and nobody is DMed.</p>
        {:else}
            <label class="check"><input type="checkbox" bind:checked={post} /> Post the change in the thread</label>
            <label class="check"><input type="checkbox" bind:checked={dm} /> DM everyone</label>
        {/if}
        <div class="edit-row">
            <button class="primary" onclick={save} disabled={panel.busy}>
                {panel.busy ? 'Saving...' : 'Update the days'}
            </button>
            <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
        </div>
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
