import { getPlan, getPlansDueToRepeat, getPlansNeedingRepair, claimForRepeat, releaseRepeatClaim, createPlan, setPlanChosen, setPlanRepeat, setNeedsRepair, addPlanEvent } from '../db/plans.js';
import { getGuildConfig } from '../db/guilds.js';
import { isMongoReady } from '../db/mongo.js';
import { client } from './client.js';
import { announcePlan, announceSetPlan, syncPlan } from './plans.js';
import { shortId } from '../lib/ids.js';
import { today, shiftDate, nextPlanShape } from '../lib/dates.js';
import { safeZone, dayHasPassed } from '../lib/zones.js';
import { hostIdsOf } from '../lib/hosts.js';

/*
    Plans that come round again. "Every other Thursday" used to mean making a new plan
    by hand every other Thursday, and this is the bot doing that instead.

    The next one is not made until this one's day has been and gone, so a chain is only
    ever one plan long. That is what keeps it honest: nothing is scheduled into a future
    nobody has agreed to, cancelling a plan ends the chain without a separate way to say
    so, and a planner who wants out just turns the repeat off on whichever plan is live.

    Intervals are whole weeks, which is the whole reason they are not months: shifting by
    a multiple of seven lands on the same weekday, so a plan pinned to weekends is still
    pinned to weekends afterwards and nothing has to be re-derived.

    Working out where the next one lands is nextPlanShape in shared/dates.js, since the
    overview shows a planner those dates before they turn a repeat on.
*/

//How often to look. A plan falls due at midnight somewhere, so this is about how late it can be.
const SWEEP_MS = 30 * 60 * 1000;
//Long enough after boot to be past the gateway and the first database connection
const FIRST_SWEEP_MS = 60 * 1000;

let timer = null;

/*
    Whoever runs the plan and is still in the server, as members. Unknown Member (10007)
    and Unknown User (10013) are the only answers read as gone. Anything else throws,
    since Discord having a bad minute would otherwise read as everyone having left, and
    that stops the repeat for good.
*/
async function hostsHere(plan) {
    const guild = await client.guilds.fetch(plan.guildId);
    const found = await Promise.all(
        hostIdsOf(plan).map(async (id) => {
            try {
                return guild.members.cache.get(id) || (await guild.members.fetch(id));
            } catch (err) {
                if (err?.code === 10007 || err?.code === 10013) return null;
                throw err;
            }
        })
    );
    return found.filter(Boolean);
}

