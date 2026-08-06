/*
    Runs the same job over a list, a few at a time.

    Discord has no bulk DM and no bulk thread add, so a plan of MAX_PARTICIPANTS is
    that many calls whichever way it is written. One at a time is two hundred round
    trips end to end, and firing all two hundred at once hands discord.js a queue it
    will pace anyway while every one of them sits open. A handful in flight keeps
    that queue fed without the burst.

    Jobs finish as they finish, so nothing here preserves order or collects results.
    Nothing here catches either: every caller has its own idea of what a failure
    means, and they all swallow theirs at the call site.
*/

//Chosen for a REST client that paces itself, low enough that nothing sees a burst
export const FAN_OUT = 5;

export async function fanOut(items, worker, limit = FAN_OUT) {
    let next = 0;
    const runner = async () => {
        while (next < items.length) {
            const i = next++;
            await worker(items[i], i);
        }
    };

    const runners = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(runner());

    /*
        Settled rather than raced: a worker that throws would otherwise leave the
        rest of the list running behind an already rejected fanOut, unwatched. The
        first failure is rethrown once every runner has stopped.
    */
    const results = await Promise.allSettled(runners);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
}
