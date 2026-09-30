import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    A member leaving or joining a server, and whether their calendar is kept. A record
    made to hold the answers of someone who has only used /free has no list of servers,
    which must never read as sharing none with the bot.
*/

vi.mock('../../src/bot/client.js', () => ({ client: {} }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(), deleteGuildConfig: vi.fn(), markSetupBroken: vi.fn() }));
vi.mock('../../src/db/plans.js', () => ({
    getPlanByThread: vi.fn(),
    deletePlan: vi.fn(),
    deletePlansForGuild: vi.fn(),
    deletePlansUnderChannel: vi.fn(),
    removeUserFromGuildPlans: vi.fn()
}));
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
vi.mock('../../src/bot/plans.js', () => ({ syncPlanCards: vi.fn() }));

const { onGuildMemberRemove, onGuildMemberAdd } = await import('../../src/bot/cleanup.js');

const member = { id: 'bo', guild: { id: 'g1' } };

beforeEach(() => vi.clearAllMocks());

describe('leaving a server', () => {
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
