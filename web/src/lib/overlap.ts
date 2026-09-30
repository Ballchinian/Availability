import { DAY_HOURS, HOUR_COUNT } from './hours.js';

/*
    Works out the common window for a day: the hours that suit everyone we are
    counting. Someone free with no specific hours does not narrow anything, they
    are free the whole day. If you are willing to miss a few people we drop the
    ones whose hours most shrink the window, so one odd schedule does not spoil an
    otherwise good day.
*/

export interface FreePerson {
    userId: string;
    hours?: number[];  // empty or missing means free the whole day
}

export interface WindowResult {
    keptIds: string[];
    window: number[];
    droppedIds: string[];
}

export interface DayEval {
    viable: boolean;
    freeCount: number;
    windowSize: number;
    window: number[];
    keptIds: string[];
    droppedIds: string[];
}

//A counted person carries their hours as a set, ready to intersect with others
interface Counted {
    userId: string;
    set: Set<number>;
}

const ALL = new Set(DAY_HOURS);

function setOf(hours?: number[]): Set<number> {
    return hours && hours.length ? new Set(hours) : ALL;
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
    const out = new Set<number>();
    for (const x of a) if (b.has(x)) out.add(x);
    return out;
}

function windowOf(people: Counted[]): Set<number> {
    if (!people.length) return new Set();
    let w = new Set(people[0].set);
    for (let i = 1; i < people.length; i++) {
        w = intersect(w, people[i].set);
        if (!w.size) break;
    }
    return w;
}

/*
    The window each person's absence would leave, all of them in three passes.
    Intersection is associative, so the answer for i is everyone before i met with
    everyone after: prefix and suffix scans give both halves. Rebuilding each one
    from scratch instead is people squared times hours per round, which a forty
    person plan felt as a stall on every step of the miss slider.

    Only sound while at least two people are kept, since the identity here is the
    whole day and windowOf calls an empty group no window at all.
*/
function windowsWithoutEach(kept: Counted[]): Set<number>[] {
    const n = kept.length;
    const prefix: Set<number>[] = new Array(n);
    const suffix: Set<number>[] = new Array(n);

    let acc = ALL;
    for (let i = 0; i < n; i++) {
        prefix[i] = acc;
        acc = intersect(acc, kept[i].set);
    }
    acc = ALL;
    for (let i = n - 1; i >= 0; i--) {
        suffix[i] = acc;
        acc = intersect(acc, kept[i].set);
    }

    return prefix.map((p, i) => intersect(p, suffix[i]));
}

export function bestWindow(free: FreePerson[], budget: number): WindowResult {
    const kept: Counted[] = free.map((f) => ({ userId: f.userId, set: setOf(f.hours) }));
    let window = windowOf(kept);
    const dropped: string[] = [];
    let b = budget;

    while (b > 0 && window.size < HOUR_COUNT && kept.length > 1) {
        const without = windowsWithoutEach(kept);
        let bestIdx = -1;
        let bestWin = window;
        let bestSize = -1;
        for (let i = 0; i < without.length; i++) {
            const w = without[i];
            if (w.size > bestSize) {
                bestSize = w.size;
                bestIdx = i;
                bestWin = w;
            }
        }
        const improves = bestSize > window.size;
        const escapingEmpty = window.size === 0 && bestIdx !== -1;
        if (!improves && !escapingEmpty) break;

        dropped.push(kept[bestIdx].userId);
        kept.splice(bestIdx, 1);
        window = bestWin;
        b -= 1;
    }

    return { keptIds: kept.map((k) => k.userId), window: [...window], droppedIds: dropped };
}

/*
    unsureCount is how many confirmed people this day sits past the certainty horizon
    of. They are neither free nor busy, just too far out to say, so they come off the
    denominator rather than eating into the miss budget as if they were skipping it.
*/
export function evaluateDay(free: FreePerson[], confirmedCount: number, missAllowed: number, unsureCount = 0): DayEval {
    const counted = confirmedCount - unsureCount;
    const freeCount = free.length;
    const missingAuto = counted - freeCount;
    if (counted === 0 || missingAuto > missAllowed) {
        return { viable: false, freeCount, windowSize: 0, window: [], keptIds: [], droppedIds: [] };
    }
    const budget = missAllowed - missingAuto;
    const { keptIds, window, droppedIds } = bestWindow(free, budget);
    return {
        viable: window.length > 0,
        freeCount,
        windowSize: window.length,
        window,
        keptIds,
        droppedIds
    };
}
