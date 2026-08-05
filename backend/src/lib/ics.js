import { shiftDate } from './dates.js';
import { safeZone, planInstant } from './zones.js';

/*
    The calendar file for a plan whose date is locked in, so a date lands in someone's
    calendar instead of being copied across by hand. RFC 5545, which is fussy in three
    ways worth knowing: lines end CRLF, a content line over 75 octets has to be folded
    onto a continuation starting with a space, and text values escape backslash,
    semicolon, comma and newline.

    Times go out in UTC, with the trailing Z, worked out from the plan's own clock. Not
    TZID, which would be the more literal way to say "8pm in London": a TZID has to come
    with a VTIMEZONE block spelling out that zone's daylight saving rules, and a file
    that names a zone without defining it is one calendars are within their rights to
    refuse. A moment in UTC needs nothing to explain it and lands at 8pm all the same.

    A whole day event stays a plain date with no zone at all, which is what a date is.

    The Google link lives here too rather than in bot/util.js with the other links,
    since it needs the same start and end as the file and the two must not drift.
*/

//No end time is ever stored, only the day and an optional start, so an event gets a length
const DEFAULT_EVENT_HOURS = 2;

//The four characters RFC 5545 gives meaning to inside a text value
function escapeText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/*
    Fold one content line to 75 octets, continuing with a leading space. Measured in
    octets, not characters: a plan name is free text, so an emoji in it counts as one
    character while taking four of the budget.
*/
export function fold(line) {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;

    const parts = [];
    let at = 0;
    while (at < bytes.length) {
        //Continuations only get 74, since the space that marks them counts toward the 75
        const take = parts.length === 0 ? 75 : 74;
        let end = Math.min(at + take, bytes.length);
        //Never cut a multi byte character down the middle
        while (end > at && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        parts.push(bytes.subarray(at, end).toString('utf8'));
        at = end;
    }
    return parts.join('\r\n ');
}

//YYYY-MM-DD to the 20260812 a calendar wants
function compact(date) {
    return date.replace(/-/g, '');
}

//An instant as the 20260812T190000Z a calendar wants
function utcStamp(instant) {
    return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

/*
    Where the event starts and ends, in the form both the file and the Google link use.
    A plan with no time is a whole day, which ends on the day after since that end is
    exclusive, and stays a bare date because a date has no clock to be read on.

    A plan with a time is a real moment, read off the plan's own zone. Everything past
    that point is arithmetic on milliseconds, so the two hours a plan gets cross
    midnight, month ends and a clock change without any of them being a special case.
*/
export function eventTimes(plan) {
    if (!plan.chosenTime) {
        return { allDay: true, start: compact(plan.chosenDate), end: compact(shiftDate(plan.chosenDate, 1)) };
    }

    const start = planInstant(safeZone(plan.timeZone), plan.chosenDate, plan.chosenTime);
    const end = new Date(start.getTime() + DEFAULT_EVENT_HOURS * 3600000);
    return { allDay: false, start: utcStamp(start), end: utcStamp(end) };
}

/*
    What a calendar shows under the event: whatever the plan says about itself, then the
    way back to it. Shared by the file and the Google link so both carry the same thing.
*/
function details(plan, { guildName = '', url = '' } = {}) {
    return [plan.description, plan.chosenNote, guildName ? `Planned in ${guildName}` : '', url].filter(Boolean).join('\n\n');
}

export function buildIcs(plan, { guildName = '', url = '', now = new Date() } = {}) {
    const { allDay, start, end } = eventTimes(plan);
    const body = details(plan, { guildName, url });

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Availability//Plan bot//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${plan.planId}@availability`,
        //When the file was written, which is always a moment and never the event's own clock
        `DTSTAMP:${utcStamp(now)}`,
        allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
        allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
        `SUMMARY:${escapeText(plan.name)}`,
        ...(body ? [`DESCRIPTION:${escapeText(body)}`] : []),
        'END:VEVENT',
        'END:VCALENDAR'
    ];

    return lines.map(fold).join('\r\n') + '\r\n';
}

/*
    A prefilled Google Calendar entry, which is the one that needs no login at all, so it
    is what a DM can offer someone who has not signed in to the site. Deliberately without
    the description: everything in it is already in the message carrying this link, and
    a url long enough to wrap twice in a DM is worse than a tidy one.
*/
export function googleCalendarUrl(plan) {
    const { start, end } = eventTimes(plan);
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: plan.name,
        dates: `${start}/${end}`
    });
    return `https://calendar.google.com/calendar/render?${params}`;
}

/*
    What the download is called once it is on someone's machine. The plan's own name where
    it survives being stripped to something a filesystem will take, and a plain fallback
    where it does not, since a name can be all emoji.
*/
export function icsFileName(plan) {
    const slug = String(plan.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
    return `${slug || 'plan'}.ics`;
}
