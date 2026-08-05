/*
    A sliding window per caller address, held in this process. The counter in
    db/ratelimits.js is the one that matters and is keyed by person and server,
    which the login round trip cannot use: nobody is logged in yet, so the address
    is all there is to go on.

    In memory on purpose. It guards endpoints that do almost nothing, so a mongo
    round trip per hit would cost more than the work it is protecting, and losing
    every count on a restart is no loss at all.

    Accuracy here rests on config.trustProxy being the real number of proxies.
    Set that too low and everyone arriving through one of them shares an
    allowance, so keep the limits loose enough that a real group never feels them.
*/

const SWEEP_AT = 5000;

/*
    Plain text rather than json because the only callers are browser navigations,
    not fetches: the person is looking at the reply, not parsing it.
*/
export function ipLimit({ limit, windowMs, message }) {
    const hits = new Map();

    return function limiter(req, res, next) {
        const now = Date.now();
        const cutoff = now - windowMs;

        //Nothing else ever removes an address, so drop the cold ones once the map gets big
        if (hits.size > SWEEP_AT) {
            for (const [key, times] of hits) {
                if (times[times.length - 1] <= cutoff) hits.delete(key);
            }
        }

        const key = req.ip || 'unknown';
        const recent = (hits.get(key) || []).filter((t) => t > cutoff);

        if (recent.length >= limit) {
            //Oldest first, so the first survivor is the one whose slot frees up next
            res.set('Retry-After', String(Math.ceil((recent[0] + windowMs - now) / 1000)));
            return res.status(429).type('text').send(message);
        }

        recent.push(now);
        hits.set(key, recent);
        next();
    };
}
