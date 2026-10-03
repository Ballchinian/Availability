<script module lang="ts">
    //What ties a field to the error line about it, spread onto the field while it is the one at fault
    export function invalidIf(on: boolean, errorId: string) {
        return on ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};
    }
</script>

<script lang="ts">
    import type { Snippet } from 'svelte';

    /*
        A line that answers something the reader did: an error is read out at once, a
        result when the screen reader is free. Mounted before it has anything to say,
        since a live region that arrives with its text already in it often goes unread.
        Two regions rather than one role that flips, because a changed role makes a new
        node and that has the same problem.
    */
    let { msg = '', error = false, id = undefined, class: extra = '', children }: {
        msg?: string;
        error?: boolean;
        id?: string;
        class?: string;
        //Markup in place of msg, for a result with more to it than a string. Never an error.
        children?: Snippet;
    } = $props();

    let line: HTMLParagraphElement;

    //For a failed submit, which sends the reader here rather than leaving them on the button
    export function focus() {
        line.focus();
    }
</script>

<p class={extra} class:error class:silent={!msg && !children} {id} tabindex="-1" bind:this={line}><span role="alert">{error ? msg : ''}</span><span role="status">{#if children}{@render children()}{:else if !error}{msg}{/if}</span></p>
