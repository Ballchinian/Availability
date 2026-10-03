/*
    Types for planDiff.js, which is plain .js so node can run it unbuilt. Signatures
    only, no logic, so there is nothing here that can disagree with the code.
*/

import type { Answerer, Coverage } from './coverage.js';

//The parts of a plan these read
export interface Diffable {
    name: string;
    description?: string | null;
    chosenNote?: string | null;
    status: string;
    chosenDate?: string | null;
    chosenTime?: string | null;
    dateRange: { start: string; end: string };
    allowedWeekdays?: number[] | null;
    repeatWeeks?: number | null;
    participants?: (Answerer & { userId: string; invited?: boolean; override?: string | null })[];
    hostIds?: string[];
}

export type Change =
    | { type: 'name'; from: string; to: string }
    | { type: 'description'; to: string }
    //Finding a day before, its day now
    | { type: 'set'; date: string; time: string | null }
    | { type: 'day'; from: string; date: string; time: string | null }
    | { type: 'time'; from: string | null; to: string | null }
    //Its day before, finding one now
    | { type: 'collect'; start: string; end: string; allowedWeekdays: number[] | null }
    | { type: 'window'; start: string; end: string; allowedWeekdays: number[] | null }
    | { type: 'repeat'; from: number | null; to: number | null }
    | { type: 'added'; ids: string[] }
    | { type: 'removed'; ids: string[] }
    | { type: 'hosts'; added: string[]; removed: string[] };

export type Owed = 'vote' | 'answer' | 'days' | null;

export interface Hearing {
    userId: string;
    why: 'cleared' | 'changed' | 'vote' | 'answer' | 'days';
}

export function kindOf(plan: Pick<Diffable, 'status' | 'chosenDate'>): 'set' | 'collect';
export function diffPlan(before: Diffable, after: Diffable): Change[];
export function listed(changes: Change[]): Change[];
export function owedOn(p: Answerer & { invited?: boolean; override?: string | null }, plan: Diffable, coverage: Coverage): Owed;
export function whoHears(
    before: Diffable,
    after: Diffable,
    options?: { quiet?: boolean; owed?: Record<string, { before?: Owed; after?: Owed }> }
): Hearing[];
