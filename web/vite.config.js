import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/*
    In dev the svelte app runs on 5173 and the bot and api service runs on 3000,
    so anything starting /api gets proxied across. In production the backend
    serves this build straight out of web/dist, so there is no proxy and the two
    share an origin.
*/
export default defineConfig({
    plugins: [svelte()],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3000'
        }
    }
});
