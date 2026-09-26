import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import App from '../../src/App.svelte';

/*
    The frame every screen sits in. The router reads window.location as it loads, so it is
    swapped for the not-found screen here, which draws the same whatever route it is given.
*/
vi.mock('svelte-spa-router', async () => ({
    default: (await import('../../src/routes/NotFound.svelte')).default,
    router: { location: '/', querystring: '' },
    push: async () => {}
}));

const page = () => render(App).body;

describe('the page frame', () => {
    it('puts the header, main and footer side by side rather than one inside another', () => {
        const body = page();
        const headerEnd = body.indexOf('</header>');
        const main = body.indexOf('<main id="content"');
        const mainEnd = body.indexOf('</main>');
        const footer = body.indexOf('<footer');
        expect(headerEnd).toBeGreaterThan(-1);
        expect(main).toBeGreaterThan(headerEnd);
        expect(footer).toBeGreaterThan(mainEnd);
    });

    it('starts with a link that skips to the content', () => {
        const first = page().match(/<a [^>]*>[^<]*<\/a>/)?.[0];
        expect(first).toContain('href="#content"');
        expect(first).toContain('Skip to content');
    });
});
