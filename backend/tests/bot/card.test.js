import { describe, it, expect } from 'vitest';
import { planCard } from '../../src/bot/plans.js';

/*
    The one DM per person that says what a plan currently is. What matters here is that
    the same function builds the message on the day and rebuilds it a fortnight later,
    since a rewrite that lost something would take it off a message somebody already has.

    The rebuild cases pass no actor and no moved flag, reading both off the participant,
    which is exactly what a sync months later does.
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
const ids = (card) => card.components.flatMap((row) => row.components.map((b) => b.data.custom_id));

describe('planCard while a plan is still collecting', () => {
    it('reads as the invitation, with the actor, the link and the way to the thread', () => {
        const { content, components } = planCard(collecting, nobody, { guildName: 'The server', actorName: 'Ali' });
        expect(content).toContain('INVITED TO A PLAN');
        expect(content).toContain('Ali added you to the plan "Camping" in The server');
        expect(content).toContain('01/08/2026 to 30/08/2026');
        expect(content).toContain('a weekend away');
        expect(content).toContain('#/plan/ab12cd34ef');
        expect(content).toContain('/channels/g1/t1');
        expect(ids({ components })).toEqual(['drop|ab12cd34ef']);
    });

    /*
        The card is built before setPlanThread has been read back on the create path, and
        a jump link to a thread that is not there yet would be a dead link on a message
        meant to outlive the send.
    */
    it('drops the jump line rather than guessing when there is no thread yet', () => {
        const { content } = planCard({ ...collecting, threadId: null }, nobody, { actorName: 'Ali' });
        expect(content).not.toContain('Jump straight to the thread');
        expect(content).toContain('#/plan/ab12cd34ef');
    });

    //Nobody did this, it came round on a timer, so the line cannot name anyone
    it('says a repeat came round rather than naming whoever the sweep ran as', () => {
        const { content } = planCard({ ...collecting, repeatedFrom: 'zz99' }, nobody, { actorName: 'Ali' });
        expect(content).toContain('ROUND AGAIN');
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
    it('states the day, the time and the note, and offers the calendar', () => {
        const { content, components } = planCard(set, nobody, { guildName: 'The server', actorName: 'Ali' });
        expect(content).toContain('DATE SET');
        expect(content).toContain('Ali set the plan "Camping" in The server for');
        expect(content).toContain('12/08/2026');
        expect(content).toContain('7pm');
        expect(content).toContain('meet at the station');
        expect(content).toContain('a weekend away');
        expect(content).toContain('calendar');
        expect(components).toEqual([]);
    });

    it('says moved rather than set when the day was already taken', () => {
        const { content } = planCard(set, nobody, { actorName: 'Ali', moved: true });
        expect(content).toContain('PLAN CHANGED');
        expect(content).toContain('Ali moved the plan "Camping"');
    });

    //The half of a rebuild that has nothing else to read it off
    it('takes the moved flag off the participant when none is passed', () => {
        const { content } = planCard(set, { cardActor: 'Ali', cardMoved: true }, {});
        expect(content).toContain('Ali moved the plan "Camping"');
    });

    it('carries the yes/no buttons while the confirmation is running', () => {
        const card = planCard({ ...set, probeActive: true }, nobody, { actorName: 'Ali' });
        expect(card.content).toContain('CAN YOU MAKE IT?');
        expect(card.content).toContain('Can you make it? Tap below.');
        expect(ids(card)).toEqual(['vote|yes|ab12cd34ef', 'vote|no|ab12cd34ef']);
    });
});

/*
    The reason the card knows about votes at all. ackVote rewrites somebody's DM to their
    answer when they tap it, and a later sync that blanked that back to the question would
    read as the bot forgetting what they said.
*/
describe('planCard for somebody who has already answered', () => {
    it('keeps a yes on the card, with the calendar and a way to change it', () => {
        const card = planCard({ ...set, probeActive: true }, { vote: 'yes' }, { actorName: 'Ali' });
        expect(card.content).toContain("You're down as coming.");
        expect(card.content).not.toContain('Can you make it? Tap below.');
        expect(card.content).toContain('calendar');
        expect(ids(card)).toEqual(['vote|yes|ab12cd34ef', 'vote|no|ab12cd34ef']);
    });

    //Nothing to put in a calendar for somebody who is not coming
    it('keeps a no on the card without offering the calendar', () => {
        const card = planCard({ ...set, probeActive: true }, { vote: 'no' }, { actorName: 'Ali' });
        expect(card.content).toContain("You're down as not coming.");
        expect(card.content).not.toContain('calendar');
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
        const { content } = planCard({ ...set, probeActive: true }, nobody, { actorName: 'Ali', aside: '\nWorth a proper look.' });
        expect(content.indexOf('Worth a proper look.')).toBeLessThan(content.indexOf('Can you make it? Tap below.'));
        expect(content.indexOf('meet at the station')).toBeLessThan(content.indexOf('Worth a proper look.'));
    });

    //A rewrite passes none, so advice about a moment does not outlive the moment
    it('carries no aside when none is passed', () => {
        const { content } = planCard({ ...set, probeActive: true }, nobody, { actorName: 'Ali' });
        expect(content).not.toContain('Worth a proper look.');
    });
});
