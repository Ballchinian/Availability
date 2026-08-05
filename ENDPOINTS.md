# API Endpoints

This document describes the Availability backend API.

Everything lives under `/api`. The same Node service serves these routes and hands out the built site, so in production they share an origin with the frontend.

## Authentication

Endpoints marked with 🔒 require a logged-in session.

A session is a signed JWT in an httpOnly `sid` cookie, set when someone logs in through Discord. The cookie carries who they are and is signed so it cannot be faked. The only thing held this end is a version counter on the user record: the token carries the version it was signed under, every guarded request compares the two, and logout bumps it so an old cookie stops working.

Most actions also need a role inside the server they touch:

* Anyone in the server can fill in their own availability for a plan they were invited to.
* Only people with the planner role can pull the member list, start a plan, or run the compare and outcome actions.

A missing or expired session comes back as `401`. A valid session without the right role comes back as `403`.

## Clocks

Dates are `YYYY-MM-DD` and times are `HH:MM`, both plain readings with no zone written into them. Which clock to read one on depends on whose it is:

* A person's own availability is read on **their** clock, `PUT /api/me/timezone`, taken from the browser.
* A plan's day, its set time and the compare grid are read on **the server's**, set by `/setup` or `/timezone` in Discord.

Nothing is stored converted. The two only meet in `GET /api/plans/:planId/compare`, which reads everyone's hours onto the server's clock so they can be compared, and in the calendar file, which turns a plan's reading into a real moment.

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

### Notes

* Rate limited by caller address, sixty hits across `/login` and `/callback` together in ten minutes. A real login spends two of them.

---

## GET `/api/auth/callback`

Where Discord sends the person back with a code. The backend trades the code for their identity, caches their profile, sets the session cookie, and redirects them on.

### Notes

* Checked against the state cookie from `/login`, a mismatch is rejected.
* Only ever redirects to a local path, never an arbitrary url.
* Shares the `/login` rate limit.

---

## POST `/api/auth/logout`

Clear the session cookie and retire the token behind it.

### Notes

* The cookie is a signed token with nothing stored this end, so it is retired by bumping a counter on the user record that every request checks against. That ends every session they have open, not only this browser.

---

## GET `/api/auth/me`

Return the logged-in person, or `null` if nobody is.

---

# You

What the landing page runs on. Everywhere else the link says which server or plan it is about, so these are the only routes that answer from the session alone.

## GET `/api/me/guilds` 🔒

The servers the requester shares with the bot.

### Returns

Each server, sorted by name, with:

* Server id and name, and its icon if it has one
* Whether it has run `/setup`
* Whether the requester has the planner role there

### Notes

* Read from the list stored on the user, which is written at login and kept current as people join and leave servers. A user saved without one has it worked out and stored on the first request.
* A server the bot has since been removed from, or that the requester has left, is dropped from the list rather than returned.

---

## PUT `/api/me/timezone` 🔒

The clock the requester reads their own hours on.

### Input

* `timeZone`: an IANA name, like `Europe/London`. Anything the runtime does not recognise is a `400`.

### Effects

* Saves it on the user, replacing whatever was there.

### Notes

* Sent by the browser rather than asked for: the site reads it off the device and puts it here once a session, since a device already knows and a setting nobody can find would be wrong half the time.
* Availability is stored exactly as it was written, so this is only ever used to line one person's hours up against another's. Moving it re-reads their whole calendar as local to the new zone, which is what "I am free Wednesday evening" has always meant.

---

## GET `/api/me/plans` 🔒

Everything the requester still has on, across every server they share with the bot.

### Returns

Each plan with:

* Plan id, name, and the server it belongs to
* Its status and date range, plus the day and time if one has been set, and the server clock that time is written on
* Whether the requester is on the guest list, and whether they have filled their dates in
* Whether they started it, which is what earns the plan a compare link

### Notes

* Covers plans still collecting dates and set plans whose day has not passed. Cancelled plans and days gone by are left out.
* Plans the requester started count as well as plans they are in, since nothing makes a planner invite themselves to their own plan.
* A set plan the requester was left off the invite list for is left out too.

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

