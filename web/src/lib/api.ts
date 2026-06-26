/*
    One fetch wrapper for the whole app. Always sends the session cookie so the
    backend knows who is logged in, and unwraps json when that is what came back.
*/
export async function api(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`/api${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });

    const type = res.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
        const message = (body && body.error) || res.statusText;
        throw new Error(`${path} failed: ${message}`);
    }
    return body;
}

//Pull a readable message out of whatever was thrown, since catch values are unknown
export function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
