import { describe, it, expect } from 'vitest';
import { HOUR_COUNT } from '../../src/lib/hours.js';
import { bestWindow, evaluateDay, explainDay } from '../../src/lib/overlap.js';

describe('bestWindow', () => {
    it('has no window when nobody is free', () => {
        expect(bestWindow([], 3)).toEqual({ keptIds: [], window: [], droppedIds: [] });
    });

    it('gives someone with no hours the whole window', () => {
        const r = bestWindow([{ userId: 'a' }], 0);
        expect(r.window).toHaveLength(HOUR_COUNT);
        expect(r.droppedIds).toEqual([]);
    });

    it('does not let someone with no hours narrow anyone', () => {
        const r = bestWindow([{ userId: 'a' }, { userId: 'b', hours: [8, 9] }], 0);
        expect(r.window).toEqual([8, 9]);
        expect(r.keptIds).toEqual(['a', 'b']);
        expect(r.droppedIds).toEqual([]);
    });

    it('intersects everyone when there is no budget to drop', () => {
        const r = bestWindow(
            [
                { userId: 'a', hours: [8, 9, 10] },
                { userId: 'b', hours: [9, 10, 11] }
            ],
            0
        );
        expect(r.window).toEqual([9, 10]);
        expect(r.droppedIds).toEqual([]);
    });

    it('keeps everyone and an empty window when the budget is nil', () => {
        const r = bestWindow(
            [
                { userId: 'a', hours: [8, 9] },
                { userId: 'b', hours: [12, 13] }
            ],
            0
        );
        expect(r.window).toEqual([]);
        expect(r.keptIds).toEqual(['a', 'b']);
    });

    it('drops the one odd schedule that is spoiling the day', () => {
        const r = bestWindow(
            [
                { userId: 'a', hours: [8, 9] },
                { userId: 'b', hours: [8, 9, 10, 11] },
                { userId: 'c', hours: [12] }
            ],
            1
        );
        expect(r.droppedIds).toEqual(['c']);
        expect(r.keptIds).toEqual(['a', 'b']);
        expect(r.window).toEqual([8, 9]);
    });

    it('spends no more of the budget than it has to', () => {
        const r = bestWindow(
            [
                { userId: 'a', hours: [8, 9] },
                { userId: 'b', hours: [8, 9] },
                { userId: 'c', hours: [12] }
            ],
            5
        );
        expect(r.droppedIds).toEqual(['c']);
    });

    /*
        Three people who share nothing: the first drop cannot improve on an already
        empty window, so without the escaping-empty case it would give up here and
        return nothing. It has to spend the drop anyway to reach a real window.
    */
    it('keeps dropping through an empty window to reach a real one', () => {
        const r = bestWindow(
            [
                { userId: 'a', hours: [8] },
                { userId: 'b', hours: [9] },
                { userId: 'c', hours: [10] }
            ],
            2
        );
        expect(r.window).toHaveLength(1);
        expect(r.keptIds).toHaveLength(1);
        expect(r.droppedIds).toHaveLength(2);
    });

    /*
        The odd one out in the middle of the list rather than at the end, so the
        window without them is built from people on both sides of them.
    */
    it('drops a spoiler from the middle of the list', () => {
        const r = bestWindow(
            [
                { userId: 'a', hours: [8, 9, 10] },
                { userId: 'b', hours: [20] },
                { userId: 'c', hours: [8, 9] }
            ],
            1
        );
        expect(r.droppedIds).toEqual(['b']);
        expect(r.keptIds).toEqual(['a', 'c']);
        expect(r.window).toEqual([8, 9]);
    });

    it('drops from both ends of the list across rounds', () => {
        const r = bestWindow(
            [
                { userId: 'a', hours: [5] },
                { userId: 'b', hours: [8, 9, 10] },
                { userId: 'c', hours: [8, 9, 10, 11] },
                { userId: 'd', hours: [0] }
            ],
            2
        );
        expect(r.droppedIds).toEqual(['a', 'd']);
        expect(r.keptIds).toEqual(['b', 'c']);
        expect(r.window).toEqual([8, 9, 10]);
    });

    it('never drops the last person standing', () => {
        const r = bestWindow([{ userId: 'a', hours: [8] }], 5);
        expect(r.keptIds).toEqual(['a']);
        expect(r.droppedIds).toEqual([]);
    });
});

