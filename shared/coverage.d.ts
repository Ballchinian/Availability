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
export function answeredOn(date: string, answers?: Answers): boolean;
export function coverageOf(input: Answers & {
    window: Window;
    today?: string;
    sentBack?: unknown;
    theirDays?: (date: string) => string[];
}): Coverage;
export function inOf(p: Answerer): boolean | null;
export function standing(p: Answerer, coverage: Coverage): Standing;
export function owes(p: Answerer, coverage: Coverage): 'answer' | 'days' | null;
export function askLine(coverage: Coverage, extra?: { free?: number; updated?: string | null }): string;
