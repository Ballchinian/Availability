<script lang="ts">
    import { onDestroy, untrack } from 'svelte';
    import { api, errorText } from '../site/api.js';
    import { refocus } from '../site/focus.js';
    import BotMessage from './BotMessage.svelte';
    import type { Kept } from './outbox.js';

    /*
        A list of what the bot kept on the site: someone made up's messages, or a practice
        plan's thread. Read again whenever stamp changes, which the page moves on anything
        it did, and once more a moment later, since most of what a change sends goes out
        after the page has had its answer.
    */
    let { path, title, empty, stamp = null, onanswered = () => {} }: {
        path: string;
        title: string;
        empty: string;
        stamp?: unknown;
        onanswered?: () => Promise<void> | void;
    } = $props();

    let kept = $state<Kept | null>(null);
    let loadError = $state('');
    let heading = $state<HTMLElement>();
    let later: ReturnType<typeof setTimeout> | undefined;

    async function load() {
        try {
            kept = await api<Kept>(path);
            loadError = '';
        } catch (err) {
            loadError = errorText(err);
        }
    }

    function loadTwice() {
        load();
        clearTimeout(later);
        later = setTimeout(load, 2000);
    }

    $effect(() => {
        void stamp;
        untrack(loadTwice);
    });
    onDestroy(() => clearTimeout(later));

    //A card replaced by a newer one takes the pressed button with it
    async function answered() {
        await onanswered();
        await load();
        refocus(() => heading);
        clearTimeout(later);
        later = setTimeout(load, 2000);
    }
</script>

<section class="group kept">
    <h2 tabindex="-1" bind:this={heading}>{title}</h2>
    {#if loadError}
        <p class="status error">{loadError}</p>
    {:else if !kept}
        <p class="muted">Loading {title.toLowerCase()}...</p>
    {:else if !kept.messages.length}
        <p class="muted">{empty}</p>
    {:else}
        <ul class="dms">
            {#each kept.messages as message (message.id)}
                <li><BotMessage {message} names={kept.names} onanswered={answered} /></li>
            {/each}
        </ul>
    {/if}
</section>