describe('evaluateDay', () => {
    it('is not viable with nobody confirmed', () => {
        expect(evaluateDay([], 0, 3).viable).toBe(false);
    });

    it('is viable when everyone confirmed is free', () => {
        const ev = evaluateDay([{ userId: 'a' }, { userId: 'b' }], 2, 0);
        expect(ev.viable).toBe(true);
        expect(ev.freeCount).toBe(2);
        expect(ev.windowSize).toBe(HOUR_COUNT);
    });

    it('fails a day more people are missing from than the budget allows', () => {
        const ev = evaluateDay([{ userId: 'a' }], 3, 1);
        expect(ev.viable).toBe(false);
        expect(ev.freeCount).toBe(1);
        expect(ev.windowSize).toBe(0);
    });

    it('allows exactly as many missing as the budget', () => {
        const ev = evaluateDay([{ userId: 'a' }, { userId: 'b' }], 3, 1);
        expect(ev.viable).toBe(true);
    });

    it('spends what the budget has left over on dropping bad hours', () => {
        const ev = evaluateDay(
            [
                { userId: 'a', hours: [8, 9] },
                { userId: 'b', hours: [12] }
            ],
            2,
            1
        );
        expect(ev.viable).toBe(true);
        expect(ev.droppedIds).toHaveLength(1);
        expect(ev.freeCount).toBe(2);
    });

    /*
        Someone past their certainty horizon is neither free nor busy, so they come
        off the denominator instead of counting as a miss.
    */
    it('takes unsure people out of the count rather than the budget', () => {
        const free = [{ userId: 'a' }, { userId: 'b' }];
        expect(evaluateDay(free, 4, 0).viable).toBe(false);
        expect(evaluateDay(free, 4, 0, 2).viable).toBe(true);
    });

    it('is not viable when everyone confirmed is unsure', () => {
        expect(evaluateDay([], 2, 0, 2).viable).toBe(false);
    });
});

describe('explainDay', () => {
    it('blames the absences when too few marked the day', () => {
        expect(explainDay([{ userId: 'a' }], 3, 0)).toEqual({ block: 'missing', needMiss: 2 });
    });

    it('blames the hours when everyone is free and nothing overlaps', () => {
        const free = [
            { userId: 'a', hours: [8] },
            { userId: 'b', hours: [20] }
        ];
        expect(explainDay(free, 2, 0)).toEqual({ block: 'clash', needMiss: 1 });
    });

    /*
        Two away and the two who are here clashing, so the allowance that covers the
        absences still leaves a dim day. The whole reason this walks the allowances
        rather than answering with the number missing.
    */
    it('goes past the absences when the hours clash on top of them', () => {
        const free = [
            { userId: 'a', hours: [8] },
            { userId: 'b', hours: [20] }
        ];
        expect(explainDay(free, 4, 0)).toEqual({ block: 'missing', needMiss: 3 });
    });

    it('counts every round a clash takes to come apart', () => {
        const free = [
            { userId: 'a', hours: [8] },
            { userId: 'b', hours: [20] },
            { userId: 'c', hours: [14] }
        ];
        expect(explainDay(free, 3, 1)).toEqual({ block: 'clash', needMiss: 2 });
    });

    it('has no allowance to offer for a day nobody marked', () => {
        expect(explainDay([], 3, 0)).toEqual({ block: 'missing', needMiss: null });
    });

    it('says nobody is counted when the day is past every horizon', () => {
        expect(explainDay([], 2, 0, 2)).toEqual({ block: 'nobody', needMiss: null });
    });
});
