import { safeZone as safe } from '../../../shared/zones.js';
import { config } from '../config.js';

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

//What Discord renders in the reader's own clock, so a DM never has to say whose 8pm it is
export function discordStamp(instant, style = 'F') {
    return `<t:${Math.floor(instant.getTime() / 1000)}:${style}>`;
}
