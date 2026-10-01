import { describe, it, expect } from 'vitest';
import { nameless, unansweredCounts } from '../../src/api/guestview.js';

//The days as a guest gets them on a plan from before guests could see each other's
describe('days with the names taken off', () => {
    it('keeps how many are free and their hours', () => {
        const out = nameless({ '2026-10-10': [{ userId: 'ann', hours: [18, 19] }, { userId: 'bo', hours: [] }] });
        expect(out['2026-10-10'].map((f) => f.hours)).toEqual([[], [18, 19]]);
        expect(JSON.stringify(out)).not.toMatch(/ann|bo/);
    });

    //The guest list is in a fixed order, so the same slot every day would be the same person
    it('puts each day in order of its hours, whatever order the people came in', () => {
        const a = nameless({ d: [{ userId: 'ann', hours: [18] }, { userId: 'bo', hours: [9, 10] }, { userId: 'cy', hours: [] }] });
        const b = nameless({ d: [{ userId: 'cy', hours: [] }, { userId: 'bo', hours: [9, 10] }, { userId: 'ann', hours: [18] }] });
        expect(a).toEqual(b);
        expect(a.d.map((f) => f.userId)).toEqual(['free0', 'free1', 'free2']);
    });
});

describe('how many have not answered a day', () => {
    it('counts each day someone still has to answer', () => {
        expect(unansweredCounts({ ann: ['d1', 'd2'], bo: ['d2'] }, {})).toEqual({ d1: 1, d2: 2 });
    });

    //Someone sent back still shows as free on the days they marked
    it('leaves out a day they are free on', () => {
        expect(unansweredCounts({ ann: ['d1', 'd2'] }, { d2: [{ userId: 'ann', hours: [] }] })).toEqual({ d1: 1 });
    });
});
