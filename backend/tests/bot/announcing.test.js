import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    What goes out when a plan is announced or a day is set, over a Discord that records
    every thread post and DM. A set day always asks who can make it and a new plan always
    DMs, so nothing a caller passes can turn either off.
*/

const posts = [];
//Edits to messages already in a thread, the pinned opener among them
const edited = [];
const dms = [];
//Who has DMs from the server off, and whether the thread refuses every post
const closed = new Set();
const broken = { thread: false, week: false };
let made = 0;
//What each new thread was asked for, and posts and adds in the order they happened
const created = [];
const timeline = [];

vi.mock('../../src/bot/client.js', () => {
    const thread = (id) => ({
        id,
        archived: false,
        members: { add: async (userId) => timeline.push(`add ${userId}`) },
        messages: {
            fetch: async (messageId) => ({
                id: messageId,
                edit: async (payload) => {
                    edited.push({ id: messageId, ...payload });
                    return { id: messageId, ...payload };
                }
            })
        },
        send: async (payload) => {
            if (broken.thread) throw new Error('service unavailable');
            posts.push({ threadId: id, ...payload });
            timeline.push('post');
            return { id: `post${posts.length}` };
        }
    });
    const create = async (options) => {
        created.push(options);
        if (broken.week && options.autoArchiveDuration === 10080) throw new Error('invalid auto archive duration');
        return thread(`t${++made}`);
    };
    return {
        client: {
            users: {
                fetch: async (userId) => ({
                    send: async (payload) => {
                        if (closed.has(userId)) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
                        dms.push({ userId, ...(typeof payload === 'string' ? { content: payload } : payload) });
                        return { id: `dm-${userId}` };
                    }
                })
            },
            channels: { fetch: async (id) => thread(id) },
            guilds: {
                fetch: async () => ({
                    name: 'The server',
                    channels: {
                        fetch: async (channelId) => ({ id: channelId, threads: { create } })
                    }
                })
            }
        }
    };
});

