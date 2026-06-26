import { api } from './api.js';

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

export const auth: { user: User | null; loaded: boolean } = $state({ user: null, loaded: false });

export async function loadMe(): Promise<void> {
    try {
        const res = await api('/auth/me');
        auth.user = res.user;
    } catch {
        auth.user = null;
    }
    auth.loaded = true;
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
}
