<script lang="ts">
    import { tick } from 'svelte';
    import { api, errorText } from './api.js';
    import { refocus } from './focus.js';
    import { hrefOf, messageBlocks, pressBody, pressOf, type Bit, type KeptButton, type KeptMessage, type Press } from './outbox.js';
    import Status from './Status.svelte';

    /*
        One message the bot kept on the site, drawn the way Discord would show it. Its
        buttons answer through the routes the site answers with, as whoever is viewing, and
        a no asks for its reason first the way Discord's box does.
    */
    let { message, names, onanswered }: {
        message: KeptMessage;
        names: Record<string, string>;
        onanswered: () => Promise<void> | void;
    } = $props();

    const blocks = $derived(messageBlocks(message.content, names));
    const when = $derived(new Date(message.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }));

    //A no waiting on its reason, and the button that asked, whose label the box takes
    let asking = $state<{ press: Press; label: string } | null>(null);
    let reason = $state('');
    let busy = $state(false);
    let msg = $state('');
    let reasonField = $state<HTMLInputElement>();
    let opener: HTMLElement | null = null;
    const id = $props.id();

    async function press(button: KeptButton, from: HTMLElement) {
        const found = pressOf(button.custom_id);
        if (!found) return;
        if (found.yes) return answer(found);
        opener = from;
        asking = { press: found, label: (button.label || '').replace(/^✓ /, '') };
        reason = '';
        await tick();
        reasonField?.focus();
    }

    async function answer(found: Press) {
        busy = true;
        msg = '';
        try {
            await api(`/plans/${found.planId}/${found.route}`, { method: 'POST', body: JSON.stringify(pressBody(found, reason)) });
            asking = null;
            await onanswered();
        } catch (err) {
            msg = errorText(err);
        }
        busy = false;
    }
</script>

{#snippet line(parts: Bit[])}{#each parts as part, i (i)}{#if part.bold}<strong>{part.text}</strong>{:else if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}{/snippet}

<article class="dm">
    <p class="dm-head">
        <span class="from">Availability</span>
        <time datetime={message.at}>{when}</time>
        {#if message.editedAt}<span>(edited)</span>{/if}
        {#if message.pinned}<span class="tag">pinned</span>{/if}
    </p>
    {#each blocks as block, i (i)}
        {#if 'list' in block}
            <ul>
                {#each block.list as item, j (j)}<li>{@render line(item)}</li>{/each}
            </ul>
        {:else}
            <p>{@render line(block.line)}</p>
        {/if}
    {/each}

    {#each message.components as row, r (r)}
        <div class="dm-row">
            {#each row.components as button, b (b)}
                {#if button.style === 5 && button.url}
                    {@const link = hrefOf(button.url)}
                    <a class="dbtn s5" href={link.href} target={link.away ? '_blank' : undefined} rel={link.away ? 'noopener' : undefined}>{button.label}</a>
                {:else}
                    <button class="dbtn s{button.style}" disabled={button.disabled || busy || !pressOf(button.custom_id)} onclick={(event) => press(button, event.currentTarget)}>{button.label}</button>
                {/if}
            {/each}
        </div>
    {/each}

    {#if asking}
        <form
            class="dm-reason"
            onsubmit={(event) => {
                event.preventDefault();
                if (asking) answer(asking.press);
            }}
        >
            <label for="{id}-reason">Why not? (optional)</label>
            <p class="muted small" id="{id}-who">Only whoever runs the plan sees this.</p>
            <input id="{id}-reason" type="text" maxlength="200" bind:value={reason} bind:this={reasonField} aria-describedby="{id}-who" />
            <div class="btn-row">
                <button class="ghost" type="submit" disabled={busy}>{asking.label}</button>
                <button
                    class="link-btn"
                    type="button"
                    onclick={() => {
                        asking = null;
                        refocus(() => opener);
                    }}>Back</button
                >
            </div>
        </form>
    {/if}
    <Status class="status" {msg} error />
</article>
