import { describe, it, expect, beforeEach, vi } from 'vitest';
import { today, shiftDate, formatDate } from '../../src/lib/dates.js';

/*
    The buttons on a DM. Each press has to be answered inside Discord's three seconds, so
    anything that can wait, like a DM to whoever runs the plan, goes after the answer. The
    offer to mark the day busy rides on the same card as the answer rather than arriving as
    a message of its own.
*/

const order = [];
const dms = [];

vi.mock('../../src/bot/client.js', () => ({
    client: {
        users: {
            fetch: async (id) => ({
                send: async (payload) => {
                    order.push(`dm ${id}`);
                    dms.push({ userId: id, payload });
                    return { id: `dm-${id}` };
                }
            })
        },
        channels: { fetch: async () => Promise.reject(new Error('unknown channel')) },
        guilds: {
            fetch: async () => ({
                members: {
                    cache: new Map(),
                    fetch: async (id) => ({ id, displayName: id === 'planner' ? 'Ali' : 'Bo', user: { bot: false } })
                }
            })
        }
    }
}));

const store = vi.hoisted(() => ({ plan: null, after: null }));
const db = vi.hoisted(() => ({
    getPlan: vi.fn(async () => store.plan && { ...store.plan }),
    recordVote: vi.fn(async () => store.after),
    removeParticipant: vi.fn(async () => store.after),
    setIn: vi.fn(async () => store.after),
    addParticipants: vi.fn(async () => store.after),
    addPlanEvent: vi.fn(async () => {}),
    markAllInNotified: vi.fn(async () => {}),
    markProbeAllYes: vi.fn(async () => {}),
    setPlanCards: vi.fn(async () => {}),
    setDmsClosed: vi.fn(async () => {})
}));
vi.mock('../../src/db/plans/index.js', async (real) => ({ ...(await real()), ...db }));
vi.mock('../../src/db/guilds.js', () => ({ getGuildConfig: vi.fn(async () => ({ guildName: 'The server' })) }));
vi.mock('../../src/db/users.js', () => ({ getPlanningPrefs: vi.fn(async () => ({})) }));
const cal = vi.hoisted(() => ({
    getAvailabilityInRange: vi.fn(async () => []),
    blockDay: vi.fn(async () => {}),
    setDayFree: vi.fn(async () => {}),
    getAvailabilityForUsersInRange: vi.fn(async () => []),
    getLastUpdated: vi.fn(async () => ({}))
}));
vi.mock('../../src/db/availability.js', () => cal);

const { handleVote, handleBlockDay, handleUnblockDay, handleDrop, handleJoin, handleJoinModal, handleUndrop, setDayReply } = await import('../../src/bot/plans/index.js');

const day = shiftDate(today(), 3);
const ids = (payload) => payload.components.flatMap((row) => row.components.map((b) => b.data.custom_id));

const setPlan = (bo = {}) => ({
    planId: 'ab12cd34ef',
    guildId: 'g1',
    name: 'Board games',
    createdBy: 'planner',
    status: 'closed',
    probeActive: true,
    chosenDate: day,
    dateRange: { start: day, end: day },
    timeZone: 'Europe/London',
    participants: [{ userId: 'bo', invited: true, vote: null, cardMessageId: 'card', ...bo }]
});

function press(customId, over = {}) {
    return {
        customId,
        message: { id: 'card' },
        user: { id: 'bo', username: 'bo' },
        inGuild: () => false,
        update: vi.fn(async () => order.push('answered')),
        reply: vi.fn(async () => order.push('answered')),
        showModal: vi.fn(async () => {}),
        ...over
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    dms.length = 0;
    cal.getAvailabilityInRange.mockImplementation(async () => []);
});

describe("/free in a set plan's thread", () => {
    it('answers with the day and the yes/no', () => {
        const reply = setDayReply(setPlan(), 'bo');
        expect(reply.content).toBe(`**Board games** is set for ${formatDate(day)}.\nCan you make it?`);
        expect(ids(reply)).toEqual(['vote|yes|ab12cd34ef|r0', 'vote|no|ab12cd34ef|r0']);
    });

    it('says where they stand once they have answered', () => {
        expect(setDayReply(setPlan({ vote: 'yes' }), 'bo').content).toContain("You're down as coming.");
        expect(setDayReply(setPlan({ override: 'no' }), 'bo').content).toContain("You're down as not coming.");
    });

    it('gives no buttons to someone off the list for this date', () => {
        const reply = setDayReply(setPlan({ invited: false }), 'bo');
        expect(reply.content).toMatch(/not on the invite list/);
        expect(reply.components).toEqual([]);
    });
});

