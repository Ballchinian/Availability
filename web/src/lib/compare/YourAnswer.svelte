<script lang="ts">
    import { api, errorText } from '../api.js';
    import { refocus } from '../focus.js';
    import type { Answer, LeftPlan, Voted } from '../types.js';
    import Status from '../Status.svelte';
    import { Panel } from './panel.svelte.js';

    /*
        Someone's own answer for a set day: I'm coming or Can't make it, the overview's
        side of the buttons on their DM. Under it, a smaller way off the plan altogether,
        which is all that stops one that comes round again from asking them next time.
    */
    let { planId, vote = null, invited = true, repeats = false, onanswered, onleft }: {
        planId: string;
        //Their own answer, never a call made for them on the board
        vote?: Answer | null;
        //Whether they are on this day's list. Left off it, there is nothing to answer.
        invited?: boolean;
        repeats?: boolean;
        onanswered: () => Promise<void>;
        onleft: (heard: LeftPlan) => void;
    } = $props();

    const panel = new Panel();
    const uid = $props.id();

    //The reason box Can't make it opens
    let declining = $state(false);
    let reason = $state('');
    //Who heard about a no just now, which a refetch has no way of knowing
    let heard = $state<LeftPlan | null>(null);

    let line = $state<HTMLElement>();
    let noButton = $state<HTMLButtonElement>();

    function decline() {
        declining = true;
        refocus(() => document.getElementById(`${uid}-reason`));
    }

    function back() {
        declining = false;
        refocus(() => noButton);
    }

    //The button pressed goes with the answer, so the line saying where they now stand takes focus
    async function answer(to: Answer) {
        await panel.run(async () => {
            const res = await api<Voted>(`/plans/${planId}/vote`, {
                method: 'POST',
                body: JSON.stringify({ vote: to, reason: to === 'no' ? reason : null })
            });
            heard = to === 'no' ? { told: res.told ?? [], missed: res.missed ?? [] } : null;
            declining = false;
            reason = '';
            await onanswered();
        });
        refocus(() => line);
    }

    let leaveArmed = $state(false);
    let leaving = $state(false);
    let leaveError = $state('');
    let leaveButton = $state<HTMLButtonElement>();
    let keepButton = $state<HTMLButtonElement>();

    //The button turns into the question, and focus lands on the answer that changes nothing
    function askToLeave() {
        leaveArmed = true;
        refocus(() => keepButton);
    }

    function keep() {
        leaveArmed = false;
        refocus(() => leaveButton);
    }

    async function leave() {
        leaveError = '';
        leaving = true;
        try {
            const res = await api<Partial<LeftPlan>>(`/plans/${planId}/leave`, { method: 'POST' });
            onleft({ told: res.told ?? [], missed: res.missed ?? [] });
        } catch (err) {
            leaveError = errorText(err);
        }
        leaving = false;
    }
</script>

{#if invited}
    <div class="prompt">
        <p tabindex="-1" bind:this={line}>
            {vote === 'yes' ? "You're down as coming." : vote === 'no' ? "You're down as not coming." : 'Can you make it?'}
            {#if heard?.told.length}I DMed {heard.told.join(', ')} to say so.{/if}
            {#if heard?.missed.length}I could not DM {heard.missed.join(', ')}, so let them know yourself.{/if}
        </p>
        <div class="answer">
            {#if vote !== 'yes' && !declining}
                <button class="primary" onclick={() => answer('yes')} disabled={panel.busy}>I'm coming</button>
            {/if}
            {#if vote !== 'no'}
                {#if !declining}
                    <button class="ghost danger-btn" onclick={decline} disabled={panel.busy} bind:this={noButton}>Can't make it</button>
                {:else}
                    <form
                        class="confirm"
                        onsubmit={(e) => {
                            e.preventDefault();
                            answer('no');
                        }}
                    >
                        <div class="field">
                            <label for="{uid}-reason">Why not? (optional)</label>
                            <input id="{uid}-reason" type="text" maxlength="200" bind:value={reason} aria-describedby="{uid}-who" />
                        </div>
                        <p class="muted small" id="{uid}-who">Only whoever runs the plan sees this.</p>
                        <div class="answer">
                            <button class="ghost danger-btn" disabled={panel.busy}>{panel.busy ? 'Saving...' : "Can't make it"}</button>
                            <button type="button" class="ghost" onclick={back}>Back</button>
                        </div>
                    </form>
                {/if}
            {/if}
        </div>
    </div>
    <Status class="status" msg={panel.msg} error={panel.failed} />
{:else}
    <p class="muted small">You are not on the list for this day.</p>
{/if}

<div class="danger">
    {#if !leaveArmed}
        <button class="link-btn" onclick={askToLeave} bind:this={leaveButton}>Leave this plan</button>
    {:else}
        <span class="small">
            Leave this plan? You come off its guest list{repeats ? ', so it will not ask you when it comes round again' : ''}, and I'll DM whoever runs it.
        </span>
        <button class="ghost danger-btn" onclick={leave} disabled={leaving}>{leaving ? 'Leaving...' : 'Yes, leave it'}</button>
        <button class="ghost" onclick={keep} bind:this={keepButton}>No</button>
    {/if}
</div>
<!--Outside the row above, where an empty line would still take a gap-->
<Status class="status" msg={leaveError} error />
