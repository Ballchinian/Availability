<script lang="ts">
    import Legal from '../lib/Legal.svelte';
</script>

<Legal title="Availability Privacy Policy">
    <p>
        This policy explains what data Availability (the website and the Discord bot) stores, why, and
        how to get it removed. The short version: we store the minimum needed to work out when a group is
        free, we don't sell anything, and there's no advertising or tracking.
    </p>

    <h2>What we store</h2>
    <p>
        <strong>Your Discord account:</strong> your Discord user ID, username, display name and avatar,
        from the "identify" scope when you log in, and when you first and last logged in. It's what lets
        the site know who you are and show you back to yourself.
        <br />
        <strong>Your time zone:</strong> the one your browser reports, saved whenever it changes, so the
        hours you mark are read on your own clock.
        <br />
        <strong>Your calendar:</strong> the days you mark as free, any hours you narrow a day down to, the
        date you take your calendar as your answer up to if you set one, and the stretches of days you've
        answered on a plan's page or with /free. This is saved against your account and carried across
        plans and servers, so you don't have to fill it in twice.
        <br />
        <strong>Servers you share with the bot:</strong> which servers (that have the bot) you're in, so
        we know when your calendar is still needed by anyone.
        <br />
        <strong>Plans:</strong> a plan's name, optional description, date range, who runs it, who's invited, who has
        filled in their dates, whether each person is in or said it's not for them, with any short reason
        they gave, and the day, time and any note it's set for. Once a day is set, also each
        person's yes or no, any short reason given for a no, a planner's call on the board, and who is on
        that day's list. When the day moves, those answers are kept for the last three days the plan has
        been on, so they come back if it moves back. Each plan keeps its last 100 events: what happened, when, and who did it, under
        the name they had then. Anyone who opens a plan's link sees its name, even logged out, so they can
        tell what the link is for. That's all a logged-out visitor sees.
        <br />
        <strong>The bot's DMs:</strong> the ID of the message the bot last sent you about each plan, so it
        can rewrite that message when the plan changes, and whether your DMs were closed the last time it
        tried, so the overview can show whoever runs the plan that the thread is the only way to reach you.
        <br />
        <strong>Server settings:</strong> for each server, which channel is the plans channel, which role
        can plan, the time zone its plans run on, who ran /setup, and the intro message the
        bot pinned.
        <br />
        <strong>Limits:</strong> the times in the last day you started or changed a plan in each server,
        which stops the bot being used to spam. Logins and plan links are also limited by IP address, which
        is only held in memory for ten minutes and never saved.
        <br />
        <strong>Login session:</strong> a signed cookie that keeps you logged in for 30 days. It holds
        your Discord ID, name and avatar and nothing more. All we keep on our side is a number on your
        account that changes when you log out, which is what makes logging out end the session
        everywhere rather than only in the browser you clicked it in. That number stays after the rest of
        your data is deleted, so an old cookie stays logged out.
    </p>

    <h2>Who can see your days</h2>
    <p>
        Whoever runs a plan sees the most. That's the planner who made it, and anyone in the server they
        picked to run it with them. Once you're in on a plan,
        its overview shows them the days and hours you marked free within that plan's dates, on the days
        your answer covers. It also shows whether you're in, how many days you have left to answer, when
        you last updated your calendar, your yes or no on a set day, any reason you gave, and whether
        your DMs were closed. Having the planner role doesn't let anyone into a plan they aren't on.
    </p>
    <p>
        Someone else can take a plan on, which makes them one of the people who run it. A planner can
        once nobody who runs it is left in the server, and someone who can manage the server can at any
        time. It goes in the plan's history, where everyone on the plan can read who did.
    </p>
    <p>
        Everyone else on the plan can open its overview too. They see whether each person is in, how many
        days each has left to answer, and who's coming once a day is set, without being told whether you
        said so yourself or whoever runs the plan marked it for you. They never see a reason. They also
        see the days and hours each person who's in marked free, the same as whoever runs it. A plan made
        before guests could see that stays as it was: guests on it see how many people are free each day,
        and nobody's name.
    </p>

    <h2>What we don't do</h2>
    <p>
        No selling or sharing of your data with third parties, no advertising, no analytics trackers. The
        bot doesn't read your everyday chat: it posts in the plan threads and the info channel it sets up,
        DMs the people invited to a plan about it, and sees only the commands, buttons and reason boxes
        you use. It sees each server's member list so planners, and whoever runs a plan, can pick who to
        invite, and doesn't save it. Data is kept apart per server, so one server's plans and guest lists aren't visible to
        another.
    </p>

    <h2>Where it lives</h2>
    <p>
        Your data is stored in a MongoDB database and processed on Availability's hosting providers,
        currently Netlify for the website and Railway for the bot and API. Logging in goes through
        Discord's own OAuth, and avatars are loaded straight from Discord's CDN.
    </p>

    <h2>Retention and deletion</h2>
    <p>
        A plan is deleted when its thread is deleted, or the channel holding its thread is, and every DM
        the bot sent about it is rewritten to say so. Removing the bot from a server deletes all of that
        server's plans. You're taken off a server's plans when you leave that server, and stop running
        any you ran there. Once you no longer
        share any server with the bot, your calendar is deleted and your account record is cut down to
        your Discord ID and the logout number above. If you want your data gone sooner, email us (see
        below) from a way we can tie to your Discord account and we'll remove it within a reasonable time.
    </p>

    <h2>Children</h2>
    <p>
        Availability is meant for users who meet Discord's minimum age requirement in their country. We
        don't knowingly collect data from anyone below it.
    </p>

    <h2>Changes</h2>
    <p>
        If this policy changes in a meaningful way, the "last updated" date above changes with it.
        Carrying on using Availability after an update means you accept the revised policy.
    </p>
</Legal>
