import { describe, it, expect } from 'vitest';
import { buildIcs, eventTimes, fold, googleCalendarUrl, icsFileName } from '../../src/lib/ics.js';

/*
    August, so the plan's own clock is an hour off UTC and every timed assertion below
    would still pass if the conversion were dropped in January.
*/
const timed = { planId: 'ab12cd34ef', name: 'Board games', description: 'Bring snacks', chosenDate: '2026-08-12', chosenTime: '19:00', chosenNote: null, timeZone: 'Europe/London' };
const allDay = { planId: 'ab12cd34ef', name: 'Camping', description: '', chosenDate: '2026-08-12', chosenTime: null, chosenNote: null, timeZone: 'Europe/London' };

//Pull one property's value out of a built file, unfolding it first
function valueOf(ics, name) {
    const line = ics.replace(/\r\n /g, '').split('\r\n').find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
    return line ? line.slice(line.indexOf(':') + 1) : null;
}

describe('eventTimes', () => {
    it('runs a timed plan the default two hours, as a real moment', () => {
        expect(eventTimes(timed)).toEqual({ allDay: false, start: '20260812T180000Z', end: '20260812T200000Z' });
    });

    it('reads the hour off the plan\'s own clock, not the machine\'s', () => {
        expect(eventTimes({ ...timed, timeZone: 'Asia/Tokyo' }).start).toBe('20260812T100000Z');
        expect(eventTimes({ ...timed, timeZone: 'America/New_York' }).start).toBe('20260812T230000Z');
    });

    //The same reading in the same place, six months apart, is an hour further from UTC
    it('follows the clock changing under a zone', () => {
        expect(eventTimes({ ...timed, chosenDate: '2026-01-12' }).start).toBe('20260112T190000Z');
        expect(eventTimes(timed).start).toBe('20260812T180000Z');
    });

    it('rolls a late start over into the next day', () => {
        const late = { ...timed, chosenTime: '23:30' };
        expect(eventTimes(late)).toEqual({ allDay: false, start: '20260812T223000Z', end: '20260813T003000Z' });
    });

    //Nothing said what clock it meant, so it falls back rather than writing a wrong moment confidently
    it('still writes a moment for a plan saved before zones existed', () => {
        expect(eventTimes({ ...timed, timeZone: undefined }).start).toMatch(/^20260812T\d{6}Z$/);
    });

    it('ends an all-day plan on the day after, since that end is exclusive', () => {
        expect(eventTimes(allDay)).toEqual({ allDay: true, start: '20260812', end: '20260813' });
    });

    //A date is a date in any zone, so a whole day plan never picks one up
    it('leaves an all-day plan free of any clock', () => {
        expect(eventTimes({ ...allDay, timeZone: 'Pacific/Kiritimati' })).toEqual(eventTimes(allDay));
    });

    it('rolls an all-day plan over a month end', () => {
        expect(eventTimes({ ...allDay, chosenDate: '2026-08-31' }).end).toBe('20260901');
    });

    it('rolls an all-day plan over a leap day', () => {
        expect(eventTimes({ ...allDay, chosenDate: '2028-02-28' }).end).toBe('20280229');
    });
});

