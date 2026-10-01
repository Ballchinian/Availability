/*
    Types for coverage.js, which is plain .js so node can run it unbuilt. Signatures
    only, no logic, so there is nothing here that can disagree with the code.
*/

export interface Window {
    start: string;
    end: string;
    allowedWeekdays?: number[] | null;
}

export interface Answers {
    coveredUntil?: string | null;
    answered?: Window[] | null;
}

export interface Coverage {
    state: 'covered' | 'partial' | 'none';
    daysLeft: number;
    lastCovered: string | null;
    total: number;
}

export type Standing = 'not-said' | 'done' | 'days-left' | 'no-dates' | 'out';

//The parts of a participant these read, including the ones saved before in existed
export interface Answerer {
    in?: boolean | null;
    confirmed?: boolean;
    vote?: string | null;
}

export function askedDays(window?: Partial<Window>): string[];
export function datesPassed(window: Partial<Window>, today: string): boolean;
export function answeredOn(date: string, answers?: Answers): boolean;
export interface PlanAnswers extends Answers {
    window: Window;
    today?: string;
    sentBack?: unknown;
    theirDays?: (date: string) => string[];
}

export function coverageOf(answers: PlanAnswers): Coverage;
export function daysToFill(answers: PlanAnswers): string[];
export function toFillRuns(answers: PlanAnswers): [string, string][];
export function inOf(p: Answerer): boolean | null;
export function standing(p: Answerer, coverage: Coverage): Standing;
export function owes(p: Answerer, coverage: Coverage): 'answer' | 'days' | null;

//Where someone stands on one plan, as GET /me/plans sends it
export interface PlanRow {
    status: string;
    role?: 'host' | 'guest';
    onList?: boolean;
    standing?: Standing | null;
    daysLeft?: number;
    movedBack?: boolean;
    datesPassed?: boolean;
    answer?: string | null;
    invited?: boolean;
    readyToPick?: boolean;
    over?: boolean;
}

export interface NextStep {
    label: string;
    page: 'plan' | 'overview' | 'dates';
    asks: boolean;
}

export function nextStep(row: PlanRow): NextStep;
export function askLine(coverage: Coverage, extra?: { free?: number; updated?: string | null; joined?: boolean }): string;
