/*
    Types for dates.js, which is plain .js so node can run it unbuilt. Signatures
    only, no logic, so there is nothing here that can disagree with the code. The
    site imports these through web/src/lib, which is where they get their names.
*/

export function formatDate(iso?: string | null): string;
export function formatTime(t?: string | null): string;
export function weekdayOf(date: string): number;
export function weekdayAllowed(date: string, allowedWeekdays?: number[] | null): boolean;
export function describeWeekdays(allowedWeekdays?: number[] | null, everyDay?: string): string;
export const REPEAT_WEEKS: number[];
export function describeRepeat(weeks?: number | null): string;
export function isoDate(d: Date): string;
export function tomorrow(): string;
export function maxEnd(): string;
export function shiftDate(date: string, days: number): string;
export function daysBetween(from: string, to: string): number;
export function nextInSeries(date: string, weeks: number, notBefore: string): string | null;

//The plan as the repeat maths reads it, which is its window, its day and how often it comes round
export interface RepeatSource {
    repeatWeeks: number;
    dateRange: { start: string; end: string };
    chosenDate: string | null;
    chosenTime?: string | null;
    chosenNote?: string | null;
}

export interface PlanShape {
    set: boolean;
    dateRange: { start: string; end: string };
    chosen: { date: string; time: string | null; note: string | null } | null;
}

export function nextPlanShape(plan: RepeatSource, from?: string): PlanShape | null;
