import { Router } from 'express';
import { requireUser, issueSession, loadSession } from '../../lib/session.js';
import { guildContext } from '../context.js';
import { getPracticePeople, getPracticePerson, addPracticePerson, removePracticePerson } from '../../db/practice.js';
import { removeUserFromGuildPlans } from '../../db/plans.js';
import { deleteAllForUser } from '../../db/availability.js';
import { getTokenVersion } from '../../db/users.js';
import { getOutbox, outboxShape, deleteOutboxFor } from '../../db/outbox.js';
import { afterLeaving } from '../../bot/plans/index.js';
import { newPracticeId, isPracticeId, PRACTICE_LIMIT, PRACTICE_NAME_MAX } from '../../lib/practice.js';
import { dayHasPassed } from '../../lib/zones.js';

/*
    A planner's made-up people, for trying plans out on without anyone in Discord
    hearing about it. Each is made for one server and only listed while whoever made
    them still plans there. Everything here is done as the planner, even while they
    view the site as one of their people.
*/

const router = Router();

const shape = (person, guildName) => ({
    id: person.id,
    guildId: person.guildId,
    guildName,
    displayName: person.displayName,
    planner: person.planner
});

router.get('/', requireUser, async (req, res) => {
    const people = await getPracticePeople(req.realUser.id);
    const guildIds = [...new Set(people.map((p) => p.guildId))];
    const contexts = await Promise.all(guildIds.map((guildId) => guildContext(guildId, req.realUser.id)));
    const planning = new Map(guildIds.flatMap((guildId, i) => (contexts[i].isPlanner ? [[guildId, contexts[i].cfg.guildName]] : [])));

    res.json({ people: people.filter((p) => planning.has(p.guildId)).map((p) => shape(p, planning.get(p.guildId))) });
});

/*
    What the bot has sent the made-up person being viewed as, newest first, and the names
    of everyone it could mention by id, which is only ever the planner and their people.
*/
router.get('/messages', requireUser, async (req, res) => {
    if (!isPracticeId(req.user.id)) return res.json({ messages: [], names: {} });
    const [rows, people] = await Promise.all([getOutbox(req.user.id), getPracticePeople(req.realUser.id)]);
    const names = Object.fromEntries([[req.realUser.id, req.realUser.displayName], ...people.map((p) => [p.id, p.displayName])]);
    res.json({ messages: rows.map(outboxShape), names });
});

router.post('/', requireUser, async (req, res) => {
    const { guildId, displayName, planner } = req.body || {};
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (!name) return res.status(400).json({ error: 'Give them a name.' });
    if (name.length > PRACTICE_NAME_MAX) return res.status(400).json({ error: `Keep the name to ${PRACTICE_NAME_MAX} characters.` });
    if (typeof guildId !== 'string') return res.status(400).json({ error: 'Which server are they for?' });

    const ctx = await guildContext(guildId, req.realUser.id, { requirePlanner: true });
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    const person = await addPracticePerson({ id: newPracticeId(), ownerId: req.realUser.id, guildId, displayName: name, planner: planner === true });
    if (!person) return res.status(409).json({ error: `You have ${PRACTICE_LIMIT} made-up people in ${ctx.cfg.guildName} already.` });
    res.json({ person: shape(person, ctx.cfg.guildName) });
});

/*
    No planner role needed, since it only ever takes away. They come off every plan they
    were on, and their calendar and messages go with them.
*/
router.delete('/:id', requireUser, async (req, res) => {
    const person = await getPracticePerson(req.params.id);
    if (!person || person.ownerId !== req.realUser.id) return res.status(404).json({ error: 'There is nobody like that to remove.' });

    await removePracticePerson(person.id, req.realUser.id);
    const plans = await removeUserFromGuildPlans(person.guildId, person.id, { id: req.realUser.id, name: req.realUser.displayName || '' });
    for (const plan of plans) {
        if (plan.status === 'cancelled' || dayHasPassed(plan)) continue;
        await afterLeaving(plan).catch((err) => console.error(`[practice] ${plan.planId} after removing ${person.id}:`, err));
    }
    await deleteAllForUser(person.id);
    await deleteOutboxFor([], [person.id]);
    res.json({ ok: true });
});

/*
    View the site as one of them. Only ever the planner's own, and only while they plan
    in its server. From then on every request is made as that person, see requireUser.
*/
router.post('/as/:id', requireUser, async (req, res) => {
    const real = req.realUser;
    const person = await getPracticePerson(req.params.id);
    if (!person || person.ownerId !== real.id) return res.status(404).json({ error: 'There is nobody like that to view as.' });

    const ctx = await guildContext(person.guildId, real.id, { requirePlanner: true });
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    const user = { id: person.id, username: '', displayName: person.displayName, avatar: '' };
    issueSession(res, user, (await getTokenVersion(real.id)) ?? 0, real);
    res.json({ user, real });
});

//Back to the planner. Read straight off the cookie, so it works even once practice has had to end.
router.post('/back', async (req, res) => {
    const session = await loadSession(req);
    if (!session) return res.status(401).json({ error: 'You need to log in first.' });
    issueSession(res, session.real, session.tv);
    res.json({ user: session.real, real: null });
});

export default router;
