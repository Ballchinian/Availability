import { describe, it, expect, vi } from 'vitest';

/*
    The slash commands go by /overview and /mycalendar. Registering replaces the whole
    list on Discord's side, so the old names drop off by themselves on the next boot.
*/

vi.mock('../../src/bot/client.js', () => ({ client: {} }));

const plan = { planId: 'ab12cd34ef', guildId: 'g1', threadId: 't1', name: 'Board games' };
vi.mock('../../src/db/guilds.js', async (real) => ({
    ...(await real()),
    getGuildConfig: vi.fn(async () => ({ setupComplete: true, plannerRoleId: 'r1' }))
}));
vi.mock('../../src/db/plans.js', async (real) => ({
    ...(await real()),
    getPlanByThread: vi.fn(async (threadId) => (threadId === 't1' ? plan : null))
}));

const { commands } = await import('../../src/bot/commands.js');
const { attachEvents } = await import('../../src/bot/events.js');
const { introText, whoCanPlan, createUrl, calendarUrl, compareUrl } = await import('../../src/bot/util.js');
const { config } = await import('../../src/config.js');

//Wires the real dispatch to a client that only collects its listeners
function fakeClient() {
    const listeners = {};
    attachEvents({ once: () => {}, on: (name, fn) => (listeners[name] = fn) });
    return listeners;
}

function slash(commandName) {
    return {
        commandName,
        channelId: 't1',
        guildId: 'g1',
        user: { id: 'ali' },
        guild: { members: { fetch: async () => ({ roles: { cache: { has: (id) => id === 'r1' } } }) } },
        inGuild: () => true,
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        isMessageComponent: () => false,
        isRepliable: () => true,
        reply: vi.fn(async () => {})
    };
}

describe('the command list', () => {
    const names = commands.map((c) => c.name);

    it('registers /overview and /mycalendar', () => {
        expect(names).toContain('overview');
        expect(names).toContain('mycalendar');
    });

    it('no longer registers /compare or /myavailability', () => {
        expect(names).not.toContain('compare');
        expect(names).not.toContain('myavailability');
    });
});

describe('running the renamed commands', () => {
    it('answers /overview with a button to the plan overview', async () => {
        const { interactionCreate } = fakeClient();
        const interaction = slash('overview');
        await interactionCreate(interaction);
        expect(interaction.reply).toHaveBeenCalledTimes(1);
        const { content, components } = interaction.reply.mock.calls[0][0];
        expect(content).toBe('**Board games**');
        const [button] = components[0].components;
        expect(button.data).toMatchObject({ label: 'Open the overview', url: compareUrl('ab12cd34ef') });
    });

    it('answers /mycalendar with the calendar link', async () => {
        const { interactionCreate } = fakeClient();
        const interaction = slash('mycalendar');
        await interactionCreate(interaction);
        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].content).toBe(`Your calendar: ${calendarUrl()}`);
    });
});

describe('the pinned intro', () => {
    const text = introText('g1', 'r1');

    it('lists every command anyone can run, by its new name', () => {
        for (const name of ['/free', '/mylink', '/mycalendar', '/overview', '/cancel', '/timezone']) {
            expect(text).toContain(`- \`${name}\`:`);
        }
        expect(text).not.toMatch(/\/compare|\/myavailability/);
    });

    it('links the calendar, the plans list and starting a plan', () => {
        expect(text).toContain(`**Your calendar:** ${calendarUrl()}`);
        expect(text).toContain(`**Your plans:** ${config.baseUrl}/#/\n`);
        expect(text).toContain(`**Start a plan** (planners): ${createUrl('g1')}`);
    });

    it('ends on the line the setup reply shares', () => {
        const lines = text.split('\n');
        expect(lines.at(-2)).toBe(whoCanPlan('r1'));
        expect(lines.at(-1)).toBe('Deleting a plan thread clears the plan for good.');
        expect(whoCanPlan('r1')).toBe('Anyone with <@&r1> can start a plan and pick who runs it with them.');
    });

    it('has no heads up and no em-dash', () => {
        expect(text).not.toMatch(/heads up/i);
        expect(text).not.toContain('—');
    });
});
