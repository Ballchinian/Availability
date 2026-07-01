# API Endpoints

This document describes the Availability backend API.

Everything lives under `/api`. The same Node service serves these routes and hands out the built site, so in production they share an origin with the frontend.

## Authentication

Endpoints marked with 🔒 require a logged-in session.

A session is a signed JWT in an httpOnly `sid` cookie, set when someone logs in through Discord. Nothing is kept server side, the cookie carries who they are and is signed so it cannot be faked.

Most actions also need a role inside the server they touch:

* Anyone in the server can fill in their own availability for a plan they were invited to.
* Only people with the planner role can pull the member list, start a plan, or run the compare and outcome actions.

A missing or expired session comes back as `401`. A valid session without the right role comes back as `403`.

---

# Health

## GET `/api/health`

Quick liveness check.

### Returns

* Service status
* Whether the database came up

---

# Authentication

## GET `/api/auth/login`

Start the login. Bounces the person to Discord to approve, after stashing a short lived state cookie so the round trip cannot be forged.

### Input

* `returnTo` (optional): a local path to land on afterwards

---

## GET `/api/auth/callback`

Where Discord sends the person back with a code. The backend trades the code for their identity, caches their profile, sets the session cookie, and redirects them on.

### Notes

* Checked against the state cookie from `/login`, a mismatch is rejected.
* Only ever redirects to a local path, never an arbitrary url.

---

## POST `/api/auth/logout`

Clear the session cookie.

---

## GET `/api/auth/me`

Return the logged-in person, or `null` if nobody is.

---

# Servers

## GET `/api/guilds/:guildId` 🔒

Tells the frontend about one server and where the requester stands in it.

### Returns

* Server name
* Whether the requester is a member
* Whether the requester has the planner role

### Notes

* `404` if the bot is not in that server.
* `400` if the server has not run `/setup` yet.

---

## GET `/api/guilds/:guildId/members` 🔒

The member list for the people picker.

Planner role only.

### Returns

Real, non-bot members, sorted by display name, each with a username, display name, and avatar.

### Notes

The full member list is a rate limited gateway call, so the result is cached per server for about a minute and a single fetch is shared when several requests land at once.

---

## POST `/api/guilds/:guildId/plans` 🔒

Start a plan, in one of two modes.

Planner role only.

### Input

* Name
* Description
* The people to invite
* For a collect-availability plan: a start and end date
* `allowedWeekdays` (optional, collect plans only): the weekdays people can mark, as numbers 0 (Sunday) to 6, e.g. `[0, 6]` for weekends. Left out, or all seven, means the whole range.
* For a set plan: `announce` set to true, a single `date`, and an optional `time` and `note`
* `dm` (optional, default true): whether to DM the invited people
* `post` (optional, default true, set plans only): whether the thread's opening post pings everyone

### Effects

* Creates the plan.
* Collect mode: opens a private thread, pulls the invited people in, pings them, and DMs them unless `dm` is off.
* Set mode: records the date as already decided, always opens a thread so the plan can be managed, pings everyone in it unless `post` is off, and DMs everyone unless `dm` is off.

### Returns

* Plan id and link
* How many were invited, and how many were dropped for not being in the server
* `set` is true for a set plan

### Notes

* Invited ids are filtered down to real, non-bot members.
* A set plan's date must be today or later and within two years.
* A weekday restriction has to leave at least one day inside the picked range, otherwise it is rejected.
* Capped at a high daily backstop per person, since the planner role is the real gate.

---

# Plans

## GET `/api/plans/:planId` 🔒

Everything the availability page needs to draw the grid.

### Returns

* The plan: name, description, date range, status, server name, and any weekday restriction
* Whether the requester is a participant, and whether they have confirmed
* The running confirmed count out of the total
* The requester's saved days inside the range, so the grid comes up prefilled
* When they last filled their timetable

---

## POST `/api/plans/:planId/availability` 🔒

Save the requester's picks for this plan and mark them confirmed.

Participants only.

### Input

* The days they are free, optionally narrowed to certain hours

### Effects

* Replaces their saved days inside the plan range.
* Marks them confirmed for the plan.
* If that was the last person, DMs the planner to go and compare.

### Notes

* No thread post, a confirmation is kept quiet.
* On a weekday-pinned plan, days off those weekdays are ignored, and only the pinned days are rewritten so the person's saved availability on other days is left alone.
* `409` if the plan was cancelled.

---

## GET `/api/plans/:planId/compare` 🔒

