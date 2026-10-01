# API Endpoints

This document describes the Availability backend API.

Everything lives under `/api`. The same Node service serves these routes and hands out the built site, so in production they share an origin with the frontend.

## Authentication

Endpoints marked (session) require a logged-in session.

A session is a signed JWT in an httpOnly `sid` cookie, set when someone logs in through Discord. The cookie carries who they are and is signed so it cannot be faked. The only thing held this end is a version counter on the user record: the token carries the version it was signed under, every guarded request compares the two, and logout bumps it so an old cookie stops working.

Most actions also depend on where the requester stands:

* **Planner**: has the server's planner role. Only planners can pull the server's member list, start a plan, turn a repeat on, or copy a plan into a new one.
* **Host**: runs one plan, and can change anything on it. That takes no planner role, only being in the server. A plan is run by whoever made it, plus anyone who has taken it on since. One made before hosts were stored reads as run by whoever made it.
* **Guest**: on a plan's guest list. They can fill in their own dates, answer for themselves, and read the plan's overview.

A missing or expired session comes back as `401`. A valid session without the right standing comes back as `403`.

A plan that is over can't be changed: one called off, or one whose day has been on the server's clock. Every route that would change one answers `409`. Without that, a host with no planner role could send last month's plan back out for dates and have started a new one.

## Clocks

Dates are `YYYY-MM-DD` and times are `HH:MM`, both plain readings with no zone written into them. Which clock to read one on depends on whose it is:

* A person's own availability is read on **their** clock, `PUT /api/me/timezone`, taken from the browser.
* A plan's day, its set time and the overview's grid are read on **the server's**, set by `/setup` or `/timezone` in Discord. So is "today" when a route turns away a day in the past: on a server in Auckland, the 27th arrives while it is still the 26th here.

A time has to be a real one, `00:00` to `23:59`. Anything else, `25:99` say, comes back as a 400 rather than being quietly dropped.

Nothing is stored converted. The two only meet in `GET /api/plans/:planId/compare`, which reads everyone's hours onto the server's clock so they can be compared.

## What the bot is holding for a plan

Three kinds of Discord message belong to a plan, and every route that changes it brings all three back in line before it does anything else.

* **The pinned opener** in the plan's thread. On a set day it is the yes/no itself: the day, what the plan is about, the running tally and the buttons. Once called off it says so, with no buttons. It is remembered by message id, edited where it sits, and posted and pinned again if somebody deletes it. Without that second half a single deletion was permanent: every later pass fetched nothing and gave up. Set plans used to post the yes/no as a second message under it, and that one is deleted the first time the plan is touched after this change.
* **One card per person**, the DM that says what the plan currently is. It is rebuilt from the plan every time, so the message sent on the day and the message rewritten a fortnight later agree, and somebody's own yes or no stays on theirs. While a plan is still finding its day the card asks Count me in / Not for me, with the same line about what their calendar already answers that the plan page shows, and once they have answered it says where they stand, with their answer ticked. Someone who says Not for me stays on the plan and hears nothing more about it until they say they're in. Drop out and Undo buttons on cards from before Count me in land as Not for me and back in.

Anything that tells a guest something (a day set, a time moved, a nudge, a plan called off) goes as a fresh card with a line on why it came, and their old card is deleted once the new one has landed. When Discord will not delete it, it is edited down to "There's a newer message about this plan." with no buttons. That keeps one DM per person per plan with live buttons. A press on an older one anyway gets the card as it is now, becomes their card, and changes nothing. The only other DMs are the notes to everyone who runs the plan about other people (everyone is in, someone cannot make it, someone dropped out, everyone is coming).

Every yes/no button carries the round it was sent in, and a new day is a new round, so a button pressed after the day moved is refused with the day it was about ("That was about Sat 12 Sep 2026; the plan has moved.") and nothing is written. The answers for the last three days a plan has been on are kept, so moving back to one of them brings its answers back, and its old buttons work again. Buttons sent before rounds existed carry none and count as the plan's first day.

Editing a message notifies nobody in Discord. That is what the whole arrangement rests on: a wrong time or a wrong note can be put right without the correction itself becoming an event, and the people it was wrong for end up holding a DM that is simply correct.

