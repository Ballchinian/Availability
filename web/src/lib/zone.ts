import { api } from './api.js';

/*
    Which clock this person is on, and how to say when someone else is on another.

    Availability is stored the way it was written, their date and their hours, so this
    is what the backend lines two people up with. It is taken from the device rather
    than asked for: a browser already knows, a setting nobody can find would be wrong
    half the time, and this way it follows someone who fills a week in from abroad.

    The maths lives in shared/zones.js, the same copy the backend and the bot read, so
    the page and the DM cannot disagree about whose evening a plan lands on.
*/

import { zoneOffsetLabel } from '../../../shared/zones.js';

export { clocksAgree } from '../../../shared/zones.js';

//What the device says, or nothing at all from a runtime too old to know
export function browserZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
}

/*
    Only when it has actually moved, remembered on the device rather than for the tab:
    this sits in front of every screen, so a write per visit would be a round trip
    everybody waits on to learn something that changes when somebody gets on a plane.
    First run on a device pays it once.

    Awaited, unlike most things nobody is looking at, because the screen behind it draws
    hours that were read on this: going first costs a request and going second would
    show the old zone's answer for a moment.
*/
const SYNCED = 'zone-synced';

export async function syncZone(): Promise<void> {
    const zone = browserZone();
    if (!zone) return;
    try {
        if (localStorage.getItem(SYNCED) === zone) return;
        localStorage.setItem(SYNCED, zone);
    } catch {
        //Storage turned off, so it goes every visit instead of once
    }
    //A page that carries on is better than one that will not load because a preference did not save
    await api('/me/timezone', { method: 'PUT', body: JSON.stringify({ timeZone: zone }) }).catch(() => {});
}

//"Europe/London (GMT+1)", the form the pages name a clock in
export function describeZone(zone: string): string {
    if (!zone) return '';
    const offset = zoneOffsetLabel(zone);
    return offset ? `${zone} (${offset})` : zone;
}
