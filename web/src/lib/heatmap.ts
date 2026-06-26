/*
    Red to green for a month heading, carried over from the original site. An
    empty month sits at maroon, a full one at green, everything in between scales
    smoothly. Filled is how many days in that month are marked, total is how many
    days of the month fall inside the plan's range.
*/
export function fillColor(filled: number, total: number): string {
    if (total <= 0) return 'rgb(128,0,0)';
    const factor = Math.max(0, Math.min(1, filled / total));
    const red = Math.round(128 + (0 - 128) * factor);
    const green = Math.round(0 + (128 - 0) * factor);
    return `rgb(${red},${green},0)`;
}
