<script lang="ts">
    import { formatDate, formatTime } from './format.js';
    import { browserZone, clocksAgree } from './zone.js';
    import type { UserPlan } from './types.js';

    //My plans and Past plans draw the same card, and `over` is the only difference
    let { plans, over = false }: { plans: UserPlan[]; over?: boolean } = $props();

    const mine = browserZone();

    //What this plan is waiting on, said from where this person stands in it
    function planNote(p: UserPlan) {
        const where = p.guildName ? `${p.guildName} · ` : '';
        if (p.status === 'cancelled') return `${where}called off`;
        if (p.status !== 'collecting') {
            /*
                This list spans servers, which need not run on one clock, so a time gets the
                clock named after it when that is not the reader's own. A plan with no time
                needs nothing: a day is a day.
            */
            const elsewhere = p.chosenTime && mine && !clocksAgree(p.timeZone, mine) ? ` ${p.timeZone}` : '';
            const when = over ? 'was set for' : 'set for';
            return `${where}${when} ${formatDate(p.chosenDate)}${p.chosenTime ? ` at ${formatTime(p.chosenTime)}${elsewhere}` : ''}`;
        }
        if (!p.inIt) return `${where}yours to run · ${formatDate(p.start)} to ${formatDate(p.end)}`;
        const state = p.filledIn ? 'your dates are in' : 'waiting on your dates';
        return `${where}${state} · ${formatDate(p.start)} to ${formatDate(p.end)}`;
    }
</script>

<ul class="cards">
    {#each plans as p (p.planId)}
        <li class="card">
            <div class="body">
                <a class="name" href={p.inIt ? `#/plan/${p.planId}` : `#/plan/${p.planId}/compare`}>{p.name}</a>
                <span class="muted note">{planNote(p)}</span>
                <!--Every way on named out loud. The title above is a link too, and where it
                    lands depends on whether they are in the plan or only running it, which
                    is not something a card can show by looking at it.-->
                {#if p.inIt && p.status === 'collecting'}
                    <a class="action" href="#/plan/{p.planId}">{p.filledIn ? 'Change your dates' : 'Fill in your dates'}</a>
                {/if}
                {#if p.mine}
                    <a class="action" href="#/plan/{p.planId}/compare">
                        {p.status === 'collecting' ? 'Overview' : over ? 'Look back at it' : 'See who is coming'}
                    </a>
                {/if}
            </div>
        </li>
    {/each}
</ul>
