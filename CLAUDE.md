# today.robski.uk

Robin's personal daily schedule tool. Plain HTML/CSS/JS on a Cloudflare Worker
with D1. No build step, no framework.

Read README.md first: it explains the architecture and how the pieces fit.

## Stack

- **Worker + static assets:** one `wrangler deploy` serves `public/` and `/api/*`
  from `today.robski.uk`. There is no Pages project.
- **D1** `today-robski`. Schema in `worker/schema.sql`.
- **Auth:** email OTP -> 7-day HS256 JWT signed with `AUTH_SECRET`. Codes,
  invites and the morning brief all send from **contact@daybook.fyi via
  Purelymail SMTP** (`smtp.purelymail.com:465`, `BRIEF_SMTP_PASS` is that
  mailbox's Purelymail **Shared Password** - the mailbox login password 535s
  under 2FA; `BRIEF_FROM`/`BRIEF_SMTP_USER` set the address). daybook.fyi is
  fully SPF/DKIM/DMARC-aligned on Purelymail, so deliverability is native.
  Resend (`FROM_EMAIL = Today <today@incremento.co>`) is only the fallback if
  `BRIEF_SMTP_PASS` is unset or SMTP fails - `sendCodeMail` catches an SMTP
  error and retries via Resend so a bad cred can't lock people out. Nothing
  sends from robski.uk any more.
- `ADMIN_EMAILS` takes whole addresses or `*@domain`. `isAllowed` in auth.js
  matches the domain exactly - never loosen it to endsWith, that would let
  `robski.uk.evil.com` in. `npm test` covers it.

## Invitations

You put in someone's email and a note; the worker emails them the invitation
(`sendInviteMail` in accounts.js, template in the pure `worker/invite-email.js`).
**Nobody is ever asked to type a code.** Three things make that true, and each
was a way the first invitations died:

- **The signup form only asks for a code when it hasn't already got one.**
  `/join/<CODE>` stashes it, and failing that `resolveInvite` finds the unused
  invite addressed to the signed-in email. A pinned email is how we *find* an
  invitation, not a lock on it: blocking a mismatch stranded anyone who read the
  mail at work and signed in with a personal address. The code is the credential.
- **A signup finishes on the new account's own subdomain.** Signing up happens on
  `daybook.fyi`, but `tara.daybook.fyi` is a different origin with its own empty
  localStorage. `goToMyDaybook` carries the session over in the URL fragment
  (never sent to a server, never logged). Reloading the apex instead landed the
  newcomer on the marketing page and asked for a second sign-in code, which read
  as "signup failed" - while the invite was already marked used, so trying again
  was a dead end.
- **`/join` with no code still serves the app shell**, because the app tidies the
  code out of the URL and a mid-signup refresh must not drop them on marketing.