describe('fold', () => {
    it('leaves a short line alone', () => {
        expect(fold('SUMMARY:Board games')).toBe('SUMMARY:Board games');
    });

    it('breaks a long line onto continuations of at most 75 octets', () => {
        const folded = fold(`SUMMARY:${'a'.repeat(200)}`);
        for (const line of folded.split('\r\n')) {
            expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
        }
        expect(folded.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
    });

    it('rebuilds exactly when the continuations are stitched back together', () => {
        const line = `SUMMARY:${'a'.repeat(200)}`;
        expect(fold(line).replace(/\r\n /g, '')).toBe(line);
    });

    /*
        The reason folding counts octets rather than characters. An emoji is one
        character and four of the budget, and a calendar refuses a file that splits one
        down the middle.
    */
    it('never cuts a multi byte character in half', () => {
        const line = `SUMMARY:${'🎲'.repeat(40)}`;
        const folded = fold(line);
        expect(folded).not.toContain('�');
        expect(folded.replace(/\r\n /g, '')).toBe(line);
    });
});

describe('buildIcs', () => {
    it('writes CRLF line endings and closes the calendar', () => {
        const ics = buildIcs(timed);
        expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
        expect(ics).not.toMatch(/[^\r]\n/);
    });

    /*
        UTC rather than a TZID, which would need a VTIMEZONE block spelling out the zone's
        rules and which a calendar can refuse without one.
    */
    it('writes a timed start as a moment, with no zone named', () => {
        const ics = buildIcs(timed);
        expect(ics).toContain('DTSTART:20260812T180000Z\r\n');
        expect(ics).toContain('DTEND:20260812T200000Z\r\n');
        expect(ics).not.toContain('TZID');
    });

    it('marks an all-day plan as a date rather than a time', () => {
        const ics = buildIcs(allDay);
        expect(ics).toContain('DTSTART;VALUE=DATE:20260812\r\n');
        expect(ics).toContain('DTEND;VALUE=DATE:20260813\r\n');
    });

    it('stamps when the file was written, which is not the event\'s own clock', () => {
        const ics = buildIcs(timed, { now: new Date('2026-08-05T18:50:31.123Z') });
        expect(ics).toContain('DTSTAMP:20260805T185031Z\r\n');
    });

    it('escapes the characters the format gives meaning to', () => {
        const awkward = { ...timed, name: 'Drinks, games; and a \\ chat' };
        expect(valueOf(buildIcs(awkward), 'SUMMARY')).toBe('Drinks\\, games\\; and a \\\\ chat');
    });

    it('folds a description into one value that unfolds back to itself', () => {
        const wordy = { ...timed, description: 'x'.repeat(300) };
        expect(valueOf(buildIcs(wordy), 'DESCRIPTION')).toBe('x'.repeat(300));
    });

    it('gathers the description, note, server and link into the one description', () => {
        const full = { ...timed, chosenNote: 'my place' };
        const value = valueOf(buildIcs(full, { guildName: 'The Group', url: 'https://x/#/plan/ab12cd34ef' }), 'DESCRIPTION');
        expect(value).toBe('Bring snacks\\n\\nmy place\\n\\nPlanned in The Group\\n\\nhttps://x/#/plan/ab12cd34ef');
    });

    it('leaves the description out entirely when a plan says nothing about itself', () => {
        expect(valueOf(buildIcs(allDay), 'DESCRIPTION')).toBe(null);
    });
});

describe('googleCalendarUrl', () => {
    it('prefills the name and the span', () => {
        const url = new URL(googleCalendarUrl(timed));
        expect(url.searchParams.get('action')).toBe('TEMPLATE');
        expect(url.searchParams.get('text')).toBe('Board games');
        expect(url.searchParams.get('dates')).toBe('20260812T180000Z/20260812T200000Z');
    });

    //The link and the file are built off one eventTimes, so they cannot say different things
    it('spans exactly what the file does', () => {
        const { start, end } = eventTimes(timed);
        expect(new URL(googleCalendarUrl(timed)).searchParams.get('dates')).toBe(`${start}/${end}`);
    });

    it('spans the whole day when no time was set', () => {
        expect(new URL(googleCalendarUrl(allDay)).searchParams.get('dates')).toBe('20260812/20260813');
    });
});

describe('icsFileName', () => {
    it('names the file after the plan', () => {
        expect(icsFileName(timed)).toBe('board-games.ics');
    });

    it('collapses punctuation rather than passing it to a filesystem', () => {
        expect(icsFileName({ name: 'Drinks / games: round 2!' })).toBe('drinks-games-round-2.ics');
    });

    //A name can be all emoji, which strips to nothing at all
    it('falls back when the name leaves nothing behind', () => {
        expect(icsFileName({ name: '🎲🎲' })).toBe('plan.ics');
        expect(icsFileName({})).toBe('plan.ics');
    });
});
