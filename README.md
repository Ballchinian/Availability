# Availability

A Discord bot and small website for working out when a group is actually free. A planner picks a date range and who to invite, the bot opens a private thread and nudges everyone, each person fills in the days they can make on the site, and the plan's overview colours in the dates that suit the most people so you can land on one.

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
- Plan another like an old one, same crowd and same days, straight from its overview
- `/free` to tick your days off inside Discord, for the people who never click links
- Saved timetables, so your next plan starts already filled in
- One list of every plan you're on, each with a button for what it wants from you next
- An overview for everyone on the plan, which colours days by how many people are free, with a slider for how many you'll let miss out
- Whoever runs a plan can change it without the planner role, and a planner can take one on when nobody running it is left
- One edit form for everything about a plan, which shows every message a save will send, and who gets it, before it sends anything
- Save quietly, for putting a mistake right: everyone's DM is corrected where it sits, and only people with something new to answer are told
- Once a day is set, the thread's pinned post becomes the yes/no, with a count that keeps itself up to date
- Noise limits so nobody can get blasted with pings
- Multi server support, fully isolated per server

Endpoint docs live in [ENDPOINTS.md](./ENDPOINTS.md).

## How it works

Everything lives in one place per server. `/setup` makes a planner role (or adopts one you already have) and a read only `plan-bot-info` channel, with the link and a short intro pinned at the top. Every plan thread spawns off that channel, so it stays the one tidy home for planning.

When a planner starts a plan, the bot spins up a private thread named after it, with the day on the end once there is one, so a plan that repeats doesn't leave a row of threads all called the same thing. It pins the plan at the top first and only then pulls in the invited people and whoever runs it, so nobody lands in an empty thread. Everyone also gets a DM asking if they're in, with buttons to fill in their dates and to jump to the thread. Anyone the planner picked to run it with them gets one more, saying so, since nothing in the thread does. Once everyone who's in has answered every day, whoever runs the plan gets a DM to go and pick a day.

While the day is still being found, the overview lists everyone under **Who has answered**, in the same three columns a set day gets: answered every day, still to answer, and can't make it, with their reason. Anyone still to answer has what they owe beside their name, which is saying if they're in, a number of days left, or their dates altogether. Next to each name it also says how long ago they last touched their calendar, and **Ask again** DMs that one person their card there and then. For someone who's in, it also stops their calendar counting for that plan until they go over their dates again, which is the fix for a calendar that has gone stale. A name there also opens that person's days once they're in: a small calendar of the plan's dates, filled in where they're free and dashed where they haven't answered yet.

The overview is for everyone on the plan, and what you get depends on where you stand. A **planner** has the server's planner role, and is the only one who can start a plan, make one come round again, or copy an old one into a new one. Whoever **runs** a plan can change anything on it, and that takes no role at all: it's the planner who made it, anyone they picked under **Who else runs it?** when they started it, and anyone who has taken it on since. Everyone else on it is a **guest**. Guests get the same picture to read, who has answered or who is coming, the grid, and what has happened, with nobody's reasons and nothing that changes anyone else. Once the day is set, the overview is also where anyone on the list says **I'm coming** or **Can't make it**, the same answer the buttons in Discord give, with a smaller **Leave this plan** under it for getting off the plan altogether. On a plan made before guests could see each other's days, they get the grid's counts and no names.

Opening the site without a link lands on **My plans**: a card for every plan you're on or run, across all your servers, with one button on each for whatever it wants from you next, whether that's saying if you're in, filling in the three days you have left, or picking the day now that everyone has answered. A plan whose dates went by with no day picked stays there for thirty days, with **Ask about new dates** for whoever runs it, and after that it moves to **Past plans** as one that never got a day, next to the ones that were called off or have been.

If everyone running a plan leaves the server, any planner there can take it on from its overview, and someone with Manage Server can step in on any plan, which is the way in on one being misused. Either way it goes in the plan's history for everyone on it to read. A plan that was called off, or whose day has been, can't be changed by anyone.

