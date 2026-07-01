<script lang="ts">
    import type { Snippet } from 'svelte';

    /*
        Shared shell for the two legal pages. Discord's developer portal asks for a
        public Terms of Service URL and a Privacy Policy URL (General Information ->
        Terms of Service URL / Privacy Policy URL): point those at #/terms and
        #/privacy on this site.
    */

    let { title, children }: { title: string; children: Snippet } = $props();

    const CONTACT_EMAIL = 'ethantnewiss@gmail.com';
    const LAST_UPDATED = '1 July 2026';
</script>

<section class="screen legal">
    <h1>{title}</h1>
    <p class="muted last-updated">Last updated: {LAST_UPDATED}</p>

    {@render children()}

    <p class="muted foot">
        Questions? Contact <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>. See also the
        <a href="#/terms">Terms of Service</a> and <a href="#/privacy">Privacy Policy</a>.
    </p>
</section>
