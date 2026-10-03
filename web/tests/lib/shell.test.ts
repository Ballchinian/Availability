import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import App from '../../src/App.svelte';

/*
    The frame every screen sits in. The router reads window.location as it loads, so it is
    swapped for the not-found screen here, which draws the same whatever route it is given.
*/
const route = vi.hoisted(() => ({ location: '/', querystring: '' }));
vi.mock('svelte-spa-router', async () => ({
    default: (await import('../../src/routes/NotFound.svelte')).default,
    router: route,
    push: async () => {}
}));

const page = (location = '/') => {
    route.location = location;
    return render(App).body;
};

//Each tab's text, for the ones marked as the page being looked at
const current = (body: string) => [...body.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

describe('the tabs', () => {
    it('marks the one for the page being looked at, and only that one', () => {
        expect(current(page('/'))).toEqual(['My plans']);
        expect(current(page('/availability'))).toEqual(['My calendar']);
        expect(current(page('/past'))).toEqual(['Past plans']);
    });

    it('marks none on a page that is not one of them', () => {
        expect(current(page('/plan/ab12cd34ef'))).toEqual([]);
    });
});
