import { describe, it, expect, beforeEach, vi } from 'vitest';
import { today, shiftDate, allowedDaysInRange } from '../../src/lib/dates.js';

/*
    A click on a /free picker that was drawn before the plan's dates moved. What matters
    is that nothing is written: the old list's unticked days would otherwise wipe days on
    the new window that the person never saw.
*/

const store = vi.hoisted(() => ({ plan: null }));
vi.mock('../../src/db/plans/index.js', () => ({
    getPlan: vi.fn(async () => store.plan),
    getPlanByThread: vi.fn(),
    getOpenPlansForUser: vi.fn(),
    getCollectingPlansForUser: vi.fn(async () => [{ planId: 'other' }]),
    confirmParticipant: vi.fn(async () => store.plan)
}));
const saved = vi.hoisted(() => ({ replaceAvailabilityInRange: vi.fn(async () => 0), getAvailabilityInRange: vi.fn(async () => []) }));
vi.mock('../../src/db/availability.js', () => saved);
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn() }));
const users = vi.hoisted(() => ({ addAnswered: vi.fn(async () => []) }));
vi.mock('../../src/db/users.js', () => users);
const order = vi.hoisted(() => []);
vi.mock('../../src/bot/plans/index.js', () => ({
    answersMoved: vi.fn(() => order.push('planner told')),
    setDayReply: vi.fn(() => ({ content: 'The day and the yes/no', components: [] }))
}));
vi.mock('../../src/bot/util.js', () => ({ planUrl: () => 'https://example.test/plan' }));

const { handleFree, handleFreeComponent } = await import('../../src/bot/availability.js');
const { getPlanByThread } = await import('../../src/db/plans/index.js');
const { getGuildConfig } = await import('../../src/db/guilds.js');
const { answersMoved } = await import('../../src/bot/plans/index.js');

const day = (n) => shiftDate(today(), n);
const window = (start, end) => ({
    planId: 'ab12cd34ef',
    name: 'Board games',
    status: 'collecting',
    dateRange: { start: day(start), end: day(end) },
    allowedWeekdays: null,
    participants: [{ userId: 'bo' }]
});

function pick(customId, values = []) {
    return { customId, values, user: { id: 'bo' }, update: vi.fn(async () => {}) };
}

beforeEach(() => {
    vi.clearAllMocks();
    //The window the picker was drawn with was days 1 to 14, and it has since moved to 10 to 20
    store.plan = window(10, 20);
});

describe('a picker drawn before the dates moved', () => {
    it('saves nothing from a list and redraws it as the plan is now', async () => {
        const click = pick(`free|day|ab12cd34ef|0|${day(1)}|${day(14)}`, [day(3), day(12)]);

        await handleFreeComponent(click);

        expect(saved.replaceAvailabilityInRange).not.toHaveBeenCalled();
        expect(users.addAnswered).not.toHaveBeenCalled();
        const redrawn = click.update.mock.calls[0][0];
        expect(redrawn.content).toMatch(/saved nothing/);
        expect(redrawn.components[0].toJSON().components[0].custom_id).toBe(`free|day|ab12cd34ef|0|${day(10)}|${day(20)}`);
    });

    it('saves nothing from the blanket buttons either', async () => {
        await handleFreeComponent(pick(`free|none|ab12cd34ef|${day(1)}|${day(14)}`));
        await handleFreeComponent(pick(`free|all|ab12cd34ef|${day(1)}|${day(14)}`));
        expect(saved.replaceAvailabilityInRange).not.toHaveBeenCalled();
    });

    //Pickers already out there when this deploys carry no days at all
    it('redraws an id from before the days were carried', async () => {
        await handleFreeComponent(pick('free|day|ab12cd34ef|0', [day(12)]));
        expect(saved.replaceAvailabilityInRange).not.toHaveBeenCalled();
    });
});

describe('a plan that has its day', () => {
    beforeEach(() => {
        store.plan = { ...window(10, 20), status: 'closed', chosenDate: day(12) };
    });

    it('answers /free in its thread with the yes/no and no day picker', async () => {
        getGuildConfig.mockResolvedValueOnce({ setupComplete: true });
        getPlanByThread.mockResolvedValueOnce(store.plan);
        const run = { inGuild: () => true, guildId: 'g1', channelId: 't1', user: { id: 'bo' }, reply: vi.fn(async () => {}) };

        await handleFree(run);

        expect(run.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'The day and the yes/no', flags: expect.any(Number) }));
    });

    it('saves nothing from a picker opened before the day was set', async () => {
        const click = pick(`free|day|ab12cd34ef|0|${day(10)}|${day(20)}`, [day(12)]);

        await handleFreeComponent(click);

        expect(saved.replaceAvailabilityInRange).not.toHaveBeenCalled();
        expect(click.update.mock.calls[0][0]).toEqual({ content: expect.stringMatching(/is set for .* now, so there are no dates to fill in/), components: [] });
    });
});

describe('a picker that still matches', () => {
    it('saves the list it was drawn with', async () => {
        const click = pick(`free|day|ab12cd34ef|0|${day(10)}|${day(20)}`, [day(12)]);

        await handleFreeComponent(click);

        expect(saved.replaceAvailabilityInRange).toHaveBeenCalledWith('bo', day(10), day(20), [{ date: day(12), hours: [] }], expect.any(Array));
        expect(click.update.mock.calls[0][0].content).not.toMatch(/saved nothing/);
    });

    it("records the list's first and last day as answered, on the plan's weekdays", async () => {
        store.plan = { ...window(10, 20), allowedWeekdays: [0, 6] };
        const days = allowedDaysInRange(day(10), day(20), [0, 6]);

        await handleFreeComponent(pick(`free|none|ab12cd34ef|${days[0]}|${days.at(-1)}`));

        expect(users.addAnswered).toHaveBeenCalledWith('bo', { start: days[0], end: days.at(-1), allowedWeekdays: [0, 6] });
    });

    //A slow DM to the planner used to hold the answer up past Discord's three seconds
    it('answers the click before telling the planner', async () => {
        order.length = 0;
        const click = pick(`free|all|ab12cd34ef|${day(10)}|${day(20)}`);
        click.update = vi.fn(async () => order.push('answered'));

        await handleFreeComponent(click);

        expect(order).toEqual(['answered', 'planner told']);
    });

    //The window it saved answers their other plans over the same days too
    it('brings every plan they are finding a day for up to date', async () => {
        await handleFreeComponent(pick(`free|all|ab12cd34ef|${day(10)}|${day(20)}`));
        expect(answersMoved).toHaveBeenCalledWith('bo', ['ab12cd34ef', 'other']);
    });
});
