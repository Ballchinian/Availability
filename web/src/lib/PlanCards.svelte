<script module lang="ts">
    import { nextStep, type NextStep } from '../../../shared/coverage.js';
    import type { UserPlan } from './types.js';

    /*
        The one thing a plan wants from this person: the button on its card, and what My
        plans puts first. A backend from before role was sent says only whether they
        filled in, which is enough to tell their dates from the overview.
    */
    export function stepFor(p: UserPlan, over = false): NextStep {
        if (p.role) return nextStep({ ...p, over });
        return nextStep({
            status: p.status,
            over,
            role: p.mine ? 'host' : 'guest',
            onList: p.inIt,
            standing: p.inIt && !p.filledIn ? 'no-dates' : null
        });
    }
</script>

<script lang="ts">
    import { repeatSeries } from './calendar.js';
    import { describeRepeat, formatDate, formatTime, listNames } from './format.js';
    import { browserZone, clocksAgree } from './zone.js';

    //My plans and Past plans draw the same card, and `over` is the only difference
    let { plans, over = false }: { plans: UserPlan[]; over?: boolean } = $props();

    const mine = browserZone();

    //Where the plan has got to, in the words its overview opens on
    function planNote(p: UserPlan) {
        const where = p.guildName ? `${p.guildName} · ` : '';
        if (p.status === 'cancelled') return `${where}called off`;
        if (p.status === 'collecting') {
            if (over) return `${where}never got a day`;
            if (p.datesPassed) return `${where}the dates it asked about have passed`;
            return `${where}finding a day, ${formatDate(p.start)} to ${formatDate(p.end)}`;
        }
        /*
            This list spans servers, which need not run on one clock, so a time gets the
            clock named after it when that is not the reader's own. A plan with no time
            needs nothing: a day is a day.
        */
        const elsewhere = p.chosenTime && mine && !clocksAgree(p.timeZone, mine) ? ` ${p.timeZone}` : '';
        return `${where}${over ? 'was on' : 'set for'} ${formatDate(p.chosenDate)}${p.chosenTime ? ` at ${formatTime(p.chosenTime)}${elsewhere}` : ''}`;
    }

    //When a plan that repeats comes round next. Nothing is made until it has its day, so there is no date before then.
    function repeats(p: UserPlan) {
        const every = `Repeats ${describeRepeat(p.repeatWeeks)}`;
        const [next] = repeatSeries({ repeatWeeks: p.repeatWeeks || 0, dateRange: { start: p.start, end: p.end }, chosenDate: p.chosenDate, chosenTime: p.chosenTime });
        return next ? `${every} · next ${formatDate(next.chosen.date)}` : every;
    }

    //hosts is whoever runs it other than the reader, so on a plan they run it is who they run it with
    function tags(p: UserPlan) {
        const out: string[] = [];
        if (p.role === 'host' && p.hosts?.length) out.push(`${over ? 'You ran this' : 'You run this'} with ${listNames(p.hosts)}`);
        //A plan that is over has already handed its repeat on to the next one
        if (p.repeatWeeks && !over) out.push(repeats(p));
        return out;
    }

    //A backend from before role keeps the overview to whoever made the plan
    function href(p: UserPlan, page: NextStep['page']) {
        if (page === 'plan' || (!p.role && !p.mine)) return `#/plan/${p.planId}`;
        return `#/plan/${p.planId}/${page}`;
    }
</script>

<ul class="cards">
    {#each plans as p (p.planId)}
        {@const step = stepFor(p, over)}
        {@const marks = tags(p)}
        <li class="card">
            <div class="body">
                <a class="name" href={href(p, 'overview')}>{p.name}</a>
                <span class="muted note">{planNote(p)}</span>
                {#if marks.length}
                    <span class="tags">
                        {#each marks as mark (mark)}<span class="tag">{mark}</span>{/each}
                    </span>
                {/if}
            </div>
            <a class="ghost action" href={href(p, step.page)}>{step.label}</a>
        </li>
    {/each}
</ul>
