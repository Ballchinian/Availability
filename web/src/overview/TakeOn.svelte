<script lang="ts">
    import { api } from '../site/api.js';
    import Status from '../site/Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        Take it on: the reader becomes one of the people who run the plan. Only drawn for
        someone the overview says can, which is a planner once nobody who runs it is left
        in the server, or anyone who can manage the server.
    */
    let { planId, ontaken }: {
        planId: string;
        //The button goes once it has worked, so this is where focus gets sent on from
        ontaken: () => Promise<void>;
    } = $props();

    const panel = new Panel();

    async function take() {
        await panel.run(async () => {
            await api(`/plans/${planId}/takeon`, { method: 'POST' });
            await ontaken();
        });
    }
</script>

<div class="takeon">
    <button class="ghost" onclick={take} disabled={panel.busy}>{panel.busy ? 'Taking it on...' : 'Take it on'}</button>
    <span class="muted small">Makes you one of the people who run it, and its history says so.</span>
</div>
<Status class="status small" msg={panel.msg} error={panel.failed} />
