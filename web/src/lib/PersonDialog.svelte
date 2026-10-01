<script module lang="ts">
    //Named apart from the browser's own Window
    import { askedDays, type Window as Asked } from '../../../shared/coverage.js';
    import { formatDay } from './format.js';
    import { formatHours } from './hours.js';
    import type { FreePerson } from './overlap.js';
    import type { Participant } from './types.js';

    /*
        One person's days on a plan, out of what its overview was sent: the days they
        are free on with their hours, the days their answer has not reached, and every
        day the plan still asks about. Nothing is fetched. Whoever may see someone's
        days has them on the page already, so this cannot show anyone more than that.
    */
    export function daysOf(person: Participant, freeByDate: Record<string, FreePerson[]>, asked: Asked, today: string) {
        const free: Record<string, number[]> = {};
        for (const [date, people] of Object.entries(freeByDate)) {
            const theirs = people.find((f) => f.userId === person.userId);
            if (theirs) free[date] = theirs.hours ?? [];
        }
        //Each run is first to last of the days the plan asks about, so a pinned plan's run skips the weekdays between
        const left = (person.unanswered ?? []).flatMap(([first, last]) => askedDays({ ...asked, start: first, end: last }));
        return { free, left, days: askedDays(asked).filter((d) => d >= today) };
    }

    //Where their answer has got to, in a line. Blank once every day the plan asked about has gone.
    export function daysLine(days: string[], left: string[], free: Record<string, number[]>): string {
        const total = days.length;
        if (!total) return '';
        if (!left.length) {
            const count = days.filter((d) => d in free).length;
            if (total === 1) return count ? 'Free that day.' : 'Not free that day.';
            return count ? `Free on ${count} of the ${total} days.` : `Not free on any of the ${total} days.`;
        }
        if (left.length === total) return total === 1 ? 'Still to answer that day.' : `Still to answer all ${total} days.`;

        const first = days.indexOf(left[0]);
        const owed = `${left.length} ${left.length === 1 ? 'day' : 'days'}`;
        return first > 0 ? `Answered up to ${formatDay(days[first - 1])}, with ${owed} after that still to answer.` : `${owed} of the ${total} still to answer.`;
    }

    //Days next to each other in what the plan asks that share a key, as [first, last, key]
    function runs(days: string[], key: (date: string) => string | null): [string, string, string][] {
        const out: [string, string, string][] = [];
        let open: [string, string, string] | null = null;
        for (const d of days) {
            const k = key(d);
            if (k === null) open = null;
            else if (open && open[2] === k) open[1] = d;
            else out.push((open = [d, d, k]));
        }
        return out;
    }

    //The calendar in words, for anyone who cannot see it
    export function daysSpoken(days: string[], left: string[], free: Record<string, number[]>): string {
        const span = ([first, last]: [string, string, string]) => (first === last ? formatDay(first) : `${formatDay(first)} to ${formatDay(last)}`);
        const owed = new Set(left);
        const freeRuns = runs(days, (d) => (d in free ? formatHours(free[d]) : null)).map((r) => (r[2] === 'all day' ? span(r) : `${span(r)}, ${r[2]}`));
        const leftRuns = runs(days, (d) => (owed.has(d) ? '' : null)).map(span);
        return [freeRuns.length ? `Free: ${freeRuns.join('; ')}.` : '', leftRuns.length ? `Still to answer: ${leftRuns.join('; ')}.` : ''].filter(Boolean).join(' ');
    }
</script>

<script lang="ts">
    import DayGrid from './DayGrid.svelte';

    /*
        The quick view: one person's days on a plan still finding its day, as a calendar
        to look at. Their free days are filled the way they are on their own calendar,
        and the days still to answer are dashed.

        A real dialog like TimePicker, so Escape, the focus trap and focus going back
        to the name that opened it all come from showModal.
    */
    let { person, freeByDate, asked, today, onclose }: {
        person: Participant;
        freeByDate: Record<string, FreePerson[]>;
        asked: Asked;
        //On the plan's clock, the same today the overview counts from
        today: string;
        onclose: () => void;
    } = $props();

    let dialog: HTMLDialogElement;
    const uid = $props.id();

    const view = $derived(daysOf(person, freeByDate, asked, today));
    const line = $derived(daysLine(view.days, view.left, view.free));
    //More than one month to draw, which the card widens for
    const wide = $derived(asked.start.slice(0, 7) !== asked.end.slice(0, 7));

    //Mounted only while someone is being looked at, so opening is the whole of it
    $effect(() => {
        dialog.showModal();
    });
</script>

<dialog
    class="person-card"
    class:wide
    bind:this={dialog}
    aria-labelledby="{uid}-name"
    onclose={() => onclose()}
    onclick={(e) => {
        if (e.target === dialog) dialog.close();
    }}
>
    <div class="person-body">
        <header>
            <h2 id="{uid}-name">{person.displayName}'s days</h2>
            <button class="close" aria-label="Close" onclick={() => dialog.close()}>
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
        </header>

        {#if line}<p class="muted small">{line}</p>{/if}

        <DayGrid readOnly start={asked.start} end={asked.end} allowedWeekdays={asked.allowedWeekdays} selection={view.free} toFill={view.left} />
        <p class="offscreen">{daysSpoken(view.days, view.left, view.free)}</p>
    </div>
</dialog>
