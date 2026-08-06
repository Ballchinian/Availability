import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } from 'discord.js';
import { getPlan, getPlanByThread, getOpenPlansForUser, confirmParticipant } from '../db/plans.js';
import { getGuildConfig } from '../db/guilds.js';
import { getAvailabilityInRange, replaceAvailabilityInRange } from '../db/availability.js';
import { notifyCreatorIfAllIn } from './plans.js';
import { planUrl } from './util.js';
import { allowedDaysInRange, weekdayOf } from '../lib/dates.js';

/*
    Filling in your dates without leaving Discord, for the people who never click the
    link. The data model does not care where the days come from, so this writes exactly
    what the site writes and a person can use both on the same plan.

    A day picker rather than a modal, because a modal can only hold text and asking
    somebody to type dates is how you get "next weds" in a field expecting 2026-08-12.
    Discord's select menus already know how to be a multiple choice list, and they can
    come back pre-ticked, which makes this a view of what you have said as much as a way
    to say it.

    Hours cannot be narrowed here. A day picked in Discord is a day free all through,
    which is what an empty hours list already means everywhere else, and the reply says
    where to go if that is not true.
*/

//Discord's own caps: options in one select, and rows on one message, with the last row spent on buttons
const PER_SELECT = 25;
const MAX_SELECTS = 4;
const MAX_DAYS = PER_SELECT * MAX_SELECTS;

//Short forms, only used on the option labels, where a select is a few hundred pixels wide
const SHORT_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

//"Wed 12 Aug", which is what someone picking a day actually reads it by
export function dayLabel(date) {
    const [, m, d] = date.split('-');
    return `${SHORT_WEEKDAY[weekdayOf(date)]} ${Number(d)} ${SHORT_MONTH[Number(m) - 1]}`;
}

/*
    The days this plan asks about, split into the runs one select can hold. Chunks are
    fixed by position rather than by week, so the same day is always in the same select:
    the index is what the button ids carry, and a chunk that moved would write somebody's
    answer onto the wrong dates.

    A plan longer than four selects is cut off rather than paginated. The link does the
    whole range and is right there in the message, and a plan asking about more than a
    hundred days is not one anybody is filling in from a dropdown.
*/
export function dayChunks(plan) {
    const days = allowedDaysInRange(plan.dateRange.start, plan.dateRange.end, plan.allowedWeekdays || null);
    const shown = days.slice(0, MAX_DAYS);
    const chunks = [];
    for (let at = 0; at < shown.length; at += PER_SELECT) chunks.push(shown.slice(at, at + PER_SELECT));
    return { chunks, total: days.length, cut: days.length - shown.length };
}

//What the message says above the pickers: where they stand, and what this cannot do
export function pickerText(plan, freeCount, shownCount, cut) {
    const lines = [
        `**${plan.name}**`,
        `Tick the days you are free. Each list saves as you close it, so there is nothing to submit.`,
        `You are down as free on **${freeCount}** of the ${shownCount} day${shownCount === 1 ? '' : 's'} this plan asks about.`
    ];
    if (cut > 0) {
        lines.push(`The first ${shownCount} days are here, ${cut} more are on the page: ${planUrl(plan.planId)}`);
    } else {
        lines.push(`Only free part of a day, or want to see how it lines up with everyone else? ${planUrl(plan.planId)}`);
    }
    return lines.join('\n');
}

/*
    One select per chunk, already ticked with whatever they have saved, and the two
    blanket buttons on the last row. Exported so the tests can build it and hand it to
    discord.js to validate: every cap in here is one Discord enforces at send time, which
    is the worst place to find out about it.
*/
export function pickerComponents(plan, chunks, freeSet) {
    const rows = chunks.map((chunk, index) => {
        const options = chunk.map((date) =>
            new StringSelectMenuOptionBuilder().setLabel(dayLabel(date)).setValue(date).setDefault(freeSet.has(date))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId(`free|day|${plan.planId}|${index}`)
            .setPlaceholder(`${dayLabel(chunk[0])} to ${dayLabel(chunk[chunk.length - 1])}`)
            //Zero so a list can be emptied, which is how somebody says they are free on none of these
            .setMinValues(0)
            .setMaxValues(options.length)
            .addOptions(options);
        return new ActionRowBuilder().addComponents(select);
    });

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`free|all|${plan.planId}`).setLabel('Free every day').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`free|none|${plan.planId}`).setLabel('Free on none of them').setStyle(ButtonStyle.Secondary)
    );

    return [...rows, buttons];
}

