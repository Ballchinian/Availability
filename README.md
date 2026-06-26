# Availability

A Discord bot and small website for working out when a group is actually free. A
planner picks a date range and who to invite, the bot opens a private thread and
nudges everyone, each person fills in the days they can make on the site, and a
compare view colours in the dates that suit the most people so you can land on one.

It is built to be shared. Any server can invite the bot and gets its own plans,
threads and links, all kept apart by the server they belong to.

## How a plan goes

1. Someone with Manage Server runs `/setup`. The bot makes a planner role (or
   adopts one you already have) and creates a read-only `plan-bot-info` channel,
   with the link and a short intro pinned at the top. Every plan thread spawns off
   that channel, so it stays the one tidy home for planning.
2. A person with the planner role opens the site, sets a date range (anywhere from
   tomorrow up to two years out) and picks who is coming, with search and
   drag-and-drop to sort people.
3. The bot spins up a private thread named after the plan, pulls those people in
   and pings them there. Nobody gets a DM about it unless a trusted organiser ticks
   the box to send one.
4. Everyone opens their link and marks the days they are free. They can drag across
   a stretch of days, and narrow any day down to certain hours. The site remembers
   their timetable, so the next plan starts already filled in.
5. As people confirm, the thread keeps a running count ("waiting on 4/8"). No one
   gets DM spam about other people checking in.
6. Once everyone is in, the planner who made the plan gets a DM to go and compare.
   They open the compare view (or run `/compare` in the thread). Days are coloured
   by how many people are free, with a slider for how many you are willing to miss.
   Pick a day and the bot announces it.

So a group cannot be blasted, the noisy actions that ping people (starting a plan,
changing the range, locking a date in) are capped at twice a day per person in a
server. Anyone in the trusted role gets ten a day instead, and is the only one who
can choose to DM people on top of the thread ping.

## Layout

The repo is two parts. [backend/](./backend) is one Node service that runs the
discord.js bot, the Express API, and serves the built site, all from a single
process, since the bot needs to stay connected the whole time anyway.
[web/](./web) is the Svelte site that the backend hands out.

The old single-page version lives in [legacy/](./legacy) for reference. It is not
used by anything now.

## What you need first

A Discord application, from the developer portal:

- A **bot token**, **client id** and **client secret**.
- The **Server Members Intent** switched on (the member picker needs it).
- An **OAuth2 redirect** of `http://localhost:3000/api/auth/callback` while local,
  plus your real domain once it is live.

And a **MongoDB** connection string (Atlas has a free tier).

## Running it locally

You need Node 20 or newer. Copy `backend/.env.example` to `backend/.env` and fill
it in, then build the site and start the service:

```
cd web
npm install
npm run build

cd ../backend
npm install
npm start
```

The site comes up at http://localhost:3000. On boot the backend logs an invite
link with exactly the permissions the bot needs (including Pin Messages and the
thread permissions). Open that link to add the bot to a server, then run `/setup`.

While developing, set `DISCORD_DEV_GUILD_ID` to a test server so slash commands
appear right away instead of taking up to an hour to register globally.

## Commands

- `/setup` makes the read-only `plan-bot-info` channel and sorts out the planner
  role. Manage Server only.
- `/compare`, run inside a plan's thread, hands the planner that plan's compare
  link. Planner role only.

## Deploying

The whole thing is one service plus a database. The root [Dockerfile](./Dockerfile)
builds the site and runs the backend, and works on Railway, Fly, Render or any
container host. The bot keeps a live gateway connection, so pick a host that does
not sleep when idle.

Set these in the host's environment: `MONGODB_URI`, `DISCORD_BOT_TOKEN`,
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` (a long random
string), and `BASE_URL` (your real address). Add the matching OAuth redirect,
`BASE_URL` + `/api/auth/callback`, in the Discord portal.
