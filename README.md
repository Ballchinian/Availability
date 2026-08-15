# Availability

A Discord bot and small website for working out when a group is actually free. A planner picks a date range and who to invite, the bot opens a private thread and nudges everyone, each person fills in the days they can make on the site, and a compare view colours in the dates that suit the most people so you can land on one.

It's built to be shared. Any server can invite the bot and gets its own plans, threads, and links, all kept apart by the server they belong to.

## Features

- Date range plans, anywhere from tomorrow up to two years out
- Pin a plan to certain days, like weekends only, so people are only asked about the days that matter
- Or announce a plan whose day is already set, skipping the availability step
- A member picker with search and drag and drop to sort who's invited
- Private per plan threads that pull in only the people invited
- Drag across a stretch of days to mark yourself free, and narrow any day down to certain hours
- Time zones throughout, so a group spread across the world compares hours that actually line up
- Repeating plans, for the thing you do every other Thursday
- Plan another like an old one, same crowd and same days, straight from its compare page
- `/free` to tick your days off inside Discord, for the people who never click links
- Saved timetables, so your next plan starts already filled in
- A compare view that colours days by how many people are free, with a slider for how many you'll let miss out
- Changes named after what you came wanting: the day, the time, the name, who's on it, or going back out for different dates altogether
- Optional DMs and thread posts, so you can keep any action as quiet as you like
- A quiet switch for putting a mistake right: everyone's DM is corrected where it sits, nobody is told it changed
- Yes/no confirmations you can close and reopen without anybody losing their answer
- Noise limits so nobody can get blasted with pings
- Multi server support, fully isolated per server

Endpoint docs live in [ENDPOINTS.md](./ENDPOINTS.md).

## How it works

Everything lives in one place per server. `/setup` makes a planner role (or adopts one you already have) and a read only `plan-bot-info` channel, with the link and a short intro pinned at the top. Every plan thread spawns off that channel, so it stays the one tidy home for planning.

When a planner starts a plan, the bot spins up a private thread named after it, pulls in the invited people, and pings them there. Everyone also gets a DM with the link by default, though the planner can untick that to keep it to the thread. As people fill in their days the thread keeps a running count, and once everyone's in, the planner who made the plan gets a DM to go and compare.

Anyone who would rather not click the link can run `/free` in the plan's thread instead and tick their days off a list right there. It writes exactly what the site writes, so the two can be used on the same plan interchangeably. The one thing it can't do is narrow a day to certain hours, since a Discord list has nowhere to put that: a day ticked there is a day free all through, and the reply says where to go if that isn't true.

If the day is already decided, the planner can skip all that and announce a set plan instead: give it a name, a date and time, and who is coming, and the bot just tells everyone. Every action that reaches people, locking in a date, moving the range, cancelling, adding someone, has its own toggles for whether to post in the thread or DM, so a plan can be as loud or as quiet as you want.

### Changing a plan that is already running

Everything you can do to a plan lives under **Change the plan** on the compare page, and each one is named after the reason you came rather than after what the app has to do about it. **The day is wrong** opens the grid with the day you are on ringed in green, and you pick the new one off it. **The time is wrong**, **The note or description is wrong**, **The name is wrong** and **Someone else should be on it** are each a small form and cost nobody their answer. Whether a change means people have to look again is worked out from the change itself, so it is said on the button that does it instead of being filed under a scarier heading.

The one that does ask everybody again is **None of these days work**. That opens the create form over again on the plan you already have, with last time's window, weekdays, crowd and repeat filled in, and one press changes the lot: everyone goes back over their dates, keeping whatever they had already saved, and the thread gets a single message about it rather than one per thing you moved.

The grid is the only way to a day, whether or not anyone has answered yet. Every day in the window is clickable, and a day nobody is free on says why it looks dim and lets you set it anyway.

### Fixing things without a fuss

Everything the bot has said about a plan, it can go back and correct. It remembers the pinned post at the top of the thread, the confirmation if one is running, and the one DM each person is holding that says what the plan is, and every change rewrites all three before it does anything else. Editing a message in Discord notifies nobody, so getting the time wrong and fixing it a minute later leaves seventeen people holding a DM that just says the right time, with nothing to tell them it ever said anything else.

There is a **quiet** switch on the compare page for the rest of it. With it on, nothing you do pings anybody: no DM, no thread post, no mentions. The corrections still happen, so everyone ends up holding the truth, they are simply not told it changed. It is for the mess you made yourself rather than for keeping people in the dark, and it turns itself off when the page reloads so it cannot be left on by accident. Cancelling a plan or moving its day quietly asks you to confirm twice, because those are the two where somebody could turn up to nothing.

Two things it cannot do, both because Discord pings people the moment they are added to a private thread: a brand new plan is never quiet, and adding somebody to an existing one is only half quiet. The panel says so rather than pretending otherwise, which is also why fixing the plan you have beats starting another.

Asking everyone to confirm is a switch rather than a one-shot round. Close it and every yes and no stays on record; open it again and the same message in the thread comes back to life with the tally intact, rather than a second poll appearing below the first. Nothing clears people's answers except the day itself actually moving.

If the two ever drift apart anyway, because somebody deleted the pinned post or Discord was down when an announcement went out, **Discord has gone wrong** on the compare page rewrites the lot and puts back whatever is missing. It sends nothing and pings nobody, so it is safe to press whenever something looks wrong.

