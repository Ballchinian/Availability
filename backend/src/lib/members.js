import { fanOut } from './fanout.js';
import { isPracticeId } from './practice.js';
import { getPracticePerson, getPracticePeople, getPracticePeopleById } from '../db/practice.js';

/*
    A made-up person in the shape the routes read a member in. Discord has never heard
    of them, so nothing here may be handed to it.
*/
export function practiceMember(person) {
    return {
        id: person.id,
        displayName: person.displayName,
        user: { id: person.id, username: '', bot: false },
        displayAvatarURL: () => '',
        practice: person
    };
}

//The made-up people among ids who belong to this server, by id
async function practiceIn(guild, ids) {
    const wanted = ids.filter(isPracticeId);
    if (!wanted.length) return new Map();
    const found = await getPracticePeopleById(wanted);
    return new Map(found.filter((p) => p.guildId === guild.id).map((p) => [p.id, p]));
}

//One member of a server, made-up people in their own server included, or null for anyone not in it
export async function memberOf(guild, id) {
    if (isPracticeId(id)) {
        const person = await getPracticePerson(id);
        return person?.guildId === guild.id ? practiceMember(person) : null;
    }
    if (typeof id !== 'string') return null;
    //Answered from the cache when it holds them, which warmGuildMembers means it mostly does
    return guild.members.fetch(id).catch(() => null);
}

/*
    Which of the given ids are real, non bot members of a server, in the order they
    came in. A cache hit costs nothing and warmGuildMembers means most of them hit,
    but a server whose warm was throttled or partial pays a Discord round trip per
    person, and both callers run this inside the response rather than after it.

    Answers land by index rather than being pushed as they arrive, since fanOut
    finishes jobs in whatever order they finish and this order is the guest list
    order, which on the site is whatever the picker was dragged into.
*/
export async function realMembers(guild, given) {
    /*
        A picker that sends someone twice would otherwise put them on the plan twice. Only
        strings reach Discord: members.fetch reads an object as options, and an empty one
        asks the gateway for the whole server. Made-up people never do.
    */
    const ids = [...new Set(given)].filter((id) => typeof id === 'string');
    const kept = new Array(ids.length).fill(null);
    const madeUp = await practiceIn(guild, ids);

    await fanOut(ids, async (id, i) => {
        if (isPracticeId(id)) {
            if (madeUp.has(id)) kept[i] = id;
            return;
        }
        const member = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
        if (member && !member.user.bot) kept[i] = id;
    });

    return kept.filter(Boolean);
}

//Display names by id, for whoever of ids is still in the server
export async function namesFor(guild, ids) {
    const names = {};
    const unique = [...new Set(ids)];
    for (const [id, person] of await practiceIn(guild, unique)) names[id] = person.displayName;
    await fanOut(unique.filter((id) => !isPracticeId(id)), async (id) => {
        const member = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
        if (member) names[id] = member.displayName;
    });
    return names;
}

/*
    Who a practice plan may hold: the planner it is for, while they are in the server, and
    the people they made up for it. Shaped as listMembers shapes them, for the picker.
*/
export async function practiceCircle(guild, ownerId) {
    const [owner, people] = await Promise.all([memberOf(guild, ownerId), getPracticePeople(ownerId, guild.id)]);
    const shape = (m) => ({ id: m.id, username: m.user.username, displayName: m.displayName, avatarUrl: m.displayAvatarURL({ size: 64 }) });
    return [...(owner ? [shape(owner)] : []), ...people.map((p) => shape(practiceMember(p)))];
}

/*
    Fetching the whole member list is a gateway call (opcode 8) that Discord rate
    limits hard, so we cannot do it on every page load. We hold the list per guild
    for a short while, share a single in-flight fetch when several requests land at
    once, and fall back to whatever the client already has cached if the gateway
    says no. The member picker can live with a list that is up to a minute stale.
*/
const memberCache = new Map();
const memberInFlight = new Map();
const MEMBER_TTL_MS = 60 * 1000;

function shapeMembers(collection) {
    return collection
        .filter((m) => !m.user.bot)
        .map((m) => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            avatarUrl: m.displayAvatarURL({ size: 64 })
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/*
    One full member fetch over the gateway (opcode 8), which Discord rate limits
    hard. When it comes back rate limited the error carries how long to wait, so we
    hold off that long (capped, so the request never hangs for ages) and try once
    more before giving up.
*/
async function fetchMembersFresh(guild) {
    try {
        return shapeMembers(await guild.members.fetch());
    } catch (err) {
        const retryAfter = err?.data?.retry_after;
        if (!retryAfter) throw err;
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter * 1000 + 250, 12000)));
        return shapeMembers(await guild.members.fetch());
    }
}

export async function listMembers(guild) {
    const cached = memberCache.get(guild.id);
    if (cached && Date.now() - cached.at < MEMBER_TTL_MS) return cached.list;

    //With the GuildMembers intent a smaller server arrives already fully cached, so if
    //we hold everyone there is no need to hit the rate limited gateway fetch at all.
    if (guild.members.cache.size > 0 && guild.members.cache.size >= guild.memberCount) {
        const list = shapeMembers(guild.members.cache);
        memberCache.set(guild.id, { at: Date.now(), list });
        return list;
    }

    if (memberInFlight.has(guild.id)) return memberInFlight.get(guild.id);

    const work = (async () => {
        try {
            const list = await fetchMembersFresh(guild);
            memberCache.set(guild.id, { at: Date.now(), list });
            return list;
        } catch (err) {
            //Could not refresh. A slightly stale list, or even the client's own cache,
            //beats failing the picker outright, so fall back to those before we throw.
            if (cached) return cached.list;
            if (guild.members.cache.size > 1) return shapeMembers(guild.members.cache);
            throw err;
        }
    })();

    memberInFlight.set(guild.id, work);
    try {
        return await work;
    } finally {
        memberInFlight.delete(guild.id);
    }
}
