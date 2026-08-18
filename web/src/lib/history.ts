import { formatDate, formatTime, describeWeekdays, describeRepeat } from './format.js';
import { isoOf } from './calendar.js';
import type { PlanEvent } from './types.js';

/*
    A plan's history as sentences. Nothing here reads the plan itself: every line is
    built from what the event recorded at the time, so a plan whose name or range has
    since moved on still describes what actually happened.

    The wording deliberately echoes the DM that went out for the same event, since a
    planner reading this list is usually working out what everyone else was told.
*/

//The day and time of a set date, the half two of these lines share
function whenOf(date: string, time: string | null): string {
    return formatDate(date) + (time ? ` at ${formatTime(time)}` : '');
}

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/*
    Whether a name belongs in front of this line. Everything on a plan is done by
    somebody except coming round again, which the repeat sweep does on a timer with no
    one asking, so that line is written as a sentence of its own instead.
*/
export function hasActor(event: PlanEvent): boolean {
    return event.type !== 'repeated';
}

/*
    Three of these, voided, range and weekdays, are events nothing writes any more: the
    routes that recorded them are gone, the dates screen having taken all three over.
    They are read, not written, so they stay: a plan those were used on still has them
    stored, and dropping the case here would leave that line blank in its history.
*/
export function describeEvent(event: PlanEvent): string {
    switch (event.type) {
        case 'created':
            return 'started the plan';
        case 'chosen':
            return `set the day to ${whenOf(event.date, event.time)}${event.probe ? ', and asked everyone to confirm' : ''}`;
        case 'moved':
            return `moved the day from ${formatDate(event.from)} to ${whenOf(event.date, event.time)}${
                event.probe ? ', and asked everyone to confirm' : ''
            }`;
        case 'voided':
            return `called off ${formatDate(event.from)}${event.reason ? `, because ${event.reason}` : ''}`;
        case 'range':
            return `changed the dates to ${formatDate(event.start)} to ${formatDate(event.end)}`;
        //One line for what the panels above would have written three of, since it was one press
        case 'dates':
            return (
                `went back out for dates, ${formatDate(event.start)} to ${formatDate(event.end)}` +
                `${describeWeekdays(event.allowedWeekdays) ? `, ${describeWeekdays(event.allowedWeekdays)} only` : ''}` +
                `${event.added ? `, and added ${plural(event.added, 'person', 'people')}` : ''}`
            );
        //describeWeekdays says nothing at all for no restriction, which needs words here
        case 'weekdays':
            return `changed the days asked about to ${describeWeekdays(event.allowedWeekdays) || 'every day'}`;
        case 'details':
            return event.renamed ? 'edited the title and description' : 'edited the description';
        case 'when':
            return `updated the time or note${event.time ? `, now ${formatTime(event.time)}` : ''}${event.quiet ? ', quietly' : ''}`;
        case 'confirmations':
            return event.active ? 'asked everyone to confirm they are coming' : 'closed the confirmations';
        case 'added':
            return `added ${plural(event.count, 'person', 'people')}`;
        case 'left':
            return 'dropped out';
        case 'rejoined':
            return 'came back to the plan';
        case 'reminded':
            return event.kind === 'vote'
                ? `nudged ${plural(event.count, 'person', 'people')} who had not answered`
                : `nudged ${plural(event.count, 'person', 'people')} for their dates`;
        case 'repeat':
            return event.repeatWeeks ? `set this to come round ${describeRepeat(event.repeatWeeks)}` : 'stopped this coming round again';
        //Reads as a whole sentence because hasActor keeps a name from being put in front of it
        case 'repeated':
            return 'This one came round again as a new plan';
        case 'cancelled':
            return 'cancelled the plan';
    }
}

/*
    How long ago, kept coarse on purpose. A history is read to work out the order things
    happened in, not the minute, and "3 days ago" beats a timestamp nobody converts in
    their head. The exact time goes in the title attribute for anyone who does want it.
*/
export function timeAgo(iso: string, now: Date = new Date()): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';

    const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
    if (seconds < 60) return 'just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${plural(minutes, 'minute', 'minutes')} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${plural(hours, 'hour', 'hours')} ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${plural(days, 'day', 'days')} ago`;

    //Past a week the date itself is easier to place than a count of weeks. Read back in
    //local time, since the stored stamp is UTC and slicing it would slip a day either side
    //of midnight.
    return `on ${formatDate(isoOf(new Date(then)))}`;
}
