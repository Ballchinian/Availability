import { describe, it, expect } from 'vitest';
import { selectionKey } from '../../src/lib/unsaved.js';

describe('selectionKey', () => {
    it('reads the same however the days were painted in', () => {
        expect(selectionKey({ '2026-08-02': [], '2026-08-01': [8, 9] })).toBe(
            selectionKey({ '2026-08-01': [9, 8], '2026-08-02': [] })
        );
    });

    it('moves when a day is added, dropped or narrowed to hours', () => {
        const one = selectionKey({ '2026-08-01': [] });
        expect(selectionKey({})).not.toBe(one);
        expect(selectionKey({ '2026-08-01': [], '2026-08-02': [] })).not.toBe(one);
        expect(selectionKey({ '2026-08-01': [20, 21] })).not.toBe(one);
    });
});
