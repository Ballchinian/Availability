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
//What /mylink finds for whoever runs it, set per case
const theirs = vi.hoisted(() => ({ plans: [], prefs: {} }));
vi.mock('../../src/db/plans.js', async (real) => ({
    ...(await real()),
    getPlanByThread: vi.fn(async (threadId) => (threadId === 't1' ? plan : null)),
    getLivePlansForUser: vi.fn(async () => theirs.plans)
}));
vi.mock('../../src/db/users.js', async (real) => ({ ...(await real()), getPlanningPrefs: vi.fn(async () => theirs.prefs) }));

const { commands } = await import('../../src/bot/commands.js');
const { attachEvents } = await import('../../src/bot/events.js');
const { introText, whoCanPlan, createUrl, calendarUrl, compareUrl, planUrl } = await import('../../src/bot/util.js');
const { config } = await import('../../src/config.js');
const { getLivePlansForUser } = await import('../../src/db/plans.js');
const { todayIn } = await import('../../src/lib/zones.js');
const { shiftDate } = await import('../../src/lib/dates.js');

//Wires the real dispatch to a client that only collects its listeners
function fakeClient() {
    const listeners = {};
    attachEvents({ once: () => {}, on: (name, fn) => (listeners[name] = fn) });
    return listeners;
}

//Run by someone with no role at all, in the thread of the one plan there is
function slash(commandName, over = {}) {
    return {
        commandName,
        channelId: 't1',
        guildId: 'g1',
        user: { id: 'bo' },
        guild: { members: { fetch: async () => ({ roles: { cache: { has: () => false } } }) } },
        inGuild: () => true,
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        isMessageComponent: () => false,
        isRepliable: () => true,
        reply: vi.fn(async () => {}),
        ...over
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
    //The pinned intro offers it to anyone on the plan, and the page turns away anyone who is not
    it('answers /overview with a button to the plan overview, planner role or not', async () => {
        const { interactionCreate } = fakeClient();
        const interaction = slash('overview');
        await interactionCreate(interaction);
        expect(interaction.reply).toHaveBeenCalledTimes(1);
        const { content, components } = interaction.reply.mock.calls[0][0];
        expect(content).toBe('**Board games**');
        const [button] = components[0].components;
        expect(button.data).toMatchObject({ label: 'Open the overview', url: compareUrl('ab12cd34ef') });
    });

    it('says where /overview goes when it is run outside a plan thread', async () => {
        const { interactionCreate } = fakeClient();
        const interaction = slash('overview', { channelId: 'general' });
        await interactionCreate(interaction);
        const { content, components } = interaction.reply.mock.calls[0][0];
        expect(content).toMatch(/inside a plan's thread/);
        expect(components).toBeUndefined();
    });

    it('answers /mycalendar with the calendar link', async () => {
        const { interactionCreate } = fakeClient();
        const interaction = slash('mycalendar');
        await interactionCreate(interaction);
        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].content).toBe(`Your calendar: ${calendarUrl()}`);
    });
});

/*
    /mylink. Bo is on three plans here: one still to answer, one with its day set, and one
    Bo runs where everyone has answered. Each comes as a button saying what is next.
*/
describe('/mylink', () => {
    const ahead = (days) => shiftDate(todayIn('Europe/London'), days);
    const live = (planId, name, over = {}) => ({
        planId,
        guildId: 'g1',
        name,
        status: 'collecting',
        timeZone: 'Europe/London',
        dateRange: { start: ahead(3), end: ahead(6) },
        createdBy: 'ali',
        participants: [{ userId: 'bo', in: null }],
        ...over
    });
    const run = async () => {
        const { interactionCreate } = fakeClient();
        const interaction = slash('mylink');
        await interactionCreate(interaction);
        return interaction.reply.mock.calls[0][0];
    };
    const buttons = (reply) => reply.components.flatMap((row) => row.components.map((b) => [b.data.label, b.data.url]));

    it('lists every plan they are on here, set ones too, each with what is next', async () => {
        theirs.plans = [
            live('p1', 'Cinema'),
            live('p2', 'Bowling', { status: 'closed', chosenDate: ahead(4) }),
            live('p3', 'Picnic', { hostIds: ['bo'], participants: [{ userId: 'cy', in: true }] })
        ];
        theirs.prefs = { cy: { coveredUntil: ahead(30), answered: [], timeZone: 'Europe/London' } };

        const reply = await run();
        expect(reply.content).toBe('Your plans here:');
        expect(buttons(reply)).toEqual([
            ["Cinema: Say if you're in", planUrl('p1')],
            ["Bowling: Say if you're coming", compareUrl('p2')],
            ['Picnic: Pick the day', compareUrl('p3')]
        ]);
        //A day back, since a day has passed on the server's clock, not on this machine's
        expect(getLivePlansForUser).toHaveBeenCalledWith('g1', 'bo', expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/));
    });

    it('leaves out a day that has been, and a day they were left off unless they run it', async () => {
        theirs.plans = [
            live('p1', 'Been', { status: 'closed', chosenDate: ahead(-2) }),
            live('p2', 'Left off', { status: 'closed', chosenDate: ahead(4), participants: [{ userId: 'bo', invited: false }] }),
            live('p3', 'Mine', { status: 'closed', chosenDate: ahead(4), hostIds: ['bo'], participants: [{ userId: 'bo', invited: false }] })
        ];
        expect(buttons(await run()).map(([label]) => label)).toEqual(['Mine: Overview']);
    });

    it('says so when there is nothing on', async () => {
        theirs.plans = [];
        const reply = await run();
        expect(reply.content).toBe('You are not on any plans here right now.');
        expect(reply.components).toBeUndefined();
    });

    //A name can run to 90 characters and a label stops at 80, so the name is what gives
    it('keeps what is next on the button however long the name is', async () => {
        theirs.plans = [live('p1', 'x'.repeat(90), { participants: [{ userId: 'bo', in: true, sentBack: { byName: 'Ali' } }] })];
        const [[label]] = buttons(await run());
        expect(label).toHaveLength(80);
        expect(label.endsWith('...: Go over your dates again')).toBe(true);
    });

    //Five rows of five is all one message holds
    it('says how many did not fit rather than dropping them quietly', async () => {
        theirs.plans = Array.from({ length: 27 }, (_, i) => live(`p${i}`, `Plan ${i}`));
        const reply = await run();
        expect(reply.components).toHaveLength(5);
        expect(buttons(reply)).toHaveLength(25);
        expect(reply.content).toBe('Your plans here. The 25 newest fit, and the other 2 are on My plans.');
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
