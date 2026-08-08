# API Endpoints

This document describes the Availability backend API.

Everything lives under `/api`. The same Node service serves these routes and hands out the built site, so in production they share an origin with the frontend.

## Authentication

Endpoints marked (session) require a logged-in session.

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

## What the bot is holding for a plan

Three kinds of Discord message belong to a plan, and every route that changes it brings all three back in line before it does anything else.

* **The pinned opener** in the plan's thread, and **the confirmation** while one exists. Both are remembered by message id, both are edited where they sit, and both are posted again if somebody deletes one. Without that second half a single deletion was permanent: every later pass fetched nothing and gave up.
* **One card per person**, the DM that says what the plan currently is. It is rebuilt from the plan every time, so the message sent on the day and the message rewritten a fortnight later agree, and somebody's own yes or no stays on theirs. Every other DM the bot sends is a note about a moment (a nudge, a drop out) and is left alone to age.

Editing a message notifies nobody in Discord. That is what the whole arrangement rests on: a wrong time or a wrong note can be put right without the correction itself becoming an event, and the people it was wrong for end up holding a DM that is simply correct.

A card that cannot be reached is skipped, never replaced, since sending a new one would ping them. A card whose message has really gone (Discord's `10008`) is forgotten so later passes stop paying for it; any other failure is left alone and tried again.

## Quiet

Most plan routes take an optional `quiet: true`, which forces off everything that would reach somebody who is not already looking: no new DM, no new thread post, and no mentions on anything that still has to be posted. It always beats a `post` or `dm` the caller also sent, so the site and the server cannot disagree about how loud something was.

What quiet never turns off is the rewriting above. Everyone still ends up holding the truth, they are just not told it changed. It is for a planner putting their own mistake right rather than announcing the mistake to everybody.

Two things it cannot do. Adding somebody to a private thread pings them and Discord offers no way around that, so a quiet `add` is only half quiet and says so. And a brand new plan cannot be quiet at all, for the same reason, which is why editing an existing plan is the better way out of a mess.

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

## GET `/api/me/guilds` (session)

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

## PUT `/api/me/timezone` (session)

The clock the requester reads their own hours on.

### Input

* `timeZone`: an IANA name, like `Europe/London`. Anything the runtime does not recognise is a `400`.

### Effects

* Saves it on the user, replacing whatever was there.

### Notes

* Sent by the browser rather than asked for: the site reads it off the device and puts it here once a session, since a device already knows and a setting nobody can find would be wrong half the time.
* Availability is stored exactly as it was written, so this is only ever used to line one person's hours up against another's. Moving it re-reads their whole calendar as local to the new zone, which is what "I am free Wednesday evening" has always meant.

---

## GET `/api/me/plans` (session)

Everything the requester still has on, across every server they share with the bot, and a short list of the ones that are over.

### Returns

Two lists, the live plans and the ones behind them, each plan with:

* Plan id, name, and the server it belongs to
* Its status and date range, plus the day and time if one has been set, and the server clock that time is written on
* Whether the requester is on the guest list, and whether they have filled their dates in
* Whether they started it, which is what earns the plan a compare link

### Notes

* The live list covers plans still collecting dates and set plans whose day has not passed.
* The second list is what has finished: cancelled plans, and set ones whose day has been and gone. Newest first and capped at a dozen, so the compare page behind a finished plan, and everything it remembers, still has a way in from the site.
* A plan set for today counts as live, so the two lists never overlap and nothing falls between them.
* Plans the requester started count as well as plans they are in, since nothing makes a planner invite themselves to their own plan.
* A set plan the requester was left off the invite list for is left out too.

---

# Servers

## GET `/api/guilds/:guildId` (session)

Tells the frontend about one server and where the requester stands in it.

### Returns

* Server name
* Whether the requester is a member
* Whether the requester has the planner role

### Notes

* `404` if the bot is not in that server.
* `400` if the server has not run `/setup` yet.

---

## GET `/api/guilds/:guildId/members` (session)

The member list for the people picker.

Planner role only.

### Returns

Real, non-bot members, sorted by display name, each with a username, display name, and avatar.

### Notes

The full member list is a rate limited gateway call, so the result is cached per server for about a minute and a single fetch is shared when several requests land at once.

---

## POST `/api/guilds/:guildId/plans` (session)

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
* `repeatWeeks` (optional): `1`, `2` or `4` to have this come round again that many weeks after its day has been. Anything else, including left out, is a one off.

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

## GET `/api/plans/:planId` (session)

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

## POST `/api/plans/:planId/availability` (session)

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

## GET `/api/plans/:planId/calendar.ics` (session)

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

## GET `/api/plans/:planId/compare` (session)

Everything the compare page needs.

Planner role only.

### Returns

* The plan, including any date already locked in, the clock the server runs on, whether it repeats, the plans either side of it in its series, and a link to its thread in Discord
* Everyone on the plan, with names, avatars, whether they confirmed, their confirmation vote and reason, any manual call a planner made on them, whether they are still invited to the set date, and their sure-up-to date
* Whether the requester is on the guest list themselves
* For each day, who is free and the hours they gave, so the page can work out the overlap
* The plan's history: what has happened to it, oldest first

### Notes

* The days and hours come back on the server's clock, not on each person's. Everyone writes their hours where they are, and this is where they get read onto one clock so they can be compared at all: someone an hour ahead is free from 11pm the night before as far as the grid is concerned. The read reaches a day past each end of the range to catch that spill, and anything still landing outside is dropped, so the first and last day of a range can read a little short for someone far away.
* An empty hours list still means free all day, and survives as one from anybody whose clock matches the server's, which on most servers is everybody.

* Each history line carries what happened, when, who did it, and their display name as it was at the time. The name is stored with the event rather than looked up now, so the list does not rewrite itself when someone changes their nickname or leaves the server.
* Recorded: the plan starting, a day being set or moved or called off, the range or the weekdays changing, the title or description being edited, people being added, someone dropping out or coming back, a nudge going out, repeating being turned on or off, the plan coming round again, and the plan being cancelled. Availability being filled in is not, since the confirmed count above already says that.
* Every line but one was done by a person. Coming round again is written by the repeat sweep on a timer, so it carries no name and reads as a sentence of its own.
* Capped at the most recent 100, and it is the only place history is exposed, so it never leaves the planner's screen.

---

## GET `/api/plans/:planId/template` (session)

What it takes to set another plan up like this one, for "plan another like this" on the compare page to open the create form with.

Planner role only.

### Returns

* The name and description
* Which weekdays it asks about, or nothing at all if it asks about every day
* Everyone on the guest list, by id

### Notes

* No dates in it, on purpose. A plan run again is the same crowd in a different month, so the range is the one thing that does not carry, and the create form leaves its own default in place.
* Works on a cancelled plan and on one whose day has been. Those are the two most worth running again, and this only reads.
* The ids come back as they are stored. Anyone who has since left the server is dropped by the create form, which has the member list to check against, and again by the create route.

---

## POST `/api/plans/:planId/choose` (session)

Lock in the winning date and announce it, or edit the time and note on the day it is already on.

Planner role only.

### Input

* Date (must sit inside the plan range)
* Time and note (both optional)
* `inviteMode`: who is still invited once this is set. `attending` narrows the plan to the people in `attendingIds`, anything else keeps everyone on the list.
* `attendingIds`: who can make the day, worked out by the compare page
* `probe` (optional): whether to ask everyone to confirm they are coming with yes/no buttons
* `quiet` (optional): only read on an edit, see below

### Two things, decided by the date

Picking the day the plan is **already set for** is an edit to the time and note and nothing else. Every vote stands, the confirmation keeps running, and the invite list is left exactly as it is, because nobody answered about a different day. `inviteMode` and `probe` are ignored, since neither has anything to decide. Everyone's DM and the pinned post are rewritten where they sit, and unless `quiet` is set the people still invited get a DM naming what moved, with the yes/no buttons again if the time is what changed. Answers `edited: true`.

Picking **any other day** is a set or a move, and behaves as it always has, below. This split is the fix for an update having wiped a confirmation round that was halfway through.

### Effects

* Sets the chosen date.
* Narrows the invite list when asked. Anyone left off is not pinged, not DMed, and does not count in the confirmation tally. Moving or undoing the date invites everyone back.
* Always posts the outcome in the thread, pinging the people still invited, and always DMs them. Setting a different date counts as a reorganise.
* With the probe on, the outcome carries yes/no buttons in the thread and the DMs, and the thread tally keeps itself current as votes land. Anyone whose sure-up-to date sits before the chosen day gets an extra line in their DM saying this landed past what they could plan for.

### Notes

* `409` if the plan was cancelled.
* `400` on an edit that changes neither the time nor the note.
* Capped at a high daily backstop per person, since it pings and DMs everyone. An edit spends the same allowance: it is quieter, but it still rewrites a DM per person.

---

## POST `/api/plans/:planId/repair` (session)

Puts Discord back in step with the plan by hand.

Planner role only.

### Effects

* Rewrites the pinned opener, the confirmation and its tally, and every DM card, from the plan as it currently stands. Anything deleted since is posted again, except a card, since sending one would ping them.
* Sends nothing and pings nobody, so it is safe to press whenever something looks out of step.

### Notes

* Every change already does this on its way past. This exists for when that failed and nothing said so: announcements run after the response and only log a failure, so a Discord outage leaves the plan set, the database right and not a word sent anywhere. There was no second attempt before this.
* Answers `cards` (how many DMs were corrected) against `holders` (how many people are holding one). A gap between them is people who deleted theirs or have DMs closed.
* `502` if Discord would not answer at all, rather than reporting a success it did not have.
* No `refuseCancelled`, deliberately, and it is the fourth planner route to go without one. A cancelled plan is the one whose DMs most want correcting, since a stale card there has somebody turning up to nothing.

---

## POST `/api/plans/:planId/confirmations` (session)

Opens or closes the yes/no confirmation on a set date.

Planner role only.

### Input

* `active`: `true` to open, `false` to close
* `quiet`: optional, `true` posts a first confirmation without mentioning anyone

### Effects

* A switch, not a round. Neither direction touches a single answer, so a confirmation closed by mistake reopens with every yes and no still on it and the attendance board never loses what it knew. Only a day actually moving clears answers, which is the choose, void, range and days routes.
* Opening revives the confirmation message already in the thread wherever it survives, rather than posting a second one. Only a plan that has never had one gets a fresh post, and only that post carries mentions.
* Every card is rewritten with it, so the buttons appear in people's DMs when it opens and come off when it closes.

### Notes

* `400` if no date is set, or `active` is not a boolean.
* Answers `unchanged: true` and does nothing when it already matches.
* `revived` says whether it came back on the old message. Reviving is an edit, and Discord does not notify on an edit, so a revived confirmation reaches nobody until someone nudges. The site says so rather than implying people were told.
* No rate limit: opening revives a message rather than sending one.
* `409` if the plan was cancelled.

---

## POST `/api/plans/:planId/attendance` (session)

A planner's manual call on someone's attendance for the set date, the moves on the compare page's board.

Planner role only.

### Input

* The person to move
* `status`: `coming`, `cant`, or `waiting`

### Effects

* `coming` and `cant` lay an override over whatever the person answered. `waiting` clears it, so their own answer stands again.
* Moving someone to coming also puts them back on the invite list if they were left off when the date was locked, which is how you let in someone who never filled their availability.
* The thread tally is refreshed. Nothing else happens: a board move is silent for the person it lands on.

### Notes

* `400` if no date is set yet, or the person is not on the plan.
* Nobody is ever DMed about being moved. A planner reaches for the board because they have decided that person is not going to answer, so telling them second guesses a call already made. An override only stops them being nudged: they keep the thread and the buttons on their own DM, and casting a vote clears the override, so their own answer still wins whenever they give it.
* `409` if the plan was cancelled.

---

## POST `/api/plans/:planId/repeat` (session)

Whether this plan comes round again once its day has been and gone.

Planner role only.

### Input

* `repeatWeeks`: `1`, `2` or `4`, or `null` to make it a one off. Anything else is a `400`.

### Effects

* Saves it on the plan, and records the change in the plan's history.
* Nothing is scheduled. The next plan is only made after this one's day has passed.

### Notes

* Allowed on a plan with no date yet, on purpose: somebody who knows this is their fortnightly thing should not have to come back and say so once the day is picked.
* Nothing happens to plans the series has already made. Repeating is a standing instruction on whichever plan is currently live.
* Cancelling a plan ends the series too, since only a plan with a day that has passed is ever picked up.
* `409` if the plan was cancelled.

---

## POST `/api/plans/:planId/void` (session)

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

## POST `/api/plans/:planId/remind` (session)

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

## POST `/api/plans/:planId/range` (session)

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

## POST `/api/plans/:planId/weekdays` (session)

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

## POST `/api/plans/:planId/details` (session)

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

## POST `/api/plans/:planId/cancel` (session)

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

## POST `/api/plans/:planId/add` (session)

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

## POST `/api/plans/:planId/leave` (session)

Drop yourself out of a plan you were invited to. This is the website side of the leave button in the DM.

Participants only.

---

# Availability

The general timetable, not tied to any plan. People can fill it ahead of time, say if they know they will be away, and their next plan starts already filled in.

## GET `/api/availability` (session)

The requester's saved days inside a window they choose.

### Input

* `start` and `end`: the window to read

### Returns

* Their saved days in that window
* When they last filled their timetable
* Their sure-up-to date, if they set one
* The clock those days and hours are read on

---

## POST `/api/availability` (session)

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
