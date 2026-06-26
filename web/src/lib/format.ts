/*
    Dates are stored as YYYY-MM-DD but shown to people as day-month-year, which
    is how everyone here reads a date. One helper so every screen formats the
    same way.
*/
export function formatDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}
