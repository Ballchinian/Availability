import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { planUrl, overviewUrl, datesUrl, calendarUrl } from '../util.js';
import { getPlan, getPlanByThread, getLivePlansForUser } from '../../db/plans/index.js';
import { getPlanningPrefs } from '../../db/users.js';
import { formatDate, shiftDate, today } from '../../lib/dates.js';
import { rowFor, nextStep } from '../../lib/coverage.js';
import { dayHasPassed, hasLapsed } from '../../lib/zones.js';
import { hostIdsOf } from '../../lib/hosts.js';
import { linkButton, overviewRow } from './cards.js';
import { cancelPlan } from './announce.js';

//The slash commands about plans: /overview, /mylink, /mycalendar and /cancel

/*
    The /overview slash command. Run inside a plan's thread, it hands back that plan's
    overview, to whoever asks. The thread is private and the page turns away anyone who
    is not on the plan, so there is nothing here to check.
*/
export async function handleOverview(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server.', flags: MessageFlags.Ephemeral });
    }

    const plan = await getPlanByThread(interaction.channelId);
    if (!plan) {
        return interaction.reply({ content: "Run this inside a plan's thread to get its overview.", flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({
        content: `**${plan.name}**`,
        components: [overviewRow(plan)],
        flags: MessageFlags.Ephemeral
    });
}

//Discord's own caps: buttons on one row, and rows on one message
const PER_ROW = 5;

const MAX_LINKS = PER_ROW * 5;

//A plan's name and what it wants next, with the name cut short before the step is, since a label caps at 80
function stepLabel(name, step) {
    const room = 80 - step.length - 2;
    return `${name.length > room ? `${name.slice(0, room - 3)}...` : name}: ${step}`;
}

/*
    The /mylink command. Every plan still on in this server that they are on or run, set
    ones too, each as a button that says what the plan wants from them next and goes
    there: the same step My plans gives it. Always a private reply, just to them, so it
    works the same wherever they run it.
*/
export async function handleMyLink(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a server.', flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.user.id;
    const found = await getLivePlansForUser(interaction.guildId, userId, shiftDate(today(), -1));
    //Left off a set day, there is nothing for them to open, unless they run it
    const leftOff = (plan) => plan.status === 'closed' && !hostIdsOf(plan).includes(userId) &&
        plan.participants.find((p) => p.userId === userId)?.invited === false;
    const plans = found.filter((plan) => !dayHasPassed(plan) && !hasLapsed(plan) && !leftOff(plan));
    if (!plans.length) {
        return interaction.reply({ content: 'You are not on any plans here right now.', flags: MessageFlags.Ephemeral });
    }

    //Their own answers, and everyone's on the plans they run, since picking the day waits on all of them
    const running = plans.filter((plan) => plan.status === 'collecting' && hostIdsOf(plan).includes(userId));
    const prefs = await getPlanningPrefs([...new Set([userId, ...running.flatMap((plan) => plan.participants.map((p) => p.userId))])]);

    const pages = { plan: planUrl, overview: overviewUrl, dates: datesUrl };
    const links = plans.slice(0, MAX_LINKS).map((plan) => {
        const step = nextStep({ status: plan.status, ...rowFor(plan, userId, prefs) });
        return linkButton(stepLabel(plan.name, step.label), pages[step.page](plan.planId));
    });
    const rows = [];
    for (let at = 0; at < links.length; at += PER_ROW) rows.push(new ActionRowBuilder().addComponents(links.slice(at, at + PER_ROW)));

    const more = plans.length - links.length;
    return interaction.reply({
        content: more > 0 ? `Your plans here. The ${links.length} newest fit, and the other ${more} are on My plans.` : 'Your plans here:',
        components: rows,
        flags: MessageFlags.Ephemeral
    });
}

//Hands back the link to the calendar, the page not tied to any one plan
export async function handleMyCalendar(interaction) {
    return interaction.reply({
        content: `Your calendar: ${calendarUrl()}`,
        flags: MessageFlags.Ephemeral
    });
}

/*
    Why this person cannot call the plan off, or null when they can. Asked when /cancel
    is run and again when its button is pressed, since who runs the plan and whether it
    is still on can both change while the question sits there.
*/
function cancelRefusal(plan, userId) {
    if (!plan) return 'That plan is no longer around.';
    if (!hostIdsOf(plan).includes(userId)) return 'Only whoever runs this plan can call it off.';
    if (plan.status === 'cancelled') return 'It was already called off, so I left everyone be.';
    if (dayHasPassed(plan)) return `"${plan.name}" was on ${formatDate(plan.chosenDate)}, so there is nothing left to call off.`;
    return null;
}

//The /cancel command, asks to confirm before scrapping the plan in this thread
export async function handleCancel(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Run this inside a plan thread.', flags: MessageFlags.Ephemeral });
    }

    const plan = await getPlanByThread(interaction.channelId);
    if (!plan) return interaction.reply({ content: 'Run this inside a plan thread to call it off.', flags: MessageFlags.Ephemeral });

    const refusal = cancelRefusal(plan, interaction.user.id);
    if (refusal) return interaction.reply({ content: refusal, flags: MessageFlags.Ephemeral });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel|yes|${plan.planId}`).setLabel('Yes, call it off').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel|no').setLabel('Keep it').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
        content: `Call off **${plan.name}**${plan.repeatWeeks ? ', and stop it coming round again' : ''}? Everyone gets told, and the thread stays until you delete it by hand.`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

//Routes the cancel confirm buttons. Cancel is the only plan button left now that
//a deleted thread just scraps the plan outright.
export async function handlePlanComponent(interaction) {
    const [, action, planId] = interaction.customId.split('|');

    if (action === 'no') return interaction.update({ content: 'Kept it.', components: [] });

    await interaction.update({ content: 'Calling it off...', components: [] });
    const plan = await getPlan(planId);
    const refusal = cancelRefusal(plan, interaction.user.id);
    if (refusal) return interaction.editReply({ content: refusal });

    const actorName = interaction.member?.displayName || interaction.user.username;
    if (!(await cancelPlan(plan, interaction.user.id, actorName))) {
        return interaction.editReply({ content: 'It was already called off, so I left everyone be.' });
    }
    return interaction.editReply({ content: 'Done, everyone has been told. Delete this thread when you are ready to clear the plan for good.' });
}
