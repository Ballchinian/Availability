/*
    Types for dates.js, which is plain .js so node can run it unbuilt. Signatures
    only, no logic, so there is nothing here that can disagree with the code. The
    site imports these through web/src/lib, which is where they get their names.
*/

export function formatDate(iso: string): string;
export function formatTime(t?: string | null): string;
export function weekdayOf(date: string): number;
export function weekdayAllowed(date: string, allowedWeekdays?: number[] | null): boolean;
export function describeWeekdays(allowedWeekdays?: number[] | null, everyDay?: string): string;
