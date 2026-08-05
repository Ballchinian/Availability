import { describe, it, expect, afterEach, vi } from 'vitest';

/*
    config.js reads BASE_URL once at import, so every case needs a fresh module.
    All three variables are set on every load because dotenv fills in whatever the
    local .env holds for anything left alone, which would otherwise make these
    pass or fail depending on the machine they run on.
*/
const before = { ...process.env };

async function loadConfig({ nodeEnv, baseUrl, secret }) {
    vi.resetModules();
    process.env.NODE_ENV = nodeEnv;
    process.env.BASE_URL = baseUrl;
    process.env.SESSION_SECRET = secret;
    return import('../src/config.js');
}

afterEach(() => {
    process.env = { ...before };
});

describe('fatalConfig', () => {
    it('lets a proper production setup boot', async () => {
        const { fatalConfig } = await loadConfig({
            nodeEnv: 'production',
            baseUrl: 'https://availabilityforfriends.com',
            secret: 'a-long-random-value'
        });
        expect(fatalConfig()).toBe(null);
    });

    it('stops production on a base url that is not https', async () => {
        const { fatalConfig } = await loadConfig({
            nodeEnv: 'production',
            baseUrl: 'http://availabilityforfriends.com',
            secret: 'a-long-random-value'
        });
        expect(fatalConfig()).toMatch(/BASE_URL/);
    });

    it('stops production on the default secret', async () => {
        const { fatalConfig } = await loadConfig({
            nodeEnv: 'production',
            baseUrl: 'https://availabilityforfriends.com',
            secret: 'dev-secret-change-me'
        });
        expect(fatalConfig()).toMatch(/SESSION_SECRET/);
    });

    it('leaves local development alone', async () => {
        const { fatalConfig } = await loadConfig({
            nodeEnv: 'development',
            baseUrl: 'http://localhost:3000',
            secret: 'dev-secret-change-me'
        });
        expect(fatalConfig()).toBe(null);
    });
});
