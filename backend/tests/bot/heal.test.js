import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    What happens to a plan's own thread messages when somebody deletes one. Before this
    a single deletion was permanent: every later pass fetched nothing, gave up, and the
    plan spent the rest of its life with no pinned opener, or a confirmation nobody in
    the thread could answer.

    The fake thread records everything it is asked to do, and most of what these assert
    is what is not in that record: no second opener on a plan that never had one, no
    poll posted into a thread that never had one.
*/

const channels = new Map();

vi.mock('../../src/bot/client.js', () => ({
    client: { channels: { fetch: async (id) => channels.get(id) || Promise.reject(new Error('unknown channel')) } }
}));

const db = vi.hoisted(() => ({ setPlanOpener: vi.fn(), setProbe: vi.fn(async () => ({})) }));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));

const pins = vi.hoisted(() => ({ pinMessage: vi.fn(async () => {}) }));
vi.mock('../../src/bot/util.js', async (real) => ({ ...(await real()), ...pins }));

const { syncPlan, updateProbeMessage } = await import('../../src/bot/plans.js');

/*
    held is which message ids the thread still has. Anything else fetches as gone, which
    is what a deleted message looks like from here.
*/
function fakeThread(held = []) {
    const log = [];
    const messages = new Map(
        held.map((id) => [id, { id, edit: async (payload) => (log.push({ edit: id, payload }), { id, ...payload }) }])
    );
    return {
        log,
        archived: false,
        setName: async (name) => log.push({ setName: name }),
        send: async (payload) => {
            const id = `new${log.length}`;
            log.push({ send: id, payload });
            return { id, ...payload };
        },
        messages: {
            fetch: async (id) => {
                const found = messages.get(id);
                if (!found) throw new Error('unknown message');
                return found;
            }
        }
    };
}

const plan = (over = {}) => ({
    planId: 'ab12cd34ef',
    guildId: 'g1',
    threadId: 't1',
    name: 'Camping',
    description: 'a weekend away',
    dateRange: { start: '2026-08-01', end: '2026-08-30' },
    status: 'collecting',
    chosenDate: null,
    participants: [],
    openerMessageId: 'op1',
    ...over
});

beforeEach(() => {
    channels.clear();
    db.setPlanOpener.mockClear();
    db.setProbe.mockClear();
    pins.pinMessage.mockClear();
});

describe('the pinned opener', () => {
    it('is edited where it sits while it is still there', async () => {
        const thread = fakeThread(['op1']);
        channels.set('t1', thread);

        await syncPlan(plan());

        expect(thread.log.filter((e) => e.edit)).toHaveLength(1);
        expect(thread.log.some((e) => e.send)).toBe(false);
        //Nothing to write down or pin again when the message never moved
        expect(db.setPlanOpener).not.toHaveBeenCalled();
        expect(pins.pinMessage).not.toHaveBeenCalled();
    });

    it('is posted again, pinned and written down when it has been deleted', async () => {
        const thread = fakeThread([]);
        channels.set('t1', thread);

        await syncPlan(plan());

        const sent = thread.log.find((e) => e.send);
        expect(sent).toBeTruthy();
        expect(sent.payload.content).toContain('Camping');
        expect(pins.pinMessage).toHaveBeenCalledTimes(1);
        expect(db.setPlanOpener).toHaveBeenCalledWith('ab12cd34ef', sent.send);
    });

    /*
        A plan from before openers were remembered. A repost would land at the bottom of
        the thread, which is not an opener, and nothing says one was ever meant to be there.
    */
    it('is left alone on a plan that never had one', async () => {
        const thread = fakeThread([]);
        channels.set('t1', thread);

        await syncPlan(plan({ openerMessageId: null }));

        expect(thread.log.some((e) => e.send)).toBe(false);
        expect(db.setPlanOpener).not.toHaveBeenCalled();
    });

    it('does nothing at all when the thread itself is gone', async () => {
        await syncPlan(plan(), { rename: true });
        expect(db.setPlanOpener).not.toHaveBeenCalled();
        expect(pins.pinMessage).not.toHaveBeenCalled();
    });

    //Discord caps thread renames, so the call is only worth making when the title moved
    it('only renames the thread when the title actually changed', async () => {
        const thread = fakeThread(['op1']);
        channels.set('t1', thread);

        await syncPlan(plan());
        expect(thread.log.some((e) => e.setName)).toBe(false);

        await syncPlan(plan(), { rename: true });
        expect(thread.log.some((e) => e.setName === 'Camping')).toBe(true);
    });
});

const setPlan = (over = {}) =>
    plan({
        status: 'closed',
        chosenDate: '2026-08-12',
        chosenTime: '19:00',
        timeZone: 'Europe/London',
        probeActive: true,
        probeThreadMessageId: 'pr1',
        ...over
    });

describe('the confirmation message', () => {
    it('is edited where it sits while it is still there', async () => {
        const thread = fakeThread(['pr1']);
        channels.set('t1', thread);

        await updateProbeMessage(setPlan());

        expect(thread.log.filter((e) => e.edit)).toHaveLength(1);
        expect(db.setProbe).not.toHaveBeenCalled();
    });

    it('is posted again and written down when it has been deleted', async () => {
        const thread = fakeThread([]);
        channels.set('t1', thread);

        await updateProbeMessage(setPlan());

        const sent = thread.log.find((e) => e.send);
        expect(sent).toBeTruthy();
        expect(sent.payload.content).toContain('CAN YOU MAKE IT?');
        expect(db.setProbe).toHaveBeenCalledWith('ab12cd34ef', { active: true, threadMessageId: sent.send });
    });

    /*
        The DM only case, from a probe that went up while the thread was unreachable. This
        runs on every vote, so healing here would post a poll into a thread nobody asked
        to have one in.
    */
    it('is not invented for a probe that never had one', async () => {
        const thread = fakeThread([]);
        channels.set('t1', thread);

        await updateProbeMessage(setPlan({ probeThreadMessageId: null }));

        expect(thread.log).toHaveLength(0);
        expect(db.setProbe).not.toHaveBeenCalled();
    });
});
