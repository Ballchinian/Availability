import { guildContext } from '../../context.js';
import { planRole, canTakeOn } from '../../roles.js';
import { forGuest, historyForGuest, nameless, unansweredCounts } from '../../guestview.js';
import { announceAfter } from '../../announce.js';
import { addPlanEvent, addHost } from '../../../db/plans/index.js';
import { getAvailabilityForUsersInRange, getLastUpdated } from '../../../db/availability.js';
import { getPlanningPrefs } from '../../../db/users.js';
import { addHostToThread } from '../../../bot/plans/index.js';
import { threadUrl } from '../../../bot/util.js';
import { shiftDate } from '../../../lib/dates.js';
import { safeZone } from '../../../lib/zones.js';
import { gatherFreeDays } from '../../../lib/freedays.js';
import { answersOn, daysToFill, toFillRuns, coverageOf, standing, inOf } from '../../../lib/coverage.js';
import { realMembers, listMembers, memberOf } from '../../../lib/members.js';
import { hostIdsOf } from '../../../lib/hosts.js';
import { requireHost, requirePlanner, finished } from './gates.js';

//The overview and what hangs off it
export function overviewRoutes(router) {
    /*
        Everything the overview needs: who is in, where each person stands, and who is free
        each day. For anyone on the plan. Whoever runs it gets all of it, and a guest gets
        what guestview.js leaves them.
    */
    router.get('/:planId/compare', async (req, res) => {
        const { plan } = req;

        const ctx = await guildContext(plan.guildId, req.user.id);
        if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
        if (!ctx.isMember) return res.status(403).json({ error: 'You are not in that server.' });
        const role = planRole(plan, req.user.id);

        const member = (id) => memberOf(ctx.guild, id);
        const running = await Promise.all(hostIdsOf(plan).map(member));
        //Who runs it, by name, leaving out anyone no longer in the server
        const hosts = running.filter(Boolean).map((m) => m.displayName);
        const hostIds = hostIdsOf(plan).filter((id, i) => running[i]);
        const takeOn = canTakeOn(plan, req.user.id, ctx, hosts);

        /*
            Someone who could take the plan on gets that much and the name, which anyone
            holding the link can already read. Anyone else not on it gets nothing.
        */
        if (!role) {
            if (!takeOn) return res.status(403).json({ error: 'You are not on this plan.' });
            return res.json({ plan: { planId: plan.planId, name: plan.name, guildName: ctx.cfg.guildName }, role: null, canTakeOn: true, hosts });
        }

        const host = role === 'host';
        //Guests see each other's days by name only on a plan made since they could
        const seesDays = host || plan.guestsSeeDays === true;

        /*
            Only people who are in count, and only on the days their answer reaches, since
            a day marked on My calendar past their answer date is not an answer. Their hours
            go out so the site can work out the overlap window for each day. The query below
            reaches a day past each end because everyone writes their hours in their own
            clock and the plan runs on the server's, so a day of theirs spills onto a day of
            ours either side. gatherFreeDays does that reading and drops whatever still lands
            outside.
        */
        const guildZone = safeZone(ctx.cfg.timeZone);
        const joined = plan.participants.filter((p) => inOf(p) === true);
        const everyone = plan.participants.map((p) => p.userId);

        /*
            The reads this page needs, together: everyone's clocks and answers, their names
            and avatars, the hours themselves, and when each last saved, which only a host
            is shown. Who is in comes off the plan we already hold, so nothing here waits on
            anything else here. The member fetches are one wait for twenty people rather
            than twenty on their own.
        */
        const [prefs, members, rows, updated] = await Promise.all([
            getPlanningPrefs(everyone),
            Promise.all(everyone.map(member)),
            getAvailabilityForUsersInRange(
                joined.map((p) => p.userId),
                shiftDate(plan.dateRange.start, -1),
                shiftDate(plan.dateRange.end, 1)
            ),
            host ? getLastUpdated(everyone) : {}
        ]);

        const answers = Object.fromEntries(plan.participants.map((p) => [p.userId, answersOn(plan, prefs[p.userId], p)]));

        const people = plan.participants.map((p, i) => {
            const m = members[i];
            const joinedNow = inOf(p);
            const coverage = coverageOf(answers[p.userId]);
            return {
                userId: p.userId,
                displayName: m?.displayName || 'Someone who left',
                avatarUrl: m?.displayAvatarURL({ size: 64 }) || '',
                confirmed: p.confirmed,
                in: joinedNow,
                //Why it's not for them, which only whoever runs the plan reads
                inReason: joinedNow === false ? p.inReason || null : null,
                standing: standing(p, coverage),
                daysLeft: coverage.daysLeft,
                coveredUntil: prefs[p.userId]?.coveredUntil || null,
                //Their last save anywhere, so a host can see a calendar has gone stale
                updatedAt: updated[p.userId] ? new Date(updated[p.userId]).toISOString() : null,
                //The days still to answer, as runs, only for people whose days the grid counts
                unanswered: joinedNow === true && seesDays ? toFillRuns(answers[p.userId]) : [],
                //The confirmation vote, so whoever runs it can watch who is in without leaning on DMs
                vote: p.vote || null,
                voteReason: p.voteReason || null,
                //A host's manual call on them, sitting over whatever they answered
                override: p.override || null,
                //Whether they are still on the invite list for the set date
                invited: p.invited !== false,
                dmsClosed: Boolean(p.dmsClosed),
                //Only who moved them: what they had is for putting back, not for showing
                sentBack: p.sentBack ? { byName: p.sentBack.byName || '' } : null
            };
        });

        const free = gatherFreeDays(rows, {
            userIds: joined.map((p) => p.userId),
            prefs,
            zone: guildZone,
            start: plan.dateRange.start,
            end: plan.dateRange.end,
            answeredOnly: true
        });

        //Oldest first. Dates go over the wire as strings like every other date here.
        const history = (plan.history || []).map((e) => ({ ...e, at: new Date(e.at).toISOString() }));
        const me = plan.participants.find((p) => p.userId === req.user.id);

        res.json({
            plan: {
                planId: plan.planId,
                name: plan.name,
                description: plan.description || '',
                guildId: plan.guildId,
                guildName: ctx.cfg.guildName,
                start: plan.dateRange.start,
                end: plan.dateRange.end,
                allowedWeekdays: plan.allowedWeekdays || null,
                //Which clock the grid, the hours and the set time are all read in
                timeZone: guildZone,
                status: plan.status,
                chosenDate: plan.chosenDate,
                chosenTime: plan.chosenTime || null,
                chosenNote: plan.chosenNote || null,
                probeActive: Boolean(plan.probeActive),
                //Whether this comes round again once its day has been, who set it to, and where the chain has got to
                repeatWeeks: plan.repeatWeeks || null,
                repeatBy: plan.repeatWeeks ? plan.repeatBy?.name || null : null,
                repeatedFrom: plan.repeatedFrom || null,
                repeatedInto: plan.repeatedInto || null,
                //The way back to where the plan is actually being talked about
                threadUrl: plan.threadId ? threadUrl(plan.guildId, plan.threadId) : null,
                //What the edit form sends back, so a save made since it opened is caught
                rev: plan.rev || 0,
                createdBy: plan.createdBy
            },
            role,
            hosts,
            //The same people by id, for the edit form's picker
            ...(host ? { hostIds } : {}),
            canTakeOn: takeOn,
            //Whether they could start another plan like it
            isPlanner: ctx.isPlanner,
            seesDays,
            participants: host ? people : people.map(forGuest),
            //Whether they are on the guest list themselves, so they get their own way to fill dates in
            youAreIn: Boolean(me),
            //Their own answer for a set day, which a guest's row above has a host's call folded into
            you: me ? { vote: me.vote || null, invited: me.invited !== false } : null,
            confirmedCount: plan.participants.filter((p) => p.confirmed).length,
            totalParticipants: plan.participants.length,
            freeByDate: seesDays ? free : nameless(free),
            ...(seesDays
                ? {}
                : { unansweredCounts: unansweredCounts(Object.fromEntries(joined.map((p) => [p.userId, daysToFill(answers[p.userId])])), free) }),
            history: host ? history : historyForGuest(history)
        });
    });

    /*
        What it takes to set another plan up like this one, for the create form to open with.
        The crowd, the name, the days and whoever ran it carry, the dates never do: a plan run
        again is the same shape in a different month, and the window is the part that moves.

        No refuseFinished on purpose. A plan that fell through and one that has already been
        are the two you most want to run again, and both are read only everywhere else.
    */
    router.get('/:planId/template', requirePlanner, async (req, res) => {
        const { plan, ctx } = req;
        res.json({
            name: plan.name,
            description: plan.description || '',
            allowedWeekdays: plan.allowedWeekdays || null,
            participantIds: plan.participants.map((p) => p.userId),
            //Only the ones still in the server, since nobody else can run the new one
            hostIds: await realMembers(ctx.guild, hostIdsOf(plan))
        });
    });

    /*
        The server's members, for the people picker on a plan already running. The server's
        own route to the same list takes the planner role, which whoever runs a plan may not
        hold.
    */
    router.get('/:planId/members', requireHost, async (req, res) => {
        try {
            res.json({ members: await listMembers(req.ctx.guild) });
        } catch (err) {
            console.error('[members] failed:', err);
            res.status(500).json({ error: 'Could not load the member list.' });
        }
    });

    /*
        Take a plan on: the requester becomes one of the people who run it. A planner can once
        nobody who runs it is left in the server, and anyone who can manage the server can at
        any time, see canTakeOn. Written into the plan's history, and anyone on the list who
        has left the server comes off it.
    */
    router.post('/:planId/takeon', async (req, res) => {
        const { plan } = req;

        const ctx = await guildContext(plan.guildId, req.user.id);
        if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });
        //Pressed twice, or on a page from before someone else let them in
        if (ctx.isMember && planRole(plan, req.user.id) === 'host') return res.json({ ok: true });

        const listed = hostIdsOf(plan);
        const here = await realMembers(ctx.guild, listed);
        if (!canTakeOn(plan, req.user.id, ctx, here)) {
            return res.status(403).json({ error: 'A planner can take a plan on once nobody who runs it is left in the server.' });
        }
        const over = finished(plan);
        if (over) return res.status(409).json({ error: over });

        await addHost(plan.planId, req.user.id, listed.filter((id) => !here.includes(id)), { id: req.user.id, name: ctx.member.displayName });
        await addPlanEvent(plan.planId, { type: 'tookon', by: req.user.id, byName: ctx.member.displayName });
        announceAfter(plan.planId, 'take on', (current) => addHostToThread(current, req.user.id));

        res.json({ ok: true });
    });
}
