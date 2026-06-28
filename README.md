# Availability

A Discord bot and small website for working out when a group is actually free. A planner picks a date range and who to invite, the bot opens a private thread and nudges everyone, each person fills in the days they can make on the site, and a compare view colours in the dates that suit the most people so you can land on one.

It's built to be shared. Any server can invite the bot and gets its own plans, threads, and links, all kept apart by the server they belong to.

## Features

- Date range plans, anywhere from tomorrow up to two years out
- Or announce a plan whose day is already set, skipping the availability step
- A member picker with search and drag and drop to sort who's invited
- Private per plan threads that pull in only the people invited
- Drag across a stretch of days to mark yourself free, and narrow any day down to certain hours
- Saved timetables, so your next plan starts already filled in
- A compare view that colours days by how many people are free, with a slider for how many you'll let miss out
- Optional DMs and thread posts, so you can keep any action as quiet as you like
- Noise limits so nobody can get blasted with pings
- Multi server support, fully isolated per server

Endpoint docs live in [ENDPOINTS.md](./ENDPOINTS.md).

## How it works

Everything lives in one place per server. `/setup` makes a planner role (or adopts one you already have) and a read only `plan-bot-info` channel, with the link and a short intro pinned at the top. Every plan thread spawns off that channel, so it stays the one tidy home for planning.

When a planner starts a plan, the bot spins up a private thread named after it, pulls in the invited people, and pings them there. Everyone also gets a DM with the link by default, though the planner can untick that to keep it to the thread. As people fill in their days the thread keeps a running count, and once everyone's in, the planner who made the plan gets a DM to go and compare.

If the day is already decided, the planner can skip all that and announce a set plan instead: give it a name, a date and time, and who is coming, and the bot just tells everyone. Every action that reaches people, locking in a date, moving the range, cancelling, adding someone, has its own toggles for whether to post in the thread or DM, so a plan can be as loud or as quiet as you want.

## Commands

| Command | What it does |
| --- | --- |
| `/setup` | Makes the read-only `plan-bot-info` channel and sorts out the planner role. Manage Server only. |
| `/compare` | Run inside a plan's thread, hands the planner that plan's compare link. Planner role only. |

## Tech stack

- **One Node service** running the discord.js bot, the Express API, and serving the built site, all from a single process, since the bot needs to stay connected the whole time anyway
- **Frontend:** a Svelte site the backend hands out
- **Data:** MongoDB

## A typical plan

1. Someone with Manage Server runs `/setup`.
2. A planner opens the site, sets a date range, and picks who's coming.
3. The bot spins up a private thread, pulls those people in, and pings them.
4. Everyone opens their link and marks the days they're free, down to certain hours if they want.
5. The thread keeps a running count as people confirm.
6. Once everyone's in, the planner opens the compare view (or runs `/compare`), reads the colours, and locks a day in.