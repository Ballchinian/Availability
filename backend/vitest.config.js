import { defineConfig } from 'vitest/config';

//Vitest fills BASE_URL with Vite's base path, "/", and Discord refuses a link button whose url is not a whole address
export default defineConfig({
    test: {
        env: { BASE_URL: 'http://localhost:3000' }
    }
});
