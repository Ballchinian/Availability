<script lang="ts">
    import { refocus } from './focus.js';
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
    const uid = $props.id();
    let root = $state<HTMLDivElement>();

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

    /*
        A chip pressed crosses to the other list, so focus stays in the list it left, on the
        next person down, and goes to the search box once that list is empty. Pressing on
        down a list invites one after another.
    */
    function stayIn(list: Member[], id: string) {
        const at = list.findIndex((m) => m.id === id);
        const next = list[at + 1] ?? list[at - 1];
        refocus(() => root?.querySelector<HTMLElement>(next ? `[data-member="${next.id}"]` : '.search'));
    }

    function add(id: string) {
        if (selectedSet.has(id)) return;
        stayIn(pool, id);
        selectedIds = [...selectedIds, id];
    }
    function remove(id: string) {
        stayIn(chosen, id);
        selectedIds = selectedIds.filter((x) => x !== id);
    }

    //Everyone the left column is currently showing, so a search doubles as a way to
    //invite a group of people in one go
    function addAll() {
        selectedIds = [...selectedIds, ...pool.map((m) => m.id)];
        refocus(() => root?.querySelector<HTMLElement>('.search'));
    }
    function clearAll() {
        selectedIds = [];
        refocus(() => root?.querySelector<HTMLElement>('.search'));
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

<div class="picker" bind:this={root}>
    <div class="col">
        <div class="col-head">
            <span id="{uid}-pool">Members ({pool.length})</span>
            <label class="offscreen" for="{uid}-search">Search members</label>
            <input id="{uid}-search" class="search" type="text" placeholder="Search..." bind:value={search} />
        </div>
        <ul
            class="list"
            aria-labelledby="{uid}-pool"
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => onDrop(e, 'pool')}
        >
            {#each pool as m (m.id)}
                <li>
                    <button
                        class="chip"
                        data-member={m.id}
                        draggable="true"
                        ondragstart={(e) => onDragStart(e, m.id)}
                        onclick={() => add(m.id)}
                        aria-label="Add {m.displayName}"
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
            <span id="{uid}-chosen">Invited ({chosen.length})</span>
            <span class="head-actions">
                <button type="button" class="quick" onclick={addAll} disabled={pool.length === 0}>
                    {search.trim() ? 'Add all shown' : 'Add all'}
                </button>
                <button type="button" class="quick" onclick={clearAll} disabled={chosen.length === 0}>Clear</button>
            </span>
        </div>
        <ul
            class="list drop"
            aria-labelledby="{uid}-chosen"
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => onDrop(e, 'chosen')}
        >
            {#each chosen as m (m.id)}
                <li>
                    <button
                        class="chip selected"
                        data-member={m.id}
                        draggable="true"
                        ondragstart={(e) => onDragStart(e, m.id)}
                        onclick={() => remove(m.id)}
                        aria-label="Remove {m.displayName}"
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
