<script lang="ts">
    import { formatTime } from './format.js';

    /*
        A clock-time picker that only offers five minute slots. The native time
        input ignores its step on the minute arrows in most browsers, so it would
        still creep along a minute at a time. A plain dropdown of slots sidesteps
        that and guarantees the value lands on a five. Binds an HH:MM string, or
        empty for no time.
    */
    let { value = $bindable(''), id = '' }: { value?: string; id?: string } = $props();

    //Every five minute slot across the day, each with a friendly 7:30pm style label
    const slots: { v: string; label: string }[] = [];
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 5) {
            const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            slots.push({ v, label: formatTime(v) });
        }
    }
</script>

<select {id} class="time-select" bind:value>
    <option value="">No time</option>
    {#each slots as s (s.v)}
        <option value={s.v}>{s.label}</option>
    {/each}
</select>
