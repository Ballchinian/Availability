import { describe, it, expect, beforeEach, vi } from 'vitest';
import { announceAfter } from '../../src/api/announce.js';

/*
    The queue each plan's announcements wait in. Two saves a second apart used to send
    their posts and DMs at the same time, each built from the plan its own save saw.
*/

const store = vi.hoisted(() => new Map());

vi.mock('../../src/db/plans/index.js', () => ({
    getPlan: vi.fn(async (planId) => store.get(planId) || null)
}));

//An announcement that stays in the middle of sending until it is let go
const held = () => {
    let release;
    const until = new Promise((resolve) => (release = resolve));
    return { until, release };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    store.clear();
    store.set('p1', { planId: 'p1', status: 'closed', chosenTime: '19:00' });
    store.set('p2', { planId: 'p2', status: 'collecting' });
});

describe('announceAfter', () => {
    it('starts the next announcement for a plan only once the one before has finished', async () => {
        const order = [];
        const first = held();

        announceAfter('p1', 'first', async () => {
            order.push('first starts');
            await first.until;
            order.push('first ends');
        });
        const second = announceAfter('p1', 'second', async () => order.push('second starts'));

        await settle();
        expect(order).toEqual(['first starts']);

        first.release();
        await second;
        expect(order).toEqual(['first starts', 'first ends', 'second starts']);
    });

    it('hands each announcement the plan as it is when its turn comes', async () => {
        const seen = [];
        const first = held();

        announceAfter('p1', 'first', async (plan) => {
            seen.push(plan.chosenTime);
            await first.until;
        });
        const second = announceAfter('p1', 'second', async (plan) => seen.push(plan.chosenTime));

        //The second save writes while the first announcement is still sending
        await settle();
        store.set('p1', { ...store.get('p1'), chosenTime: '20:00' });
        first.release();
        await second;

        expect(seen).toEqual(['19:00', '20:00']);
    });

    it('does not hold one plan up behind another', async () => {
        const stuck = held();
        announceAfter('p1', 'slow', () => stuck.until);

        const other = vi.fn();
        await announceAfter('p2', 'quick', other);
        expect(other).toHaveBeenCalledTimes(1);

        stuck.release();
    });

    //Otherwise one Discord outage would stop that plan announcing anything until a restart
    it('logs a failure and carries on with the next one', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        announceAfter('p1', 'outcome post', async () => {
            throw new Error('discord is down');
        });
        const next = vi.fn();
        await announceAfter('p1', 'when edit', next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(logged).toHaveBeenCalledWith('[plans] outcome post failed:', expect.any(Error));
        logged.mockRestore();
    });

    //An invite from the board waits on this to say whether its DM landed
    it('hands back what the announcement returned, and nothing when it failed', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await announceAfter('p1', 'invite', async () => true)).toBe(true);
        expect(await announceAfter('p1', 'invite', async () => {
            throw new Error('discord is down');
        })).toBeUndefined();
        logged.mockRestore();
    });

    it('sends nothing for a plan deleted before its turn', async () => {
        const run = vi.fn();
        await announceAfter('gone', 'outcome post', run);
        expect(run).not.toHaveBeenCalled();
    });

    it('lets only the cancel through once a plan has been cancelled', async () => {
        const first = held();
        const outcome = vi.fn();
        const cancel = vi.fn();

        announceAfter('p1', 'details edit', () => first.until);
        announceAfter('p1', 'outcome post', outcome);
        const last = announceAfter('p1', 'cancel announce', cancel, { cancel: true });

        await settle();
        store.set('p1', { ...store.get('p1'), status: 'cancelled' });
        first.release();
        await last;

        expect(outcome).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });
});
