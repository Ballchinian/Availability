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

//Turns a stored HH:MM into a friendly 7:30pm style label, blank if there is no time
export function formatTime(t?: string | null): string {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? 'am' : 'pm';
    const base = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${base}${period}` : `${base}:${String(m).padStart(2, '0')}${period}`;
}
