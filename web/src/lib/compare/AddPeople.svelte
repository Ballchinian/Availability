<script lang="ts">
    import { api, errorText } from '../api.js';
    import MemberPicker from '../MemberPicker.svelte';
    import type { Member, Participant } from '../types.js';
    import { Panel } from './panel.svelte.js';

    /*
        Pulling more of the server into an existing plan. The member list is
        fetched the first time the panel opens and kept until someone is added,
        since that is the only thing that changes who is left to pick.
    */
    let { planId, guildId, participants = [], quiet = false, onadded }: {
        planId: string;
        guildId: string;
        quiet?: boolean;
        participants?: Participant[];
        onadded: () => Promise<void>;
    } = $props();

    const panel = new Panel();
    let members = $state<Member[]>([]);
    let selectedIds = $state<string[]>([]);
    let listing = $state(false);
    let dm = $state(true);

    async function open() {
        panel.show();
        if (members.length || listing) return;
        listing = true;
        try {
            const res = await api<{ members: Member[] }>(`/guilds/${guildId}/members`);
            const here = new Set(participants.map((p) => p.userId));
            members = res.members.filter((m) => !here.has(m.id));
        } catch (err) {
            panel.reject(errorText(err));
        }
        listing = false;
    }

    async function add() {
        if (!selectedIds.length) {
            panel.reject('Pick at least one person to add.');
            return;
        }
        await panel.run(async () => {
            const res = await api<{ added: number }>(`/plans/${planId}/add`, {
                method: 'POST',
                body: JSON.stringify({ userIds: selectedIds, dm, quiet })
            });
            selectedIds = [];
            members = [];
            panel.open = false;
            await onadded();
            return dm && !quiet
                ? `Added ${res.added} ${res.added === 1 ? 'person' : 'people'} and let them know.`
                : `Added ${res.added} ${res.added === 1 ? 'person' : 'people'} to the thread.`;
        });
    }
</script>

<div class="add">
    {#if !panel.open}
        <button class="ghost" onclick={open}>Add someone to this plan</button>
    {:else}
        <p class="muted small">Pick anyone in the server to pull into this plan. They get added to the thread, and a DM with the link if you leave the box ticked.</p>
        {#if listing}
            <p class="muted small">Loading the member list...</p>
        {:else if members.length === 0}
            <p class="muted small">Everyone in the server is already on this plan.</p>
        {:else}
            <MemberPicker {members} bind:selectedIds />
            <label class="check" class:off={quiet}><input type="checkbox" bind:checked={dm} disabled={quiet} /> DM the people you add</label>
            <!--The one thing quiet cannot cover: there is no way to add somebody to a private
                thread without Discord pinging them about it-->
            {#if quiet}<p class="muted small">Quiet mode is on, so no DM. They are still pinged by being added to the thread, which Discord gives no way around.</p>{/if}
            <div class="add-row">
                <button class="primary" onclick={add} disabled={panel.busy}>
                    {panel.busy ? 'Adding...' : 'Add to the plan'}
                </button>
                <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
            </div>
        {/if}
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed} aria-live="polite">{panel.msg}</p>{/if}
</div>
