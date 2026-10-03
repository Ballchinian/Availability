<script lang="ts">
    import { onMount } from 'svelte';
    import { discordBlocks, quietLine, reviewLine, saveLabel, someNames, type Part } from './review.js';
    import type { EditPreview } from './types.js';
    import Status from './Status.svelte';

    /*
        The edit form's last step: what a save would change, every message it would send
        with who gets it, and the two ways to save. What it shows is the edit route's own
        preview, so a plan someone else changed in the meantime is caught here, before
        anything is sent.
    */
    let { review, busy = '', error = '', onsave, onback }: {
        review: EditPreview;
        //Which save is on its way, if one is
        busy?: '' | 'loud' | 'quiet';
        error?: string;
        onsave: (quiet: boolean) => void;
        onback: () => void;
    } = $props();

    let heading = $state<HTMLElement>();
    const uid = $props.id();
    onMount(() => heading?.focus());

    const post = $derived(review.messages.find((m) => m.kind === 'post'));
    const card = $derived(review.messages.find((m) => m.kind === 'card'));
    const others = $derived(review.messages.filter((m) => m.kind !== 'post' && m.kind !== 'card'));
    const namesOf = (to: 'thread' | string[]) => (Array.isArray(to) ? to : []);

    //The thread post and the line on top of each fresh card say the same, so it is shown once with everyone it reaches
    const where = $derived.by(() => {
        const dm = card ? `on top of the DM to ${someNames(namesOf(card.to))}` : '';
        if (post && dm) return `In the thread, and ${dm}:`;
        return post ? 'In the thread:' : `${dm.charAt(0).toUpperCase()}${dm.slice(1)}:`;
    });
</script>

{#snippet parts(line: Part[])}{#each line as part, i (i)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}{/snippet}

<!--What the bot will send, drawn the way Discord draws it-->
{#snippet said(text: string)}
    <div class="said">
        {#each discordBlocks(text) as block, i (i)}
            {#if 'list' in block}
                <ul>
                    {#each block.list as item, j (j)}<li>{@render parts(item)}</li>{/each}
                </ul>
            {:else}
                <p>{@render parts(block.line)}</p>
            {/if}
        {/each}
    </div>
{/snippet}

<section class="review">
    <h2 tabindex="-1" bind:this={heading}>What this changes</h2>
    <ul class="changes">
        {#each review.changes as change, i (i)}
            <li>{reviewLine(change, review)}</li>
        {/each}
    </ul>

    {#if review.messages.length}
        <h3>What goes out</h3>
        {#if post || card}
            <p class="muted small">{where}</p>
            {@render said(post?.text ?? card?.text ?? '')}
        {/if}
        {#each others as m (m.kind)}
            {#if m.kind === 'invite'}
                <p class="muted small">{someNames(namesOf(m.to))} {namesOf(m.to).length === 1 ? 'gets' : 'get'} the invitation.</p>
            {:else}
                <p class="muted small">To {someNames(namesOf(m.to))}:</p>
                {@render said(m.text)}
            {/if}
        {/each}
    {/if}

    <Status class="status" msg={error} error />

    <div class="btn-row">
        <button class="primary" onclick={() => onsave(false)} disabled={Boolean(busy)}>
            {busy === 'loud' ? 'Saving...' : saveLabel(review.changes)}
        </button>
        <button class="ghost" onclick={() => onsave(true)} disabled={Boolean(busy)} aria-describedby="{uid}-quiet">
            {busy === 'quiet' ? 'Saving...' : 'Save quietly'}
        </button>
        <button class="link-btn" onclick={onback} disabled={Boolean(busy)}>Back to editing</button>
    </div>
    <p class="muted small" id="{uid}-quiet">{quietLine(review)}</p>
</section>
