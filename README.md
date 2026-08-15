# today.robski.uk

A one-day retreat schedule. Google Calendar events and native tasks on a single
day timeline, with lanes that show at a glance which part of life is being
starved.

Lanes: **Zazen · Body · Music · Art · Forró · Portuguese · Work · My Life ·
Rest** (plus an untracked *Other*). Each has a daily minute target. A ring
fills as you tick blocks off.

## Scheduling a task

Drag a task from the list onto the timeline: it snaps to the nearest quarter
hour and the drop line tells you the time before you let go. Clicking the card
does the same thing with the editor, which is the path touch takes - HTML5 drag
doesn't fire on a phone.

**Drag a lane off the rail** onto the schedule for a bare practice block, no
editor involved.

**Drag a block up or down** to move it to another time, its length unchanged.

**Drag a block's top or bottom edge** to set its start and end. The top edge
moves the start and pins the end; the bottom moves the end. Quarter-hour snap.
Pointer events, so this one does work on touch.

**Drop tasks onto an existing block** and it holds them, any number. A block is
a container of time; the tasks are what you'll do in it.

- **Rename a task** by clicking it: the name is editable at the top of the
  sheet. Enter (or Save) commits it at once. Renaming a bare block just changes
  its own label.
- A block **lists the tasks in it**. What fits shows in the block; the rest fold
  into a **Show N tasks** / **+N more** line that opens the editor, where the
  full list lives with ticks and a × to take a task back out.
- A **category block** - a bare practice with no task behind it - has no tick.
  It counts toward its lane's ring the moment it's on the schedule: you don't
  complete an hour of Music, you just do it. Move or delete it if plans change.
- Ticking a block ticks everything in it. The block is the session, so saying it
  happened says its contents happened.
- Ticking one task in a multi-task block leaves the block open. One of five
  isn't the hour.
- But a block holding exactly one task *is* that task, so ticking either ticks
  both.

The tick and the card body are separate controls on purpose: one finishes the
task, the other schedules it.

The task list is sticky below the bar, because the schedule is far taller than
it is and you'd otherwise be dragging into nothing.

## Events vs blocks

**+ Block** makes one of this app's own blocks, in D1. **+ Event** creates a
real entry in Google Calendar - a commitment other people can see.

Writing needs the `calendar.events` scope; the first setup asked only for
`calendar.readonly`, and a refresh token carries the scopes it was granted
with. So + Event 403s with "Calendar is connected read-only" until
`npm run google-auth` is run again to re-consent.

## Floating blocks

A block doesn't need a time. Tick **Any time today** and it sits in a tray above
the schedule until you place it. That's the point: a siesta happens when lunch
and energy say so, not because a calendar said 14:00. **Rest** is drawn with a
dashed ring to mark it optional, so a skipped siesta on a day the work is
flowing reads as a choice, not a failure.

When a block is placed and the work is going well, **Push 15m / 30m / 1h** in
the editor moves it later without unpicking it.

## Practices column

The left column holds the repeating practices, grouped by lane: Body (Yoga
Download, Apple Health+, 8 Pieces of Brocade) and Music & Dance (Forró,
Percussion, Singing, Songwriting). Zazen and Rest are there to add to.

Unlike a task, an activity is never used up - drag it onto the schedule as many
times a day as you like and it stays in the column. Dropping one places a block
with its name, length and link; clicking one opens the editor to pick a time.
`+ Add` and the `×` manage them. They live in D1.

Three columns on a wide screen. Below 1180px the practices become a full-width
strip above the schedule, single-line, so they don't push the day off-screen.

## Zen elements

- **One teaching a day.** Chosen from the date, so it's the same on every device
  and stays with you all day rather than reshuffling on each reload. Seeded in
  `worker/schema.sql` (Dōgen, Sawaki, Suzuki - the same set as the LST admin
  dashboard), served on `/api/day`.
- **Ensō** as the favicon, and as the empty state: an unscheduled day collapses
  to a circle and *Nothing scheduled. Just this.* rather than seventeen hours of
  blank ruled paper.
