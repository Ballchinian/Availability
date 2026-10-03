import type { FreePerson } from './overlap.js';
import type { Standing } from '../../../shared/coverage.js';

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

//Someone on a plan, as the overview sees them
export interface Participant {
    userId: string;
    displayName: string;
    avatarUrl: string;
    confirmed: boolean;
    vote: Answer | null;
    voteReason: string | null;
    override: Answer | null;
    invited: boolean;
    //Missing from a backend older than the site, for the few minutes a deploy takes
    dmsClosed?: boolean;
    //Where they stand on a plan still finding its day. Missing from an older backend too.
    in?: boolean | null;
    inReason?: string | null;
    standing?: Standing;
    daysLeft?: number;
    coveredUntil?: string | null;
    //The plan's days they are in for and haven't answered yet, as [first, last] runs
    unanswered?: [string, string][];
    //A host sent them back to answer again, and hasn't taken it back
    sentBack?: { byName: string } | null;
    //Their last save anywhere on their calendar, null if they have never saved
    updatedAt?: string | null;
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
    //What the plan ended up set for, all null while the day is still being found
    chosenDate: string | null;
    chosenTime: string | null;
    //Only ever read. A plan made before the description became the one field still has one,
    //and saving what it is about is what folds it in and drops it.
    chosenNote: string | null;
    //The server's clock, which the plan's days and its set time are all read on
    timeZone: string;
}

//GET /plans/:planId, everything the availability page draws
export interface PlanScreen {
    plan: Plan;
    //Missing from a backend older than the site, which is one that keeps the overview to planners
    role?: 'host' | 'guest';
    confirmed: boolean;
    confirmedCount: number;
    totalParticipants: number;
    availability: AvailabilityDay[];
    /*
        "Take my calendar as my answer up to", then where they stand. All four are missing
        from a backend older than the site, for the few minutes a deploy takes.
    */
    coveredUntil?: string | null;
    in?: Joining;
    inReason?: string | null;
    //The line under Count me in, blank once the plan has its day
    ask?: string;
    //The plan's days their calendar does not answer yet
    toFill?: string[];
    //Their own clock, which their hours are read on. Only worth mentioning when it is not the plan's.
    timeZone: string;
}

//The same plan with what a planner is allowed to know: the set date and the way back to Discord
export interface ComparePlan extends Plan {
    guildId: string;
    probeActive: boolean;
    //How often this comes round again, null for a one off, and who set it to. Missing from an older backend.
    repeatWeeks: number | null;
    repeatBy?: string | null;
    //The plan this one came out of, and the one it went into once its day had been
    repeatedFrom: string | null;
    repeatedInto: string | null;
    threadUrl: string | null;
    //What the edit form sends back, so a save made since it opened is caught. Missing from an older backend.
    rev?: number;
    createdBy?: string;
    //Holding made-up people, see api/practicePlans.js
    practice?: boolean;
}

/*
    One change a save on the edit form made, as the route records it and its review shows
    it. The same as Change in shared/planDiff.d.ts, with names where that has ids.
*/
export type EditChange =
    | { type: 'name'; from: string; to: string }
    | { type: 'description'; to: string }
    | { type: 'set'; date: string; time: string | null }
    | { type: 'day'; from: string; date: string; time: string | null }
    | { type: 'time'; from: string | null; to: string | null }
    | { type: 'collect'; start: string; end: string; allowedWeekdays: number[] | null }
    | { type: 'window'; start: string; end: string; allowedWeekdays: number[] | null }
    | { type: 'repeat'; from: number | null; to: number | null }
    | { type: 'added'; names: string[] }
    | { type: 'removed'; names: string[] }
    | { type: 'hosts'; added: string[]; removed: string[] };

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
    //The next three are only ever read: nothing writes them since the dates screen took
    //over the routes that did, and plans they were used on still carry them
    | (EventBase & { type: 'voided'; from: string; reason: string | null })
    | (EventBase & { type: 'range'; start: string; end: string })
    | (EventBase & { type: 'weekdays'; allowedWeekdays: number[] | null })
    //The window, the days, the crowd and the repeat moved together, from the ask-again screen
    | (EventBase & { type: 'dates'; start: string; end: string; allowedWeekdays: number[] | null; added: number; reopened: boolean })
    | (EventBase & { type: 'details'; renamed: boolean })
    | (EventBase & { type: 'added'; count: number })
    | (EventBase & { type: 'left' })
    | (EventBase & { type: 'rejoined' })
    | (EventBase & { type: 'reminded'; kind: 'availability' | 'vote'; count: number })
    //An edit to the time or note on a day that stayed put, as against moving the day itself. Only older ones say if they were quiet.
    | (EventBase & { type: 'when'; time: string | null; quiet?: boolean })
    | (EventBase & { type: 'confirmations'; active: boolean })
    | (EventBase & { type: 'repeat'; repeatWeeks: number | null })
    //Written by the repeat sweep rather than by a person, so its by and byName are the plan's creator and blank
    | (EventBase & { type: 'repeated'; planId: string })
    //The sweep again: the repeat stopped, since nobody who runs the plan still holds the planner role
    | (EventBase & { type: 'repeatended' })
    | (EventBase & { type: 'cancelled' })
    //Someone who did not run the plan made themselves one of the people who do
    | (EventBase & { type: 'tookon' })
    //One save on the edit form, however much it changed
    | (EventBase & { type: 'edited'; changes: EditChange[]; quiet: boolean });

