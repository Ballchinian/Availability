import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
    What happens when somebody deletes one of a plan's own thread messages. The fake thread
    records everything it is asked to do, and most of these assert what is not in that
    record: no second opener on a plan that never had one, no poll in a thread that had none.
*/

const channels = new Map();

vi.mock('../../src/bot/client.js', () => ({
    client: { channels: { fetch: async (id) => channels.get(id) || Promise.reject(new Error('unknown channel')) } }
}));

const db = vi.hoisted(() => ({ setPlanOpener: vi.fn(), forgetProbeMessage: vi.fn(async () => {}) }));
vi.mock('../../src/db/plans.js', async (real) => ({ ...(await real()), ...db }));

const pins = vi.hoisted(() => ({ pinMessage: vi.fn(async () => {}) }));
vi.mock('../../src/bot/util.js', async (real) => ({ ...(await real()), ...pins }));

const { syncPlan, updateOpener } = await import('../../src/bot/plans.js');

/*
    held is which message ids the thread still has. Anything else fetches as gone, which
    is what a deleted message looks like from here.
*/
function fakeThread(held = [], { undeletable = false, id = 't1', name = 'Camping', stuck = false } = {}) {
    const log = [];
    const messages = new Map(
        held.map((id) => [id, {
            id,
            edit: async (payload) => (log.push({ edit: id, payload }), { id, ...payload }),
            delete: async () => {
                if (undeletable) throw new Error('missing access');
                log.push({ delete: id });
            }
        }])
    );
    return {
        id,
        name,
        log,
        archived: false,
        //stuck is Discord's rename limit, which discord.js waits out for up to ten minutes
        setName: (to) => (log.push({ setName: to }), stuck ? new Promise(() => {}) : Promise.resolve()),
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
    db.forgetProbeMessage.mockClear();
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
        await syncPlan(plan());
        expect(db.setPlanOpener).not.toHaveBeenCalled();
        expect(pins.pinMessage).not.toHaveBeenCalled();
    });
});

describe("the thread's name", () => {
    //Discord caps thread renames, so the call is only worth making when the name moved
    it('is only renamed when it is not what the plan says', async () => {
        const thread = fakeThread(['op1']);
        channels.set('t1', thread);

        await syncPlan(plan());
        expect(thread.log.some((e) => e.setName)).toBe(false);

        await syncPlan(plan({ name: 'Camping trip' }));
        expect(thread.log.filter((e) => e.setName)).toEqual([{ setName: 'Camping trip' }]);
    });

    //A repeating series would otherwise be a row of threads all called the same thing
    it('carries the day once one is set, and loses it when the plan goes back to collecting', async () => {
        const thread = fakeThread(['op1'], { id: 't2' });
        channels.set('t1', thread);

        await syncPlan(plan({ status: 'closed', chosenDate: '2026-08-12', timeZone: 'Europe/London' }));
        thread.name = 'Camping · Wed 12 Aug';
        await syncPlan(plan());

        expect(thread.log.filter((e) => e.setName)).toEqual([{ setName: 'Camping · Wed 12 Aug' }, { setName: 'Camping' }]);
    });

    it('goes last, and nothing waits on it', async () => {
        const thread = fakeThread(['op1'], { id: 't3', name: 'Old name', stuck: true });
        channels.set('t1', thread);

        await syncPlan(plan());
        await syncPlan(plan());

        expect(thread.log.map((e) => Object.keys(e)[0])).toEqual(['edit', 'setName', 'edit']);
    });
});

const setPlan = (over = {}) =>
    plan({
        status: 'closed',
        chosenDate: '2026-08-12',
        chosenTime: '19:00',
        timeZone: 'Europe/London',
        probeActive: true,
        participants: [{ userId: 'a', invited: true, vote: 'yes' }, { userId: 'b', invited: true, vote: null }],
        ...over
    });

const ids = (payload) => payload.components.flatMap((row) => row.components.map((b) => b.data.custom_id));

describe('the yes/no on a set day', () => {
    it('is the opener, edited where it sits with the tally and the buttons', async () => {
        const thread = fakeThread(['op1']);
        channels.set('t1', thread);

        await updateOpener(setPlan());

        const edits = thread.log.filter((e) => e.edit);
        expect(edits).toHaveLength(1);
        expect(edits[0].payload.content).toContain('1 coming');
        expect(ids(edits[0].payload)).toEqual(['vote|yes|ab12cd34ef|r0', 'vote|no|ab12cd34ef|r0']);
    });

    //From before the opener carried it: its tally stopped moving, so it goes the first time the plan is touched
    it('takes down the separate yes/no an older plan posted, and forgets it', async () => {
        const thread = fakeThread(['op1', 'pr1']);
        channels.set('t1', thread);

        await updateOpener(setPlan({ probeThreadMessageId: 'pr1' }));

        expect(thread.log).toContainEqual({ delete: 'pr1' });
        expect(db.forgetProbeMessage).toHaveBeenCalledWith('ab12cd34ef');
    });

    it('edits that one down to a pointer when Discord will not delete it', async () => {
        const thread = fakeThread(['op1', 'pr1'], { undeletable: true });
        channels.set('t1', thread);

        await updateOpener(setPlan({ probeThreadMessageId: 'pr1' }));

        const down = thread.log.find((e) => e.edit === 'pr1');
        expect(down.payload).toEqual({ content: 'The yes/no is the pinned message now.', components: [] });
    });

    //Nothing would carry the buttons if it went, so a plan with no opener keeps what it has
    it('leaves an older plan with no opener exactly as it is', async () => {
        const thread = fakeThread(['pr1']);
        channels.set('t1', thread);

        await updateOpener(setPlan({ openerMessageId: null, probeThreadMessageId: 'pr1' }));

        expect(thread.log).toEqual([]);
        expect(db.forgetProbeMessage).not.toHaveBeenCalled();
    });
});
