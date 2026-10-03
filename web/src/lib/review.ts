import { formatDate, formatDay, formatTime, describeWeekdays, describeRepeat, listNames } from './format.js';
import type { EditChange, EditPreview } from './types.js';

/*
    What the edit form's review step says. Built from what the edit route's preview hands
    back, so the lines here describe the save the route will actually make.
*/

const whenOf = (date: string, time: string | null) => `${formatDate(date)}${time ? ` at ${formatTime(time)}` : ''}`;

function windowOf(change: { start: string; end: string; allowedWeekdays: number[] | null }): string {
    const days = describeWeekdays(change.allowedWeekdays);
    return `${formatDate(change.start)} to ${formatDate(change.end)}${days ? `, ${days} only` : ''}`;
}

//A few names, then how many more, for everyone one message goes to
export function someNames(names: string[], show = 3): string {
    if (names.length <= show + 1) return listNames(names);
    return `${names.slice(0, show).join(', ')} and ${names.length - show} others`;
}

//Of the people the plan waits on, how many have nothing left to do and how many it asks
function counts({ settled, asked }: Pick<EditPreview, 'settled' | 'asked'>): string {
    const bits = [settled ? `${settled} already answered` : '', asked ? `${asked} will be asked` : ''].filter(Boolean);
    return bits.length ? `: ${bits.join(', ')}` : '';
}

//One change as a line of the review
export function reviewLine(change: EditChange, preview: Pick<EditPreview, 'settled' | 'asked'>): string {
    switch (change.type) {
        case 'name':
            return `Name: ${change.to}, was ${change.from}`;
        case 'description':
            return change.to ? `What it's about: ${change.to}` : "No longer says what it's about";
        case 'set':
            return `Set for ${whenOf(change.date, change.time)}${counts(preview)}`;
        case 'day':
            return `Moved to ${whenOf(change.date, change.time)}, from ${formatDate(change.from)}${counts(preview)}`;
        case 'time':
            if (!change.to) return `No set time, was ${formatTime(change.from)}`;
            return `Starts at ${formatTime(change.to)}${change.from ? `, was ${formatTime(change.from)}` : ''}`;
        case 'collect':
            return `Now finding a day, ${windowOf(change)}${counts(preview)}`;
        case 'window':
            return `Now asking about ${windowOf(change)}${counts(preview)}`;
        case 'repeat':
            return change.to ? `Comes round ${describeRepeat(change.to)}` : 'Stops coming round again';
        case 'added':
            return `Adding ${listNames(change.names)}`;
        case 'removed':
            return `Taking ${listNames(change.names)} off`;
        case 'hosts':
            return [
                change.added.length ? `${listNames(change.added)} running it too` : '',
                change.removed.length ? `${listNames(change.removed)} not running it any more` : ''
            ].filter(Boolean).join(', ');
    }
}

//The save button, named for the biggest thing it does
export function saveLabel(changes: EditChange[]): string {
    for (const change of changes) {
        if (change.type === 'set') return `Save and set it for ${formatDay(change.date)}`;
        if (change.type === 'day') return `Save and move it to ${formatDay(change.date)}`;
        if (change.type === 'collect') return 'Save and ask about dates again';
        if (change.type === 'window') return 'Save and ask about these dates';
    }
    return 'Save changes';
}

const WHY: Record<string, string> = {
    cleared: 'the day they answered for has moved',
    vote: 'they now have to say if they can make it',
    answer: "they now have to say if they're in",
    days: 'they now have days to fill in'
};

/*
    Who a quiet save still reaches, which is what Save quietly is described by. The
    people it leaves out are only counted: their DM is corrected where it sits.
*/
export function quietLine(preview: EditPreview): string {
    const toOf = (kind: string) => {
        const to = preview.messages.find((m) => m.kind === kind)?.to;
        return Array.isArray(to) ? to : [];
    };
    const untold = toOf('card').length - preview.quietly.length;
    const lines = [`Nothing goes in the thread${untold > 0 ? `, and ${untold} ${untold === 1 ? "person isn't" : "people aren't"} DMed` : ''}.`];

    for (const why of Object.keys(WHY)) {
        const names = preview.quietly.filter((h) => h.why === why).map((h) => h.name);
        if (names.length) lines.push(`${someNames(names)} ${names.length === 1 ? 'is' : 'are'} still DMed, since ${WHY[why]}.`);
    }
    const invited = toOf('invite');
    if (invited.length) lines.push(`${someNames(invited)} still ${invited.length === 1 ? 'gets' : 'get'} the invitation.`);
    const picked = toOf('picked');
    if (picked.length) lines.push(`${someNames(picked)} ${picked.length === 1 ? 'is' : 'are'} still told they run it.`);
    return lines.join(' ');
}

export type Part = { text: string; bold: boolean };
export type Block = { line: Part[] } | { list: Part[][] };

//A line of the bot's own text in pieces, with its **bold** marked, so the page can draw it the way Discord will
export function boldParts(line: string): Part[] {
    return line
        .split(/\*\*(.+?)\*\*/)
        .map((text, i) => ({ text, bold: i % 2 === 1 }))
        .filter((part) => part.text);
}

//The bot's text as Discord draws it: a paragraph a line, with a run of lines starting "- " as one list
export function discordBlocks(text: string): Block[] {
    const blocks: Block[] = [];
    for (const line of text.split('\n').filter(Boolean)) {
        const last = blocks[blocks.length - 1];
        if (!line.startsWith('- ')) blocks.push({ line: boldParts(line) });
        else if (last && 'list' in last) last.list.push(boldParts(line.slice(2)));
        else blocks.push({ list: [boldParts(line.slice(2))] });
    }
    return blocks;
}
