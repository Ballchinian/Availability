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

    const chosen = $derived(dayOn.map((on, i) => (on ? i : -1)).filter((i) => i >= 0));
    const hint = $derived.by(() => {
        if (chosen.length === 0) return 'Pick at least one day people can mark.';
        if (chosen.length === 7) return 'People can mark any day in the range.';
        return `People can only mark ${describeWeekdays(chosen)}.`;
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
<p class="muted small">{hint} Anything else is greyed out on their calendar.</p>
