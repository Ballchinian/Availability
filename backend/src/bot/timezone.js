import { MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { getGuildConfig, saveGuildConfig } from '../db/guilds.js';
import { setGuildPlansTimeZone } from '../db/plans.js';
import { safeZone, isValidZone, zoneOffsetLabel } from '../lib/zones.js';
import { announceToServer } from './util.js';

/*
    The server's clock: what "Wednesday" and "8pm" mean for everyone here. Set at
    /setup and changed with /timezone, and read by the compare grid, the calendar
    file and every stamp the bot posts.

    People are not asked for their own clock anywhere: the site takes that from the
    browser, which already knows. This is only the shared one, which no device can
    guess because it is not about any one person.
*/

/*
    Every zone the runtime knows, which is the IANA list, so nothing is written down
    here to go stale. Built once: it is several hundred entries and the filtering
    below runs on every keystroke someone types into the option.
*/
const ALL_ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

//Discord takes 25 suggestions at most, and silently drops the rest if you send more
const MAX_CHOICES = 25;

/*
    What an empty box gets. The list is alphabetical and Africa alone runs well past
    the 25 Discord shows, so the head of it was 25 African cities and the option looked
    like it knew nowhere else. Nobody has typed yet, so the useful answer is the clock
    this deployment already runs on, then a walk across the regions, the ones carrying
    the most zones first, since that is where most people are.
*/
function openingZones() {
    const byRegion = new Map();
    for (const zone of ALL_ZONES) {
        const region = zone.split('/')[0];
        if (!byRegion.has(region)) byRegion.set(region, []);
        byRegion.get(region).push(zone);
    }

    const regions = [...byRegion.values()].sort((a, b) => b.length - a.length);
    //Seeded rather than pushed, so a runtime carrying no zone list still offers the one clock it knows
    const picked = new Set([config.defaultTimeZone]);

    //One from every region, then a second from every region, until Discord's 25 are full
    for (let depth = 0; picked.size < MAX_CHOICES; depth++) {
        let reached = false;
        for (const zones of regions) {
            if (depth >= zones.length) continue;
            reached = true;
            picked.add(zones[depth]);
            if (picked.size >= MAX_CHOICES) break;
        }
        if (!reached) break;
    }
    return [...picked];
}

//Built once like the list itself, since the answer never changes
const OPENING_ZONES = openingZones();

/*
    The suggestion list as they type. Matching on the whole name means "lond" finds
    Europe/London and "new_y" finds America/New_York, and a starts-with match sorts
    first so a typed continent lands where you expect.
*/
export function suggestZones(typed) {
    const q = String(typed || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!q) return [...OPENING_ZONES];

    const starts = [];
    const contains = [];
    for (const zone of ALL_ZONES) {
        const lower = zone.toLowerCase();
        if (lower.startsWith(q)) starts.push(zone);
        else if (lower.includes(q)) contains.push(zone);
        if (starts.length >= MAX_CHOICES) break;
    }
    return [...starts, ...contains].slice(0, MAX_CHOICES);
}

//Answers the typeahead on any command option that asks for a zone
export async function handleZoneAutocomplete(interaction) {
    const typed = interaction.options.getFocused();
    await interaction.respond(suggestZones(typed).map((zone) => ({ name: zone, value: zone })));
}

//"Europe/London (GMT+1)", the form every message here says a zone in
export function describeZone(zone) {
    const offset = zoneOffsetLabel(zone);
    return offset ? `${zone} (${offset})` : zone;
}

/*
    Pulled off /setup as well as /timezone. Absent means they left the option alone,
    which at setup takes the deployment default and later leaves the server's own
    alone, so returning null for that is the whole point.
*/
export function readZoneOption(interaction) {
    const picked = interaction.options.getString('timezone');
    if (!picked) return null;
    return isValidZone(picked) ? picked : false;
}

//The /timezone command: says what the server runs on, and sets it for a planner
export async function handleTimeZone(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server, not in a DM.', flags: MessageFlags.Ephemeral });
    }

    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg?.setupComplete) {
        return interaction.reply({ content: 'Run /setup first and I will ask about this there.', flags: MessageFlags.Ephemeral });
    }

    const current = safeZone(cfg.timeZone);
    const picked = readZoneOption(interaction);

    if (picked === null) {
        const note = cfg.timeZone ? '' : `\nNobody has picked one, so it is on my default. Run \`/timezone timezone:\` to change it.`;
        return interaction.reply({
            content: `This server runs on **${describeZone(current)}**. A plan set for 8pm means 8pm there.${note}`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (picked === false) {
        return interaction.reply({ content: 'I do not know that zone. Pick one from the list I offer as you type.', flags: MessageFlags.Ephemeral });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.roles.cache.has(cfg.plannerRoleId)) {
        return interaction.reply({ content: 'You need the planner role to change the server clock.', flags: MessageFlags.Ephemeral });
    }
    if (picked === current) {
        return interaction.reply({ content: `Already on **${describeZone(current)}**.`, flags: MessageFlags.Ephemeral });
    }

    await saveGuildConfig(interaction.guildId, { timeZone: picked });
    //Every plan here carries its own copy for the messages to read, so they move together or not at all
    const moved = await setGuildPlansTimeZone(interaction.guildId, picked);

    /*
        Out loud in the info channel, not just back to whoever ran it. This changes what
        every time in the server means, for everybody, and it wants no more than the
        planner role, so an ephemeral reply was the only record it left anywhere.
    */
    const told = await announceToServer(
        interaction.guild,
        cfg.infoChannelId,
        `<@${interaction.user.id}> moved this server's clock to **${describeZone(picked)}**, from ${describeZone(current)}.${clockMovedLine(moved, picked)}`
    );

    return interaction.reply({
        content: `Right, this server is on **${describeZone(picked)}** now, moved from ${describeZone(current)}.${clockMovedLine(moved, picked)}${
            told ? `\n\nI have said so in <#${cfg.infoChannelId}>, since it changes what times mean for everybody.` : ''
        }`,
        flags: MessageFlags.Ephemeral
    });
}

/*
    What a clock move means for the plans already on the books, said the same way in
    the reply and in the notice. A planner who moves the clock an hour wonders which
    way their plans went, and the answer is neither: a day and a time are stored as a
    reading, so they stay put and it is what they mean that moves.
*/
export function clockMovedLine(moved, to) {
    if (!moved) return '';
    const plans =
        moved === 1
            ? 'The one plan here keeps the time written on it'
            : `All ${moved} plans here keep the time written on them`;
    return ` ${plans}, so a plan at 8pm is still at 8pm, now 8pm ${to}.`;
}

//What /setup says about the clock once it has saved one
export function setupZoneLine(zone, picked) {
    if (picked) return `\n\nI have this server on **${describeZone(zone)}**, so that is what a plan set for 8pm means.`;
    return `\n\nI have this server on **${describeZone(zone)}**, which is just my default. If that is wrong, run \`/timezone\` to change it, otherwise calendar files land an hour or two out.`;
}
