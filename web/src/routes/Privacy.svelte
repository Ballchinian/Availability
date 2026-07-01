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
        from the "identify" scope when you log in. It's what lets the site know who you are and show you
        back to yourself.
        <br />
        <strong>Your availability:</strong> the days you mark as free, and any hours you narrow a day
        down to. This is saved against your account and carried across plans and servers, so you don't
        have to fill it in twice.
        <br />
        <strong>Servers you share with the bot:</strong> which servers (that have the bot) you're in, so
        we know when your saved availability is still needed by anyone.
        <br />
        <strong>Plans:</strong> a plan's name, optional description, date range, who's invited, who has
        confirmed, the chosen date, time and any note, and, when a planner asks people to confirm a set
        date, each person's yes or no plus any short reason given for a no.
        <br />
        <strong>Server settings:</strong> for each server, which channel is the plans channel, which role
        can drive the bot, and the intro message the bot pinned.
        <br />
        <strong>Login session:</strong> a signed cookie that keeps you logged in for 30 days. It holds
        your Discord ID, name and avatar and nothing more, and no matching session data is kept on our
        side.
    </p>

    <h2>What we don't do</h2>
    <p>
        No selling or sharing of your data with third parties, no advertising, no analytics trackers. The
        bot doesn't read your everyday chat: it only posts and reads in the plan threads and the info
        channel it sets up. Data is kept apart per server, so one server's plans and guest lists aren't
        visible to another.
    </p>

    <h2>Where it lives</h2>
    <p>
        Your data is stored in a MongoDB database and processed on the Service's hosting providers,
        currently Netlify for the website and Railway for the bot and API. Logging in goes through
        Discord's own OAuth, and avatars are loaded straight from Discord's CDN.
    </p>

    <h2>Retention and deletion</h2>
    <p>
        Plans are deleted when the bot is removed from a server, and you're dropped from a server's plans
        when you leave that server. Your saved availability is cleared automatically once you no longer
        share any server with the bot, since at that point it's no use to anyone. If you want your data
        gone sooner, email us (see below) from a way we can tie to your Discord account and we'll remove
        it within a reasonable time.
    </p>

    <h2>Children</h2>
    <p>
        The Service is meant for users who meet Discord's minimum age requirement in their country. We
        don't knowingly collect data from anyone below it.
    </p>

    <h2>Changes</h2>
    <p>
        If this policy changes in a meaningful way, the "last updated" date above changes with it.
        Carrying on using the Service after an update means you accept the revised policy.
    </p>
</Legal>
