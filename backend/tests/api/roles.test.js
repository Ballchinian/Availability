import { describe, it, expect } from 'vitest';
import { planRole } from '../../src/api/roles.js';
import { hostIdsOf } from '../../src/lib/hosts.js';

//Who runs a plan and who is only on it, including plans saved before there was a list of hosts
const plan = (over = {}) => ({ createdBy: 'ali', participants: [{ userId: 'bo' }, { userId: 'sam' }], ...over });

describe('who runs a plan', () => {
    it('is whoever made it on a plan from before hosts', () => {
        expect(hostIdsOf(plan())).toEqual(['ali']);
    });

    it('is the list once the plan has one, whoever made it', () => {
        expect(hostIdsOf(plan({ hostIds: ['sam', 'jo'] }))).toEqual(['sam', 'jo']);
    });

    //Everyone who ran it has left, which is not the same as never having had a list
    it('is nobody on a plan whose list has emptied', () => {
        expect(hostIdsOf(plan({ hostIds: [] }))).toEqual([]);
    });
});

describe('where someone stands on a plan', () => {
    it('is host for whoever runs it, on the guest list or not', () => {
        expect(planRole(plan(), 'ali')).toBe('host');
        expect(planRole(plan({ hostIds: ['ali', 'sam'] }), 'sam')).toBe('host');
    });

    it('is guest for someone only on the list', () => {
        expect(planRole(plan(), 'bo')).toBe('guest');
    });

    it('is nothing for anyone else', () => {
        expect(planRole(plan(), 'cass')).toBe(null);
    });

    it('no longer counts whoever made it once they are off the list', () => {
        expect(planRole(plan({ hostIds: ['sam'] }), 'ali')).toBe(null);
    });
});
