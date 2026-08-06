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
        throw new ApiError(message, res.status);
    }
    return body;
}

/*
    The status travels with the message, since a quiet call sometimes has to tell a
    session that has gone from a request that simply did not work: the first has to
    be said out loud, the second is what "quiet" is for.
*/
export class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

//Logged out, or the role this screen needs taken away. Either way the page is stale.
export function isAuthError(err: unknown): boolean {
    return err instanceof ApiError && (err.status === 401 || err.status === 403);
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
