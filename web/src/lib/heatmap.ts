/*
    The heat used by both grids: a month heading, a day shaded by how many hours
    it keeps, a compare cell shaded by the common window. Filled is how much of
    the thing is there, total is how much there could be.

    The ramp is viridis, dark purple through teal to yellow, not the red to green
    of the original site. Red against green is the pairing colour blindness hits
    hardest and this is the primary signal on both grids. Viridis also climbs
    steadily in lightness, so the order survives a greyscale screen or a bad
    projector. Do not swap it for anything that only varies in hue.
*/
const RAMP: [number, number, number][] = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37]
];

/*
    How far up the ramp a full score reaches. Viridis ends on a near maximum chroma
    yellow, and a day free with no hours picked counts as all 24, so the ordinary
    case sat on the loudest colour the ramp has and a filled grid glared. Stopping
    short leaves the top green: 14.2:1 against the page down to 9.3:1, with the
    lightness still climbing the whole way, which is what carries the ordering.
*/
const TOP = 0.8;

function ramp(filled: number, total: number): [number, number, number] {
    if (total <= 0) return RAMP[0];
    const factor = Math.max(0, Math.min(1, filled / total)) * TOP;
    const span = (RAMP.length - 1) * factor;
    const i = Math.min(RAMP.length - 2, Math.floor(span));
    const t = span - i;
    const a = RAMP[i];
    const b = RAMP[i + 1];
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t)
    ];
}

export function fillColor(filled: number, total: number): string {
    const [r, g, b] = ramp(filled, total);
    return `rgb(${r},${g},${b})`;
}

//Relative luminance, the sRGB one contrast is actually judged on
function luminance(r: number, g: number, b: number): number {
    const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/*
    Text to sit on top of a fill. The white the grids default to disappears at the
    yellow end of the ramp, so past a point the page background takes over. 0.2 is
    that point, where white and the page read equally well, which is where the
    worst cell on the ramp comes out best: around 4.2 to 1 either way, and higher
    everywhere else. The shadow goes with the swap, a dark glow under dark text
    smudges rather than lifts.
*/
export function fillTextStyle(filled: number, total: number): string {
    const [r, g, b] = ramp(filled, total);
    if (luminance(r, g, b) <= 0.2) return `background:rgb(${r},${g},${b})`;
    return `background:rgb(${r},${g},${b});color:#16171d;text-shadow:none`;
}

/*
    The same ramp as a text colour on the dark panel. The empty end of the ramp is
    near black there, so lift it towards white by however far down the ramp it
    sits: the full end is bright enough to stand on its own.
*/
export function headingColor(filled: number, total: number): string {
    const [r, g, b] = ramp(filled, total);
    const factor = total <= 0 ? 0 : Math.max(0, Math.min(1, filled / total));
    const lift = 0.55 * (1 - factor);
    const mix = (c: number) => Math.round(c + (255 - c) * lift);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
