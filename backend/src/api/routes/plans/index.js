import { Router } from 'express';
import { requireUser } from '../../../lib/session.js';
import { getPlan } from '../../../db/plans/index.js';
import { ipLimit } from '../../../lib/iplimit.js';
import { hiddenFrom } from './gates.js';
import { answerRoutes } from './answers.js';
import { overviewRoutes } from './overview.js';
import { runningRoutes } from './running.js';
import { editRoutes } from './edit.js';

//Every route about one plan. This finds the plan, and the files beside it hold the routes, by who uses them.

const router = Router();

/*
    The one thing about a plan anyone holding its link can read, logged in or not: its
    name, so a logged out visitor can see what the link is for before logging in.

    :id rather than :planId, so the limit runs before the lookup rather than after it.
*/
const limitName = ipLimit({
    limit: 120,
    windowMs: 10 * 60 * 1000,
    message: 'That is a lot of plan links from one place. Give it ten minutes and try again.'
});

router.get('/:id/name', limitName, async (req, res) => {
    const plan = await getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'That plan does not exist.' });
    res.json({ name: plan.name });
});

//Ahead of the lookup below on purpose: express runs a param callback before the route's own
//middleware, so without this a logged out request would read a plan out of the database
router.use(requireUser);

/*
    The plan the whole file is about, on req for every route under it. Answering a
    missing one here is what lets each handler open with its own gate rather than
    with the same four lines the one before it wrote.
*/
router.param('planId', async (req, res, next, planId) => {
    const plan = await getPlan(planId);
    if (!plan || hiddenFrom(plan, req)) return res.status(404).json({ error: 'That plan does not exist.' });
    req.plan = plan;
    next();
});

answerRoutes(router);
overviewRoutes(router);
runningRoutes(router);
editRoutes(router);

export default router;
