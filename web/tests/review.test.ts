import { describe, it, expect } from 'vitest';
import { boldParts, discordBlocks, quietLine, reviewLine, saveLabel, someNames } from '../src/plan-form/review.js';
import type { EditPreview } from '../src/site/types.js';

const none = { settled: 0, asked: 0 };

const preview = (over: Partial<EditPreview> = {}): EditPreview => ({
    changes: [],
    settled: 0,
    asked: 0,
    messages: [],
    quietly: [],
    ...over
});

describe('reviewLine', () => {
    it('keeps the old name beside the new one', () => {
        expect(reviewLine({ type: 'name', from: 'Pub quiz', to: 'Quiz night' }, none)).toBe('Name: Quiz night, was Pub quiz');
    });

    it('says what a plan now finding a day asks about, and how many have answered it already', () => {
        const change = { type: 'collect', start: '2026-10-01', end: '2026-10-14', allowedWeekdays: null } as const;
        expect(reviewLine(change, { settled: 4, asked: 2 })).toBe('Now finding a day, Thu 1 Oct 2026 to Wed 14 Oct 2026: 4 already answered, 2 will be asked');
    });

    it('leaves out a count of nobody', () => {
        const change = { type: 'set', date: '2026-10-10', time: '19:00' } as const;
        expect(reviewLine(change, { settled: 0, asked: 6 })).toBe('Set for Sat 10 Oct 2026 at 7pm: 6 will be asked');
    });

    it('says where a day moved from', () => {
        expect(reviewLine({ type: 'day', from: '2026-10-10', date: '2026-10-17', time: null }, none)).toBe('Moved to Sat 17 Oct 2026, from Sat 10 Oct 2026');
    });

    it('reads a time put on, moved and taken off', () => {
        expect(reviewLine({ type: 'time', from: null, to: '19:00' }, none)).toBe('Starts at 7pm');
        expect(reviewLine({ type: 'time', from: '19:00', to: '20:30' }, none)).toBe('Starts at 8:30pm, was 7pm');
        expect(reviewLine({ type: 'time', from: '19:00', to: null }, none)).toBe('No set time, was 7pm');
    });

    it('names who comes on, who goes off, and who runs it', () => {
        expect(reviewLine({ type: 'added', names: ['Sam', 'Jo'] }, none)).toBe('Adding Sam and Jo');
        expect(reviewLine({ type: 'removed', names: ['Bo'] }, none)).toBe('Taking Bo off');
        expect(reviewLine({ type: 'hosts', added: ['Ann'], removed: ['Cy'] }, none)).toBe('Ann running it too, Cy not running it any more');
    });
});

describe('saveLabel', () => {
    it('is named for the biggest thing the save does', () => {
        expect(saveLabel([{ type: 'name', from: 'a', to: 'b' }, { type: 'day', from: '2026-10-10', date: '2026-10-17', time: null }])).toBe(
            'Save and move it to Sat 17 Oct'
        );
        expect(saveLabel([{ type: 'set', date: '2026-10-10', time: null }])).toBe('Save and set it for Sat 10 Oct');
        expect(saveLabel([{ type: 'collect', start: '2026-10-01', end: '2026-10-14', allowedWeekdays: null }])).toBe('Save and ask about dates again');
        expect(saveLabel([{ type: 'window', start: '2026-10-01', end: '2026-10-21', allowedWeekdays: null }])).toBe('Save and ask about these dates');
        expect(saveLabel([{ type: 'removed', names: ['Bo'] }])).toBe('Save changes');
    });
});

describe('quietLine', () => {
    it('counts who a quiet save leaves out, and names who it still DMs with why', () => {
        const p = preview({
            messages: [
                { kind: 'post', to: 'thread', text: '' },
                { kind: 'card', to: ['Bo', 'Cy', 'Di', 'Ed', 'Fi'], text: '' }
            ],
            quietly: [
                { name: 'Bo', why: 'days' },
                { name: 'Cy', why: 'days' }
            ]
        });
        expect(quietLine(p)).toBe("Nothing goes in the thread, and 3 people aren't DMed. Bo and Cy are still DMed, since they now have days to fill in.");
    });

    it('says the invitation and the note to whoever runs it go either way', () => {
        const p = preview({
            messages: [
                { kind: 'invite', to: ['Sam'], text: '' },
                { kind: 'picked', to: ['Ann'], text: 'Ali picked you' }
            ]
        });
        expect(quietLine(p)).toBe('Nothing goes in the thread. Sam still gets the invitation. Ann is still told they run it.');
    });
});

describe('someNames', () => {
    it('lists a few names and counts the rest', () => {
        expect(someNames(['Ann', 'Bo', 'Cy', 'Di'])).toBe('Ann, Bo, Cy and Di');
        expect(someNames(['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fi'])).toBe('Ann, Bo, Cy and 3 others');
    });
});

describe('boldParts', () => {
    it('picks out the bold the bot writes', () => {
        expect(boldParts('Ali changed **Pub quiz**:')).toEqual([
            { text: 'Ali changed ', bold: false },
            { text: 'Pub quiz', bold: true },
            { text: ':', bold: false }
        ]);
        expect(boldParts('**CHANGED**')).toEqual([{ text: 'CHANGED', bold: true }]);
    });
});

describe('discordBlocks', () => {
    it('draws a run of lines starting with a dash as one list, the way Discord does', () => {
        expect(discordBlocks('**CHANGED**\n\nAli changed **Pub quiz**:\n- now called **Quiz night**\n- it starts at 8pm now')).toEqual([
            { line: [{ text: 'CHANGED', bold: true }] },
            { line: [{ text: 'Ali changed ', bold: false }, { text: 'Pub quiz', bold: true }, { text: ':', bold: false }] },
            {
                list: [
                    [{ text: 'now called ', bold: false }, { text: 'Quiz night', bold: true }],
                    [{ text: 'it starts at 8pm now', bold: false }]
                ]
            }
        ]);
    });
});
