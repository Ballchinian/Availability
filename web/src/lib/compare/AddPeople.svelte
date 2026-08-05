<script lang="ts">
    import { api, errorText } from '../api.js';
    import MemberPicker from '../MemberPicker.svelte';
    import type { Member } from '../types.js';
    import { Panel } from './panel.svelte.js';

    /*
        Pulling more of the server into an existing plan. The member list is
        fetched the first time the panel opens and kept until someone is added,
        since that is the only thing that changes who is left to pick.
    */
    let { planId, guildId, participants = [], onadded }: {
        planId: string;
        guildId: string;
        participants?: any[];
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
            const res = await api(`/guilds/${guildId}/members`);
            const here = new Set(participants.map((p: any) => p.userId));
            members = res.members.filter((m: Member) => !here.has(m.id));
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
            const res = await api(`/plans/${planId}/add`, {
                method: 'POST',
                body: JSON.stringify({ userIds: selectedIds, dm })
            });
            selectedIds = [];
            members = [];
            panel.open = false;
            await onadded();
            return dm
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
            <label class="check"><input type="checkbox" bind:checked={dm} /> DM the people you add</label>
            <div class="add-row">
                <button class="primary" onclick={add} disabled={panel.busy}>
                    {panel.busy ? 'Adding...' : 'Add to the plan'}
                </button>
                <button class="ghost" onclick={() => (panel.open = false)}>Cancel</button>
            </div>
        {/if}
    {/if}
    {#if panel.msg}<p class="status small" class:error={panel.failed}>{panel.msg}</p>{/if}
</div>
