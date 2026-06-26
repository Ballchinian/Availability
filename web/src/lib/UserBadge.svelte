<script lang="ts">
    import { auth, loginHref, logout } from './auth.svelte.js';
</script>

{#if !auth.loaded}
    <span class="muted">checking...</span>
{:else if auth.user}
    <span class="user-badge">
        <img src={auth.user.avatar} alt="" width="28" height="28" />
        <span>{auth.user.displayName}</span>
        <button class="link-btn" onclick={logout}>Log out</button>
    </span>
{:else}
    <a class="discord-btn" href={loginHref()}>Log in with Discord</a>
{/if}