Anyone who would rather not click the link can run `/free` in the plan's thread instead and tick their days off a list right there. It writes exactly what the site writes, so the two can be used on the same plan interchangeably. The one thing it can't do is narrow a day to certain hours, since a Discord list has nowhere to put that: a day ticked there is a day free all through, and the reply says where to go if that isn't true.

If the day is already decided, the planner can skip all that and announce a set plan instead: give it a name, a date and time, and who is coming, and the bot just tells everyone.

### Changing a plan that is already running

Whoever runs a plan changes it with **Edit plan** on its overview, which opens the edit form. That's the create form over again on the plan you already have, with everything filled in: the name, what it's about, its window or its day, who's coming, who else runs it and whether it repeats. Change whatever you like, take someone off by moving them back across, and press **Review changes**. Before anything is sent, that lists what changes and every message that would go out, with who gets each one, and the save button is named for the biggest thing it does, like **Save and move it to Sat 10 Oct**. Naming a day asks everyone on it if they're coming. Asking about dates again only asks each person for the days their calendar doesn't already answer. Either way the thread gets one message listing what changed, rather than one per thing you moved.

**Save quietly** sits beside it, for putting a mistake right. It posts nothing in the thread and only DMs the people the change gives something new to do, like someone whose yes the move took away, and the review says who those are before you press it. Everyone else's DM is corrected where it sits.

If somebody else changes the plan while you have the form open, the review says who, and nothing you did is saved over theirs.

Naming a day is not held to the window the plan asked about. Pick something outside it and the window simply stretches to reach it, so a plan that went out asking about August can still land on the first weekend of September without anybody having to answer anything again.

The grid is the only way to a day you are picking off what people said, whether or not anyone has answered yet. Every day in the window is clickable, one nobody is free on included. It leads the overview while the day is still being found, and once there is a day it sits under the date on the edit form, which is the only place it is still worth a look. Picking a day there fills the date in.

### Fixing things without a fuss

Everything the bot has said about a plan, it can go back and correct. It remembers the pinned post at the top of the thread, which is the yes/no once there's a day, and the one DM each person is holding that says what the plan is, and every change rewrites both before it does anything else. Editing a message in Discord notifies nobody, so getting the time wrong and fixing it a minute later leaves seventeen people holding a DM that just says the right time, with nothing to tell them it ever said anything else.

That is what **Save quietly** leans on. Nobody who already knew what to do is told it changed, and the people who do hear are only the ones the change asks something new of. Discord pings people the moment they're added to a private thread, so anyone added still hears, and gets their invitation too. A brand new plan is never quiet for the same reason, which is why fixing the plan you have beats starting another. Calling a plan off, and setting its day off the grid, always tell everyone.

If the two ever drift apart anyway, because somebody deleted the pinned post or Discord was down when an announcement went out, **Put it back**, at the foot of the overview for whoever runs the plan, rewrites the lot and puts back whatever is missing. It sends nothing and pings nobody, so it is safe to press whenever something looks wrong.

### Plans that come round again

A plan with its day can be set to repeat every week, every other week or every four weeks, either when you start it or later on the edit form. Turning one on takes the planner role, since it makes plans. After that the form doesn't ask again: it says how often and who set it, with one box, **Make this the last time it comes round**, that anyone running the plan can tick. The box is still there while a repeating plan is sent back out for dates. Coming round always means the same day a few weeks on, even for a plan that found its day by asking everyone: a group that picks a new day each time uses **Plan another like this** instead. Weeks rather than months on purpose: shifting a date by a multiple of seven lands on the same weekday, so "every other Thursday" stays on Thursdays. Picking an interval draws the dates it would actually land on, a month at a time with arrows, before you save anything. They are worked out by the same code that makes the next plan, so what you are shown is what you get. The overview keeps saying it afterwards, for everyone on the plan: how often, who set it, and when the next one is.

