import { safeZone as safe, instantToWall } from '../../../shared/zones.js';
import { config } from '../config.js';
import { LAPSE_DAYS, shiftDate } from './dates.js';

/*
    The clock helpers, passed straight back out of shared/zones.js so every import
    inside backend/ comes from one file, the same arrangement dates.js has.

    What is added here is the fallback: shared/ cannot read the environment, so it
    falls back to UTC, and this end knows better.
*/

export {
    isValidZone,
    instantToWall,
    wallToInstant,
    clocksAgree,
    zoneOffsetLabel,
    retimeDay,
    planInstant
} from '../../../shared/zones.js';

//A stored zone, or the deployment's, for a document written before anyone was asked
export function safeZone(zone) {
    return safe(zone, config.defaultTimeZone);
}

//Today on a server's clock, up to a day off the machine's own for a server across the world
export function todayIn(zone) {
    return instantToWall(safeZone(zone), new Date()).date;
}

//A set plan's day has been and gone where the plan is. A plan with no day has none to pass.
export function dayHasPassed(plan) {
    return Boolean(plan.chosenDate) && todayIn(plan.timeZone) > plan.chosenDate;
}

//Still finding its day more than LAPSE_DAYS after the last one it asked about, where the plan is
export function hasLapsed(plan) {
    return plan.status === 'collecting' && plan.dateRange.end < shiftDate(todayIn(plan.timeZone), -LAPSE_DAYS);
}

//What Discord renders in the reader's own clock, so a DM never has to say whose 8pm it is
export function discordStamp(instant, style = 'F') {
    return `<t:${Math.floor(instant.getTime() / 1000)}:${style}>`;
}
