import { getGuildConfig } from '../../db/guilds.js';
import { getPlanningPrefs } from '../../db/users.js';
import { answersOn, coverageOf, owes, inOf } from '../../lib/coverage.js';
import { onIt, invitedOnly, effectiveVote } from './cards.js';
import { resendCards } from './send.js';

//Nudges, and Ask again, which send someone their card again with who is waiting on them

/*
    Nudges everyone a plan still finding its day is waiting on with a fresh card, no thread
    post: whoever has not said if they're in, and whoever is in with days still to fill. The
    card says what is left, so the line on top only says who is waiting. The /remind route
    caps this to once a day. actorName is whoever asked for it.
*/
export async function remindStragglers(plan, actorName) {
    const on = onIt(plan);
    const prefs = await getPlanningPrefs(on.map((p) => p.userId));
    const owing = new Map();
    for (const p of on) {
        const owed = owes(p, coverageOf(answersOn(plan, prefs[p.userId], p)));
        if (owed) owing.set(p.userId, owed === 'answer' ? "is still waiting to hear if you're in." : 'is still waiting on your dates.');
    }
    if (!owing.size) return 0;

    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    await resendCards(plan, [...owing.keys()], cfg, (id) => ({ title: 'REMINDER', aside: nudgeLine(plan, id, `${actorName} ${owing.get(id)}`) }));

    return owing.size;
}

//Someone a host moved back hears that first, and nothing about who is waiting
function nudgeLine(plan, userId, waiting) {
    const back = plan.participants.find((p) => p.userId === userId)?.sentBack;
    if (!back?.byName) return waiting;
    return plan.chosenDate
        ? `${back.byName} moved you back to waiting for "${plan.name}".`
        : `${back.byName} asked you to go over your dates for "${plan.name}" again.`;
}

/*
    Ask again, from the overview of a plan still finding its day: one person's card sent
    fresh, opening with who asked. Answers whether it landed. Nobody who said Not for me,
    since they get no DMs at all.
*/
export async function askAgain(plan, userId, actorName) {
    const p = plan.participants.find((q) => q.userId === userId);
    if (!p || inOf(p) === false || plan.status !== 'collecting') return false;
    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    const sent = await resendCards(plan, [userId], cfg, {
        title: 'REMINDER',
        aside: nudgeLine(plan, userId, `${actorName} is still waiting to hear if you're in.`)
    });
    return sent.length > 0;
}

/*
    The same nudge for a running confirmation probe: the people who have not said
    whether they are coming, sent their card again, buttons and all, so they can answer
    without going and finding the thread.

    Only the people still on the invite list, and only where the answer is genuinely
    missing. A planner who has already made the call on someone counts as an answer, so
    the board they just filled in is not undone by a DM asking them again.
*/
export async function remindVoters(plan, actorName) {
    const pending = invitedOnly(plan).filter((p) => !effectiveVote(p)).map((p) => p.userId);
    if (!pending.length) return 0;

    const cfg = await getGuildConfig(plan.guildId).catch(() => null);
    await resendCards(plan, pending, cfg, (id) => ({
        title: 'REMINDER',
        aside: nudgeLine(plan, id, `${actorName} is still waiting to hear whether you can make it.`)
    }));

    return pending.length;
}
