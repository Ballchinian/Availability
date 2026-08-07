<script module lang="ts">
    /*
        The days a picker's on/off array stands for, as the 0-6 list the api takes.
        Lives here so the two forms that own a picker read its state the same way
        rather than each writing out the same map and filter.
    */
    export function chosenDays(dayOn: boolean[]): number[] {
        return dayOn.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
    }
</script>

<script lang="ts">
    import { WEEKDAYS } from './calendar.js';
    import { describeWeekdays } from './format.js';

    /*
        The pick-your-days control, shared by the create form and the compare page.
        It hands back a seven long boolean array, indexed Sunday (0) to Saturday (6)
        to line up with getDay(), but shows the buttons Monday first the way a week
        is usually read. All on means the whole range, no restriction.
    */
    let { dayOn = $bindable([true, true, true, true, true, true, true]) }: {
        dayOn?: boolean[];
    } = $props();

    //Button order, Monday first, while the values behind them stay 0=Sunday
    const ORDER = [1, 2, 3, 4, 5, 6, 0];

    const chosen = $derived(chosenDays(dayOn));
    /*
        Nothing to say while every day is on: the lit buttons already say it. Only a
        restriction has a consequence the buttons do not show, which is the greying out.
    */
    const hint = $derived.by(() => {
        if (chosen.length === 0) return 'Pick at least one day people can mark.';
        if (chosen.length === 7) return '';
        return `Everything but ${describeWeekdays(chosen)} is greyed out on their calendar.`;
    });

    function setWeekends() {
        //Saturday and Sunday, the ends of the calendar week
        dayOn = [true, false, false, false, false, false, true];
    }
    function setEveryDay() {
        dayOn = [true, true, true, true, true, true, true];
    }
    function toggle(i: number) {
        dayOn = dayOn.map((v, idx) => (idx === i ? !v : v));
    }
</script>

<div class="quick-row">
    <button type="button" class="quick" onclick={setWeekends}>Weekends</button>
    <button type="button" class="quick" onclick={setEveryDay}>Every day</button>
</div>
<div class="wdays">
    {#each ORDER as i (i)}
        <button type="button" class="wday" class:on={dayOn[i]} onclick={() => toggle(i)}>{WEEKDAYS[i]}</button>
    {/each}
</div>
{#if hint}<p class="muted small">{hint}</p>{/if}
