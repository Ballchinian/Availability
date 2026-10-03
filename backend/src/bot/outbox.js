import { client } from './client.js';
import { addToOutbox, getOutboxMessage, editOutboxMessage, deleteOutboxMessage, pinOutboxMessage } from '../db/outbox.js';
import { isPracticeId, isOutboxThread, outboxThreadId, planOfOutboxThread } from '../lib/practice.js';

/*
    Anything addressed to a made-up person, or posted in a practice plan's thread, is kept
    in the outbox rather than sent. These stand in for the few discord.js objects the bot
    sends through, close enough that nothing sending can tell: a user to DM, the DM channel
    a message is fetched back from, a thread, and messages that edit, delete and pin. Only
    what the bot calls is copied, so a new call on any of them wants adding here as well.
*/

//Discord's code for a message that is not there, which callers already look for
const unknownMessage = () => Object.assign(new Error('Unknown Message'), { code: 10008 });

//A payload as Discord would keep it, the builders turned into the JSON they send
function kept(payload) {
    const p = typeof payload === 'string' ? { content: payload } : payload;
    const out = {};
    if ('content' in p) out.content = p.content ?? '';
    if ('components' in p) out.components = (p.components || []).map((c) => (typeof c?.toJSON === 'function' ? c.toJSON() : c));
    return out;
}

function message(row) {
    return {
        id: row.id,
        channelId: row.to === 'thread' ? outboxThreadId(row.planId) : row.to,
        content: row.content,
        edit: async (payload) => message((await editOutboxMessage(row.id, kept(payload))) || row),
        delete: () => deleteOutboxMessage(row.id),
        //All pinMessage in util.js reaches for
        client: { rest: { put: () => pinOutboxMessage(row.id) } }
    };
}

async function fetchMessage(id, belongs) {
    const row = await getOutboxMessage(id);
    if (!row || !belongs(row)) throw unknownMessage();
    return message(row);
}

//Someone to DM. planId is the plan a message to someone made up is about, which a DM to anyone else never needs.
export async function userFor(userId, planId = null) {
    if (!isPracticeId(userId)) return client.users.fetch(userId);
    return {
        id: userId,
        send: async (payload) => message(await addToOutbox({ planId, to: userId, ...kept(payload) })),
        createDM: async () => ({ messages: { fetch: (id) => fetchMessage(id, (row) => row.to === userId) } })
    };
}

//A plan's thread by id, which for a practice plan is kept here
export async function channelFor(threadId) {
    if (!isOutboxThread(threadId)) return client.channels.fetch(threadId);
    const planId = planOfOutboxThread(threadId);
    return {
        id: threadId,
        archived: false,
        setArchived: async () => {},
        setName: async () => {},
        members: { add: async () => {} },
        messages: { fetch: (id) => fetchMessage(id, (row) => row.planId === planId && row.to === 'thread') },
        send: async (payload) => message(await addToOutbox({ planId, to: 'thread', ...kept(payload) }))
    };
}
