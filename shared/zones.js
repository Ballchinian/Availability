/*
    Everything this project knows about clocks. Beside dates.js and for the same
    reason: the bot turns a set time into a stamp Discord redraws for each reader,
    the site turns one person's evening into the server's clock, and two sides
    disagreeing by an hour is the kind of bug nobody ever tracks down.

    Plain ESM .js with no imports, like dates.js, so node reads it straight out of
    the backend and vite bundles it into the site. zones.d.ts next door is what the
    typescript side reads, so a signature changed here changes there too.

    All of it runs on Intl, which carries a full zone database on both hosts. No
    list of zones is written down anywhere: a zone is whatever the platform takes.

    Availability is stored the way the person wrote it, their own date and their own
    hours, and converted at the moment two people are compared. So nothing here is
    ever needed to read a row back to the person who wrote it, only to line theirs up
    against someone else's.
*/

//The clock anything unset falls back to. The backend overrides it from DEFAULT_TIME_ZONE.
export const FALLBACK_ZONE = 'UTC';

export function isValidZone(zone) {
    if (typeof zone !== 'string' || !zone) return false;
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

//Falls back rather than throwing, since a zone reaches here off a stored document
export function safeZone(zone, fallback = FALLBACK_ZONE) {
    return isValidZone(zone) ? zone : fallback;
}

/*
    Building one of these costs far more than using it, and a compare walks the same
    handful of zones a few thousand times, so they are made once and kept.
*/
const formatters = new Map();
function formatterFor(zone) {
    let f = formatters.get(zone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-GB', {
            timeZone: zone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        formatters.set(zone, f);
    }
    return f;
}

//What a clock reads at an instant
export function instantToWall(zone, instant) {
    const parts = {};
    for (const p of formatterFor(zone).formatToParts(instant)) parts[p.type] = p.value;
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        //h23 should never hand back 24, but a runtime that does would push the date a day out
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute)
    };
}

//How far ahead of UTC a clock runs at an instant, in milliseconds
function offsetAt(zone, instant) {
    const w = instantToWall(zone, instant);
    const [y, m, d] = w.date.split('-').map(Number);
    //Seconds are not in the reading, so they come off the other side of the subtraction too
    return Date.UTC(y, m - 1, d, w.hour, w.minute) - Math.floor(instant.getTime() / 60000) * 60000;
}

/*
    The instant a clock reading points at. Two passes: the first offset is the one in
    force around the answer rather than at the answer, the second corrects it, which is
    what gets the hours either side of a clock change right.

    A reading the clocks skipped has no instant of its own and lands on the one they
    jumped to. A reading that happened twice lands on one of the two, whichever the
    first pass points at. Neither case is worth a choice: they are an hour wide and
    come round once a year.
*/
export function wallToInstant(zone, date, hour = 0, minute = 0) {
    const [y, m, d] = date.split('-').map(Number);
    const target = Date.UTC(y, m - 1, d, hour, minute);
    let guess = target;
    for (let pass = 0; pass < 2; pass++) guess = target - offsetAt(zone, new Date(guess));
    return new Date(guess);
}

//Whether two clocks read the same at a moment, which is what decides if a note is worth showing
export function clocksAgree(a, b, instant = new Date()) {
    return offsetAt(a, instant) === offsetAt(b, instant);
}

//What the clock there is called right now, like "GMT+1", for putting beside the zone name
export function zoneOffsetLabel(zone, instant = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(instant);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
}

//An hour of a day as one number, so two readings can be compared and subtracted
function hourIndex(date, hour) {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 3600000 + hour;
}

function fromHourIndex(index) {
    const iso = new Date(index * 3600000).toISOString();
    return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
}

/*
    How many whole hours the other clock reads ahead of this one at a given reading.
    Always whole, even out of a half hour zone: 8pm in London is half past one in
    Kolkata, which reads as the one o'clock hour, so a window there starts up to half
    an hour early and ends half an hour early too. Everything in this project is whole
    hours, so a half hour zone has to land on one side of the line or the other.
*/
function shiftAt(fromZone, toZone, date, hour) {
    const there = instantToWall(toZone, wallToInstant(fromZone, date, hour));
    return hourIndex(there.date, there.hour) - hourIndex(date, hour);
}

const WHOLE_DAY = Array.from({ length: 24 }, (_, h) => h);

/*
    One person's free day as another clock reads it. Their day is theirs, so it lands on
    one or two days over there and usually not lined up: someone an hour ahead is free
    from 11pm the night before as far as the server is concerned.

    An empty hours means free the whole of their day. That only survives as an empty
    hours when the two clocks agree for that day, since anywhere else the far side is
    looking at a different 24 hours and has to be told which.

    Returns one entry per day touched, in date order, hours sorted. A day the clocks
    change on quietly loses an hour or gains a duplicate at the fold, which is once a
    year and an hour wide.
*/
export function retimeDay(fromZone, toZone, date, hours = []) {
    const narrowed = Boolean(hours && hours.length);
    const wanted = narrowed ? [...hours].sort((a, b) => a - b) : WHOLE_DAY;

    const first = shiftAt(fromZone, toZone, date, 0);
    const last = shiftAt(fromZone, toZone, date, 23);
    //The same shift at both ends means no clock moved inside the day, so one subtraction does all of it
    const steady = first === last;

    if (steady && first === 0) return [{ date, hours: narrowed ? wanted : [] }];

    const byDate = new Map();
    for (const h of wanted) {
        const shift = steady ? first : shiftAt(fromZone, toZone, date, h);
        const { date: d, hour } = fromHourIndex(hourIndex(date, h) + shift);
        if (!byDate.has(d)) byDate.set(d, new Set());
        byDate.get(d).add(hour);
    }

    return [...byDate.keys()]
        .sort()
        .map((d) => ({ date: d, hours: [...byDate.get(d)].sort((a, b) => a - b) }));
}

/*
    The moment a plan actually happens, from the day and time as the server's clock
    reads them. Null when no time is set, which is a whole day rather than a moment.
    The calendar file and the Discord stamp both come off this, so they cannot drift.
*/
export function planInstant(zone, date, time) {
    if (!date || !time || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [h, m] = time.split(':').map(Number);
    return wallToInstant(zone, date, h, m);
}
