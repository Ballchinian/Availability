import { fanOut } from './fanout.js';

/*
    Which of the given ids are real, non bot members of a server, in the order they
    came in. A cache hit costs nothing and warmGuildMembers means most of them hit,
    but a server whose warm was throttled or partial pays a Discord round trip per
    person, and both callers run this inside the response rather than after it.

    Answers land by index rather than being pushed as they arrive, since fanOut
    finishes jobs in whatever order they finish and this order is the guest list
    order, which on the site is whatever the picker was dragged into.
*/
export async function realMembers(guild, ids) {
    const kept = new Array(ids.length).fill(null);

    await fanOut(ids, async (id, i) => {
        const member = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
        if (member && !member.user.bot) kept[i] = id;
    });

    return kept.filter(Boolean);
}
