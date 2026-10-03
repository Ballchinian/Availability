/*
    What the bot kept on the site for someone made up, or for a practice plan's thread, in
    the shape Discord would have been sent it. GET /practice/messages and
    GET /plans/:planId/thread.
*/

export interface KeptButton {
    type: 2;
    //1 blurple, 2 grey, 3 green, 4 red, 5 a link
    style: number;
    label?: string;
    custom_id?: string;
    url?: string;
    disabled?: boolean;
}

export interface KeptMessage {
    id: string;
    planId: string;
    content: string;
    components: { type: 1; components: KeptButton[] }[];
    pinned: boolean;
    at: string;
    editedAt: string | null;
}

export interface Kept {
    messages: KeptMessage[];
    //Whoever a message could mention by id
    names: Record<string, string>;
}

export type Bit = { text: string; bold?: boolean; code?: boolean };
export type MessageBlock = { line: Bit[] } | { list: Bit[][] };

//A Discord timestamp the way Discord draws it, in the reader's own clock
function stamp(seconds: string): string {
    return new Date(Number(seconds) * 1000).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

//One line in pieces, with its **bold** and `code` marked
function bits(line: string): Bit[] {
    return line
        .split(/(\*\*.+?\*\*|`[^`]+`)/)
        .filter(Boolean)
        .map((text) => (text.startsWith('**') && text.length > 4 ? { text: text.slice(2, -2), bold: true } : text.startsWith('`') && text.length > 2 ? { text: text.slice(1, -1), code: true } : { text }));
}

//A message's text as Discord draws it: mentions and timestamps read out, a paragraph a line, and a run of "- " lines as one list
export function messageBlocks(content: string, names: Record<string, string>): MessageBlock[] {
    const text = content.replace(/<@!?([^>]+)>/g, (_, id: string) => `@${names[id] ?? 'someone'}`).replace(/<t:(\d+)(?::\w)?>/g, (_, s: string) => stamp(s));
    const blocks: MessageBlock[] = [];
    for (const line of text.split('\n').filter(Boolean)) {
        const last = blocks[blocks.length - 1];
        if (!line.startsWith('- ')) blocks.push({ line: bits(line) });
        else if (last && 'list' in last) last.list.push(bits(line.slice(2)));
        else blocks.push({ list: [bits(line.slice(2))] });
    }
    return blocks;
}

//Where a link button goes. The bot's own links are this site, so they open here as the page they name.
export function hrefOf(url: string): { href: string; away: boolean } {
    const at = url.indexOf('/#/');
    return at >= 0 ? { href: url.slice(at + 1), away: false } : { href: url, away: true };
}

/*
    What a button does on the site: the answer it gives, through the same route the page
    answers with. A no asks for its reason first, as Discord's box does. Null for anything
    a card never carries.
*/
export type Press = { route: 'join' | 'vote'; planId: string; yes: boolean };

export function pressOf(customId: string | undefined): Press | null {
    const [kind, choice, planId] = (customId || '').split('|');
    if ((kind !== 'join' && kind !== 'vote') || !planId || (choice !== 'yes' && choice !== 'no')) return null;
    return { route: kind, planId, yes: choice === 'yes' };
}

//The body each route takes for the answer
export function pressBody(press: Press, reason: string): Record<string, unknown> {
    const why = press.yes ? {} : { reason: reason.trim() || null };
    return press.route === 'join' ? { in: press.yes, ...why } : { vote: press.yes ? 'yes' : 'no', ...why };
}
