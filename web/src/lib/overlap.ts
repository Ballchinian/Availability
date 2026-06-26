import { SOCIABLE_HOURS, HOUR_COUNT } from './hours.js';

/*
    Works out the common window for a day: the hours that suit everyone we are
    counting. Someone free with no specific hours does not narrow anything, they
    are free the whole window. If you are willing to miss a few people we drop the
    ones whose hours most shrink the window, so one odd schedule does not spoil an
    otherwise good day.
*/

export interface FreePerson {
    userId: string;
    hours?: number[];  // empty or missing means free the whole window
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

const ALL = new Set(SOCIABLE_HOURS);

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

export function bestWindow(free: FreePerson[], budget: number): WindowResult {
    let kept: Counted[] = free.map((f) => ({ userId: f.userId, set: setOf(f.hours) }));
    let window = windowOf(kept);
    const dropped: string[] = [];
    let b = budget;

    while (b > 0 && window.size < HOUR_COUNT && kept.length > 1) {
        let bestIdx = -1;
        let bestWin = window;
        let bestSize = -1;
        for (let i = 0; i < kept.length; i++) {
            const without = kept.filter((_, j) => j !== i);
            const w = windowOf(without);
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

export function evaluateDay(free: FreePerson[], confirmedCount: number, missAllowed: number): DayEval {
    const freeCount = free.length;
    const missingAuto = confirmedCount - freeCount;
    if (confirmedCount === 0 || missingAuto > missAllowed) {
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
