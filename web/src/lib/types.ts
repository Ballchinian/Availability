import type { FreePerson } from './overlap.js';

/*
    What the api hands back, as the screens read it. Written from the routes in
    backend/src/api, so a field renamed one end and not the other is a build
    error rather than a blank space on the page. The small one-off replies (how
    many were added, whether a change reopened the plan) stay inline at the call
    that asks for them, since naming them here would only spread them out.

    Anything the backend leaves off a document until it is set arrives as null,
    not missing: the routes spell that out with `|| null` on the way past.
*/

//Someone in a server, for the member picker
export interface Member {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
}

export type PlanStatus = 'collecting' | 'closed' | 'cancelled';

//Yes or no, either the person's own answer or a planner's call over the top of it
export type Answer = 'yes' | 'no';

//Someone on a plan, as the compare page sees them
export interface Participant {
    userId: string;
    displayName: string;
    avatarUrl: string;
    confirmed: boolean;
    vote: Answer | null;
    voteReason: string | null;
    override: Answer | null;
    invited: boolean;
    sureUntil: string | null;
}

//A day someone marked free, with the hours they narrowed it to
export interface AvailabilityDay {
    date: string;
    hours: number[];
}

//The plan itself, the half both plan screens are given
export interface Plan {
    planId: string;
    name: string;
    description: string;
    start: string;
    end: string;
    status: PlanStatus;
    allowedWeekdays: number[] | null;
    guildName: string;
    //The server's clock, which the plan's days and its set time are all read on
    timeZone: string;
}

//GET /plans/:planId, everything the availability page draws
export interface PlanScreen {
    plan: Plan;
    confirmed: boolean;
    confirmedCount: number;
    totalParticipants: number;
    availability: AvailabilityDay[];
    lastFilled: string | null;
    lastUpdatedAt: string | null;
    sureUntil: string | null;
    //Their own clock, which their hours are read on. Only worth mentioning when it is not the plan's.
    timeZone: string;
}

//The same plan with what a planner is allowed to know: the set date and the way back to Discord
export interface ComparePlan extends Plan {
    guildId: string;
    chosenDate: string | null;
    chosenTime: string | null;
    chosenNote: string | null;
    probeActive: boolean;
    //How often this comes round again, null for a one off
    repeatWeeks: number | null;
    //The plan this one came out of, and the one it went into once its day had been
    repeatedFrom: string | null;
    repeatedInto: string | null;
    threadUrl: string | null;
}

/*
    What every line of a plan's history carries. byName is who did it as they were called
    at the time, stored with the event rather than looked up now, so the list does not
    rewrite itself when someone changes their nickname or leaves.
*/
interface EventBase {
    at: string;
    by: string;
    byName: string;
}

//One thing that happened to a plan. The type picks which extra fields come with it.
export type PlanEvent =
    | (EventBase & { type: 'created' })
    | (EventBase & { type: 'chosen'; date: string; time: string | null; probe: boolean })
    | (EventBase & { type: 'moved'; date: string; time: string | null; probe: boolean; from: string })
    | (EventBase & { type: 'voided'; from: string; reason: string | null })
    | (EventBase & { type: 'range'; start: string; end: string })
    | (EventBase & { type: 'weekdays'; allowedWeekdays: number[] | null })
    | (EventBase & { type: 'details'; renamed: boolean })
    | (EventBase & { type: 'added'; count: number })
    | (EventBase & { type: 'left' })
    | (EventBase & { type: 'rejoined' })
    | (EventBase & { type: 'reminded'; kind: 'availability' | 'vote'; count: number })
    | (EventBase & { type: 'repeat'; repeatWeeks: number | null })
    //Written by the repeat sweep rather than by a person, so its by and byName are the plan's creator and blank
    | (EventBase & { type: 'repeated'; planId: string })
    | (EventBase & { type: 'cancelled' });

//GET /plans/:planId/compare
export interface CompareScreen {
    plan: ComparePlan;
    participants: Participant[];
    //Whether the planner is on the guest list too, so they get their own way to fill dates in
    youAreIn: boolean;
    confirmedCount: number;
    totalParticipants: number;
    freeByDate: Record<string, FreePerson[]>;
    //Oldest first, as it happened. The page turns it round to read latest first.
    history: PlanEvent[];
}

//POST /plans/:planId/availability
export interface SavedForPlan {
    confirmedCount: number;
    totalParticipants: number;
    savedDays: number;
    //The names of any other plans this save auto-confirmed them for
    confirmedPlans: string[];
}

//GET /availability, the general timetable with no plan behind it
export interface TimetableScreen {
    availability: AvailabilityDay[];
    lastFilled: string | null;
    lastUpdatedAt: string | null;
    sureUntil: string | null;
    //The clock these hours get read on when a plan lines them up against somebody else's
    timeZone: string;
}

//POST /availability
export interface SavedTimetable {
    savedDays: number;
    confirmedPlans: string[];
}

//GET /guilds/:guildId, where the requester stands in one server
export interface GuildInfo {
    guildId: string;
    guildName: string;
    isMember: boolean;
    isPlanner: boolean;
}

//GET /me/guilds, a server on the landing page
export interface UserGuild {
    guildId: string;
    guildName: string;
    iconUrl: string | null;
    setupComplete: boolean;
    isPlanner: boolean;
}

//GET /me/plans, a plan on the landing page, said from where this person stands in it
export interface UserPlan {
    planId: string;
    name: string;
    guildName: string;
    status: PlanStatus;
    start: string;
    end: string;
    chosenDate: string | null;
    chosenTime: string | null;
    //The clock that time is written on, since this list spans servers that need not share one
    timeZone: string;
    //A planner who did not invite themselves is running this one without being in it
    inIt: boolean;
    filledIn: boolean;
    mine: boolean;
}

//POST /guilds/:guildId/plans, what comes back from the create form
export interface CreatedPlan {
    planId: string;
    url: string;
    invited: number;
    dropped: number;
    //Only a set plan carries this, a collect plan has no date yet
    set?: boolean;
}