describe("saying I'm coming from a DM", () => {
    beforeEach(() => {
        store.plan = setPlan();
        store.after = setPlan({ vote: 'yes' });
    });

    it('turns the card into the answer with the offer under it, dated', async () => {
        cal.getAvailabilityInRange.mockImplementation(async () => [{ date: day, hours: [] }]);
        const click = press('vote|yes|ab12cd34ef|r0');

        await handleVote(click);

        const shown = click.update.mock.calls[0][0];
        expect(shown.content).toContain("You're down as coming.");
        expect(shown.content).toContain(`Your calendar has you free on ${formatDate(day)}.`);
        expect(ids(shown)).toEqual(['vote|yes|ab12cd34ef|r0', 'vote|no|ab12cd34ef|r0', `block|yes|ab12cd34ef|${day}`, `block|no|ab12cd34ef|${day}`]);
        expect(shown.components[1].components.map((b) => b.data.label)).toEqual(['Mark me busy that day', 'Leave my calendar']);
    });

    it('offers nothing when their calendar already has them busy', async () => {
        const click = press('vote|yes|ab12cd34ef|r0');
        await handleVote(click);
        expect(click.update.mock.calls[0][0].components).toHaveLength(1);
    });

    it('offers nothing in the thread', async () => {
        const click = press('vote|yes|ab12cd34ef|r0', { inGuild: () => true });
        await handleVote(click);
        expect(cal.getAvailabilityInRange).not.toHaveBeenCalled();
    });
});

describe('the offer under the card', () => {
    //The plan has moved on since, which is exactly what the date on the button is for
    const offered = '2026-10-10';
    beforeEach(() => (store.plan = setPlan({ vote: 'yes' })));

    it('marks the offered day busy and puts the hours it had on the undo', async () => {
        cal.getAvailabilityInRange.mockImplementation(async () => [{ date: offered, hours: [18, 19] }]);
        const click = press(`block|yes|ab12cd34ef|${offered}`);

        await handleBlockDay(click);

        expect(cal.blockDay).toHaveBeenCalledWith('bo', offered);
        const shown = click.update.mock.calls[0][0];
        expect(shown.content).toContain("You're down as coming.");
        expect(shown.content).toContain('Marked Sat 10 Oct 2026 busy in your calendar.');
        expect(ids(shown).at(-1)).toBe(`unblock|ab12cd34ef|${offered}|${(1 << 18) | (1 << 19)}`);
    });

    it('leaves the calendar alone and the card without the offer', async () => {
        const click = press(`block|no|ab12cd34ef|${offered}`);

        await handleBlockDay(click);

        expect(cal.blockDay).not.toHaveBeenCalled();
        expect(ids(click.update.mock.calls[0][0])).toEqual(['vote|yes|ab12cd34ef|r0', 'vote|no|ab12cd34ef|r0']);
    });

    it('undoes to the exact hours and makes the offer again', async () => {
        const click = press(`unblock|ab12cd34ef|${offered}|${(1 << 18) | (1 << 19)}`);

        await handleUnblockDay(click);

        expect(cal.setDayFree).toHaveBeenCalledWith('bo', offered, [18, 19]);
        expect(ids(click.update.mock.calls[0][0]).at(-2)).toBe(`block|yes|ab12cd34ef|${offered}`);
    });

    //Worded "Yes, keep it free" for marking the day busy, so a press on one could mean either
    it('writes nothing for an offer from before the buttons were dated', async () => {
        const click = press('block|yes|ab12cd34ef');
        await handleBlockDay(click);
        await handleUnblockDay(press('unblock|ab12cd34ef|786432'));

        expect(cal.blockDay).not.toHaveBeenCalled();
        expect(cal.setDayFree).not.toHaveBeenCalled();
        expect(click.update.mock.calls[0][0].content).toContain('expired');
    });
});

