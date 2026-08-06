import { describe, it, expect } from 'vitest';
import { placeIntro } from '../../src/bot/util.js';

/*
    Setup used to delete the info channel and make a fresh one every run. Plan threads
    live under that channel and a deleted plan thread clears its plan for good, so a
    rerun to freshen a pinned message took every live plan on the server with it.

    Every call is recorded in one list, and what these are really about is what is not
    in it: no `delete:` on a channel that is still there, and no `create` beside it.
*/

const BODY = { content: 'the new intro', allowedMentions: { parse: [] } };

function fakeMessage(id, log, { pinned = false, editable = true } = {}) {
    return {
        id,
        pinned,
        content: 'the old intro',
        edit: async (body) => {
            if (!editable) throw new Error('cannot edit that');
            log.push(`edit:${id}`);
            return { id, pinned, content: body.content };
        }
    };
}

function fakeChannel(id, log, message = null) {
    return {
        id,
        messages: {
            fetch: async (wanted) => {
                if (message && message.id === wanted) return message;
                throw new Error('unknown message');
            }
        },
        send: async (body) => {
            log.push(`send:${id}`);
            return { id: `${id}-new`, pinned: false, content: body.content };
        },
        delete: async () => log.push(`delete:${id}`)
    };
}

function fakeGuild(present, log) {
    return {
        id: 'g1',
        members: { me: { id: 'bot' } },
        roles: { everyone: { id: 'everyone' } },
        channels: {
            fetch: async (id) => {
                if (present[id]) return present[id];
                throw new Error('unknown channel');
            },
            create: async () => {
                log.push('create');
                return fakeChannel('c-new', log);
            }
        }
    };
}

describe('placeIntro', () => {
    //The one that matters: a second /setup must not touch the channel the plans hang off
    it('keeps the channel a rerun already has and edits the intro where it sits', async () => {
        const log = [];
        const intro = fakeMessage('m1', log, { pinned: true });
        const guild = fakeGuild({ c1: fakeChannel('c1', log, intro) }, log);

        const out = await placeIntro(guild, { infoChannelId: 'c1', introMessageId: 'm1' }, BODY);

        expect(log).toEqual(['edit:m1']);
        expect(out.madeChannel).toBe(false);
        expect(out.channel.id).toBe('c1');
        expect(out.intro.content).toBe('the new intro');
        //What setup reads to decide whether to pin again
        expect(out.intro.pinned).toBe(true);
    });

    it('makes one on a server that has never been set up', async () => {
        const log = [];
        const out = await placeIntro(fakeGuild({}, log), null, BODY);

        expect(log).toEqual(['create', 'send:c-new']);
        expect(out.madeChannel).toBe(true);
        expect(out.intro.content).toBe('the new intro');
    });

    it('makes one when the channel in the config has been deleted since', async () => {
        const log = [];
        const out = await placeIntro(fakeGuild({}, log), { infoChannelId: 'c1', introMessageId: 'm1' }, BODY);

        expect(log).toEqual(['create', 'send:c-new']);
        expect(out.madeChannel).toBe(true);
    });

    //Somebody clearing the pin by hand should cost an intro, not a channel
    it('posts a fresh intro in the same channel when the old one is gone', async () => {
        const log = [];
        const guild = fakeGuild({ c1: fakeChannel('c1', log) }, log);

        const out = await placeIntro(guild, { infoChannelId: 'c1', introMessageId: 'm1' }, BODY);

        expect(log).toEqual(['send:c1']);
        expect(out.madeChannel).toBe(false);
        expect(out.channel.id).toBe('c1');
    });

    it('falls through to a fresh intro when the old one will not edit', async () => {
        const log = [];
        const intro = fakeMessage('m1', log, { editable: false });
        const guild = fakeGuild({ c1: fakeChannel('c1', log, intro) }, log);

        const out = await placeIntro(guild, { infoChannelId: 'c1', introMessageId: 'm1' }, BODY);

        expect(log).toEqual(['send:c1']);
        expect(out.madeChannel).toBe(false);
    });

    it('clears up the thread an older setup kept the intro in', async () => {
        const log = [];
        const guild = fakeGuild({ t1: fakeChannel('t1', log) }, log);

        await placeIntro(guild, { introThreadId: 't1' }, BODY);

        expect(log).toEqual(['delete:t1', 'create', 'send:c-new']);
    });

    //A config carrying both is a server set up under the old scheme and again under this one
    it('leaves that thread alone once there is a channel', async () => {
        const log = [];
        const intro = fakeMessage('m1', log);
        const guild = fakeGuild({ c1: fakeChannel('c1', log, intro), t1: fakeChannel('t1', log) }, log);

        await placeIntro(guild, { infoChannelId: 'c1', introMessageId: 'm1', introThreadId: 't1' }, BODY);

        expect(log).toEqual(['edit:m1']);
    });
});