- **Sōtō names** appear in the block editor for the lanes where they're honest:
  zazen 坐禅, taisō 体操, samu 作務 (work as practice), hōsan 放参 (released from
  the schedule). Music, Art and Forró have none, because a monastery has no word
  for forró and inventing one would be costume.
- **The Dojo Zen de Lisboa palette**, lifted from `dzl-site`: warm paper
  (#f5f0e8), sumi ink, vermillion (#c4412e) and gold. Cormorant Garamond for
  anything that speaks, Inter for anything that labels. Dark is proper sumi
  black (#0e0d0b), not a bluish grey.
- **只管打坐** (*shikantaza*, "just sitting") as a watermark down the right edge,
  the same one the dojo site carries. Hidden below 1400px, where it would
  collide with the task column.
- No streaks, no overdue, nothing that nags.

## How it fits together

```
                                    Cloudflare
                                ┌──────────────────┐
                                │  today-robski    │
                                │  worker + D1     │
                                │                  │      ┌─────────┐
                                │  blocks (tasks)  │◄─────┤ browser │
                                │  slots (the day) │      └─────────┘
                                └────────┬─────────┘
                                         │ OAuth
                                ┌────────┴─────────┐
                                │ Google Calendar  │
                                └──────────────────┘
```

### Where tasks live

Tasks are **native blocks** in D1: `kind='task'`, with a `props` JSON holding
area, priority, done and duration. There is no external system to reconcile
with, so nothing needs a background sync and nothing runs on a Mac.

What that buys you:

- **Everything is immediate.** Creating a task, renaming it or ticking it takes
  effect the moment you do it - no queue, no 15-minute pass to wait for.
- **+ New** writes the task straight to D1 and it is usable at once. Tick either
  the checkbox on a task in the list, or its scheduled block - both go through
  the same `setTaskDone` door.
- The schedule itself (`slots`) lives in D1 too, linked to tasks through
  `slot_tasks`.

(This app used to sync tasks with Tana over a local MCP bridge; that is gone,
and tasks are now owned here directly.)

## Lane mapping

There are 20 Life Areas that grew organically and don't line up with the seven
lanes, so `shared/lanes.js` maps them. The areas themselves are left as they
are; the mapping does the work.

| Lane | Life Areas | Open tasks | Target |
|---|---|---|---|
| Zazen | *(none - a practice)* | 0 | 60m |
| Body | *(none - a practice)* | 0 | 45m |
| Music | Music | 27 | 30m |
| Art | Art | 34 | 30m |
| Forró | Dance | 4 | 30m |
| Portuguese | Língua Portuguesa | 12 | 30m |
| Work | Business, Stone Grinder, Incremento, Portugal Portfolio, Lisbon Sintra Tours | 38 | 3h |
| My Life | My Life, Tool / Admin, Portugal, Money, Body / Health, Somatic Studio | 123 | 30m |
| Rest | *(none - a practice)* | 0 | 60m |
| Other | People, Society, Maya Das, Tara L-S, Well-being / Mind / Spirit, *no area* | 24 | - |

Two things to know about the data:

- **Zazen, Body and Rest have no tasks at all, by design** (`practice: true` in
  lanes.js - nothing may map onto them, and `npm test` enforces it). They're
  practices, not todos. Fill them with **+ Block**, or click the lane's ring to
  pick an activity.
- **Only ~24 of 278 tasks have a `duration` set.** The slot editor falls back to
  30 minutes. Setting a task's duration makes the editor pre-fill correctly.
- **~35 tasks have no `area`**, so they land in *Other*. Give a task an area to
  pull it into a lane.

## Setup

### 1. Database

```bash
npx wrangler d1 create today-robski        # paste the id into wrangler.toml
npx wrangler d1 execute today-robski --file worker/schema.sql --remote
```

### 2. Keys

```bash
npx wrangler secret put AUTH_SECRET  # signs session tokens; any long random string
```

Rotating `AUTH_SECRET` signs every device out at once.

### 3. Sign-in email

Email sign-in: enter your address, get a six-digit code, exchange it for a
seven-day session. Who's allowed is `ADMIN_EMAILS` in `wrangler.toml`: whole
addresses, or `*@domain` for any mailbox on a domain.

```
ADMIN_EMAILS = "robin@lumley-savile.com,robin@incremento.co,*@robski.uk"
```

A wildcard is exactly as safe as the domain behind it - the code goes to the
address typed, so signing in still means reading that inbox. Only wildcard a
domain whose mail you receive. Domains match exactly, so `*@robski.uk` covers
neither `mail.robski.uk` nor `notrobski.uk` (`npm test` proves it).

The allowlist is re-checked on every request, not just at sign-in, so removing
an address kills its live sessions rather than waiting out the seven days.

Codes go out via **Resend**, the same as Career Club and the Incremento admin.

`FROM_EMAIL` is `Today <today@incremento.co>`, because incremento.co is the one
domain verified on Resend's free tier and a verified domain can send anywhere.
The sender domain is incidental - Career Club posts its codes from
`onboarding@resend.dev` and carries its brand in the body, which is what this
does too. The email is Robski-branded regardless of what it's sent from.

Two paths that were considered and rejected:

- **Verify robski.uk on Resend** - the free tier is one domain and incremento.co
  has it, so this is $20/mo to post six digits to one person.
- **Cloudflare Email Sending** - free, but robski.uk already has real mail on
  Purelymail with a single SPF record, and onboarding would mean editing it.
  Not worth the risk to a working inbox.

`onboarding@resend.dev` won't work here: it only delivers to the Resend
account's own address, and codes go to robin@lumley-savile.com.

```bash
npx wrangler secret put RESEND_API_KEY    # same key as the other admins
```

**You cannot lock yourself out.** The code is written to D1 *before* the email
is sent, so if Resend breaks entirely:

```bash
npx wrangler d1 execute today-robski --remote --command "SELECT code FROM otp_codes"
```

The break-glass is your Cloudflare login, not a shared secret.

### 4. Google Calendar

Read-only. **You do the consent step yourself.**

```bash
npm run google-auth
```

That is the whole command - no `export` first. It prints the Google Cloud
Console steps, asks for the Client ID and secret, opens the consent screen,
then offers to set all three secrets and deploy for you.

The worker needs **all three** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`), not just the refresh token: it trades the refresh
token for an access token on every cold start. The script handles that; if you
decline, it prints the token and the three commands.

Pick **Desktop app** as the OAuth client type - it permits the loopback
redirect (`http://127.0.0.1:8790/callback`) without registering one.

Until this is done the app shows *calendar not connected* and works fine
otherwise. `GOOGLE_CALENDAR_ID` is set in `wrangler.toml`.

### 5. Deploy

```bash
npm run deploy    # worker + static assets, one shot
```

Then point `today.robski.uk` at the worker in the Cloudflare dashboard.

## Local development

```bash
cat > .dev.vars <<EOF
AUTH_SECRET=dev-auth-secret
EOF

npx wrangler d1 execute today-robski --local --file worker/schema.sql
npm run dev                                    # http://127.0.0.1:8788
npm test                                       # timezone / DST maths
```

## API

Browser endpoints need `Authorization: Bearer <session token>` from `/auth/verify`.

| | |
|---|---|
| `GET /api/day?date=` | slots, calendar events, lane progress, settings |
| `GET /api/tasks?lane=&q=` | task blocks, P1 first |
| `POST /api/slots` | add a block |
| `PATCH /api/slots/:id` | move, resize, tick |
| `DELETE /api/slots/:id` | remove |
| `GET/PATCH /api/settings` | lane targets, day bounds |

## Tuning

Lane targets live in the `settings` table (`target_zazen` etc, in minutes) and
are editable via `PATCH /api/settings`. Zazen is 60;
the rest are guesses.

```bash
npx wrangler d1 execute today-robski --remote \
  --command "UPDATE settings SET value='45' WHERE key='target_body'"
```