const store = vi.hoisted(() => ({ plan: null }));
const db = vi.hoisted(() => ({
    setPlanThread: vi.fn(async () => {}),
    setPlanOpener: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {}),
    setDmsClosed: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/users.js', async (real) => ({ ...(await real()), getPlanningPrefs: vi.fn(async () => ({})) }));
vi.mock('../../src/db/availability.js', async (real) => ({
    ...(await real()),
    getAvailabilityForUsersInRange: vi.fn(async () => []),
    getLastUpdated: vi.fn(async () => ({}))
}));

const { announcePlan, announceSetPlan, announceOutcome, announceCancel, mentionPosts, addHostToThread } = await import('../../src/bot/plans.js');
const { getPlanningPrefs } = await import('../../src/db/users.js');
const { todayIn } = await import('../../src/lib/zones.js');
const { shiftDate } = await import('../../src/lib/dates.js');

const cfg = { guildName: 'The server', plansChannelId: 'c2' };
const buttons = (message) => (message.components || []).flatMap((row) => row.components.map((b) => b.data.custom_id));
const guests = ['ali', 'bo'];

const collecting = () => ({
    planId: 'p1',
    guildId: 'g1',
    threadId: null,
    openerMessageId: null,
    name: 'Board games',
    description: '',
    status: 'collecting',
    timeZone: 'Europe/London',
    dateRange: { start: '2026-08-01', end: '2026-08-14' },
    chosenDate: null,
    probeActive: false,
    participants: guests.map((userId) => ({ userId, invited: true }))
});

//As setPlanChosen leaves it: closed on the day, and asking
const setDay = (over = {}) => ({
    ...collecting(),
    status: 'closed',
    chosenDate: '2026-08-08',
    chosenTime: null,
    probeActive: true,
    ...over
});

beforeEach(() => {
    vi.clearAllMocks();
    posts.length = 0;
    edited.length = 0;
    dms.length = 0;
    closed.clear();
    broken.thread = false;
    broken.week = false;
    made = 0;
    created.length = 0;
    timeline.length = 0;
});

describe('announcing a plan with its day already set', () => {
    beforeEach(() => (store.plan = setDay()));

    //The yes/no used to be a second post under the pin, with its own tally to keep in step
    it('pins one opener carrying the day, the tally and the buttons, and posts nothing else', async () => {
        await announceSetPlan(store.plan, cfg, 'Ali');

        expect(posts).toHaveLength(1);
        expect(posts[0].content).toContain('**Board games** is set for Sat 8 Aug 2026.');
        expect(posts[0].content).toContain("0 coming · 0 can't make it · 2 yet to answer");
        expect(buttons(posts[0])).toEqual(['vote|yes|p1|r0', 'vote|no|p1|r0']);
        expect(db.setPlanOpener).toHaveBeenCalledWith('p1', 'post1');
    });

    //Kept on the list for a change of mind, but not waited on
    it('counts someone who said it is not for them as not coming', async () => {
        store.plan = setDay({ participants: [...store.plan.participants, { userId: 'cy', in: false, invited: true }] });
        await announceSetPlan(store.plan, cfg, 'Ali');
        expect(posts[0].content).toContain("0 coming · 1 can't make it · 2 yet to answer");
        expect(dms.map((d) => d.userId)).not.toContain('cy');
    });

    it('DMs every guest the same buttons', async () => {
        await announceSetPlan(store.plan, cfg, 'Ali');

        expect(dms.map((d) => d.userId).sort()).toEqual(guests);
        for (const dm of dms) expect(buttons(dm)).toEqual(['vote|yes|p1|r0', 'vote|no|p1|r0']);
    });

    it('links no calendar in the thread or the DMs', async () => {
        await announceSetPlan(store.plan, cfg, 'Ali');

        const text = [...posts, ...dms].map((m) => m.content || '').join('\n');
        expect(text).toContain('Board games');
        expect(text).not.toMatch(/calendar\.google|\.ics/);
    });
});

describe('announcing a plan that is collecting dates', () => {
    it('DMs every guest', async () => {
        store.plan = collecting();
        await announcePlan(store.plan, cfg, 'Ali');
        expect(dms.map((d) => d.userId).sort()).toEqual(guests);
    });
});

describe('setting a day on a running plan', () => {
    beforeEach(() => (store.plan = setDay({ threadId: 'thread1' })));

    //Everyone the DM reached already has the day, so a ping in the thread would be the same news twice
    it('posts the yes/no in the thread, mentioning only whoever the DM missed', async () => {
        closed.add('bo');
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });

        expect(dms.map((d) => d.userId)).toEqual(['ali']);
        expect(posts).toHaveLength(1);
        expect(buttons(posts[0])).toEqual(['vote|yes|p1|r0', 'vote|no|p1|r0']);
        expect(posts[0].allowedMentions).toEqual({ users: ['bo'] });
        expect(posts[0].content.startsWith('<@bo>\n\n')).toBe(true);
    });

    it('mentions nobody when every DM landed', async () => {
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });
        expect(posts[0].allowedMentions).toEqual({ users: [] });
        expect(posts[0].content).not.toContain('<@');
    });

    //The post used to go first, so a thread that threw took every DM after it down too
    it('still DMs everyone when the thread post throws', async () => {
        broken.thread = true;
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' }).catch(() => {});
        expect(dms.map((d) => d.userId).sort()).toEqual(guests);
    });
});

describe('the line under Count me in', () => {
    it("tells each person what their own calendar already answers", async () => {
        const soon = { start: shiftDate(todayIn('Europe/London'), 5), end: shiftDate(todayIn('Europe/London'), 7) };
        getPlanningPrefs.mockResolvedValueOnce({ ali: { coveredUntil: soon.end, answered: [], timeZone: 'Europe/London' } });

        await announcePlan({ ...collecting(), dateRange: soon }, cfg, 'Ali');

        const card = (id) => dms.find((d) => d.userId === id).content;
        expect(card('ali').endsWith("Are you in? Your calendar already answers this: you're not free on any of the 3 days.")).toBe(true);
        expect(card('bo').endsWith('Are you in? Then fill in your dates.')).toBe(true);
    });
});

describe('someone who said it is not for them', () => {
    const withOut = (plan) => ({ ...plan, participants: [{ userId: 'ali', invited: true, in: false }, { userId: 'bo', invited: true }] });

    it('is not asked about the day, or pinged when their DM is not sent', async () => {
        await announceOutcome(withOut(setDay({ threadId: 't9' })), cfg, { changed: false, actorName: 'Ali' });
        expect(dms.map((d) => d.userId)).toEqual(['bo']);
        expect(posts[0].allowedMentions.users).toEqual([]);
    });

    it('is not told it was called off', async () => {
        await announceCancel(withOut(collecting()), 'Ali');
        expect(dms.map((d) => d.userId)).toEqual(['bo']);
    });
});

