<script lang="ts">
    /*
        A clock-time picker split into an hour dropdown and a minute dropdown that
        only steps in fives. The native time input ignores its step on the minute
        arrows in most browsers, so it would still creep along a minute at a time,
        this does the five minute stepping by hand. Binds an HH:MM string, or empty
        for no time.
    */
    let { value = $bindable(''), id = '' }: { value?: string; id?: string } = $props();

    //Split the bound value into its hour and minute, blank hour meaning no time
    function parse(v: string) {
        if (!v || !/^\d{2}:\d{2}$/.test(v)) return { hh: '', mm: '00' };
        const [h, m] = v.split(':');
        return { hh: h, mm: m };
    }
    const hh = $derived(parse(value).hh);
    const mm = $derived(parse(value).mm);

    //Hours read 12am to 11pm but store as 24h, minutes run every five
    const hours = Array.from({ length: 24 }, (_, h) => ({
        v: String(h).padStart(2, '0'),
        label: `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`
    }));
    const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

    function setHour(e: Event) {
        const h = (e.currentTarget as HTMLSelectElement).value;
        value = h === '' ? '' : `${h}:${mm}`;
    }
    function setMinute(e: Event) {
        const m = (e.currentTarget as HTMLSelectElement).value;
        if (hh !== '') value = `${hh}:${m}`;
    }
</script>

<span class="time-fields">
    <select {id} class="time-select" value={hh} onchange={setHour}>
        <option value="">No time</option>
        {#each hours as h (h.v)}<option value={h.v}>{h.label}</option>{/each}
    </select>
    <span class="time-colon">:</span>
    <select class="time-select" value={mm} onchange={setMinute} disabled={hh === ''} aria-label="Minutes">
        {#each minutes as m (m)}<option value={m}>{m}</option>{/each}
    </select>
</span>
