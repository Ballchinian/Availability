/*
    What a planner had decided about one plan, kept on the device.

    The miss slider is how the compare grid is read, and it started at nought every
    time the page was arrived at, so anyone who had settled on "two can miss out" set
    it again on the way back from filling in their own dates.

    localStorage rather than session, against what the note asked for: the usual way
    onto this page is the compare link in the Discord thread, which opens a tab of its
    own, and per-tab storage forgets on exactly that trip. How many people a plan can
    do without is a decision about the plan rather than where a tab is up to, so it
    should outlive the tab that made it. Cost is a few bytes per plan ever compared,
    left behind when the plan is, which nothing here bothers to sweep up.
*/

const missKey = (planId: string) => `miss:${planId}`;

/*
    Clamped on the way out rather than on the way in, since a plan can lose people
    between visits and the top of the slider goes with them.
*/
export function recallMiss(planId: string, max: number): number {
    try {
        const miss = Number(localStorage.getItem(missKey(planId)));
        if (!Number.isFinite(miss)) return 0;
        return Math.min(Math.max(Math.round(miss), 0), Math.max(max, 0));
    } catch {
        return 0;
    }
}

export function rememberMiss(planId: string, miss: number): void {
    try {
        localStorage.setItem(missKey(planId), String(miss));
    } catch {
        //Storage turned off, so the slider forgets between visits
    }
}