describe('opening a plan thread', () => {
    it('stores the channel the thread was made under', async () => {
        store.plan = collecting();
        await announcePlan(store.plan, cfg, 'Ali');
        expect(db.setPlanThread).toHaveBeenCalledWith('p1', 't1', 'c2');
    });

    it('does the same for a plan announced with its day already set', async () => {
        store.plan = setDay();
        await announceSetPlan(store.plan, cfg, 'Ali');
        expect(db.setPlanThread).toHaveBeenCalledWith('p1', 't1', 'c2');
    });

    //Adding someone to a thread pings them, and they used to land in an empty one
    it('posts the opener before anyone is added', async () => {
        store.plan = collecting();
        await announcePlan(store.plan, cfg, 'Ali');
        expect(timeline[0]).toBe('post');
        expect(timeline.slice(1).sort()).toEqual(['add ali', 'add bo']);
    });

    //A private thread is invisible to anyone not on it, whoever made the plan included
    it('adds whoever made the plan even when they are not a guest', async () => {
        store.plan = { ...setDay(), createdBy: 'cy' };
        await announceSetPlan(store.plan, cfg, 'Cy');
        expect(timeline.filter((t) => t.startsWith('add')).sort()).toEqual(['add ali', 'add bo', 'add cy']);
    });

    it('adds everyone who runs it, on the guest list or not', async () => {
        store.plan = { ...setDay(), createdBy: 'cy', hostIds: ['cy', 'sam', 'ali'] };
        await announceSetPlan(store.plan, cfg, 'Cy');
        expect(timeline.filter((t) => t.startsWith('add')).sort()).toEqual(['add ali', 'add bo', 'add cy', 'add sam']);
    });

    //Where /overview and /cancel are run, so someone who took the plan on has to be in it
    it('adds someone who takes the plan on later, and nothing else happens', async () => {
        await addHostToThread({ ...setDay(), threadId: 't1' }, 'sam');
        expect(timeline).toEqual(['add sam']);
        expect(dms).toEqual([]);
    });

    it('leaves a plan with no thread alone', async () => {
        await addHostToThread(setDay(), 'sam');
        expect(timeline).toEqual([]);
    });

    it('asks for a week before archiving, and for nobody else to invite people in', async () => {
        store.plan = collecting();
        await announcePlan(store.plan, cfg, 'Ali');
        expect(created).toEqual([expect.objectContaining({ name: 'Board games', autoArchiveDuration: 10080, invitable: false })]);
    });

    it('falls back to a day when the server will not take a week', async () => {
        store.plan = collecting();
        broken.week = true;
        await announcePlan(store.plan, cfg, 'Ali');
        expect(created.map((c) => c.autoArchiveDuration)).toEqual([10080, 1440]);
    });

    //A repeating series would otherwise be a row of threads all called the same thing
    it('names a set plan thread with its day', async () => {
        store.plan = setDay();
        await announceSetPlan(store.plan, cfg, 'Ali');
        expect(created[0].name).toBe('Board games · Sat 8 Aug');
    });

    it('keeps a long name inside the hundred characters a thread name gets, day and all', async () => {
        store.plan = setDay({ name: 'x'.repeat(120) });
        await announceSetPlan(store.plan, cfg, 'Ali');
        expect(created[0].name).toHaveLength(100);
        expect(created[0].name.endsWith(' · Sat 8 Aug')).toBe(true);
    });
});

/*
    Discord refuses a post past 2000 characters, and allowedMentions past 100 users. The
    thread post used to lead with every guest, so a plan of about 55 broke the first and
    everything queued behind that post never went out.
*/
describe('a plan of 150 people', () => {
    const crowd = Array.from({ length: 150 }, (_, i) => `1${String(i).padStart(17, '0')}`);
    const big = () => setDay({ threadId: 'thread1', participants: crowd.map((userId) => ({ userId, invited: true })) });

    const withinLimits = () => {
        for (const post of posts) {
            expect(post.content.length).toBeLessThanOrEqual(2000);
            expect(post.allowedMentions.users.length).toBeLessThanOrEqual(100);
        }
    };

    it('DMs every one of them', async () => {
        store.plan = big();
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });
        expect(dms).toHaveLength(150);
        withinLimits();
    });

    it('still pings every one of them, over as many posts as it takes, when no DM lands', async () => {
        store.plan = big();
        for (const id of crowd) closed.add(id);

        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });

        expect(posts.length).toBeGreaterThan(1);
        withinLimits();
        expect(posts.flatMap((p) => p.allowedMentions.users).sort()).toEqual([...crowd].sort());
        //The buttons ride on the first, which is the one the tally follows
        expect(buttons(posts[0])).toEqual(['vote|yes|p1|r0', 'vote|no|p1|r0']);
        expect(posts.slice(1).every((p) => !p.components)).toBe(true);
    });

    it('keeps a cancel under the limits too', async () => {
        store.plan = { ...big(), status: 'cancelled' };
        for (const id of crowd) closed.add(id);

        await announceCancel(store.plan, 'Ali');

        withinLimits();
        expect(posts.flatMap((p) => p.allowedMentions.users)).toHaveLength(150);
    });
});