Nothing is scheduled ahead. The next plan is only made once the current one's day has been and gone, so there is never more than one of a series live at a time, and the new one is a real plan of its own with its own thread and its own history rather than a second date bolted onto the old one. It is run by whoever ran the last one and is still in the server. Making it counts as starting a plan, so if none of them has the planner role any more the series stops there instead, and the last plan's history says why. That also means calling a plan off ends the series, and the confirm and the CALLED OFF messages say so. Stopping it without calling anything off is the box on the edit form of whichever plan is currently live.

If the service is off for a while, a repeat that missed its turn comes back once on the next date still to come, not once for every date it slept through.

### Time zones

Two clocks, and they do different jobs. **You** have one, taken from whatever device you open the site on, and it is what your own days and hours mean: mark 8pm and you mean 8pm where you are. **The server** has one too, picked at `/setup` or changed later with `/timezone`, and that is the clock a plan's day and its set time are written on, so "Wednesday at 8" means one thing for the whole group.

Nothing is stored converted. Your availability is kept exactly as you wrote it, and everyone's is read onto the server's clock at the moment the overview lines you all up, which is why moving abroad re-reads your calendar as local to where you are now rather than leaving it behind. On a server where everyone shares a clock none of this shows up anywhere: the pages only mention a zone when it is not the one you are on. Where a time goes out over Discord it goes with a timestamp beside it, which Discord redraws in each reader's own clock.

### Practice

Planners get a **Practice** section at the bottom of My plans, for making up people to try a plan out on. Each one is made for one server, up to ten a server, and can be given the planner role. Removing one takes them off any plan they were on and deletes their calendar.

**View as** opens the site as that person, from their own My plans, with a line under the header saying who you're viewing as and a way back to you. Logging out logs you out, not them. If they're removed, or you lose the planner role in their server, you're put back as yourself.

**Start a practice plan** opens the usual form with only you and your made-up people to pick from, and so does Start a plan for a made-up person with the planner role. A plan with anyone made up on it is a practice plan: it can only hold your made-up people and you, never comes round again, and nobody else in the server can see it or find it with `/mylink`. Your practice plans sit in the Practice section rather than among your real ones, and the overview says practice next to the server's name.

Nothing about a practice plan reaches Discord except what it sends you, which still comes to your DMs. Everything else the bot would send is kept on the site: its thread, pinned post and all, is drawn on the plan's overview as **The thread**, and viewing as a made-up person shows **Their messages** under their plans, each drawn the way Discord would draw it, with buttons that work. A no asks for its reason first, the way Discord's box does.

## Commands

Seven of them, and they sort into three lots: two for setting the server up, four anyone can run, and one for whoever runs the plan. Everything the bot says back to you here is only visible to you.

| Command | What it does |
| --- | --- |
| `/setup` | Makes the read-only `plan-bot-info` channel and sorts out the planner role. Takes the server's time zone while it's there. Safe to run again: it keeps the channel it finds, the plan threads under it and the planner role you already have, and just brings the pinned intro up to date. Manage Server only. |
| `/timezone` | Shows the clock this server's plans run on, or changes it. Planner role only to change it. |
| `/free` | Tick the days you're free without leaving Discord. Run it in a plan's thread and it knows which plan you mean. Once the plan has its day, it asks if you're coming instead. |
| `/mylink` | Lists every plan you're on in this server, set ones too, each as a button for what it wants from you next. Handy when the DM has scrolled away. |
| `/mycalendar` | Hands you the link to your calendar, the one that isn't tied to any one plan. |
| `/overview` | Run inside a plan's thread, hands you that plan's overview. For anyone on the plan. |
| `/cancel` | Run inside a plan's thread to call the whole thing off. Asks you to confirm first, then tells everyone. For whoever runs the plan, planner role or not. |

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
6. Once everyone's in, whoever runs the plan opens its overview (or runs `/overview`), reads the colours, and locks a day in.

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