import { describe, it, expect } from 'vitest';
import { Collection } from 'discord.js';
import { placeIntro, plannerRoleFor, freeRoleName, buttonLabel } from '../../src/bot/util.js';
import { chooseZone, setupChanges, rerunNotice } from '../../src/bot/setup.js';

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

/*
    The role half of the same rerun. The cache is the library's own Collection rather
    than a Map standing in for one: these helpers reach for find() and map(), which
    Collection adds and a Map does not have.
*/
function rolesOf(...roles) {
    return { roles: { cache: new Collection(roles.map((r) => [r.id, r])) } };
}

describe('plannerRoleFor', () => {
    //The bug: the config is the only thing that knows, since a planner role can be called anything
    it('takes the saved role over an unrelated role named planner', () => {
        const guild = rolesOf({ id: 'r1', name: 'Plan Master' }, { id: 'r2', name: 'planner' });

        const out = plannerRoleFor(guild, { plannerRoleId: 'r1' });

        expect(out.role.id).toBe('r1');
        expect(out.saved).toBe(true);
    });

    it('takes the saved role when it is named nothing like planner at all', () => {
        const guild = rolesOf({ id: 'r1', name: 'Organisers' });

        expect(plannerRoleFor(guild, { plannerRoleId: 'r1' }).role.name).toBe('Organisers');
    });

    //A server being set up for the first time has nothing saved to go on
    it('falls back to the name when nothing is saved', () => {
        const guild = rolesOf({ id: 'r2', name: 'Planner' });

        const out = plannerRoleFor(guild, null);

        expect(out.role.id).toBe('r2');
        expect(out.saved).toBe(false);
    });

    it('falls back when the saved role has been deleted since', () => {
        const guild = rolesOf({ id: 'r2', name: 'planner' });

        expect(plannerRoleFor(guild, { plannerRoleId: 'gone' })).toEqual({ role: guild.roles.cache.get('r2'), saved: false });
    });

    it('answers with nothing when there is neither', () => {
        expect(plannerRoleFor(rolesOf({ id: 'r9', name: 'mods' }), null).role).toBe(null);
    });
});

describe('freeRoleName', () => {
    it('is planner on a server that has no such role', () => {
        expect(freeRoleName(rolesOf({ id: 'r9', name: 'mods' }))).toBe('planner');
    });

    it('steps aside for a planner role that is already there, whatever its case', () => {
        expect(freeRoleName(rolesOf({ id: 'r1', name: 'PLANNER' }))).toBe('Plan Master');
    });

    //What a third run used to collide on
    it('keeps counting rather than making a second Plan Master', () => {
        const guild = rolesOf({ id: 'r1', name: 'planner' }, { id: 'r2', name: 'Plan Master' });
        expect(freeRoleName(guild)).toBe('Plan Master 2');

        guild.roles.cache.set('r3', { id: 'r3', name: 'Plan Master 2' });
        expect(freeRoleName(guild)).toBe('Plan Master 3');
    });
});

describe('buttonLabel', () => {
    it('leaves a label Discord will take', () => {
        expect(buttonLabel('Keep planner')).toBe('Keep planner');
        expect(buttonLabel('x'.repeat(80))).toHaveLength(80);
    });

    //A role name is allowed 100 characters and the button was going out with all of them
    it('cuts one it will not, to exactly the limit', () => {
        const cut = buttonLabel(`Keep ${'x'.repeat(100)}`);
        expect(cut).toHaveLength(80);
        expect(cut.endsWith('...')).toBe(true);
    });
});

/*
    The visible half. Setup's own reply is ephemeral, so a rerun that moves who can
    plan or what the clock means used to leave nothing behind that anybody else could
    see, the server's owner included.
*/

/*
    The saved clock is deliberately not Europe/London, which is the deployment default
    these run under: with the two the same, keeping the saved one and falling back to
    the default are the same answer and the test cannot tell them apart.
*/
const SET_UP = { setupComplete: true, plannerRoleId: 'r1', timeZone: 'Asia/Tokyo', infoChannelId: 'c1' };

describe('chooseZone', () => {
    //The bug: a rerun with the option left off used to fall through to the deployment default
    it('keeps the clock the server already picked when the option is left off', () => {
        expect(chooseZone('', SET_UP)).toBe('Asia/Tokyo');
        expect(chooseZone(null, SET_UP)).toBe('Asia/Tokyo');
    });

    it('takes the one they picked over the one that was saved', () => {
        expect(chooseZone('America/New_York', SET_UP)).toBe('America/New_York');
    });

    it('falls back to the default only when there is nothing saved either', () => {
        expect(chooseZone('', null)).toBe('Europe/London');
        expect(chooseZone('', { plannerRoleId: 'r1' })).toBe('Europe/London');
    });
});

describe('setupChanges', () => {
    it('says nothing about a rerun that moved nothing', () => {
        expect(setupChanges(SET_UP, { ...SET_UP })).toEqual([]);
    });

    it('names both roles when the planning role moved', () => {
        const [line, ...rest] = setupChanges(SET_UP, { ...SET_UP, plannerRoleId: 'r2' });

        expect(rest).toEqual([]);
        expect(line).toContain('<@&r2>');
        expect(line).toContain('<@&r1>');
    });

    it('names both clocks when the clock moved', () => {
        const [line] = setupChanges(SET_UP, { ...SET_UP, timeZone: 'America/New_York' });

        expect(line).toContain('America/New_York');
        expect(line).toContain('Asia/Tokyo');
    });

    //A server set up before the clock was saved at all has none, and reads as the default
    it('does not call it a change when an unset clock lands on the default', () => {
        const old = { setupComplete: true, plannerRoleId: 'r1', infoChannelId: 'c1' };

        expect(setupChanges(old, { ...old, timeZone: 'Europe/London' })).toEqual([]);
    });

    it('mentions a channel that had to be rebuilt', () => {
        const changes = setupChanges(SET_UP, { ...SET_UP, infoChannelId: 'c2' });

        expect(changes).toHaveLength(1);
        expect(changes[0]).toContain('fresh one');
    });

    it('lists everything at once when a rerun moved the lot', () => {
        expect(setupChanges(SET_UP, { plannerRoleId: 'r2', timeZone: 'America/New_York', infoChannelId: 'c2' })).toHaveLength(3);
    });
});

describe('rerunNotice', () => {
    it('names who ran it and what moved', () => {
        const text = rerunNotice('u1', ['Who can plan: it is <@&r2> now, it was <@&r1>.']);

        expect(text).toContain('<@u1>');
        expect(text).toContain('- Who can plan:');
    });

    //Still worth saying: the fact somebody ran it is the thing being made visible
    it('still says it happened when nothing moved', () => {
        const text = rerunNotice('u1', []);

        expect(text).toContain('<@u1>');
        expect(text).toContain('Nothing changed');
        expect(text).not.toContain('- ');
    });
});
