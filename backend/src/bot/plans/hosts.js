import { markAllInNotified, markProbeAllYes } from '../../db/plans.js';
import { getGuildConfig } from '../../db/guilds.js';
import { getPlanningPrefs } from '../../db/users.js';
import { everyoneAnswered } from '../../lib/coverage.js';
import { hostIdsOf } from '../../lib/hosts.js';
import { pickedText } from '../edits.js';
import { overviewRow, banner, whenLine, onIt, invitedOnly, effectiveVote } from './cards.js';
import { deliver, deliverEach, memberName } from './send.js';

//The DMs whoever runs a plan gets about the people on it

/*
    Once everyone left on the plan is in and their calendar answers every day of it,
    nothing else tells whoever runs it they can go and pick a day, so each of them
    gets a DM with the overview. The allInNotifiedAt flag keeps it to one nudge per
    round: adding someone or changing the dates reopens the round and lets it fire again.
*/
export async function notifyHostsIfAllIn(plan) {
    if (!plan || plan.status !== 'collecting' || plan.allInNotifiedAt) return;
    const on = onIt(plan);
    if (!on.length) return;
    if (!everyoneAnswered(plan, await getPlanningPrefs(on.map((p) => p.userId)))) return;

    //Set the flag before the DM so a slow send cannot let a second nudge slip through
    await markAllInNotified(plan.planId);

    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    await deliverEach(plan, hostIdsOf(plan), {
        content: banner('EVERYONE IS IN') + `Everyone has answered "${plan.name}"${where}, so you can pick a day now.`,
        components: [overviewRow(plan)]
    });
}

/*
    When everyone has said they are coming, tell whoever runs the plan they are good to
    go. The probeAllYesNotifiedAt flag keeps it to one DM a round, the same way the
    availability all-in nudge does.
*/
export async function notifyHostsAllYes(plan) {
    if (!plan || !plan.probeActive) return;
    const invited = invitedOnly(plan);
    if (!invited.length || !invited.every((p) => effectiveVote(p) === 'yes')) return;
    if (plan.probeAllYesNotifiedAt) return;

    //Set the flag before the DM so a slow send cannot let a second one slip through
    await markProbeAllYes(plan.planId);

    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    await deliverEach(plan, hostIdsOf(plan),
        banner('EVERYONE IS COMING') +
        `Everyone confirmed they can make "${plan.name}"${where} on ${whenLine(plan)}. You are good to go.`);
}

/*
    A note to everyone who runs the plan about someone on it, built from that person's name
    and the " in {server}" to put after the plan. Hands back the names of who heard and who
    the DM could not reach, in the order they run it, so the site can say which. Nobody is
    told about themselves, so someone who runs it and answers still tells the others.
*/
async function tellHosts(plan, userId, write) {
    const ids = hostIdsOf(plan).filter((id) => id !== userId);
    if (!ids.length) return { told: [], missed: [] };
    const cfg = await getGuildConfig(plan.guildId);
    const where = cfg?.guildName ? ` in ${cfg.guildName}` : '';
    const payload = write(await memberName(plan.guildId, userId), where);
    const heard = await Promise.all(ids.map(async (id) => ({
        name: await memberName(plan.guildId, id, 'whoever runs it'),
        reached: Boolean(await deliver(plan, id, payload))
    })));
    return {
        told: heard.filter((h) => h.reached).map((h) => h.name),
        missed: heard.filter((h) => !h.reached).map((h) => h.name)
    };
}

const reasonLine = (reason) => (reason ? `\nReason: ${reason}` : '');

/*
    Someone saying they cannot make a set day, with why, which the thread never shows. The
    overview goes with it in case that moves the day.
*/
export function notifyHostsVoteNo(plan, userId, reason) {
    return tellHosts(plan, userId, (name, where) => ({
        content: banner('SOMEONE CANNOT MAKE IT') +
            `${name} cannot make "${plan.name}"${where} on ${whenLine(plan)}.${reason ? reasonLine(reason) : '\nThey did not give a reason.'}`,
        components: [overviewRow(plan)]
    }));
}

export function notifyHostsDropped(plan, userId, reason) {
    return tellHosts(plan, userId, (name, where) =>
        banner('SOMEONE DROPPED OUT') + `${name} dropped out of "${plan.name}"${where}.${reasonLine(reason)}`);
}

//Not for me on a plan still finding its day. They stay on it, and can say they're in again.
export function notifyHostsOut(plan, userId, reason) {
    return tellHosts(plan, userId, (name, where) => ({
        content: banner('SOMEONE CANNOT MAKE IT') + `${name} can't make "${plan.name}"${where}.${reasonLine(reason)}`,
        components: [overviewRow(plan)]
    }));
}

export function notifyHostsBackIn(plan, userId) {
    return tellHosts(plan, userId, (name, where) => banner('BACK IN') + `${name} is in for "${plan.name}"${where} after all.`);
}

/*
    Everyone picked to run a plan as it is made, from whoever made it, since the thread
    they are pulled into never says why. Not sent on a repeat's next plan: they ran the
    last one.
*/
export function notifyHostsPicked(plan, userId) {
    return tellHosts(plan, userId, (name, where) => ({
        content: banner('YOU RUN THIS') + pickedText(name, plan, where),
        components: [overviewRow(plan)]
    }));
}