/*
    One plan's turn. Everything that can go wrong here is a reason to stop rather than to
    retry: a server that removed the bot, a setup that was undone, a guest list nobody is
    left on. Those clear the repeat instead of failing every half hour forever. The one
    thing left for the next sweep is Discord not answering when asked who runs it.
*/
async function repeatOne(plan) {
    const cfg = await getGuildConfig(plan.guildId);
    if (!cfg?.setupComplete || !cfg.plansChannelId) {
        console.warn(`[repeat] ${plan.planId}: server ${plan.guildId} has no working setup, stopping the repeat`);
        await setPlanRepeat(plan.planId, null);
        return false;
    }

    const participantIds = plan.participants.map((p) => p.userId);
    if (!participantIds.length) {
        console.warn(`[repeat] ${plan.planId}: nobody left on the guest list, stopping the repeat`);
        await setPlanRepeat(plan.planId, null);
        return false;
    }

    const shape = nextPlanShape(plan);
    if (!shape) {
        console.warn(`[repeat] ${plan.planId}: no date left in the series, stopping the repeat`);
        await setPlanRepeat(plan.planId, null);
        return false;
    }

    let hosts;
    try {
        hosts = await hostsHere(plan);
    } catch (err) {
        //Unknown Guild: the bot was taken out while it was down, so no guildDelete came to clear the setup
        if (err?.code === 10004) {
            console.warn(`[repeat] ${plan.planId}: no longer in server ${plan.guildId}, stopping the repeat`);
            await setPlanRepeat(plan.planId, null);
        } else {
            console.warn(`[repeat] ${plan.planId}: could not check who runs it, leaving it for the next sweep:`, err.message);
        }
        return false;
    }
    /*
        Making the next one is starting a plan, which takes the planner role. Whoever
        runs this one is who it is made for, so one of them has to hold it still. This
        stop goes in the history, since it is the one a person could not have seen coming.
    */
    if (!hosts.some((m) => m.roles.cache.has(cfg.plannerRoleId))) {
        console.warn(`[repeat] ${plan.planId}: nobody who runs it has the planner role, stopping the repeat`);
        await setPlanRepeat(plan.planId, null);
        await addPlanEvent(plan.planId, { type: 'repeatended', by: plan.createdBy, byName: '' }).catch(() => {});
        return false;
    }

    /*
        The id is claimed on the old plan before the new one exists, so two sweeps running
        at once cannot both get through here, and a crash in between leaves a claim rather
        than a duplicate. The claim is let go again only if the plan is not actually made.
    */
    const nextId = shortId(10);
    if (!(await claimForRepeat(plan.planId, nextId))) return false;

    let next = null;
    try {
        next = await createPlan({
            planId: nextId,
            guildId: plan.guildId,
            name: plan.name,
            description: plan.description,
            createdBy: plan.createdBy,
            //Said outright, or createPlan would put whoever made the first one back after they had left
            hostIds: hosts.map((m) => m.id),
            //Carried off the old plan's own history, so the new one does not open with "Someone started the plan"
            actorName: (plan.history || []).find((e) => e.type === 'created')?.byName || '',
            dateRange: shape.dateRange,
            participantIds,
            allowedWeekdays: plan.allowedWeekdays || null,
            timeZone: safeZone(cfg.timeZone),
            //The chain carries on by itself, and turning it off on this one is what ends it
            repeatWeeks: plan.repeatWeeks,
            repeatedFrom: plan.planId
        });
    } catch (err) {
        /*
            An insert can throw after it landed (a timeout on the reply), so the claim goes
            only once the plan is known not to be there. Letting it go with the plan made
            was a new plan and thread every half hour for as long as the announcement failed.
        */
        console.error(`[repeat] ${plan.planId} failed:`, err);
        if (await getPlan(nextId).catch(() => null)) await setNeedsRepair(nextId, true).catch(() => {});
        else await releaseRepeatClaim(plan.planId).catch(() => {});
        return false;
    }

    await addPlanEvent(plan.planId, { type: 'repeated', by: plan.createdBy, byName: '', planId: nextId }).catch(() => {});

    try {
        if (shape.set) {
            next = await setPlanChosen(next.planId, shape.chosen.date, shape.chosen.time, shape.chosen.note);
            await announceSetPlan(next, cfg, '');
        } else {
            await announcePlan(next, cfg, '');
        }
    } catch (err) {
        console.error(`[repeat] ${nextId} was made but not announced, repairing it next sweep:`, err);
        await setNeedsRepair(nextId, true).catch(() => {});
    }

    console.log(`[repeat] ${plan.planId} came round again as ${nextId}`);
    return true;
}

/*
    A repeat that exists but never fully reached Discord. With a thread, syncPlan puts the
    opener and cards back; without one the announcement never got that far, so it runs again.
*/
async function repairOne(plan) {
    const cfg = await getGuildConfig(plan.guildId);
    if (!cfg?.setupComplete || !cfg.plansChannelId) {
        console.warn(`[repeat] ${plan.planId}: server ${plan.guildId} has no working setup, giving up the repair`);
        await setNeedsRepair(plan.planId, false);
        return;
    }

    if (plan.threadId) await syncPlan(plan, { cfg });
    else if (plan.status === 'closed') await announceSetPlan(plan, cfg, '');
    else await announcePlan(plan, cfg, '');

    await setNeedsRepair(plan.planId, false);
    console.log(`[repeat] ${plan.planId} repaired`);
}

/*
    One pass over everything due, and how many came round.

    Nothing to do without a database, and saying so quietly matters: a machine with no
    MONGODB_URI is the normal local setup, and a stack trace every half hour forever
    would be the loudest thing in its log.
*/
export async function sweepRepeats() {
    if (!isMongoReady()) return 0;

    for (const plan of await getPlansNeedingRepair()) {
        await repairOne(plan).catch((err) => console.error(`[repeat] repairing ${plan.planId} failed:`, err));
    }

    //A day past the machine's own date, since a plan's day passes on its server's clock, not ours
    const due = await getPlansDueToRepeat(shiftDate(today(), 1));
    let made = 0;
    for (const plan of due) {
        //The query above is only close enough to find candidates, this is the real check
        if (!dayHasPassed(plan)) continue;
        if (await repeatOne(plan)) made++;
    }
    return made;
}

/*
    Started after boot rather than during it, so a database still finding its feet does not
    turn the first sweep into an error in the log. Unref'd: a timer waiting half an hour
    should never be the reason the process will not exit.
*/
export function startRepeats() {
    if (timer) return;
    const run = () => {
        sweepRepeats().catch((err) => console.error('[repeat] sweep failed:', err));
    };
    timer = setTimeout(() => {
        run();
        timer = setInterval(run, SWEEP_MS);
        timer.unref?.();
    }, FIRST_SWEEP_MS);
    timer.unref?.();
}

export function stopRepeats() {
    if (!timer) return;
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
}