Inviting the same person twice re-sends their standing invitation rather than
minting a second live code, so a re-send never costs a member one of their five.
The email escaping is tested: an invitation carries two pieces of somebody's
typed text (the inviter's name, their note) into a stranger's inbox.

## How tasks work

Tasks are **native blocks** in D1: `kind='task'`, with a `props` JSON holding
area, priority, done and duration. There is no external system to reconcile
with, no queue and no delay - a tick takes effect at once. So:

- `setTaskDone` in worker/index.js is the single door for "a task changed
  state": it updates the block's `props.done` and closes a *sole-task* block.
  Both checkboxes go through it. Don't add a third path.
- `slot_tasks` is the link table: a block holds any number of tasks. Its column
  is named `tana_id` for legacy reasons, but it holds a task block id.
  `slots.tana_id` is likewise a legacy name kept so old rows read; new links go
  in slot_tasks.
- `slots` (the day itself) are owned here.
- **Adopted events.** A calendar event whose title names a lane or one of its
  activities can be counted as practice: clicking it creates a slot carrying
  `slots.event_id`. The timeline then draws the event and *skips* that slot, or
  the same sit appears twice. A unique index on `(day, event_id)` is what stops
  a double count, not a read-then-write check, because a double click races it.
  Un-adopting just deletes the slot. Nothing here ever writes to Google.
  The matcher is `public/event-lane.js` - in public/ rather than shared/
  because the browser has to fetch it, and only public/ is served as an asset.
  It matches whole words only: `\b` is ASCII-only and would break on "Forró",
  hence the explicit `\p{L}\p{N}` boundaries. `npm test` pins the false
  positives that matter (Workshop, Artichoke, Bodyboarding, Restaurant).
- **+ New** creates the task directly as a native block via `createTask` in
  worker/index.js, so it is usable instantly. No placeholder id, no swap-in
  step: the row exists the moment you type it.

## Calendar

Two layers. **Native events** are the base: `kind='event'` blocks in D1, per
user, so the calendar works for everyone with no external account at all (this
is what let members like Carolina finally add events). Props hold
`{date, allDay, start_min, duration, end_date, location, repeat, until, exdates}`;
recurrence is expanded server-side in `nativeDayEvents` / `nativeRangeEvents`,
and a recurring occurrence's id is `<blockId>::<YYYY-MM-DD>` (the events route
regex allows the `:`). Delete "this and following" sets `until`; "just this
one" appends to `exdates`; a plain delete archives the block.

**Google** is an optional overlay. **Reads are now per-member** (2026-09-02):
`googleCtx(env)` returns whose calendar to use - a member who connected their own
Google account reads their **primary** calendar; the owner reads the shared
Workspace calendar (`GOOGLE_CALENDAR_ID`). `calendarEvents`/`calendarRange` and
the `/api/day` + `/api/calendar` merges use it, so a member sees their own Google
events + native, never Robin's diary. **Writes are still owner-only**:
`createEvent`/`updateEvent`/`deleteEvent` route to Google only when
`env.uid === 1 && env.GOOGLE_REFRESH_TOKEN`; a member's writes fall to native
storage (two-way sync for members is the next phase).

