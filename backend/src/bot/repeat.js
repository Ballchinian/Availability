import { getPlansDueToRepeat, claimForRepeat, releaseRepeatClaim, createPlan, setPlanChosen, setPlanRepeat, addPlanEvent } from '../db/plans.js';
import { getGuildConfig } from '../db/guilds.js';
import { isMongoReady } from '../db/mongo.js';
import { announcePlan, announceSetPlan } from './plans.js';
import { shortId } from '../lib/ids.js';
import { today, shiftDate, nextPlanShape } from '../lib/dates.js';
import { safeZone, instantToWall } from '../lib/zones.js';

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
    compare page shows a planner those dates before they turn a repeat on.
*/

//How often to look. A plan falls due at midnight somewhere, so this is about how late it can be.
const SWEEP_MS = 30 * 60 * 1000;
//Long enough after boot to be past the gateway and the first database connection
const FIRST_SWEEP_MS = 60 * 1000;

let timer = null;

/*
    Whether the plan's day has actually been and gone where the plan is. The sweep's query
    filters on the machine's date, which is close enough to find candidates and up to a day
    out for a server on the other side of the world, so the real check happens here.
*/
function dayHasPassed(plan) {
    return instantToWall(safeZone(plan.timeZone), new Date()).date > plan.chosenDate;
}

/*
    One plan's turn. Everything that can go wrong here is a reason to stop rather than to
    retry: a server that removed the bot, a setup that was undone, a guest list nobody is
    left on. Those clear the repeat instead of failing every half hour forever.
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

    /*
        The id is claimed on the old plan before the new one exists, so two sweeps running
        at once cannot both get through here, and a crash in between leaves a claim rather
        than a duplicate. The claim is let go again if the plan is not actually made.
    */
    const nextId = shortId(10);
    if (!(await claimForRepeat(plan.planId, nextId))) return false;

    try {
        let next = await createPlan({
            planId: nextId,
            guildId: plan.guildId,
            name: plan.name,
            description: plan.description,
            createdBy: plan.createdBy,
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

        if (shape.set) {
            next = await setPlanChosen(next.planId, shape.chosen.date, shape.chosen.time, shape.chosen.note);
            await announceSetPlan(next, cfg, '', { dm: true, probe: false });
        } else {
            await announcePlan(next, cfg, '', { dm: true });
        }

        await addPlanEvent(plan.planId, { type: 'repeated', by: plan.createdBy, byName: '', planId: nextId });
        console.log(`[repeat] ${plan.planId} came round again as ${nextId}`);
        return true;
    } catch (err) {
        /*
            The plan may or may not exist by now. Letting the claim go is right either way:
            if it was never made the next sweep tries again, and if it was made but the
            announcement fell over, the plan is still reachable from the landing page.
        */
        console.error(`[repeat] ${plan.planId} failed:`, err);
        await releaseRepeatClaim(plan.planId).catch(() => {});
        return false;
    }
}

/*
    One pass over everything due, and how many came round.

    Nothing to do without a database, and saying so quietly matters: a machine with no
    MONGODB_URI is the normal local setup, and a stack trace every half hour forever
    would be the loudest thing in its log.
*/
export async function sweepRepeats() {
    if (!isMongoReady()) return 0;

    //A day past the machine's own date, since a plan's day passes on its server's clock, not ours
    const due = await getPlansDueToRepeat(shiftDate(today(), 1));
    let made = 0;
    for (const plan of due) {
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
