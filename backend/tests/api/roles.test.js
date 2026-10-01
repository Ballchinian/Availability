import { describe, it, expect } from 'vitest';
import { planRole, canTakeOn } from '../../src/api/roles.js';
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

/*
    Take it on. here is whoever runs the plan and is still in the server, which is what
    decides it for a planner. Manage Server is the way in on a plan being misused, so it
    waits on nobody.
*/
describe('taking a plan on', () => {
    const member = { isMember: true, isPlanner: false, canManage: false };
    const planner = { ...member, isPlanner: true };
    const admin = { ...member, canManage: true };

    it('is open to a planner once nobody who runs it is left in the server', () => {
        expect(canTakeOn(plan(), 'cass', planner, [])).toBe(true);
    });

    it('is not while one of them is still here', () => {
        expect(canTakeOn(plan({ hostIds: ['ali', 'sam'] }), 'cass', planner, ['sam'])).toBe(false);
    });

    //The list still names them, and Discord says they have gone
    it('goes by who is in the server, not by who is on the list', () => {
        expect(canTakeOn(plan({ hostIds: ['ali'] }), 'bo', planner, [])).toBe(true);
    });

    it('takes the planner role when nobody is left', () => {
        expect(canTakeOn(plan(), 'bo', member, [])).toBe(false);
    });

    it('is always open to someone who can manage the server', () => {
        expect(canTakeOn(plan(), 'cass', admin, ['ali'])).toBe(true);
        expect(canTakeOn(plan(), 'cass', admin, [])).toBe(true);
    });

    it('is not offered to someone who already runs it', () => {
        expect(canTakeOn(plan(), 'ali', admin, ['ali'])).toBe(false);
    });

    it('is not offered to someone outside the server', () => {
        expect(canTakeOn(plan(), 'cass', { isMember: false, isPlanner: false, canManage: false }, [])).toBe(false);
    });
});
