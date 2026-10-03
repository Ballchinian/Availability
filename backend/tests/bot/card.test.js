import { describe, it, expect } from 'vitest';
import { planCard } from '../../src/bot/plans.js';

/*
    The DM saying what a plan is. What matters is that one send and a rebuild a fortnight
    later agree, since anything the rebuild loses comes off a message somebody already has.
    The rebuild cases pass no actor and no moved flag, which is what a later sync does.
*/

const collecting = {
    planId: 'ab12cd34ef',
    guildId: 'g1',
    threadId: 't1',
    name: 'Camping',
    description: 'a weekend away',
    dateRange: { start: '2026-08-01', end: '2026-08-30' },
    status: 'collecting',
    chosenDate: null
};

const set = {
    ...collecting,
    status: 'closed',
    chosenDate: '2026-08-12',
    chosenTime: '19:00',
    chosenNote: 'meet at the station',
    timeZone: 'Europe/London',
    probeActive: false
};

const nobody = {};
const ids = (card) => card.components.flatMap((row) => row.components.filter((b) => b.data.custom_id).map((b) => b.data.custom_id));
const links = (card) => card.components.flatMap((row) => row.components.filter((b) => b.data.url).map((b) => [b.data.label, b.data.url]));

describe('planCard while a plan is still collecting', () => {
    it('reads as the invitation, with the actor, and buttons to the dates and the thread', () => {
        const card = planCard(collecting, nobody, { guildName: 'The server', actorName: 'Ali' });
        expect(card.content).toMatch(/^\*\*INVITED\*\*/);
        expect(card.content).toContain('Ali added you to the plan "Camping" in The server');
        expect(card.content).toContain('Sat 1 Aug 2026 to Sun 30 Aug 2026');
        expect(card.content).toContain('a weekend away');
        expect(card.content).not.toMatch(/https?:\/\//);
        expect(links(card)).toEqual([
            ['Add my dates', expect.stringMatching(/#\/plan\/ab12cd34ef$/)],
            ['Open the thread', 'https://discord.com/channels/g1/t1']
        ]);
        expect(ids(card)).toEqual(['join|yes|ab12cd34ef', 'join|no|ab12cd34ef']);
    });

    it('asks if they are in, with what their calendar already answers', () => {
        const card = planCard(collecting, nobody, { ask: 'Then fill in your dates.' });
        expect(card.content.endsWith('\n\nAre you in? Then fill in your dates.')).toBe(true);
        expect(card.components[0].components.map((b) => b.data.label)).toEqual(['Count me in', 'Not for me']);
    });

    //The question is the thing to answer, so it comes before the way to the dates
    it('puts the question above the links', () => {
        expect(planCard(collecting, nobody, {}).components.map((row) => row.components[0].data.label)).toEqual(['Count me in', 'Add my dates']);
    });

    it('says where they stand once they have answered, with their answer ticked', () => {
        const inCard = planCard(collecting, { in: true }, { ask: '' });
        expect(inCard.content.endsWith("\n\nYou're in.")).toBe(true);
        expect(inCard.components[0].components.map((b) => b.data.label)).toEqual(["✓ I'm in", 'Not for me']);

        const outCard = planCard(collecting, { in: false }, { ask: 'Then fill in your dates.' });
        expect(outCard.content.endsWith("\n\nYou said it's not for you.")).toBe(true);
        expect(outCard.components[0].components.map((b) => b.data.label)).toEqual(['Count me in', '✓ Not for me']);
    });

    //Nobody from before the question has an answer stored, and filling in counted as in
    it('reads someone who filled in before the question as in', () => {
        expect(planCard(collecting, { confirmed: true }, {}).content).toContain("You're in.");
    });

    /*
        The card is built before setPlanThread has been read back on the create path, and
        a button to a thread that is not there yet would lead nowhere on a message meant to
        outlive the send.
    */
    it('leaves the thread button off rather than guessing when there is no thread yet', () => {
        const card = planCard({ ...collecting, threadId: null }, nobody, { actorName: 'Ali' });
        expect(links(card).map(([label]) => label)).toEqual(['Add my dates']);
    });

    //Nobody did this, it came round on a timer, so the line cannot name anyone
    it('says a repeat came round rather than naming whoever the sweep ran as', () => {
        const { content } = planCard({ ...collecting, repeatedFrom: 'zz99' }, nobody, { actorName: 'Ali' });
        expect(content).toContain('"Camping" is back round again');
        expect(content).not.toContain('Ali');
    });

    //A rebuild passes no actor and reads the one stored when the card was sent
    it('takes the actor off the participant when none is passed', () => {
        const { content } = planCard(collecting, { cardActor: 'Ali' }, { guildName: 'The server' });
        expect(content).toContain('Ali added you to the plan');
    });

    //An older plan has no stored actor, and a card with a dangling name would be worse
    it('still reads properly with no actor anywhere', () => {
        const { content } = planCard(collecting, nobody, { guildName: 'The server' });
        expect(content).toContain('You are on the plan "Camping" in The server');
    });
});

describe('planCard once a day is set', () => {
    it('states the day, the time and the note, with no calendar links', () => {
        const { content, components } = planCard(set, nobody, { guildName: 'The server', actorName: 'Ali' });
        expect(content).toMatch(/^\*\*DAY SET\*\*/);
        expect(content).toContain('Ali set the plan "Camping" in The server for');
        expect(content).toContain('Wed 12 Aug 2026');
        expect(content).toContain('7pm');
        expect(content).toContain('meet at the station');
        expect(content).toContain('a weekend away');
        expect(content).not.toMatch(/calendar\.google|\.ics/);
        expect(components).toEqual([]);
    });

    it('says moved rather than set when the day was already taken', () => {
        const { content } = planCard(set, nobody, { actorName: 'Ali', moved: true });
        expect(content).toMatch(/^\*\*CHANGED\*\*/);
        expect(content).toContain('Ali moved the plan "Camping"');
    });

    //The half of a rebuild that has nothing else to read it off
    it('takes the moved flag off the participant when none is passed', () => {
        const { content } = planCard(set, { cardActor: 'Ali', cardMoved: true }, {});
        expect(content).toContain('Ali moved the plan "Camping"');
    });

    it('carries the yes/no buttons while the confirmation is running', () => {
        const card = planCard({ ...set, probeActive: true }, nobody, { actorName: 'Ali' });
        expect(card.content).toMatch(/^\*\*DAY SET\*\*/);
        expect(card.content).toMatch(/Can you make it\?$/);
        expect(ids(card)).toEqual(['vote|yes|ab12cd34ef|r0', 'vote|no|ab12cd34ef|r0']);
    });
});

/*
    The reason the card knows about votes at all. ackVote rewrites somebody's DM to their
    answer when they tap it, and a later sync that blanked that back to the question would
    read as the bot forgetting what they said.
*/
describe('planCard for somebody who has already answered', () => {
    it('keeps a yes on the card, with a way to change it and no calendar links', () => {
        const card = planCard({ ...set, probeActive: true }, { vote: 'yes' }, { actorName: 'Ali' });
        expect(card.content).toContain("You're down as coming.");
        expect(card.content).not.toContain('Can you make it?');
        expect(card.content).not.toMatch(/calendar\.google|\.ics/);
        expect(ids(card)).toEqual(['vote|yes|ab12cd34ef|r0', 'vote|no|ab12cd34ef|r0']);
    });

    it('keeps a no on the card', () => {
        const card = planCard({ ...set, probeActive: true }, { vote: 'no' }, { actorName: 'Ali' });
        expect(card.content).toContain("You're down as not coming.");
    });

    //A closed confirmation leaves nobody holding a live button, which is what a stale tap was
    it('drops the buttons and the answer once the confirmation is closed', () => {
        const card = planCard({ ...set, probeActive: false }, { vote: 'yes' }, { actorName: 'Ali' });
        expect(card.components).toEqual([]);
        expect(card.content).not.toContain("You're down as coming.");
        expect(card.content).toContain('Ali set the plan "Camping"');
    });
});

describe('planCard asides', () => {
    //Advice about this send, so it has to land before what the card is asking them to do
    it('puts an aside after the plan and before the call to action', () => {
        const { content } = planCard({ ...set, probeActive: true }, nobody, { actorName: 'Ali', aside: 'Worth a proper look.' });
        expect(content.indexOf('Worth a proper look.')).toBeLessThan(content.indexOf('Can you make it?'));
        expect(content.indexOf('meet at the station')).toBeLessThan(content.indexOf('Worth a proper look.'));
    });

    it('puts it under the plan on a card still collecting dates', () => {
        const { content } = planCard(collecting, nobody, { actorName: 'Ali', aside: 'Ali has asked you to fill in your dates.' });
        expect(content.indexOf('a weekend away')).toBeLessThan(content.indexOf('Ali has asked you'));
    });

    it('swaps the banner for this send and no rebuild after it', () => {
        expect(planCard(collecting, nobody, { title: 'REMINDER' }).content).toMatch(/^\*\*REMINDER\*\*/);
        expect(planCard(collecting, nobody, {}).content).toMatch(/^\*\*INVITED\*\*/);
    });
});

//The words are one per thing everywhere
describe('planCard wording', () => {
    const cards = () => [
        planCard(collecting, nobody, { actorName: 'Ali' }),
        planCard({ ...set, probeActive: true }, nobody, { actorName: 'Ali' }),
        planCard({ ...set, probeActive: true }, { vote: 'yes' }, {}),
        planCard({ ...set, status: 'cancelled' }, nobody, { actorName: 'Ali' })
    ];

    it('uses only the new banners', () => {
        expect(cards().map((c) => c.content.match(/^\*\*([A-Z ]+)\*\*/)[1])).toEqual(['INVITED', 'DAY SET', 'DAY SET', 'CALLED OFF']);
    });
});