/*
    The whole message, rebuilt from what is saved rather than from what was just clicked.
    No ephemeral flag on it: the first one is sent with one and every later one edits that
    same message, where saying it again is not allowed.
*/
async function pickerPayload(plan, userId) {
    const { chunks, cut } = dayChunks(plan);
    const shown = chunks.flat();
    const rows = await getAvailabilityInRange(userId, shown[0], shown[shown.length - 1]);
    const freeSet = new Set(rows.map((r) => r.date));
    const freeCount = shown.filter((d) => freeSet.has(d)).length;

    return {
        content: pickerText(plan, freeCount, shown.length, cut),
        components: pickerComponents(plan, chunks, freeSet)
    };
}

/*
    Everything a click has to be true about before it writes anything. The plan can have
    been cancelled or the person dropped out between opening the picker and using it,
    since the message sits in their client until they come back to it.
*/
async function usablePlan(interaction, planId) {
    const plan = await getPlan(planId);
    if (!plan) return { error: 'That plan is no longer around.' };
    if (plan.status === 'cancelled') return { error: 'That plan was cancelled, so there is nothing to fill in.' };
    if (!plan.participants.some((p) => p.userId === interaction.user.id)) {
        return { error: 'You are not on the guest list for that plan.' };
    }
    if (!dayChunks(plan).chunks.length) return { error: 'That plan has no days left to ask about.' };
    return { plan };
}

/*
    Save a stretch of days and mark them confirmed, which is the same pair the site does
    on save. onlyDates is the exact days being answered for, so a weekday-pinned plan and
    the days in other selects are both left alone.
*/
async function saveDays(userId, plan, dates, answering) {
    const picked = dates.filter((d) => answering.includes(d));
    await replaceAvailabilityInRange(
        userId,
        answering[0],
        answering[answering.length - 1],
        picked.map((date) => ({ date, hours: [] })),
        answering
    );

    const updated = await confirmParticipant(plan.planId, userId);
    try {
        await notifyCreatorIfAllIn(updated);
    } catch (err) {
        console.error('[free] all-in notify failed:', err);
    }
}

//The /free command: the picker for the plan in this thread, or a way to say which plan
export async function handleFree(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server, not in a DM.', flags: MessageFlags.Ephemeral });
    }

    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg?.setupComplete) {
        return interaction.reply({ content: 'Run /setup first.', flags: MessageFlags.Ephemeral });
    }

    //Run in a plan's own thread it needs no asking, which is where most people will be
    const here = await getPlanByThread(interaction.channelId);
    if (here) {
        const { plan, error } = await usablePlan(interaction, here.planId);
        if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return interaction.reply({ ...(await pickerPayload(plan, interaction.user.id)), flags: MessageFlags.Ephemeral });
    }

    const plans = (await getOpenPlansForUser(interaction.guildId, interaction.user.id)).filter((p) => dayChunks(p).chunks.length);
    if (!plans.length) {
        return interaction.reply({ content: 'You are not in any open plans here right now.', flags: MessageFlags.Ephemeral });
    }
    //One open plan is not worth asking about, so it skips the step entirely
    if (plans.length === 1) {
        return interaction.reply({ ...(await pickerPayload(plans[0], interaction.user.id)), flags: MessageFlags.Ephemeral });
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('free|plan')
        .setPlaceholder('Which plan?')
        .addOptions(
            //Discord takes 25, and somebody in more open plans than that has bigger problems
            plans.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder().setLabel(p.name.slice(0, 100)).setValue(p.planId))
        );

    return interaction.reply({
        content: 'You are in a few plans here. Which one are you filling in?',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral
    });
}

//Every free|* click and pick, all of which rewrite the same ephemeral message in place
export async function handleFreeComponent(interaction) {
    const [, step, planId, chunkIndex] = interaction.customId.split('|');

    if (step === 'plan') {
        const { plan, error } = await usablePlan(interaction, interaction.values[0]);
        if (error) return interaction.update({ content: error, components: [] });
        return interaction.update(await pickerPayload(plan, interaction.user.id));
    }

    const { plan, error } = await usablePlan(interaction, planId);
    if (error) return interaction.update({ content: error, components: [] });

    const { chunks } = dayChunks(plan);

    if (step === 'day') {
        //Read back off the plan rather than trusting the message, which may be older than the plan is
        const chunk = chunks[Number(chunkIndex)];
        if (!chunk) return interaction.update(await pickerPayload(plan, interaction.user.id));
        await saveDays(interaction.user.id, plan, interaction.values, chunk);
    } else if (step === 'all' || step === 'none') {
        const every = chunks.flat();
        await saveDays(interaction.user.id, plan, step === 'all' ? every : [], every);
    }

    return interaction.update(await pickerPayload(plan, interaction.user.id));
}
