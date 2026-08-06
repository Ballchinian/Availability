import { describe, it, expect } from 'vitest';
import { fanOut, FAN_OUT } from '../../src/lib/fanout.js';

//A worker that holds each job open until it is let go, so the width can be watched
function tracker() {
    let live = 0;
    let peak = 0;
    const done = [];
    const gates = [];
    const worker = async (item, i) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => gates.push(resolve));
        live -= 1;
        done.push([item, i]);
    };
    return { worker, gates, done, peak: () => peak };
}

//Lets every job currently waiting finish, then hands control back so the next batch can start
async function release(gates) {
    while (gates.length) gates.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('fanOut', () => {
    it('does nothing with an empty list', async () => {
        let ran = 0;
        await fanOut([], () => { ran += 1; });
        expect(ran).toBe(0);
    });

    it('runs every item once, with its index', async () => {
        const seen = [];
        await fanOut(['a', 'b', 'c'], async (item, i) => { seen.push([item, i]); }, 2);
        expect(seen).toHaveLength(3);
        expect(seen.map(([item]) => item).sort()).toEqual(['a', 'b', 'c']);
        expect(seen.map(([, i]) => i).sort()).toEqual([0, 1, 2]);
    });

    it('never has more than the cap in flight', async () => {
        const t = tracker();
        const items = [1, 2, 3, 4, 5, 6, 7];
        const all = fanOut(items, t.worker, 3);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(t.gates).toHaveLength(3);

        while (t.done.length < items.length) await release(t.gates);
        await all;

        expect(t.peak()).toBe(3);
        expect(t.done).toHaveLength(items.length);
    });

    it('opens no more runners than there are items', async () => {
        const t = tracker();
        const all = fanOut([1, 2], t.worker, 10);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(t.gates).toHaveLength(2);

        await release(t.gates);
        await all;
        expect(t.peak()).toBe(2);
    });

    /*
        The reason for settling rather than racing: the throw must not leave the rest
        of the list running behind a promise nobody is holding any more.
    */
    it('finishes the list even when a worker throws, then rethrows', async () => {
        const ran = [];
        const boom = new Error('no');
        const run = fanOut([1, 2, 3, 4], async (n) => {
            ran.push(n);
            if (n === 1) throw boom;
        }, 2);

        await expect(run).rejects.toBe(boom);
        expect(ran.sort()).toEqual([1, 2, 3, 4]);
    });

    it('defaults to the shared cap', async () => {
        const t = tracker();
        const all = fanOut([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], t.worker);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(t.gates).toHaveLength(FAN_OUT);

        while (t.done.length < 10) await release(t.gates);
        await all;
    });
});