### Plans that come round again

A plan can be set to repeat every week, every other week or every four weeks, either when you start it or later from the compare page. Weeks rather than months on purpose: shifting a date by a multiple of seven lands on the same weekday, so "every other Thursday" stays on Thursdays and a plan pinned to weekends stays on weekends. Picking an interval draws the dates it would actually land on, a month at a time with arrows, before you save anything. They are worked out by the same code that makes the next plan, so what you are shown is what you get.

Nothing is scheduled ahead. The next plan is only made once the current one's day has been and gone, so there is never more than one of a series live at a time, and the new one is a real plan of its own with its own thread and its own history rather than a second date bolted onto the old one. That also means cancelling a plan ends the series without any separate way of saying so, and stopping it is always a button on whichever plan is currently live.

If the service is off for a while, a repeat that missed its turn comes back once on the next date still to come, not once for every date it slept through.

### Time zones

Two clocks, and they do different jobs. **You** have one, taken from whatever device you open the site on, and it is what your own days and hours mean: mark 8pm and you mean 8pm where you are. **The server** has one too, picked at `/setup` or changed later with `/timezone`, and that is the clock a plan's day and its set time are written on, so "Wednesday at 8" means one thing for the whole group.

Nothing is stored converted. Your availability is kept exactly as you wrote it, and everyone's is read onto the server's clock at the moment the compare view lines you all up, which is why moving abroad re-reads your calendar as local to where you are now rather than leaving it behind. On a server where everyone shares a clock none of this shows up anywhere: the pages only mention a zone when it is not the one you are on. Where a time goes out over Discord it goes with a timestamp beside it, which Discord redraws in each reader's own clock, and calendar files carry a real moment so they land at the right hour wherever they are opened.

## Commands

Seven of them, and they sort into three lots: two for setting the server up, three anyone can run, two for whoever is running the plan. Everything the bot says back to you here is only visible to you.

| Command | What it does |
| --- | --- |
| `/setup` | Makes the read-only `plan-bot-info` channel and sorts out the planner role. Takes the server's time zone while it's there. Safe to run again: it keeps the channel it finds, the plan threads under it and the planner role you already have, and just brings the pinned intro up to date. Manage Server only. |
| `/timezone` | Shows the clock this server's plans run on, or changes it. Planner role only to change it. |
| `/free` | Tick the days you're free without leaving Discord. Run it in a plan's thread and it knows which plan you mean. |
| `/mylink` | Lists the plans you're in on this server and hands you your link for each one. Handy when the DM has scrolled away. |
| `/myavailability` | Hands you the link to your general availability, the timetable that isn't tied to any one plan. |
| `/compare` | Run inside a plan's thread, hands the planner that plan's compare link. Planner role only. |
| `/cancel` | Run inside a plan's thread to call the whole thing off. Asks you to confirm first, then tells everyone. Planner role only. |

## Tech stack

- **One Node service** running the discord.js bot, the Express API, and serving the built site, all from a single process, since the bot needs to stay connected the whole time anyway
- **Frontend:** a Svelte site, served by Netlify on the live domain and by the backend itself anywhere it runs as one container
- **Data:** MongoDB

## A typical plan

1. Someone with Manage Server runs `/setup`.
2. A planner opens the site, sets a date range, and picks who's coming.
3. The bot spins up a private thread, pulls those people in, and pings them.
4. Everyone opens their link and marks the days they're free, down to certain hours if they want.
5. The thread keeps a running count as people confirm.
6. Once everyone's in, the planner opens the compare view (or runs `/compare`), reads the colours, and locks a day in.

## How this is deployed

Two hosts, on purpose, and `netlify.toml` is the whole of the arrangement. Netlify holds the domain and serves the built site out of `web/`, and every `/api/*` request that reaches it is proxied through to the backend on Railway, which runs the bot, the API and everything touching the database as one always-on process. The proxy is the point: the browser only ever talks to one domain, which is what keeps the login cookie first-party and so makes auth work at all.

The `Dockerfile` is how Railway builds that process. It also builds the site and copies it in, so the Railway URL on its own serves a complete working copy of both halves, and so any plain container host (Fly, Render, a VPS, your own machine) can run the lot from one image with nothing else set up. That copy is a spare, not what anybody uses. The live site is the Netlify one.

Which means, when you change something:

- Anything under `web/` reaches people when Netlify rebuilds.
- Anything under `backend/` reaches people when Railway redeploys.
- Anything under `shared/` needs both, since both sides import it. Change how a date reads and the site shows the new wording as soon as Netlify is done, while the bot's DMs keep saying it the old way until Railway catches up.
- Both hosts watch `main` and build on their own. CI only runs the checks, it deploys nothing.

Config is all environment variables, read in one place in `backend/src/config.js`. Locally they live in `backend/.env`, which is deliberately not in git, so a fresh machine starts by copying `backend/.env.example` over it and filling in the blanks. That file lists every variable with a line on what it wants and what happens if you leave it out.

The setting to be careful with is `BASE_URL` on the Railway side. Every link the bot posts is built from it, and the session cookie only marks itself secure when it starts with https, so it has to be the public Netlify domain rather than the Railway URL sitting behind the proxy. Get that wrong and the bot quietly hands out links to the wrong host while the site itself carries on looking perfectly fine, which is a horrible thing to debug. Booting in production with anything other than an https `BASE_URL` now refuses outright instead of half working.