describe('mentionPosts', () => {
    it('leaves a body that already fills the post alone and pings in the next', () => {
        const [first, second] = mentionPosts(['a'], { content: 'x'.repeat(1999) });
        expect(first.content).toBe('x'.repeat(1999));
        expect(first.allowedMentions).toEqual({ users: [] });
        expect(second).toEqual({ content: '<@a>', allowedMentions: { users: ['a'] } });
    });
});

describe('a DM that Discord refuses', () => {
    beforeEach(() => (store.plan = setDay({ threadId: 'thread1' })));

    it('writes a closed DM down against the person', async () => {
        closed.add('bo');
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });
        expect(db.setDmsClosed).toHaveBeenCalledTimes(1);
        expect(db.setDmsClosed).toHaveBeenCalledWith('p1', 'bo', true);
    });

    it('clears it once a DM gets through again', async () => {
        store.plan.participants[0].dmsClosed = true;
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });
        expect(db.setDmsClosed).toHaveBeenCalledWith('p1', 'ali', false);
    });

    //Only 50007 says anything about their settings, so a blip is not written down
    it('writes nothing down for any other failure', async () => {
        const { client } = await import('../../src/bot/client.js');
        const fetch = client.users.fetch;
        client.users.fetch = async () => {
            throw new Error('Unknown User');
        };
        try {
            await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });
        } finally {
            client.users.fetch = fetch;
        }
        expect(db.setDmsClosed).not.toHaveBeenCalled();
    });
});

/*
    The pin is the yes/no on a set day, so it has to follow the plan: the loud path of setting
    a day used to skip it, leaving "fill in your dates" pinned over a plan that had its day.
*/
describe('the pinned opener', () => {
    it('shows the day and the buttons once a day is picked', async () => {
        store.plan = setDay({ threadId: 'thread1', openerMessageId: 'op1' });
        await announceOutcome(store.plan, cfg, { changed: false, actorName: 'Ali' });

        const pin = edited.find((e) => e.id === 'op1');
        expect(pin.content).toContain('**Board games** is set for Sat 8 Aug 2026.');
        expect(buttons(pin)).toEqual(['vote|yes|p1|r0', 'vote|no|p1|r0']);
    });

    it('says called off, with no buttons, once the plan is cancelled', async () => {
        store.plan = setDay({ threadId: 'thread1', openerMessageId: 'op1', status: 'cancelled' });
        await announceCancel(store.plan, 'Ali');

        const pin = edited.find((e) => e.id === 'op1');
        expect(pin.content).toContain('**Board games** was called off.');
        expect(pin.components).toEqual([]);
    });

    //Sent back out for dates: the edit has to name its buttons, or the old yes/no stays on the pin
    it('swaps the yes/no for Add my dates when a plan goes back to collecting', async () => {
        const { syncPlan } = await import('../../src/bot/plans.js');
        await syncPlan({ ...collecting(), threadId: 'thread1', openerMessageId: 'op1' });
        const [row] = edited.find((e) => e.id === 'op1').components;
        expect(row.components.map((b) => b.data)).toEqual([expect.objectContaining({ label: 'Add my dates', url: expect.stringMatching(/#\/plan\/p1$/) })]);
    });
});

//Everyone on the plan reads these, so they carry nothing meant only for whoever runs it
describe('thread posts guests read', () => {
    it('says a plan was called off without telling anyone to delete the thread', async () => {
        store.plan = setDay({ threadId: 'thread1', status: 'cancelled' });
        await announceCancel(store.plan, 'Ali');

        expect(posts.at(-1).content).toBe('**CALLED OFF**\n\nAli called off **Board games**. Nothing more to fill in.');
    });

    it('opens a collecting plan with no line for planners', async () => {
        store.plan = collecting();
        await announcePlan(store.plan, cfg, 'Ali');

        expect(posts[0].content).toMatch(/^\*\*INVITED\*\*/);
        expect(posts[0].content).not.toMatch(/planner|\/overview/i);
    });

    it('banners a moved day as a change', async () => {
        store.plan = setDay({ threadId: 'thread1' });
        await announceOutcome(store.plan, cfg, { changed: true, actorName: 'Ali' });

        expect(posts[0].content).toMatch(/^\*\*CHANGED\*\*\n\nAli moved \*\*Board games\*\* to Sat 8 Aug 2026\.\nCan you make it\?$/);
    });
});