**Member connect flow** lives in `worker/gcal.js`, using a **SEPARATE OAuth
client** (`GCAL_MEMBER_CLIENT_ID` var + `GCAL_MEMBER_CLIENT_SECRET` secret) in its
**own** Google Cloud project, published **External / In production**. This keeps
the owner's Internal client - and its non-expiring refresh token - untouched
(never flip the owner's client to External: CLAUDE.md warns it opts the whole app
into 7-day token expiry). Flow: `GET /api/gcal/connect` (authed) returns a consent
URL with a signed `state`; Google redirects to the single fixed
`GET /api/gcal/callback` (unauthenticated, on the apex - wildcard subdomains
aren't allowed as redirect URIs), which exchanges the code, stores the member's
refresh token AES-256-GCM-encrypted in `users.gcal_refresh_enc` (+ `gcal_email`),
and bounces back to `https://<sub>.daybook.fyi/calendar?gcal=connected`.
`gcalMemberToken` refreshes per-uid. The Calendar view shows a Connect/Disconnect
strip to members (hidden for the owner and until the client is configured). The
whole thing is **inert until both env values are set** (`gcalStatus.available`).
Redirect URI to register in Google: `https://daybook.fyi/api/gcal/callback`;
scopes: `calendar.events` + `userinfo.email` + `openid`. Other providers
(iCloud/CalDAV, Outlook) are unbuilt.

## The morning brief

`worker/brief.js` renders one email a day, sent at 08:45 Europe/Lisbon off the
same every-minute cron as the SMS alerts: the day's calendar, every open P1,
and the day's quote.

It lives in the worker rather than in a Claude routine because the worker
already has both halves: the calendar (through its Google refresh token) and
the tasks (native blocks in D1). A routine would have to reach back in for one
or the other and would deliver half a brief, which is what the old one did.

- `briefDue` opens a window from 08:45 to 10:15 rather than matching 08:45
  exactly, so a dropped cron tick delays the brief instead of losing the day.
  An evening brief is worse than none, hence the closing edge.
- The window is 90 ticks wide, so `runDailyBrief` **claims the day in
  `settings.last_brief_day` before sending**, not after. The conditional UPDATE
  is the lock: `meta.changes` says whether this tick won it. A send failure
  hands the day back so a later tick retries.
- **Multi-tenant.** `runDailyBriefAll` fans the brief out over every active
  account (`activeUsers`); each claims its own `last_brief_day` (settings PK is
  `(user_id, key)`). The **calendar rides a single Google refresh token - the
  owner's** - so `calendarEvents` is called **only for user 1**; a member's
  brief is tasks + quote, never the owner's diary. Don't "fix" that by calling
  it for everyone. A member with no calendar and no P1s is skipped, not emailed
  a quote-only note. The SMS alerts and mail-push fan out the same way: each
  member texts their own saved `phone` (owner falls back to `ALERT_PHONE`) and
  is pushed their own inbox's unread, not the sum across tenants.
- `POST /api/brief/test` sends it now and deliberately does *not* claim the
  day, so testing at noon cannot swallow tomorrow's.
- Everything in brief.js is pure, and `npm test` renders the page without a
  worker or a clock. The escaping tests matter: a calendar invite title is
  somebody else's text.
- Base size is 17px and the quote is 27px, and a test pins the floor. Robin's
  eyesight is the reason; don't let a tidy-up shrink it.
- `longDate` composes weekday and date from two formatters rather than asking
  en-GB for both: Node renders that without the comma and workerd need not
  agree, so the header would differ between the test and the inbox.
- **Sender:** the brief sends as `contact@daybook.fyi` through Purelymail SMTP
  (`smtp.purelymail.com:465`, via `smtpSend`/`buildMessage` in mail.js) when
  `BRIEF_SMTP_PASS` (that mailbox's Purelymail Shared Password) is set - the
  same transport codes and invites now use. A real, fully-aligned Purelymail
  mailbox passes SPF/DKIM/DMARC natively. With no secret it falls back to Resend
  from `today@incremento.co`. `BRIEF_FROM` / `BRIEF_SMTP_USER` set the address
  (both are `contact@daybook.fyi` in wrangler.toml). No longer robski.uk.

## Layout

```
shared/lanes.js     LANES + AREA_TO_LANE. Imported across the worker.
worker/index.js     API. Router at the bottom.
worker/brief.js     The 08:45 email. Pure: renders, sends nothing.
worker/accounts.js  Signup, invitations, account settings.
worker/invite-email.js  The invitation email. Pure, like brief.js.
worker/schema.sql   blocks, slots, slot_tasks, settings, activities, etc.
public/             index.html, today.css, today.js, favicon.svg
sync/google-auth.js one-off refresh-token helper (Robin runs it)
```

## Design intent

Robin explicitly wants flexibility, not a rigid timetable: *"I need the
flexibility to keep working on something if I am in the zone."* So:

- `slots.start_min` is **nullable**. NULL = a floating block, shown in a tray,
  placed when the day decides. Don't make it required.
- The `rest` lane is `optional: true` (dashed ring). A skipped siesta is a
  choice. Nothing in the UI should nag about it.
- Lane targets are guidance, not debt. There is deliberately no overdue state,
  no streak, and no red.
- The quote is **per day, not per load** (`dayHash(day) % count` in the worker).
  Don't make it random; a teaching that reshuffles on refresh is a slot machine.
- `lanes.zen` is only set where a Sōtō name is genuine. Do not invent one for
  Music, Art or Forró.
- The palette is Dojo Zen de Lisboa's (`~/GitHub/dzl-site/css/dzl.css`), which
  Robin loves. Keep them aligned rather than drifting a second Zen palette.
- Themes are defined **once each** in today.css under `[data-theme=...]`. An
  inline script in index.html stamps the attribute before first paint. Don't
  reintroduce a `prefers-color-scheme` block: there used to be four copies of
  every token and they drift.

## Data facts worth remembering

Measured July 2026 across roughly 278 open tasks:

- `duration` is set on only ~24. Anything that schedules by length must have a
  fallback (the slot editor uses 30 min).
- ~35 tasks have no `area` and land in the untracked `other` lane.
- Zazen and Rest are `practice: true` in lanes.js: no area may map onto them,
  ever. Sitting is done daily, it is not a backlog. `npm test` enforces it.

## Gotchas

- `.gate` and `.sheet-bg` set `display`, which outranks the UA `[hidden]` rule.
  `[hidden] { display: none !important }` in today.css keeps `hidden` working.
  Don't remove it.
- **D1 caps bound parameters at ~100 per statement.** A `WHERE x IN (?,?,…)`
  built from a user-sized list (Robin has 400+ distinct contact emails) blows the
  limit and the statement throws - and if it's wrapped in `.catch(() => [])` the
  whole feature silently returns nothing. This is exactly what hid every
  "contacts already on Daybook" suggestion. Batch such lookups in chunks of ≤90
  (see `getFriends` in worker/friends.js). Watch for this in any IN-list query.
- Mobile grid must be `minmax(0, 1fr)`. A bare `1fr` floors at min-content and a
  long task title stretches the page.
- **The mobile shell (`.app-shell`) must be `display:block`, not grid.** In WebKit
  (iOS Safari, and every iOS browser including the Brave PWA) a `position:sticky`
  grid item is clamped to its own grid cell, so scrolling past the header's row
  unsticks it and the sticky breadcrumb (`top:var(--navh)`) floats over an empty
  gap. Chromium clamps to the whole grid and hides the bug in dev. Block flow
  makes both sticky bars clamp to the tall shell. Don't restore the mobile grid.
- `compatibility_date` must not exceed what the installed wrangler runtime
  supports, or `wrangler dev` refuses to boot.
- **`CREATE TABLE IF NOT EXISTS` never adds a column to an existing table.** A
  column appended to schema.sql is silently absent on the live D1 until an
  `ALTER TABLE ... ADD COLUMN` runs - and local dev rebuilds the schema each
  time, so it always looks fine there. The gap only surfaces as a 500 on the
  first insert naming the column. After any column addition, run `npm run audit`
  (or `node worker/audit-schema.mjs --fix`) against remote. `slots.url` was
  caught this way.
- Google Calendar is **read + write of events** (`calendar.events`). It began as
  `calendar.readonly`; a refresh token carries the scopes it was granted with,
  so widening the scope means re-running `npm run google-auth`. `createEvent`
  turns a 401/403 into "connected read-only" rather than a bare failure.
- **Revoke first, then re-auth. Never the other way round.** Widening the scope
  needs the old grant revoked at myaccount.google.com/permissions, because
  Google otherwise silently reissues the previous scope set. But a revoke kills
  *every* refresh token for that client, including one issued a minute earlier -
  so revoking after a successful `google-auth` throws the new token away and
  breaks reading too. The symptom is `invalid_grant` /
  "Token has been expired or revoked" on the token exchange, surfaced as
  `calendar_error` on `/api/day`, with zero events. The cure is simply to run
  `npm run google-auth` again and touch nothing afterwards.
- The OAuth client's user type is **Internal**, checked in the console July
  2026. So there is no publishing status, no test users, and crucially no
  7-day refresh token expiry - that only bites External apps left in Testing.
  A refresh token here lives until something revokes it. Don't "fix" this by
  clicking *Make external* on the Audience page: that opts into the weekly
  expiry we currently don't have. The setup steps google-auth.js prints are
  generic first-run text and describe External; they don't describe this
  project.
- Calendar events are instants; slots are wall-clock minutes. Convert with
  `localParts`, never with an elapsed delta from the day start, or events shift
  an hour around a DST change. `npm test` covers both Lisbon transitions.

## Deploy

```bash
npm run deploy
```

Per [[feedback_always_push]], commit and push without asking.