Everything the compare page needs.

Planner role only.

### Returns

* The plan, including any date already locked in
* Everyone invited, with names, avatars, and whether they confirmed
* For each day, who is free and the hours they gave, so the page can work out the overlap

---

## POST `/api/plans/:planId/choose` 🔒

Lock in the winning date and announce it.

Planner role only.

### Input

* Date (must sit inside the plan range)
* Time and note (both optional)
* Whether to ping the people attending, or everyone invited, and who is attending
* `post` (optional, default true): whether to post the outcome in the thread
* `dm` (optional, default true): whether to DM everyone the outcome

### Effects

* Sets the chosen date.
* Pings and DMs the relevant people. Setting a different date counts as a reorganise.

### Notes

* `409` if the plan was cancelled.
* Capped at a high daily backstop per person, since it pings and DMs everyone.

---

## POST `/api/plans/:planId/void` 🔒

Undo a date that was already locked in, so the plan can be rescheduled.

Planner role only.

### Input

* Reason (optional)
* `dm` (optional, default true): whether to DM everyone that you are rescheduling

### Effects

* Clears the chosen date.
* DMs everyone unless `dm` is off, no thread post.

### Notes

* `400` if there is no set date to undo.

---

## POST `/api/plans/:planId/remind` 🔒

Nudge the people who have not confirmed yet.

Planner role only.

### Returns

* How many people were pinged

### Notes

* Capped at once a day per plan, so it cannot be spammed.

---

## POST `/api/plans/:planId/range` 🔒

Set a fresh start and end on the plan, reopen it, and tell everyone to refill the new window.

Planner role only.

### Input

* New start and end date
* Note (optional)
* `post` (optional, default true): whether to ping the new dates in the thread
* `dm` (optional, default true): whether to DM everyone the new dates

### Effects

* Moves the date range.
* Pings and DMs everyone about the new window.

### Notes

* The new range has to be valid, not entirely in the past, within two years, and actually different from the current one.
* Capped at a high daily backstop per person, since each change pings and DMs everyone.

---

## POST `/api/plans/:planId/details` 🔒

Change a plan's title and description.

Planner role only.

### Input

* Name
* Description

### Effects

* Updates the stored title and description.
* Renames the thread to the new title.
* Rewrites the pinned opening message so it shows the new title and description.

### Notes

* Quiet on purpose, no DM and no thread post.
* Same rules as creating a plan: both are required, the name caps at 90 characters and the description at 280.
* `409` if the plan was cancelled.
* A no-op edit, where nothing actually changed, is rejected.
* The thread rename is best effort, since Discord rate limits renames hard.

---

## POST `/api/plans/:planId/cancel` 🔒

Cancel a plan.

Planner role only.

### Input

* `post` (optional, default true): whether to post the cancellation in the thread
* `dm` (optional, default true): whether to DM everyone

### Effects

* Marks the plan cancelled.
* Pings the thread and DMs everyone, each according to `post` and `dm`.

### Notes

* The thread is left to be deleted by hand.
* Cancelling an already cancelled plan is a no-op, so nobody is told twice.

---

## POST `/api/plans/:planId/add` 🔒

Pull extra people into a running plan.

Planner role only.

### Input

* The people to add
* `dm` (optional, default true): whether to DM the new people

### Effects

* Adds them to the plan and pulls them into the thread.
* DMs the new people unless `dm` is off.

### Notes

* Anyone already in, and anyone not a real non-bot member, is skipped.

---

## POST `/api/plans/:planId/leave` 🔒

Drop yourself out of a plan you were invited to. This is the website side of the leave button in the DM.

Participants only.

---

# Availability

The general timetable, not tied to any plan. People can fill it ahead of time, say if they know they will be away, and their next plan starts already filled in.

## GET `/api/availability` 🔒

The requester's saved days inside a window they choose.

### Input

* `start` and `end`: the window to read

### Returns

* Their saved days in that window
* When they last filled their timetable

---

## POST `/api/availability` 🔒

Save the requester's general timetable for a window.

### Input

* Start and end date
* The days they are free, optionally narrowed to certain hours
* Whether to auto-accept any plan the new window now fully covers

### Effects

* Replaces their saved days inside the window.
* With auto-accept on, quietly confirms them for any plan the window covers, and DMs the planner if that filled the last slot.

### Returns

* How many days were saved
* The names of any plans this confirmed them for

### Notes

* The range has to be valid and within two years.
