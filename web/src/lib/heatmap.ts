import { contrast } from './contrast.js';

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

/*
    Text to sit on top of a fill, white or black, whichever reads better on it. The
    closest the two come is 13 hours, white at 4.61:1. The page background standing
    in for black left 14 hours at 4.28:1. The shadow goes with the swap, a dark glow
    under dark text smudges rather than lifts.
*/
export function fillTextStyle(filled: number, total: number): string {
    const fill = ramp(filled, total);
    const [r, g, b] = fill;
    if (contrast([255, 255, 255], fill) >= contrast([0, 0, 0], fill)) return `background:rgb(${r},${g},${b})`;
    return `background:rgb(${r},${g},${b});color:#000;text-shadow:none`;
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