describe('count me in and not for me', () => {
    const collecting = (participants) => ({ ...setPlan(), status: 'collecting', probeActive: false, chosenDate: null, participants });
    const planner = { userId: 'planner', invited: true, confirmed: true };
    const bo = (over = {}) => ({ userId: 'bo', invited: true, cardMessageId: 'card', ...over });
    const answer = (click) => click.update.mock.calls[0][0];

    it('turns the card into their answer, and asks nothing more of someone in', async () => {
        store.plan = collecting([bo(), planner]);
        store.after = collecting([bo({ in: true }), planner]);
        const click = press('join|yes|ab12cd34ef');

        await handleJoin(click);

        expect(db.setIn).toHaveBeenCalledWith('ab12cd34ef', 'bo', true, null);
        expect(answer(click).content).toContain("You're in.");
        expect(answer(click).components[0].components.map((b) => b.data.label)).toEqual(["✓ I'm in", 'Not for me']);
    });

    it('opens the reason box for a no, and writes nothing yet', async () => {
        store.plan = collecting([bo(), planner]);
        const click = press('join|no|ab12cd34ef');

        await handleJoin(click);

        expect(click.showModal.mock.calls[0][0].toJSON().custom_id).toBe('joinmodal|ab12cd34ef');
        expect(db.setIn).not.toHaveBeenCalled();
    });

    it('answers a not for me before telling whoever runs the plan, and keeps them on it', async () => {
        store.plan = collecting([bo(), planner]);
        store.after = collecting([bo({ in: false, inReason: 'Away' }), planner]);
        const submit = press('joinmodal|ab12cd34ef', { fields: { getTextInputValue: () => ' Away ' } });

        await handleJoinModal(submit);

        expect(db.setIn).toHaveBeenCalledWith('ab12cd34ef', 'bo', false, 'Away');
        expect(db.removeParticipant).not.toHaveBeenCalled();
        expect(order[0]).toBe('answered');
        expect(order.slice(1)).toContain('dm planner');
        expect(answer(submit).content).toContain("You said it's not for you.");
        expect(db.addPlanEvent).toHaveBeenCalledWith('ab12cd34ef', expect.objectContaining({ type: 'left', by: 'bo' }));
    });

    //A card from before the question still carries Drop out, and a box opened from it can still come back
    it('takes an old drop out as not for me', async () => {
        store.plan = collecting([bo(), planner]);
        store.after = collecting([bo({ in: false }), planner]);
        const click = press('drop|ab12cd34ef');
        await handleDrop(click);
        expect(click.showModal.mock.calls[0][0].toJSON().custom_id).toBe('joinmodal|ab12cd34ef');

        await handleJoinModal(press('dropmodal|ab12cd34ef', { fields: { getTextInputValue: () => '' } }));
        expect(db.setIn).toHaveBeenCalledWith('ab12cd34ef', 'bo', false, null);
    });

    it('hands back the card for the day, and writes nothing, once the plan has one', async () => {
        store.plan = setPlan({ cardMessageId: 'card' });
        const click = press('join|yes|ab12cd34ef');

        await handleJoin(click);

        expect(db.setIn).not.toHaveBeenCalled();
        expect(ids(answer(click))).toEqual(['vote|yes|ab12cd34ef|r0', 'vote|no|ab12cd34ef|r0']);
    });

    //Dropping out used to take people off the plan, so its undo puts them back on first
    it('puts someone an old drop out took off back on, and counts them in', async () => {
        store.plan = collecting([planner]);
        store.after = collecting([bo({ in: true }), planner]);

        await handleUndrop(press('undrop|ab12cd34ef'));

        expect(db.addParticipants).toHaveBeenCalledWith('ab12cd34ef', ['bo'], expect.objectContaining({ id: 'bo' }));
        expect(db.setIn).toHaveBeenCalledWith('ab12cd34ef', 'bo', true);
        expect(order).toEqual(['answered', 'dm planner']);
        expect(dms[0].payload).toBe('**BACK IN**\n\nBo is in for "Board games" in The server after all.');
    });
});
