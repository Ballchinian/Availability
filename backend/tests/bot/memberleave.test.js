import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    A member leaving or joining a server: what happens to the plans they were on, and
    whether their calendar is kept. A record made to hold the answers of someone who has
    only used /free has no list of servers, which must never read as sharing none with
    the bot.
*/

vi.mock('../../src/bot/client.js', () => ({ client: {} }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(), deleteGuildConfig: vi.fn(), markSetupBroken: vi.fn() }));
const plans = vi.hoisted(() => ({
    getPlanByThread: vi.fn(),
    deletePlan: vi.fn(),
    deletePlansForGuild: vi.fn(),
    deletePlansUnderChannel: vi.fn(),
    removeUserFromGuildPlans: vi.fn(async () => [])
}));
vi.mock('../../src/db/plans.js', () => plans);
const users = vi.hoisted(() => ({
    getUserById: vi.fn(),
    forgetUser: vi.fn(),
    getUsersInGuild: vi.fn(),
    removeUserGuild: vi.fn(),
    addUserGuild: vi.fn()
}));
vi.mock('../../src/db/users.js', () => users);
const availability = vi.hoisted(() => ({ deleteAllForUser: vi.fn() }));
vi.mock('../../src/db/availability.js', () => availability);
vi.mock('../../src/bot/util.js', () => ({ findWritableChannel: vi.fn() }));
const bot = vi.hoisted(() => ({ syncPlanCards: vi.fn(), afterLeaving: vi.fn(async () => {}) }));
vi.mock('../../src/bot/plans.js', () => bot);

const { onGuildMemberRemove, onGuildMemberAdd } = await import('../../src/bot/cleanup.js');

const member = { id: 'bo', guild: { id: 'g1' } };

beforeEach(() => vi.clearAllMocks());

describe('leaving a server', () => {
    //Whoever is left on a plan may now all have answered, and nothing else would notice
    it('comes off every plan there, and has each one still on checked for everyone having answered', async () => {
        const live = { planId: 'p1', status: 'collecting', chosenDate: null };
        plans.removeUserFromGuildPlans.mockResolvedValueOnce([
            live,
            { planId: 'p2', status: 'cancelled', chosenDate: null },
            { planId: 'p3', status: 'closed', chosenDate: '2020-01-04', timeZone: 'Europe/London' }
        ]);
        await onGuildMemberRemove(member);

        expect(plans.removeUserFromGuildPlans).toHaveBeenCalledWith('g1', 'bo');
        expect(bot.afterLeaving.mock.calls).toEqual([[live]]);
    });

    it('carries on with the rest when one plan cannot be checked', async () => {
        plans.removeUserFromGuildPlans.mockResolvedValueOnce([
            { planId: 'p1', status: 'collecting', chosenDate: null },
            { planId: 'p2', status: 'collecting', chosenDate: null }
        ]);
        bot.afterLeaving.mockRejectedValueOnce(new Error('discord is down'));
        users.getUserById.mockResolvedValue({ userId: 'bo', guilds: ['g1', 'g2'] });

        await onGuildMemberRemove(member);

        expect(bot.afterLeaving).toHaveBeenCalledTimes(2);
        expect(users.removeUserGuild).toHaveBeenCalledWith('bo', 'g1');
    });

    it('keeps the calendar of someone who has only used /free', async () => {
        users.getUserById.mockResolvedValue({ userId: 'bo', answered: [{ start: '2026-09-07', end: '2026-09-11' }] });
        await onGuildMemberRemove(member);
        expect(availability.deleteAllForUser).not.toHaveBeenCalled();
        expect(users.forgetUser).not.toHaveBeenCalled();
    });

    it('forgets someone once the bot shares no server with them', async () => {
        users.getUserById.mockResolvedValueOnce({ userId: 'bo', guilds: ['g1'] }).mockResolvedValueOnce({ userId: 'bo', guilds: [] });
        await onGuildMemberRemove(member);
        expect(availability.deleteAllForUser).toHaveBeenCalledWith('bo');
        expect(users.forgetUser).toHaveBeenCalledWith('bo');
    });

    it('keeps someone still in another server with the bot', async () => {
        users.getUserById.mockResolvedValueOnce({ userId: 'bo', guilds: ['g1', 'g2'] }).mockResolvedValueOnce({ userId: 'bo', guilds: ['g2'] });
        await onGuildMemberRemove(member);
        expect(users.forgetUser).not.toHaveBeenCalled();
    });
});

describe('joining a server', () => {
    it('starts no list of servers for someone who has only used /free', async () => {
        users.getUserById.mockResolvedValue({ userId: 'bo', answered: [] });
        await onGuildMemberAdd(member);
        expect(users.addUserGuild).not.toHaveBeenCalled();
    });

    it('adds the server for someone who has logged in', async () => {
        users.getUserById.mockResolvedValue({ userId: 'bo', guilds: [] });
        await onGuildMemberAdd(member);
        expect(users.addUserGuild).toHaveBeenCalledWith('bo', 'g1');
    });
});
