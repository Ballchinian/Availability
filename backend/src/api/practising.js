import { getPracticePerson } from '../db/practice.js';
import { guildContext } from './context.js';

/*
    Why a planner viewing the site as one of their made-up people has to stop, or null
    while they can go on: the person was removed, or the planner no longer plans in the
    server they were made for. Asked on every request made as them.
*/
export async function practiceEnded(personId, ownerId) {
    const person = await getPracticePerson(personId);
    if (!person || person.ownerId !== ownerId) return "You're back as yourself, since that made-up person was removed.";
    const ctx = await guildContext(person.guildId, ownerId);
    if (!ctx.isPlanner) return `You're back as yourself, since you no longer have the planner role in ${ctx.cfg?.guildName || 'that server'}.`;
    return null;
}
