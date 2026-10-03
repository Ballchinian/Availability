import { describe, it, expect } from 'vitest';
import { formatLong, describeWeekdays } from '../src/site/format.js';

/*
    formatDate, formatTime and the rest of describeWeekdays come from shared/dates.js,
    which backend/tests/lib/dates.test.js covers. Only what reads differently here is left.
*/

describe('formatLong', () => {
    it('says the date out loud without a leading zero', () => {
        expect(formatLong('2026-08-05')).toBe('Wednesday 5 August 2026');
        expect(formatLong('2026-12-25')).toBe('Friday 25 December 2026');
    });

    it('is blank when there is no date', () => {
        expect(formatLong('')).toBe('');
    });
});

describe('describeWeekdays', () => {
    /*
        The bot's copy in backend/src/lib/dates.js says "every day" here on purpose,
        because it writes into a sentence rather than a chip. Merging the two has to
        keep both wordings.
    */
    it('is blank when there is no real restriction', () => {
        expect(describeWeekdays(null)).toBe('');
        expect(describeWeekdays([])).toBe('');
        expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('');
    });
});
