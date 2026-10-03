import { shortId } from './ids.js';

/*
    Made-up people a planner tries plans out on. Their ids are never all digits, so one
    that reaches Discord by mistake is refused there rather than finding somebody.
*/
export const PRACTICE_PREFIX = 'practice_';
//Per planner per server
export const PRACTICE_LIMIT = 10;
export const PRACTICE_NAME_MAX = 32;

export function isPracticeId(id) {
    return typeof id === 'string' && id.startsWith(PRACTICE_PREFIX);
}

export function newPracticeId() {
    return PRACTICE_PREFIX + shortId(10);
}
