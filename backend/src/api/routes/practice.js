import { Router } from 'express';
import { requireUser } from '../../lib/session.js';
import { guildContext } from '../context.js';
import { getPracticePeople, getPracticePerson, addPracticePerson, removePracticePerson } from '../../db/practice.js';
import { removeUserFromGuildPlans } from '../../db/plans.js';
import { deleteAllForUser } from '../../db/availability.js';
import { afterLeaving } from '../../bot/plans.js';
import { newPracticeId, PRACTICE_LIMIT, PRACTICE_NAME_MAX } from '../../lib/practice.js';
import { dayHasPassed } from '../../lib/zones.js';

/*
    A planner's made-up people, for trying plans out on without anyone in Discord
    hearing about it. Each is made for one server and only listed while whoever made
    them still plans there.
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
    const people = await getPracticePeople(req.user.id);
    const guildIds = [...new Set(people.map((p) => p.guildId))];
    const contexts = await Promise.all(guildIds.map((guildId) => guildContext(guildId, req.user.id)));
    const planning = new Map(guildIds.flatMap((guildId, i) => (contexts[i].isPlanner ? [[guildId, contexts[i].cfg.guildName]] : [])));

    res.json({ people: people.filter((p) => planning.has(p.guildId)).map((p) => shape(p, planning.get(p.guildId))) });
});

router.post('/', requireUser, async (req, res) => {
    const { guildId, displayName, planner } = req.body || {};
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (!name) return res.status(400).json({ error: 'Give them a name.' });
    if (name.length > PRACTICE_NAME_MAX) return res.status(400).json({ error: `Keep the name to ${PRACTICE_NAME_MAX} characters.` });
    if (typeof guildId !== 'string') return res.status(400).json({ error: 'Which server are they for?' });

    const ctx = await guildContext(guildId, req.user.id, { requirePlanner: true });
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message });

    const person = await addPracticePerson({ id: newPracticeId(), ownerId: req.user.id, guildId, displayName: name, planner: planner === true });
    if (!person) return res.status(409).json({ error: `You have ${PRACTICE_LIMIT} made-up people in ${ctx.cfg.guildName} already.` });
    res.json({ person: shape(person, ctx.cfg.guildName) });
});

/*
    No planner role needed, since it only ever takes away. They come off every plan they
    were on, and their calendar goes with them.
*/
router.delete('/:id', requireUser, async (req, res) => {
    const person = await getPracticePerson(req.params.id);
    if (!person || person.ownerId !== req.user.id) return res.status(404).json({ error: 'There is nobody like that to remove.' });

    await removePracticePerson(person.id, req.user.id);
    const plans = await removeUserFromGuildPlans(person.guildId, person.id, { id: req.user.id, name: req.user.displayName || '' });
    for (const plan of plans) {
        if (plan.status === 'cancelled' || dayHasPassed(plan)) continue;
        await afterLeaving(plan).catch((err) => console.error(`[practice] ${plan.planId} after removing ${person.id}:`, err));
    }
    await deleteAllForUser(person.id);
    res.json({ ok: true });
});

export default router;