//GET /plans/:planId/compare, a plan's overview as someone on it is sent it
export interface CompareScreen {
    plan: ComparePlan;
    /*
        Where the reader stands on the plan, and what that lets them see. All of it is
        missing from a backend older than the site, which only ever answered planners,
        so a missing role reads as host.
    */
    role?: 'host' | 'guest';
    //Whoever runs it, by name, and for whoever runs it the same people by id
    hosts?: string[];
    hostIds?: string[];
    canTakeOn?: boolean;
    //Whether they hold the planner role, so could start another plan like it
    isPlanner?: boolean;
    //Whether the days come with names. False for a guest on a plan from before guests could see them.
    seesDays?: boolean;
    //How many of the people in haven't answered each day, sent in place of names when seesDays is false
    unansweredCounts?: Record<string, number>;
    //Their own answer for a set day, null when they are not on the guest list
    you?: { vote: Answer | null; invited: boolean } | null;
    participants: Participant[];
    //Whether they are on the guest list themselves, so they get their own way to fill dates in
    youAreIn: boolean;
    confirmedCount: number;
    totalParticipants: number;
    freeByDate: Record<string, FreePerson[]>;
    //Oldest first, as it happened. The page turns it round to read latest first.
    history: PlanEvent[];
}

//POST /plans/:planId/edit with preview, what the review step draws
export interface EditPreview {
    changes: EditChange[];
    //Of everyone the plan will be waiting on, how many have nothing left to do and how many it will ask
    settled: number;
    asked: number;
    //Every message a loud save sends, to the thread or to these people by name
    messages: { kind: 'post' | 'card' | 'invite' | 'took off' | 'picked'; to: 'thread' | string[]; text: string }[];
    //Who a quiet save still DMs
    quietly: { name: string; why: 'cleared' | 'changed' | 'vote' | 'answer' | 'days' }[];
}

//What the same route sends someone who is not on the plan but could take it on: its name and nothing more of it
export interface TakeOnOffer {
    plan: { planId: string; name: string; guildName: string };
    role: null;
    canTakeOn: true;
    hosts: string[];
}

//A plan a save now answers, named with the way to its page
export interface PlanLink {
    planId: string;
    name: string;
}

//POST /plans/:planId/availability
export interface SavedForPlan {
    confirmedCount: number;
    totalParticipants: number;
    savedDays: number;
    //The other plans this save answered, and where it leaves them on this one. Missing from a backend older than the site.
    answers?: PlanLink[];
    in?: Joining;
    ask?: string;
    toFill?: string[];
}

//Count me in (true), Not for me (false), or not said yet
export type Joining = boolean | null;

//POST /plans/:planId/join, where it leaves them and who a Not for me was passed on to
export interface Joined {
    in: boolean;
    ask: string;
    toFill: string[];
    told: string[];
    missed: string[];
}

//POST /plans/:planId/vote, their answer for a set day and who a no was passed on to
export interface Voted {
    vote: Answer;
    told: string[];
    missed: string[];
}

//POST /plans/:planId/leave, the names the drop out DM reached and the ones it could not
export interface LeftPlan {
    told: string[];
    missed: string[];
}

//GET /availability, the general timetable with no plan behind it
export interface TimetableScreen {
    availability: AvailabilityDay[];
    lastFilled: string | null;
    lastUpdatedAt: string | null;
    //Missing from a backend older than the site, for the few minutes a deploy takes
    coveredUntil?: string | null;
    //The clock these hours get read on when a plan lines them up against somebody else's
    timeZone: string;
}

//POST /availability
export interface SavedTimetable {
    savedDays: number;
    answers?: PlanLink[];
}

//GET /guilds/:guildId, where the requester stands in one server
export interface GuildInfo {
    guildId: string;
    guildName: string;
    isMember: boolean;
    isPlanner: boolean;
    //Asked by someone made up, who can only start practice plans
    practice?: boolean;
}

//GET /me/guilds, a server Start a plan can offer
export interface UserGuild {
    guildId: string;
    guildName: string;
    iconUrl: string | null;
    setupComplete: boolean;
    isPlanner: boolean;
}

//GET /practice, one of a planner's made-up people
export interface PracticePerson {
    id: string;
    guildId: string;
    guildName: string;
    displayName: string;
    planner: boolean;
}

//GET /me/plans, a plan on My plans or Past plans, said from where this person stands in it
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
    //The older names for onList, having saved dates, and role being host, which are all a backend older than the site sends
    inIt: boolean;
    filledIn: boolean;
    mine: boolean;
    /*
        Where they stand on it, which nextStep in shared/coverage.js turns into the one
        thing the plan wants from them. All missing from a backend older than the site,
        for the few minutes a deploy takes.
    */
    role?: 'host' | 'guest';
    //Whoever runs it, other than them
    hosts?: string[];
    repeatWeeks?: number | null;
    onList?: boolean;
    standing?: Standing | null;
    daysLeft?: number;
    movedBack?: boolean;
    //Every day it asked about has gone, and it has no day
    datesPassed?: boolean;
    //For a set day: their own answer, or a call made on the board
    answer?: Answer | null;
    invited?: boolean;
    //They run it, and everyone has answered
    readyToPick?: boolean;
}

/*
    GET /plans/:planId/template, what "plan another like this" opens the create form with.
    No dates in it: the range is the one thing a plan run again does not keep.
*/
export interface PlanTemplate {
    name: string;
    description: string;
    allowedWeekdays: number[] | null;
    participantIds: string[];
    //Whoever ran it and is still in the server. Missing from a backend older than the site.
    hostIds?: string[];
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
