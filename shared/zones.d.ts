/*
    Types for zones.js, which is plain .js so node can run it unbuilt. Signatures
    only, no logic, so there is nothing here that can disagree with the code. The
    site imports these through web/src/lib, which is where they get their names.
*/

export interface Wall {
    date: string;
    hour: number;
    minute: number;
}

export interface RetimedDay {
    date: string;
    hours: number[];
}

export const FALLBACK_ZONE: string;

export function isValidZone(zone?: string | null): boolean;
export function safeZone(zone?: string | null, fallback?: string): string;
export function instantToWall(zone: string, instant: Date): Wall;
export function wallToInstant(zone: string, date: string, hour?: number, minute?: number): Date;
export function clocksAgree(a: string, b: string, instant?: Date): boolean;
export function zoneOffsetLabel(zone: string, instant?: Date): string;
export function retimeDay(fromZone: string, toZone: string, date: string, hours?: number[]): RetimedDay[];
export function planInstant(zone: string, date?: string | null, time?: string | null): Date | null;
