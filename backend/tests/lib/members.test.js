import { describe, it, expect } from 'vitest';
import { realMembers } from '../../src/lib/members.js';

/*
    A guild that answers member lookups the way discord.js does: a cache hit is
    synchronous, a miss is a fetch that either resolves or throws. Fetches can be
    made to finish in an order of their own, which is the case the index write in
    realMembers exists for.
*/
const member = (id, bot = false) => ({ id, user: { bot } });

function fakeGuild({ cached = [], remote = [], slow = () => 0 } = {}) {
    const fetched = [];
    const held = new Map(remote.map((m) => [m.id, m]));
    return {
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

    it('has nothing to say about an empty list', async () => {
        const guild = fakeGuild();
        expect(await realMembers(guild, [])).toEqual([]);
        expect(guild.fetched).toEqual([]);
    });
});
