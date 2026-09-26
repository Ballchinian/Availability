<script lang="ts">
    /*
        A line that answers something the reader did: an error is read out at once, a
        result when the screen reader is free. Mounted before it has anything to say,
        since a live region that arrives with its text already in it often goes unread.
        Two regions rather than one role that flips, because a changed role makes a new
        node and that has the same problem.
    */
    let { msg = '', error = false, class: extra = '' }: {
        msg?: string;
        error?: boolean;
        class?: string;
    } = $props();
</script>

<p class={extra} class:error class:silent={!msg}><span role="alert">{error ? msg : ''}</span><span role="status">{error ? '' : msg}</span></p>
