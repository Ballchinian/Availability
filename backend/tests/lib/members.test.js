import { describe, it, expect, vi } from 'vitest';

//Made-up people: Pat and Lou are Ali's in g1, Kim is Ali's in g2
const madeUp = vi.hoisted(() => [
    { id: 'practice_pat', ownerId: 'ali', guildId: 'g1', displayName: 'Pat', planner: false },
    { id: 'practice_lou', ownerId: 'ali', guildId: 'g1', displayName: 'Lou', planner: true },
    { id: 'practice_kim', ownerId: 'ali', guildId: 'g2', displayName: 'Kim', planner: false }
]);
vi.mock('../../src/db/practice.js', () => ({
    getPracticePerson: async (id) => madeUp.find((p) => p.id === id) || null,
    getPracticePeople: async (ownerId, guildId) => madeUp.filter((p) => p.ownerId === ownerId && p.guildId === guildId),
    getPracticePeopleById: async (ids) => madeUp.filter((p) => ids.includes(p.id))
}));

const { realMembers, namesFor, memberOf, practiceCircle } = await import('../../src/lib/members.js');

/*
    A guild that answers member lookups the way discord.js does: a cache hit is
    synchronous, a miss is a fetch that either resolves or throws. Fetches can be
    made to finish in an order of their own, which is the case the index write in
    realMembers exists for.
*/
const member = (id, bot = false) => ({ id, user: { bot } });

function fakeGuild({ cached = [], remote = [], slow = () => 0, id = 'g1' } = {}) {
    const fetched = [];
    const held = new Map(remote.map((m) => [m.id, m]));
    return {
        id,
        fetched,
        members: {
            cache: new Map(cached.map((m) => [m.id, m])),
            fetch: async (id) => {
                fetched.push(id);
                await new Promise((resolve) => setTimeout(resolve, slow(id)));
                if (!held.has(id)) throw new Error('Unknown Member');
                return held.get(id);
            }
        }
    };
}

describe('realMembers', () => {
    it('keeps everyone the server has', async () => {
        const guild = fakeGuild({ remote: [member('a'), member('b'), member('c')] });
        expect(await realMembers(guild, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('never asks Discord about anything that is not an id', async () => {
        const guild = fakeGuild({ remote: [member('a')] });
        expect(await realMembers(guild, [{}, 7, null, 'a', ['a']])).toEqual(['a']);
        expect(guild.fetched).toEqual(['a']);
    });

    it('drops bots and anyone the server does not have', async () => {
        const guild = fakeGuild({ remote: [member('a'), member('bot', true), member('c')] });
        expect(await realMembers(guild, ['a', 'bot', 'gone', 'c'])).toEqual(['a', 'c']);
    });

    //The guest list order is the one the picker was dragged into, so it has to survive the fan out
    it('holds the order it was given however the fetches land', async () => {
        const order = ['a', 'b', 'c', 'd', 'e'];
        const guild = fakeGuild({
            remote: order.map((id) => member(id)),
            slow: (id) => (order.length - order.indexOf(id)) * 5
        });
        expect(await realMembers(guild, order)).toEqual(order);
    });

    it('asks Discord for nobody it already holds', async () => {
        const guild = fakeGuild({ cached: [member('a'), member('b')], remote: [member('c')] });
        expect(await realMembers(guild, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
        expect(guild.fetched).toEqual(['c']);
    });

    it('keeps someone sent twice only once', async () => {
        const guild = fakeGuild({ remote: [member('a'), member('b')] });
        expect(await realMembers(guild, ['a', 'b', 'a'])).toEqual(['a', 'b']);
        expect(guild.fetched).toEqual(['a', 'b']);
    });

    it('has nothing to say about an empty list', async () => {
        const guild = fakeGuild();
        expect(await realMembers(guild, [])).toEqual([]);
        expect(guild.fetched).toEqual([]);
    });
});

/*
    Made-up people are members of the server they were made for and of no other, and
    Discord is never asked about them.
*/
describe('made-up people as members', () => {
    it('are kept in their own server, in the order given', async () => {
        const guild = fakeGuild({ remote: [member('ali')] });
        expect(await realMembers(guild, ['practice_lou', 'ali', 'practice_pat'])).toEqual(['practice_lou', 'ali', 'practice_pat']);
        expect(guild.fetched).toEqual(['ali']);
    });

    it('are nobody in another server, or once they are gone', async () => {
        const guild = fakeGuild();
        expect(await realMembers(guild, ['practice_kim', 'practice_gone'])).toEqual([]);
        expect(guild.fetched).toEqual([]);
    });

    it('are named', async () => {
        const guild = fakeGuild({ remote: [{ id: 'ali', user: { bot: false }, displayName: 'Ali' }] });
        expect(await namesFor(guild, ['ali', 'practice_pat', 'practice_kim'])).toEqual({ ali: 'Ali', practice_pat: 'Pat' });
    });

    it('come back as a member with no avatar, read off the record', async () => {
        const guild = fakeGuild();
        const pat = await memberOf(guild, 'practice_pat');
        expect(pat).toMatchObject({ id: 'practice_pat', displayName: 'Pat', user: { bot: false } });
        expect(pat.displayAvatarURL()).toBe('');
        expect(await memberOf(guild, 'practice_kim')).toBe(null);
        expect(guild.fetched).toEqual([]);
    });

    it('make up a practice plan with the planner, who leads the list', async () => {
        const ali = { id: 'ali', user: { bot: false, username: 'ali' }, displayName: 'Ali', displayAvatarURL: () => 'ali.png' };
        const circle = await practiceCircle(fakeGuild({ remote: [ali] }), 'ali');
        expect(circle).toEqual([
            { id: 'ali', username: 'ali', displayName: 'Ali', avatarUrl: 'ali.png' },
            { id: 'practice_pat', username: '', displayName: 'Pat', avatarUrl: '' },
            { id: 'practice_lou', username: '', displayName: 'Lou', avatarUrl: '' }
        ]);
    });

    it('leave the planner out of the circle once they have left the server', async () => {
        expect((await practiceCircle(fakeGuild(), 'ali')).map((m) => m.id)).toEqual(['practice_pat', 'practice_lou']);
    });
});