* The plan: name, description, date range, status, server name, any weekday restriction, and the clock the server runs on
* Whether the requester is a participant, and whether they have confirmed
* The running confirmed count out of the total
* The requester's saved days inside the range, so the grid comes up prefilled
* When they last filled their timetable
* Their sure-up-to date, if they set one
* Their own clock, so the page can say when it is not the server's

---

## POST `/api/plans/:planId/availability` 🔒

Save the requester's picks for this plan and mark them confirmed.

Participants only.

### Input

* The days they are free, optionally narrowed to certain hours
* `autoConfirm` (optional): whether to auto-accept any other plan these dates now fully cover, same as the general page
* `sureUntil` (optional): how far ahead they can honestly plan, or `null` for no limit. Days past it read as "too far to say" rather than busy.

### Effects

* Replaces their saved days inside the plan range.
* Marks them confirmed for the plan.
* Saves their sure-up-to date when one rides along.
* With auto-accept on, quietly confirms them for any other plan the range covers.
* If that was the last person, DMs the planner to go and compare.

### Returns

* The running confirmed count out of the total
* The names of any other plans this auto-confirmed them for

### Notes

* No thread post, a confirmation is kept quiet.
* On a weekday-pinned plan, days off those weekdays are ignored, and only the pinned days are rewritten so the person's saved availability on other days is left alone.
* `409` if the plan was cancelled.

---

## GET `/api/plans/:planId/calendar.ics` 🔒

The plan's set day as a calendar file, so it can go straight into a calendar.

Participants only, plus whoever started the plan.

### Returns

An iCalendar (`text/calendar`) download, named after the plan, holding one event: the day, the time if one was set, and the description, note, server and plan link gathered into the event's own description.

### Notes

* `400` if no day has been set for the plan yet, `409` if it was cancelled.
* A plan with no time is a whole-day event. A plan with one runs two hours from it, since no end time is ever stored.
* A timed event is written in UTC, worked out from the plan's own clock, so it lands at the right hour wherever the file is opened. Not a `TZID`, which would have to come with a `VTIMEZONE` block spelling out that zone's daylight saving rules and which a calendar can refuse without one. A whole-day event stays a bare date and picks up no clock at all.
* The DMs that announce a set day carry this link alongside a Google Calendar link, which needs no login at all.

---

## GET `/api/plans/:planId/compare` 🔒

Everything the compare page needs.

Planner role only.

### Returns

* The plan, including any date already locked in, the clock the server runs on, and a link to its thread in Discord
* Everyone on the plan, with names, avatars, whether they confirmed, their confirmation vote and reason, any manual call a planner made on them, whether they are still invited to the set date, and their sure-up-to date
* Whether the requester is on the guest list themselves
* For each day, who is free and the hours they gave, so the page can work out the overlap
* The plan's history: what has happened to it, oldest first

### Notes

* The days and hours come back on the server's clock, not on each person's. Everyone writes their hours where they are, and this is where they get read onto one clock so they can be compared at all: someone an hour ahead is free from 11pm the night before as far as the grid is concerned. The read reaches a day past each end of the range to catch that spill, and anything still landing outside is dropped, so the first and last day of a range can read a little short for someone far away.
* An empty hours list still means free all day, and survives as one from anybody whose clock matches the server's, which on most servers is everybody.

* Each history line carries what happened, when, who did it, and their display name as it was at the time. The name is stored with the event rather than looked up now, so the list does not rewrite itself when someone changes their nickname or leaves the server.
* Recorded: the plan starting, a day being set or moved or called off, the range or the weekdays changing, the title or description being edited, people being added, someone dropping out or coming back, a nudge going out, and the plan being cancelled. Availability being filled in is not, since the confirmed count above already says that.
* Capped at the most recent 100, and it is the only place history is exposed, so it never leaves the planner's screen.

---

## POST `/api/plans/:planId/choose` 🔒

Lock in the winning date and announce it.

Planner role only.

### Input

* Date (must sit inside the plan range)
* Time and note (both optional)
* `inviteMode`: who is still invited once this is set. `attending` narrows the plan to the people in `attendingIds`, anything else keeps everyone on the list.
* `attendingIds`: who can make the day, worked out by the compare page
* `probe` (optional): whether to ask everyone to confirm they are coming with yes/no buttons

### Effects

