import { formatDate, formatTime, describeWeekdays, describeRepeat } from '../lib/dates.js';
import { listed } from '../../../shared/planDiff.js';

/*
    What the bot says about an edit, as text and nothing else. The edit route's preview
    reads these and announceEdit sends them, so what the review step shows is what goes
    out. No Discord in here: a card's buttons and who it reached are announceEdit's.
*/

const whenOf = (date, time) => `${formatDate(date)}${time ? ` at ${formatTime(time)}` : ''}`;

function windowOf({ start, end, allowedWeekdays }) {
    const days = describeWeekdays(allowedWeekdays);
    return `${formatDate(start)} to ${formatDate(end)}${days === 'every day' ? '' : `, ${days} only`}`;
}

//One change as a line under "Ali changed X:"
export function changeLine(change) {
    switch (change.type) {
        case 'name':
            return `now called **${change.to}**`;
        case 'description':
            return change.to ? `what it's about: ${change.to}` : "it doesn't say what it's about any more";
        case 'set':
        case 'day':
            return `it's on ${whenOf(change.date, change.time)} now`;
        case 'time':
            return change.to ? `it starts at ${formatTime(change.to)} now` : "it doesn't have a set time now";
        case 'collect':
            return `it doesn't have a day now, and asks about ${windowOf(change)}`;
        case 'window':
            return `it asks about ${windowOf(change)} now`;
        case 'repeat':
            return change.to ? `it comes round ${describeRepeat(change.to)}` : "this is the last time it comes round";
        default:
            return '';
    }
}

//The list everyone hears, under the name the plan had. Blank when nothing everyone hears about moved.
export function editText(actorName, before, changes) {
    const lines = listed(changes).map((c) => `- ${changeLine(c)}`);
    return lines.length ? `${actorName} changed **${before.name}**:\n${lines.join('\n')}` : '';
}

export const tookOffText = (actorName, plan, where) => `${actorName} took you off "${plan.name}"${where}.`;
export const pickedText = (actorName, plan, where) => `${actorName} picked you to run "${plan.name}"${where} with them.`;

/*
    Every message one save sends, each with who it goes to: a post in the thread, the
    list on top of a fresh card, the invitation for anyone added, a line for anyone taken
    off and one for anyone picked to run it. heard is whoHears's, for the save as loud or
    quiet as it is. A quiet save posts nothing and tells nobody they were taken off: their
    card is rewritten into that line where it sits.
*/
export function buildEditMessages(before, after, changes, { actorName, guildName = '', quiet = false, heard = [] }) {
    const where = guildName ? ` in ${guildName}` : '';
    const text = editText(actorName, before, changes);
    const of = (type) => changes.find((c) => c.type === type);
    const messages = [];

    if (text && !quiet) messages.push({ kind: 'post', to: 'thread', text: `**CHANGED**\n\n${text}` });
    if (text && heard.length) messages.push({ kind: 'card', to: heard.map((h) => h.userId), text });
    if (of('added')) messages.push({ kind: 'invite', to: of('added').ids, text: '' });
    if (of('removed') && !quiet) messages.push({ kind: 'took off', to: of('removed').ids, text: tookOffText(actorName, before, where) });
    if (of('hosts')?.added.length) messages.push({ kind: 'picked', to: of('hosts').added, text: pickedText(actorName, after, where) });
    return messages;
}