A card that cannot be reached is skipped, never replaced, since sending a new one would ping them. A card whose message has really gone (Discord's `10008`) is forgotten so later passes stop paying for it; any other failure is left alone and tried again.

## Who gets pinged

The DMs always go out before the thread post, and the post mentions only the people the DM could not reach. Everyone else already has the news in their DMs. A plan of 150 whose DMs all fail still reaches everyone: the mentions are spread over as many posts as it takes to stay inside Discord's 2000 characters and 100 mentions a post. The thread post used to go first and name the whole guest list, so a plan of about 55 broke the limit and the DMs queued behind it never went out.

When Discord refuses a DM because the person has DMs closed (its `50007`), that is written against them on the plan, and the overview shows "DMs closed, only reachable in the thread" beside their name. The next DM that gets through clears it. Any other failure is a blip or somebody gone, and is not written down.

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

What My plans and Past plans run on. Everywhere else the link says which server or plan it is about, so these are the only routes that answer from the session alone.

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
* The site uses it for the Start a plan button on My plans, which only offers the servers that have run `/setup` and where the requester is a planner.

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
* Its status and date range, plus the day and time if one has been set, the server clock that time is written on, and `repeatWeeks` if it comes round again
* `role`: `host` if they run it, `guest` if they are only on its list
* `hosts`: the names of whoever runs it, other than the requester. All of them for a guest, the others for a host.
* Where they stand on it, which is what the site's next-step button and `/mylink` are worked out from:
  * `onList`: whether they are on the guest list
  * `standing` and `daysLeft` while the plan is finding its day, as the overview has them, and `movedBack` once a host has asked them to go over their dates again
  * `datesPassed`: the plan is still finding its day and every day it asked about has gone, on the server's clock. Whoever runs it is sent to ask about new dates, and a guest has nothing to do but wait.
  * `answer` for a set day, which is their own yes or no, a host's call on the board, or `no` for someone who said the plan wasn't for them, and `invited`, whether they are on that day's list
  * `readyToPick`: they run it, and everyone left on it has answered
* `inIt`, `filledIn` and `mine`, the older names for being on the list, having saved dates, and running it

### Notes

* The live list covers plans still collecting dates and set plans whose day has not passed. A plan whose dates went by with no day picked stays on it for thirty days after the end of its window, so whoever runs it can ask about new ones.
* The second list is what is over: cancelled plans, set ones whose day has been and gone, and ones that never got a day, which is a plan still collecting more than thirty days after its window ended. Newest first and capped at a dozen. The site shows it under Past plans, so the overview behind a finished plan, and everything it remembers, still has a way in.
* A plan set for today counts as live, so the two lists never overlap and nothing falls between them.
* Plans the requester runs count as well as plans they are in, since nothing makes a planner invite themselves to their own plan. A plan made before hosts were stored is run by whoever made it.
* A set plan the requester was left off the invite list for is left out, unless they run it.
* Reads everyone's answers on the plans they run that are still finding a day, in one query, since `readyToPick` is everybody's answers.

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
* For a set plan: `announce` set to true, a single `date`, and an optional `time`
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

## GET `/api/plans/:planId/name`

A plan's name, for anyone holding its link, logged in or not. It is what lets the page a logged out visitor lands on say what the link is for before they log in.

### Returns

* The plan's name, and nothing else: no description, dates, server or guests

### Notes

* `404` if there is no such plan.
* Limited to 120 requests from one address every ten minutes, since it is the one plan read that needs no login. Plan ids are ten random characters, so nobody reaches one by guessing.

---

## GET `/api/plans/:planId` (session)

Everything the availability page needs to draw the grid.

### Returns

* The plan: name, description, date range, status, server name, any weekday restriction, and the clock the server runs on
* The day it ended up set for, with its time and any note an older plan still carries, all null while one is still being found. Nothing private: the same day is on their landing page and in the DM they were sent, and the page needs it to stop asking for dates once there is nothing left to ask.
* `role`: `host` if the requester runs the plan as well as being on it, otherwise `guest`. The site sends anyone opening a plan that has its day on to the overview, and reads this as word that the overview is theirs to open.
* Whether the requester is a participant, and whether they have confirmed
* The running confirmed count out of the total
* The requester's saved days inside the range, so the grid comes up prefilled
* `coveredUntil`: the date their calendar answers plans up to, if they set one
* `in`: `true` for Count me in, `false` for Not for me, `null` while they haven't said. Someone on a plan from before the question reads as in if they had filled in or said yes.
* `inReason`: the reason they gave for Not for me, if any
* `ask`: the line under Count me in, the same one their DM carries, e.g. "Your calendar answers up to Tue 8 Sep, so there are 3 days after that to fill in." Blank once the plan has its day.
* `toFill`: the plan's days, from today on, that their calendar doesn't answer yet. Empty once the plan has its day.
* Their own clock, so the page can say when it is not the server's

### Notes

* A saved window answers the plan's days by name. `coveredUntil` is a date on their own clock, so it answers a plan's day only once every one of their days that day falls on is on or before it.
* The free count in `ask` is read on the plan's clock, the way the overview reads it.

---

## POST `/api/plans/:planId/availability` (session)

Save the requester's picks for this plan and mark them confirmed.

Participants only.

### Input

* The days they are free, optionally narrowed to certain hours
* `coveredUntil` (optional): the date their calendar answers plans up to, on their own clock, or `null` to stop it answering any. Left out, the one they have stands.

### Effects

* Replaces their saved days inside the plan range.
* Marks them confirmed for the plan, which counts as in.
* Remembers the plan's window, weekdays and all, as days they've answered, so every other plan over the same days counts them as answered too. `/free` does the same for each list it saves.
* Saves `coveredUntil` when it rides along.
* Rewrites the DM card they hold on every plan still finding a day, since each says how much is left, and DMs whoever runs any plan where everyone left on it is now in and answered.

### Returns

* The running confirmed count out of the total
* `answers`: the other plans still finding a day that this save left their calendar answering in full, where it did not before, each as `{ planId, name }`. Plans they have said are not for them are left out.
* `in`, `inReason`, `ask` and `toFill` as the GET above has them, now the save has moved them

### Notes

* No thread post, a confirmation is kept quiet.
* On a weekday-pinned plan, days off those weekdays are ignored, and only the pinned days are rewritten so the person's saved availability on other days is left alone.
* `409` if the plan was called off.

---

## GET `/api/plans/:planId/compare` (session)

Everything a plan's overview needs.

For anyone on the plan: whoever runs it, and its guests. A host gets all of it. A guest gets where everyone stands, with the parts a host works from left out.

### Returns

* `role`: `host` or `guest`, which is what decides the rest
* `hosts`: the names of whoever runs the plan, leaving out anyone no longer in the server
* `isPlanner`: whether the requester has the planner role, so could start another plan like it
* `canTakeOn`: whether the requester could make themselves a host with `/takeon`
* The plan, including any date already locked in, the clock the server runs on, whether it repeats, the plans either side of it in its series, and a link to its thread in Discord
* Everyone on the plan, with names, avatars, whether they confirmed, their confirmation vote and reason, any manual call a planner made on them, whether they are still invited to the set date, and `dmsClosed` when the last DM was refused because their DMs are closed
* Where each of them stands: `in` (true, false once they've said Not for me, null if they haven't said), `inReason` for someone out, `standing` (one of `not-said`, `done`, `days-left`, `no-dates`, `out`), `daysLeft`, their `coveredUntil`, and `sentBack` with the name of whoever moved them back, if someone did
* `updatedAt`: when each of them last saved anything on their calendar, null if they never have
* For anyone who is in, `unanswered`: the plan's days they haven't answered yet, as `[first, last]` runs rather than one date each, since a two year window would otherwise be hundreds of dates per person
* Whether the requester is on the guest list themselves, and as `you`, their own answer for a set day and whether they're on that day's list
* For each day, who is free and the hours they gave, so the page can work out the overlap. Only people who are in count, and only on days their answer reaches: a day marked on their calendar past their answer date doesn't show until they answer it
* The plan's history: what has happened to it, oldest first

### What a guest gets instead

* No reasons: `inReason` and `voteReason` are null, and the one history line that carries a reason comes without it.
* `vote` is where the person stands on the day, a host's call on the board included, and `override` is null. Whether they said it themselves is the host's business. `you.vote` is still the requester's own answer.
* `sentBack`, `updatedAt` and `coveredUntil` are null and `dmsClosed` is false for everyone.
* `seesDays`: whether the days come with names. True for a host, and for a guest on a plan made since guests could see each other's days. People on older plans answered expecting only the planner to see, so a guest on one gets each day's free people as `free0`, `free1` and so on, in order of their hours rather than in guest list order, with no `unanswered` runs on anyone. `unansweredCounts` comes in their place: for each day, how many of the people in haven't answered it.

### Notes

* The days and hours come back on the server's clock, not on each person's. Everyone writes their hours where they are, and this is where they get read onto one clock so they can be compared at all: someone an hour ahead is free from 11pm the night before as far as the grid is concerned. The read reaches a day past each end of the range to catch that spill, and anything still landing outside is dropped, so the first and last day of a range can read a little short for someone far away.
* An empty hours list still means free all day, and survives as one from anybody whose clock matches the server's, which on most servers is everybody.

* Each history line carries what happened, when, who did it, and their display name as it was at the time. The name is stored with the event rather than looked up now, so the list does not rewrite itself when someone changes their nickname or leaves the server.
* Recorded: the plan starting, a day being set or moved or called off, the range or the weekdays changing, a trip back out for different dates that moved several of those at once, the title or description being edited, people being added, someone dropping out or coming back, someone taking the plan on, a nudge going out, repeating being turned on or off, the plan coming round again, and the plan being cancelled. Availability being filled in is not, since the confirmed count above already says that.
* Every line but one was done by a person. Coming round again is written by the repeat sweep on a timer, so it carries no name and reads as a sentence of its own.
* Capped at the most recent 100, and this is the only place history is exposed, so only people on the plan ever read it.
* `403` for anyone who is not on the plan, planner role or not. The one exception is someone who could take it on: they get `role: null`, `canTakeOn: true`, `hosts`, and of the plan only its id, name and server, which is no more than its link already gives away.

---

## GET `/api/plans/:planId/template` (session)

What it takes to set another plan up like this one, for "plan another like this" on the overview to open the create form with.

Planner role only, and only for someone on the plan.

### Returns

* The name and description
* Which weekdays it asks about, or nothing at all if it asks about every day
* Everyone on the guest list, by id
* `hostIds`: whoever ran it and is still in the server, by id, for the new plan to start with

### Notes

* No dates in it, on purpose. A plan run again is the same crowd in a different month, so the range is the one thing that does not carry, and the create form leaves its own default in place.
* Works on a cancelled plan and on one whose day has been. Those are the two most worth running again, and this only reads.
* The guest list ids come back as they are stored. Anyone who has since left the server is dropped by the create form, which has the member list to check against, and again by the create route.

---

## GET `/api/plans/:planId/members` (session)

The server's member list, for the people picker on a plan that is already running.

Hosts only.

### Returns

The same list `GET /api/guilds/:guildId/members` gives a planner, cached the same way.

### Notes

* Here because whoever runs a plan may not hold the planner role, which the server's own route asks for.

---

## POST `/api/plans/:planId/takeon` (session)

Make the requester one of the people who run the plan.

For a planner, once nobody who runs the plan is still in the server. For anyone who can manage the server, at any time, which is the way in on a plan being misused.

### Effects

* Adds them to the plan's hosts, and takes off anyone on that list who has left the server.
* Records it in the plan's history, where everyone on the plan can read who did.
* Puts them in the plan's thread.

### Notes

* "Still in the server" is asked of Discord, not read off the list, since a host who left while the bot was down is still on it.
* Nobody is DMed about it.
* Says yes again, and changes nothing, for someone who already runs the plan.
* `403` for anyone else, and `409` if the plan was called off or its day has been. The `403` comes first, so someone who couldn't take it on is told nothing about the plan.

---

## POST `/api/plans/:planId/choose` (session)

Lock in the winning date and announce it, or edit the time on the day it is already on.

Hosts only.

### Input

* Date (must sit inside the plan range)
* Time (optional)
* `inviteMode`: who is still invited once this is set. `attending` narrows the plan to the people in `attendingIds`, anything else keeps everyone on the list. Anyone who said Not for me stays on a narrowed list too, but nothing is sent to them: their card just changes to the day, so they can still say I'm coming.
* `attendingIds`: who stays invited, worked out by the overview: the people who can make the day, plus anyone who hasn't answered for it (not said if they're in, or in but their answer doesn't reach that day) unless the planner unticked that
* `quiet` (optional): rewrite everything in place and tell nobody

### Two things, decided by the date

Picking the day the plan is **already set for** is an edit to the time and nothing else. Every vote stands, the confirmation keeps running, and the invite list is left exactly as it is, because nobody answered about a different day. `inviteMode` is ignored, since it has nothing to decide. Everyone's DM and the pinned post are rewritten where they sit, and unless `quiet` is set the people still invited get a fresh card naming what moved, with the yes/no buttons again. Answers `edited: true`.

Picking **any other day** is a set or a move, and behaves as it always has, below. This split is the fix for an update having wiped a confirmation round that was halfway through.

### Effects

* Sets the chosen date.
* Narrows the invite list when asked. Anyone left off is not pinged, not DMed, and does not count in the confirmation tally. Moving or undoing the date invites everyone back.
* Always DMs the people still invited, then posts the outcome in the thread, pinging only the ones the DM could not reach. Setting a different date counts as a reorganise.
* The pinned opener becomes the yes/no before anything is sent, and its tally keeps itself current as votes land. The thread post carries the buttons too, for the people it pings.
* `quiet` on a move posts nothing: the pin and everyone's card are rewritten where they sit.
* The thread is renamed to carry the new day, last and best effort, quiet or not.

### Notes

* `409` if the plan was called off, or its day has been.
* `400` on an edit that does not move the time.
* No `note` is read. What a plan is about is one field, edited on `/details`; a note an older plan still carries is passed through untouched here rather than wiped by an edit that was never about it.
* Capped at a high daily backstop per person, since it pings and DMs everyone. An edit spends the same allowance: it is quieter, but it still rewrites a DM per person.

---

## POST `/api/plans/:planId/repair` (session)

Puts Discord back in step with the plan by hand.

Hosts only.

### Effects

* Rewrites the pinned opener, tally and all, and every DM card, from the plan as it currently stands. Anything deleted since is posted again, except a card, since sending one would ping them.
* Puts the thread's name back to the plan's, day and all, if it has drifted.
* Sends nothing and pings nobody, so it is safe to press whenever something looks out of step.

### Notes

* Every change already does this on its way past. This exists for when that failed and nothing said so: announcements run after the response and only log a failure, so a Discord outage leaves the plan set, the database right and not a word sent anywhere. There was no second attempt before this.
* Answers `cards` (how many DMs were corrected) against `holders` (how many people are holding one). A gap between them is people who deleted theirs or have DMs closed.
* `502` if Discord would not answer at all, rather than reporting a success it did not have.
* Works on a plan that is over, deliberately. A cancelled plan is the one whose DMs most want correcting, since a stale card there has somebody turning up to nothing.

---

## POST `/api/plans/:planId/attendance` (session)

A host's manual call on someone's attendance for the set date, the moves on the overview's board.

Hosts only.

### Input

* The person to move
* `status`: `coming`, `cant`, `waiting`, or `invite`

### Effects

* `coming` and `cant` lay an override over whatever the person answered.
* `waiting` sends them back to answer again. Their answer and any override are put aside and cleared, and their DM is edited back to the question. Nothing is sent then; the next nudge opens with who moved them back.
* Moving someone out of Waiting before they've answered gives them back exactly what they had if it's the column they were moved from. Anywhere else, what they had comes back with the new column laid over it, so the board can still say what they said. Their DM is edited to match.
* `invite` is for someone left off the list when the date was locked. It puts them back on with no answer, so they land in Waiting to answer, and DMs them the same yes/no everyone else got as a new message, saying who invited them. Their old DM said they weren't on the list and has no buttons.
* The thread tally is refreshed.

### Returns

* `dm`, on an invite only: whether their DM landed. With DMs closed they can still answer on the yes/no in the thread, since they were never taken out of it.

### Notes

* `400` if no date is set yet, the person is not on the plan, `invite` names someone already invited, any other move names someone who isn't, or `waiting` names someone already waiting.
* What someone sent back had only comes back while the day stays put. Setting or moving the day starts everyone afresh.
* Nobody is DMed about any other move. A planner reaches for the board because they have decided that person is not going to answer, so telling them second guesses a call already made. An override only stops them being nudged: they keep the thread and the buttons on their own DM, and casting a vote clears the override, so their own answer still wins whenever they give it.
* `409` if the plan was called off, or its day has been.

---

## POST `/api/plans/:planId/askagain` (session)

Ask one person again, from Who has answered on a plan still finding its day.

Hosts only.

### Input

* `userId`: who to ask

### Effects

* DMs them their card fresh, with REMINDER on top and who is waiting on them. Their old card is taken down.
* Someone who is in is also sent back: their calendar stops answering this plan until they save their dates on it again, and the card opens with "Ali asked you to go over your dates for "Bowling" again." instead.

### Returns

* `dm`: whether the DM landed

### Notes

* `400` for someone not on the plan, or someone who said Not for me, since they get no DMs at all.
* `409` once the plan has a day (move them to Waiting on the board instead), or if it was cancelled.
* `429` if they were asked again in the last 24 hours.

---

## POST `/api/plans/:planId/repeat` (session)

Whether this plan comes round again once its day has been and gone.

Hosts only. Turning a repeat on, or changing how often, takes the planner role as well, since it makes plans. Any host can stop one.

### Input

* `repeatWeeks`: `1`, `2` or `4`, or `null` to make it a one off. Anything else is a `400`.

### Effects

* Saves it on the plan, and records the change in the plan's history.
* Nothing is scheduled. The next plan is only made after this one's day has passed.

### Notes

* Allowed on a plan with no date yet, on purpose: somebody who knows this is their fortnightly thing should not have to come back and say so once the day is picked.
* Nothing happens to plans the series has already made. Repeating is a standing instruction on whichever plan is currently live.
* Cancelling a plan ends the series too, since only a plan with a day that has passed is ever picked up.
* `403` for a host without the planner role asking for anything but a one off.
* `409` if the plan was called off, or its day has been.

---

## POST `/api/plans/:planId/remind` (session)

Nudge whoever the plan is waiting on.

Hosts only.

### Effects

* While the plan is still collecting, sends their card again to whoever it is waiting on: anyone who hasn't said if they're in, and anyone in whose calendar still leaves days to fill. The card says what each of them has left, and the line on top who is waiting. Nobody who is done, or who said Not for me, hears anything.
* Once a date is locked in and a confirmation probe is running, sends the people who have not said whether they are coming their card again, yes/no buttons and all, so they can answer from the DM.
* Someone a host moved back to waiting hears "Sam moved you back to waiting for "Bowling"." in place of who is waiting. Before there's a day, it's "Sam asked you to go over your dates for "Bowling" again."

### Returns

* How many people were pinged
* `kind`: `availability` or `vote`, which of the two nudges went out

### Notes

* Capped at once a day per plan, and the two nudges carry their own cooldowns, so starting a probe does not arrive already inside the availability nudge's.
* The vote nudge skips anyone a planner has already made the call on, since that stands in for an answer, and anyone left off the invite list.
* Setting or moving a date starts a fresh round of votes, which clears the vote cooldown with it.

---

## POST `/api/plans/:planId/dates` (session)

When is it: the day, or a fresh round of dates, plus the guest list and the repeat, all in one press.

Two modes, the same two the create form has, picked by whether a `date` is sent. Naming a day sets the plan to it; leaving it out asks everyone about a window instead.

Hosts only.

### Input

Shared by both modes:

* `participantIds` (optional): the full guest list as the screen has it
* `repeatWeeks` (optional): 1, 2, 4, or `null` for a one off
* `post` (optional, default true): whether to post the change in the thread
* `dm` (optional, default true): whether to DM everyone
* `quiet` (optional): forces both of the above off

Naming the day:

* `date`: the day the plan is on, which does **not** have to fall inside the window
* `time` (optional): `HH:MM`

Asking about a window:

* New start and end date
* `allowedWeekdays` (optional): the weekdays people can mark, as numbers 0 (Sunday) to 6, or `null`/all seven for the whole range
* Note (optional): carried into the message that goes out

### Effects

Both modes set the window, the weekdays and the repeat in a single write, then add anyone new to the guest list, and send one thread post and one round of DMs for the whole change. Anyone added gets the ordinary invitation instead, since it already carries the day or the new window. The thread's name follows along: the day goes on the end when one is named and comes off when the plan goes back to asking.

Naming a day:

* Stretches the window to reach the day when it falls outside, leaving the rest of it alone, and adds the day's weekday to the set the plan asks about when a restriction would have excluded it.
* Nobody is asked anything, so nothing is reopened and every answer already given stands.
* A day that moved clears the confirmation round and invites everyone back, the same as `/choose`. A day that stayed put is an edit to the time and costs nobody their answer.

Asking about a window:

* Reopens the plan and resets everyone's confirmed flag when the window moved, or when the weekdays opened a day nobody has been asked about. A window that stayed put falls back to the weekday rule, so a pure narrowing leaves every answer standing.

### Returns

* `set`: present and true when a day was named
* `chosenDate` and `chosenTime`, when a day was named
* `reopened`: whether everyone was sent back for their dates, when a window was asked about
* `start`, `end`, `allowedWeekdays`, `repeatWeeks`: the plan as it now stands
* `added`: how many people were new to the plan

### Notes

* Nobody is ever taken off here. A list arriving short of someone already on the plan means the picker did not know about them, not that they are meant to go.
* Stretching is the only way to a day the plan never asked about. `/choose`, which the grid uses, still holds a date to the window, since a day picked off the grid can only be one that is drawn on it.
* At least one of the picked weekdays has to fall inside the new window.
* The request has to change something: the same day, time, window, days, people and repeat is refused.
* A `repeatWeeks` that turns a repeat on, or changes how often, is a `403` from a host without the planner role. Leaving it as it was, or stopping it, is fine.
* Shares one daily backstop with the other ways a window moves, since it is the same ask.
* `/add` and `/repeat` are still reached on their own from the overview, since adding a person and turning a repeat on are their own reasons to be there. The window and the days had a route each before this one, and each put its own message in the thread.

---

## POST `/api/plans/:planId/details` (session)

Change a plan's title and what it says it is about.

Hosts only.

### Input

* Name
* Description
* `quiet` (optional): rewrite everything in place and tell nobody

### Effects

* Updates the stored title and description, and clears any `chosenNote` the plan still carries.
* Renames the thread to the new title, with the day still on the end if the plan has one.
* Rewrites the pinned opening message and every DM card so they show the new title and description.
* On a plan whose day is already set, sends everyone still invited a fresh card saying what it is about has changed, unless `quiet`.

### Notes

* Nothing goes in the thread either way.
* The description is the one field for what a plan is about. A day used to carry a `chosenNote` beside it, drawn on the next line down in every message and never tellable apart from it on screen, so the two are one field now: the site hands both back joined up and saving stores them as one. Plans made before that keep rendering their note until the next save here.
* A plan still collecting says nothing at all, since there is no arrangement yet for a correction to be about.
* Same rules as creating a plan: the name is required and caps at 90 characters, the description at 280.
* `409` if the plan was called off, or its day has been.
* A no-op edit, where nothing changed and there is no note to fold in, is rejected.
* The thread rename is best effort and goes last, with nothing waiting on it, since Discord allows two renames a thread every ten minutes.

---

## POST `/api/plans/:planId/cancel` (session)

Cancel a plan.

Hosts only.

### Input

* `post` (optional, default true): whether to post the cancellation in the thread
* `dm` (optional, default true): whether to DM everyone

### Effects

* Marks the plan cancelled.
* DMs everyone, then posts in the thread pinging whoever the DM missed, each according to `dm` and `post`.

### Notes

* The thread is left to be deleted by hand.
* Cancelling an already cancelled plan is a no-op, so nobody is told twice.
* `409` once the plan's day has been.

---

## POST `/api/plans/:planId/add` (session)

Pull extra people into a running plan.

Hosts only.

### Input

* The people to add
* `dm` (optional, default true): whether to DM the new people

### Effects

* Adds them to the plan and pulls them into the thread.
* DMs the new people unless `dm` is off.

### Notes

* Anyone already in, and anyone not a real non-bot member, is skipped.

---

## POST `/api/plans/:planId/join` (session)

Count me in or Not for me, on a plan still finding its day. The website side of the same buttons on the DM.

Participants only.

### Input

* `in`: `true` for Count me in, `false` for Not for me
* `reason` (optional): why not, with a `false`, capped at 200 characters. Only whoever runs the plan sees it.

### Effects

* Records the answer. Someone who says Not for me stays on the plan and can say they're in again.
* Rewrites their DM card to match.
* DMs everyone who runs the plan when someone says Not for me, with the reason, and when someone who had said it is in after all.
* If that leaves everyone answered, DMs them to go and pick a day.

### Returns

* `in`, `inReason`, `ask` and `toFill` as `GET /api/plans/:planId` has them
* `told`: the names the Not for me DM reached
* `missed`: the names it could not reach

### Notes

* `409` once the plan has its day, where the question is I'm coming or Can't make it, and on a cancelled plan.
* Limited to 30 answers a day per person per server, since a no and a change of mind each send a DM.

---

## POST `/api/plans/:planId/vote` (session)

I'm coming or Can't make it, for a plan with its day set. The overview's side of the same buttons on the DM and the pinned post.

Participants only, and only someone on that day's list.

### Input

* `vote`: `yes` or `no`
* `reason` (optional): why not, with a `no`, capped at 200 characters. Only whoever runs the plan sees it.

### Effects

* Records the answer, which replaces any call a host made for them on the board. A yes counts as in.
* Brings the pinned tally and their own DM card in line.
* DMs everyone who runs the plan about a no that is new, with the reason, and when a yes means everyone is now coming.

### Returns

* `vote`: the answer as it now stands
* `told`: the names a no's DM reached
* `missed`: the names it could not reach

### Notes

* `409` while the plan has no day, for someone left off the day's list, and once the plan was called off or its day has been.
* Limited to 30 answers a day per person per server, since a no sends a DM.

---

## POST `/api/plans/:planId/leave` (session)

Take yourself off a plan with its day set, from its overview. Can't make it answers for the one day; this is the way off the plan altogether, and so off any that come round after it. A plan still finding its day asks Not for me through `/join` instead, which keeps them on it.

Participants only.

### Effects

* Takes them off the guest list, and leaves them in the thread. Someone who runs the plan still runs it.
* DMs everyone who runs the plan, the same message the DM's drop out sends, just without a reason. Someone who runs it dropping out tells the others, and tells nobody when they run it alone.

### Returns

* `told`: the names of the people that DM reached
* `missed`: the names of the people it could not reach, usually because their DMs are closed

### Notes

* Someone who runs it and has since left the server comes back as "whoever runs it", since there is no server nickname left to read.
* `409` if the plan was called off, or its day has been.

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
* `coveredUntil`: the date their calendar answers plans up to, if they set one
* The clock those days and hours are read on

---

## POST `/api/availability` (session)

Save the requester's general timetable for a window.

### Input

* Start and end date
* The days they are free, optionally narrowed to certain hours
* `coveredUntil` (optional): the date their calendar answers plans up to, on their own clock, or `null` to stop it answering any. Left out, the one they have stands.

### Effects

* Replaces their saved days inside the window.
* Saves `coveredUntil` when it rides along. A plan's day counts as answered once every one of their own days it falls on is on or before it.
* Rewrites the DM card they hold on every plan still finding a day, and DMs whoever runs any plan where everyone left on it is now in and answered.

### Returns

* How many days were saved
* `answers`: the plans still finding a day that `coveredUntil` now answers in full, where it did not before, each as `{ planId, name }`. Plans they have said are not for them are left out.

### Notes

* The range has to be valid and within two years.