* Sets the chosen date.
* Narrows the invite list when asked. Anyone left off is not pinged, not DMed, and does not count in the confirmation tally. Moving or undoing the date invites everyone back.
* Always posts the outcome in the thread, pinging the people still invited, and always DMs them. Setting a different date counts as a reorganise.
* With the probe on, the outcome carries yes/no buttons in the thread and the DMs, and the thread tally keeps itself current as votes land. Anyone whose sure-up-to date sits before the chosen day gets an extra line in their DM saying this landed past what they could plan for.

### Notes

* `409` if the plan was cancelled.
* Capped at a high daily backstop per person, since it pings and DMs everyone.

---

## POST `/api/plans/:planId/attendance` 🔒

A planner's manual call on someone's attendance for the set date, the moves on the compare page's board.

Planner role only.

### Input

* The person to move
* `status`: `coming`, `cant`, or `waiting`

### Effects

* `coming` and `cant` lay an override over whatever the person answered. `waiting` clears it, so their own answer stands again.
* Moving someone to coming also puts them back on the invite list if they were left off when the date was locked, which is how you let in someone who never filled their availability.
* The thread tally is refreshed, and the person is told by DM where they were put, with the yes/no buttons when a probe is running so they can set it straight themselves. Their own answer always beats the override.

### Notes

* `400` if no date is set yet, or the person is not on the plan.
* Moving someone back to waiting is quiet, no DM.
* `409` if the plan was cancelled.

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

Nudge whoever the plan is waiting on.

Planner role only.

### Effects

* While the plan is still collecting, DMs the people who have not filled their availability, with the link.
* Once a date is locked in and a confirmation probe is running, DMs the people who have not said whether they are coming, with the probe's own yes/no buttons riding along so they can answer from the DM.

### Returns

* How many people were pinged
* `kind`: `availability` or `vote`, which of the two nudges went out

### Notes

* Capped at once a day per plan, and the two nudges carry their own cooldowns, so starting a probe does not arrive already inside the availability nudge's.
* The vote nudge skips anyone a planner has already made the call on, since that stands in for an answer, and anyone left off the invite list.
* Setting or moving a date starts a fresh round of votes, which clears the vote cooldown with it.

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
* A weekday-pinned plan needs at least one of its days to still fall inside the new range.
* Capped at a high daily backstop per person, since each change pings and DMs everyone.

---

## POST `/api/plans/:planId/weekdays` 🔒

Change which weekdays the plan asks about, reopen it, and tell everyone to fill in the new set.

Planner role only.

### Input

* `allowedWeekdays`: the weekdays people can mark, as numbers 0 (Sunday) to 6, or `null`/all seven for the whole range
* Note (optional)
* `post` (optional, default true): whether to ping the change in the thread
* `dm` (optional, default true): whether to DM everyone

### Effects

* Sets the plan's weekdays. Saved availability is always left alone.
* If the change opens a day nobody has been asked about (a pure addition, or a swap that brings a new day in), it reopens the plan and resets everyone's confirmed flag so they take another look, and clears any picked date.
* If the change only takes days away, confirmations stand and nobody has to redo anything. The one exception is a picked date that now lands on a dropped day: that date is cleared and the plan reopens, but the confirmations stay.
* Pings and DMs everyone unless those are turned off. The message asks people to fill in the new day when one opened, or tells them there is nothing to do when the plan only narrowed.

### Returns

* `reopened`: whether a new day was opened, so confirmations were reset

### Notes

* The new set has to leave at least one day inside the plan's current range, and be different from what it already asks about.
* Capped at a high daily backstop per person, since each change can ping and DM everyone.

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
* Their sure-up-to date, if they set one
* The clock those days and hours are read on

---

## POST `/api/availability` 🔒

Save the requester's general timetable for a window.

### Input

* Start and end date
* The days they are free, optionally narrowed to certain hours
* Whether to auto-accept any plan the new window now fully covers
* `sureUntil` (optional): how far ahead they can honestly plan, or `null` for no limit. Days past it read as "too far to say" rather than busy, so nobody has to paint fake no's across far-off months.

### Effects

* Replaces their saved days inside the window.
* Saves their sure-up-to date when one rides along.
* With auto-accept on, quietly confirms them for any plan the window covers, and DMs the planner if that filled the last slot.

### Returns

* How many days were saved
* The names of any plans this confirmed them for

### Notes

* The range has to be valid and within two years.
