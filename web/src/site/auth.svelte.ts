import { api } from './api.js';
import { syncZone } from '../calendar/zone.js';

/*
    Shared login state for the whole app. Any component can read auth.user and
    react when it changes. loadMe runs once on a page to find out who, if anyone,
    is signed in.
*/

export interface User {
    id: string;
    username: string;
    displayName: string;
    avatar: string;
}

/*
    real is the planner behind user while they view the site as one of their made-up
    people, and null the rest of the time.
*/
export const auth: { user: User | null; real: User | null; loaded: boolean } = $state({ user: null, real: null, loaded: false });

/*
    One /auth/me for the whole page however many components ask for it. The header
    wants it the moment it mounts and so does every screen under it, so the first
    call does the fetch and the rest wait on that same promise.
*/
let inFlight: Promise<void> | null = null;

//again asks afresh, for when the session has changed under the page
export async function loadMe(again = false): Promise<void> {
    if (again && auth.loaded) {
        auth.loaded = false;
        inFlight = null;
    }
    if (auth.loaded) return;
    if (!inFlight) {
        inFlight = (async () => {
            try {
                const res = await api<{ user: User | null; real?: User | null }>('/auth/me');
                auth.user = res.user;
                auth.real = res.real ?? null;
                //The one place every screen already passes through, so the clock gets told here
                if (res.user) await syncZone();
            } catch {
                auth.user = null;
                auth.real = null;
            }
            auth.loaded = true;
        })();
    }
    await inFlight;
}

//Where "Log in with Discord" points, remembering the page they were on
export function loginHref(): string {
    const returnTo = location.hash ? location.hash.slice(1) : '/';
    return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function logout(): Promise<void> {
    try {
        await api('/auth/logout', { method: 'POST' });
    } catch {
        //Even if the call fails, drop the user locally
    }
    auth.user = null;
    auth.real = null;
}

/*
    Changing who the site is viewed as starts again from My plans, since every screen
    loaded so far was loaded as somebody else.
*/
async function switchTo(path: string) {
    await api(path, { method: 'POST' });
    location.hash = '#/';
    location.reload();
}

export const viewAs = (personId: string) => switchTo(`/practice/as/${personId}`);
export const backToMe = () => switchTo('/practice/back');
