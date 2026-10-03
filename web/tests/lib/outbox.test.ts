import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { hrefOf, messageBlocks, pressBody, pressOf, type KeptMessage } from '../../src/lib/outbox.js';
import BotMessage from '../../src/lib/BotMessage.svelte';

//What the bot kept for practice, drawn the way Discord shows it, and its buttons answering through the site

describe('a kept message as text', () => {
    const names = { ali: 'Ali', practice_pat: 'Pat' };

    it('names whoever it mentions, and someone it has no name for', () => {
        expect(messageBlocks('<@ali> <@!practice_pat> <@gone>', names)).toEqual([{ line: [{ text: '@Ali @Pat @someone' }] }]);
    });

    it('marks bold and code, with a paragraph a line and the blank lines gone', () => {
        expect(messageBlocks('**DAY SET**\n\n`/free` in **Fire drill**', names)).toEqual([
            { line: [{ text: 'DAY SET', bold: true }] },
            { line: [{ text: '/free', code: true }, { text: ' in ' }, { text: 'Fire drill', bold: true }] }
        ]);
    });

    it('makes one list of a run of "- " lines', () => {
        expect(messageBlocks('Ali changed it:\n- now called **Quiz**\n- a new day', names)).toEqual([
            { line: [{ text: 'Ali changed it:' }] },
            { list: [[{ text: 'now called ' }, { text: 'Quiz', bold: true }], [{ text: 'a new day' }]] }
        ]);
    });

    it('reads a timestamp out in the reader\'s clock', () => {
        const [block] = messageBlocks('at <t:1791230400:f> your time', names);
        expect('line' in block && block.line[0].text).not.toContain('<t:');
    });
});

describe('a link button', () => {
    it('opens the site page it names here', () => {
        expect(hrefOf('https://availabilityspreadsheet.netlify.app/#/plan/p1/overview')).toEqual({ href: '#/plan/p1/overview', away: false });
    });

    it('leaves anywhere else as it is', () => {
        expect(hrefOf('https://discord.com/channels/g1/t1')).toEqual({ href: 'https://discord.com/channels/g1/t1', away: true });
    });
});

describe('a pressed button', () => {
    it('answers through join and vote, with a reason only on a no', () => {
        expect(pressOf('join|yes|p1')).toEqual({ route: 'join', planId: 'p1', yes: true });
        expect(pressOf('vote|no|p1|r2')).toEqual({ route: 'vote', planId: 'p1', yes: false });
        expect(pressBody({ route: 'join', planId: 'p1', yes: true }, 'ignored')).toEqual({ in: true });
        expect(pressBody({ route: 'join', planId: 'p1', yes: false }, ' Away ')).toEqual({ in: false, reason: 'Away' });
        expect(pressBody({ route: 'vote', planId: 'p1', yes: false }, '')).toEqual({ vote: 'no', reason: null });
    });

    it('does nothing it was not made for', () => {
        expect(pressOf('cancel|yes|p1')).toBe(null);
        expect(pressOf(undefined)).toBe(null);
    });
});

describe('a kept card', () => {
    const message: KeptMessage = {
        id: 'm1',
        planId: 'p1',
        content: '**INVITED**\n\nAli added you to the plan "Fire drill".\n\nAre you in?',
        components: [
            { type: 1, components: [{ type: 2, style: 3, label: 'Count me in', custom_id: 'join|yes|p1' }, { type: 2, style: 4, label: 'Not for me', custom_id: 'join|no|p1' }] },
            { type: 1, components: [{ type: 2, style: 5, label: 'Add my dates', url: 'https://site/#/plan/p1' }] }
        ],
        pinned: false,
        at: '2026-10-03T18:00:00.000Z',
        editedAt: '2026-10-03T18:05:00.000Z'
    };
    const body = render(BotMessage, { props: { message, names: {}, onanswered: () => {} } }).body;

    it('says it was edited', () => {
        expect(body).toContain('(edited)');
        expect(body).toContain('<strong>INVITED</strong>');
    });
});
