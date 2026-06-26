<script lang="ts">
    import type { Member } from './types.js';

    /*
        Two columns: everyone on the left, the people you have picked on the
        right. Click a person to send them across, or drag them. The left side
        has a search box so a big server stays manageable, and both columns
        scroll rather than stretch the page.
    */
    let { members = [], selectedIds = $bindable([]) }: {
        members?: Member[];
        selectedIds?: string[];
    } = $props();

    let search = $state('');

    const selectedSet = $derived(new Set(selectedIds));

    const pool = $derived(
        members
            .filter((m) => !selectedSet.has(m.id))
            .filter((m) => {
                const q = search.trim().toLowerCase();
                if (!q) return true;
                return m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q);
            })
    );

    const chosen = $derived(members.filter((m) => selectedSet.has(m.id)));

    function add(id: string) {
        if (!selectedSet.has(id)) selectedIds = [...selectedIds, id];
    }
    function remove(id: string) {
        selectedIds = selectedIds.filter((x) => x !== id);
    }

    function onDragStart(e: DragEvent, id: string) {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
    }
    function onDrop(e: DragEvent, target: string) {
        e.preventDefault();
        const id = e.dataTransfer?.getData('text/plain');
        if (!id) return;
        if (target === 'chosen') add(id);
        else remove(id);
    }
</script>

<div class="picker">
    <div class="col">
        <div class="col-head">
            <span>Members</span>
            <input class="search" type="text" placeholder="Search..." bind:value={search} />
        </div>
        <ul
            class="list"
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => onDrop(e, 'pool')}
        >
            {#each pool as m (m.id)}
                <li>
                    <button
                        class="chip"
                        draggable="true"
                        ondragstart={(e) => onDragStart(e, m.id)}
                        onclick={() => add(m.id)}
                        title="Add to the plan"
                    >
                        <img src={m.avatarUrl} alt="" width="24" height="24" />
                        <span>{m.displayName}</span>
                    </button>
                </li>
            {/each}
            {#if pool.length === 0}
                <li class="empty">No one left to add.</li>
            {/if}
        </ul>
    </div>

    <div class="col">
        <div class="col-head">
            <span>Invited ({chosen.length})</span>
        </div>
        <ul
            class="list drop"
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => onDrop(e, 'chosen')}
        >
            {#each chosen as m (m.id)}
                <li>
                    <button
                        class="chip selected"
                        draggable="true"
                        ondragstart={(e) => onDragStart(e, m.id)}
                        onclick={() => remove(m.id)}
                        title="Remove from the plan"
                    >
                        <img src={m.avatarUrl} alt="" width="24" height="24" />
                        <span>{m.displayName}</span>
                    </button>
                </li>
            {/each}
            {#if chosen.length === 0}
                <li class="empty">Click or drag people here.</li>
            {/if}
        </ul>
    </div>
</div>
