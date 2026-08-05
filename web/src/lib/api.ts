/*
    One fetch wrapper for the whole app. Always sends the session cookie so the
    backend knows who is logged in, and unwraps json when that is what came back.

    The caller names the shape it expects, from lib/types.ts or written out on the
    spot, and gets unknown if it names nothing, which is right for the calls that
    only care whether they threw. Nothing here checks the body really is that
    shape: it is a claim about the route, kept honest by the endpoint docs.
*/
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`/api${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });

    const type = res.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
        const message = (body && body.error) || res.statusText;
        //Screens render the thrown message straight into the UI, so the path stays in the console
        console.error(`${path} failed: ${message}`);
        throw new Error(message);
    }
    return body;
}

//Pull a readable message out of whatever was thrown, since catch values are unknown
export function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/*
    The one api path the site links to rather than fetches: a calendar file comes back as
    a download, so it belongs in an href and never goes through api() above. Here so the
    /api prefix is still only written in this file.
*/
export function icsHref(planId: string): string {
    return `/api/plans/${planId}/calendar.ics`;
}
