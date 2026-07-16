# today.robski.uk

A one-day retreat schedule. Google Calendar events and Tana tasks on a single
day timeline, with seven lanes that show at a glance which part of life is
being starved.

Lanes: **Zazen · Body · Music · Art · Forró · Work · Admin · Rest** (plus an
untracked *Other*). Each has a daily minute target. A ring fills as you tick
blocks off.

## Floating blocks

A block doesn't need a time. Tick **Any time today** and it sits in a tray above
the schedule until you place it. That's the point: a siesta happens when lunch
and energy say so, not because a calendar said 14:00. **Rest** is drawn with a
dashed ring to mark it optional, so a skipped siesta on a day the work is
flowing reads as a choice, not a failure.

When a block is placed and the work is going well, **Push 15m / 30m / 1h** in
the editor moves it later without unpicking it.

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
- Warm paper and sumi ink, in light and dark. No red, no streaks, no overdue.

## How it fits together

```
  Tana desktop app                    Cloudflare
  ┌──────────────┐                ┌──────────────────┐
  │ #Task nodes  │                │  today-robski    │
  └──────┬───────┘                │  worker + D1     │
         │ localhost MCP          │                  │      ┌─────────┐
  ┌──────┴───────┐   HTTPS        │  tasks (mirror)  │◄─────┤ browser │
  │  sync agent  ├───────────────►│  slots (the day) │      └─────────┘
  │  (your Mac)  │◄───────────────┤  pending_writes  │
  └──────────────┘   write-backs  └────────┬─────────┘
                                           │ OAuth
                                  ┌────────┴─────────┐
                                  │ Google Calendar  │
                                  └──────────────────┘
```

### Why there's a sync agent

**Tana's API is write-only.** ([Input API docs](https://tana.inc/docs/input-api):
read access is not available; it's a [long-standing request](https://ideas.tana.inc/posts/22-tana-other-services-make-all-tana-content-available-via-api).)
Nothing running in Cloudflare can read your `#Task` graph. The only read path is
the `tana-local` MCP bridge on `127.0.0.1:8262`, which talks to the Tana desktop
app. So the Mac is the only place the sync can run.

Consequences worth knowing:

- **Tasks are only as fresh as the last sync.** No Mac awake, no new tasks.
- **Ticking a task in the web app does not reach Tana immediately.** It queues in
  `pending_writes`; the agent replays it on the next pass (within 15 minutes).
- The schedule itself (`slots`) lives only in D1 and never goes to Tana.

Tana stays the source of truth for tasks. This app owns the day.

## Lane mapping

Tana has 20 Life Areas that grew organically and don't line up with the seven
lanes, so `shared/lanes.js` maps them. Tana is never re-tagged.

| Lane | Life Areas | Open tasks |
|---|---|---|
| Zazen | Well-being / Mind / Spirit | 4 |
| Body | Body / Health, Somatic Studio | 26 |
| Music | Music | 25 |
| Art | Art | 32 |
| Forró | Dance | 5 |
| Work | Business, Stone Grinder, Incremento, Portugal Portfolio, Lisbon Sintra Tours | 34 |
| Admin | Tool / Admin, My Life, Portugal, Money | 86 |
| Rest | *(none - siesta is a block, not a task)* | 0 |
| Other | People, Society, Maya Das, Tara L-S, Língua Portuguesa, *no area* | 66 |

Two things to know about the data:

- **Zazen, Forró and Rest barely exist as tasks** (4, 5 and 0). They're
  practices, not todos. That's why a slot doesn't need a task: use **+ Block**,
  or click a lane's ring, for bare practice time.
- **Only ~24 of 278 tasks have a `Duration` set.** The slot editor falls back to
  30 minutes. Setting `Duration` in Tana makes the editor pre-fill correctly.
- **~35 tasks have no `Area`**, so they land in *Other*. Tag them in Tana to pull
  them into a lane.

## Setup

### 1. Database

```bash
npx wrangler d1 create today-robski        # paste the id into wrangler.toml
npx wrangler d1 execute today-robski --file worker/schema.sql --remote
```

### 2. Keys

```bash
npx wrangler secret put TODAY_KEY   # you type this into the app once
npx wrangler secret put SYNC_KEY    # the Mac agent uses this
```

Two separate keys on purpose: a leaked browser key can't rewrite the task mirror.

### 3. Google Calendar

Read-only, via a refresh token. **You do the consent step yourself.**

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project
2. Enable the **Google Calendar API**
3. Create an **OAuth client ID** → *Desktop app* (or *Web app* with redirect
   `http://127.0.0.1:8790/callback`)
4. Mint a refresh token:

```bash
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
npm run google-auth          # opens Google consent, prints a refresh token
```

5. Store all three:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
```

Until this is done the app shows *calendar not connected* and works fine
otherwise. `GOOGLE_CALENDAR_ID` is set in `wrangler.toml`.

### 4. Deploy

```bash
npm run deploy    # worker + static assets, one shot
```

Then point `today.robski.uk` at the worker in the Cloudflare dashboard.

### 5. The sync agent

```bash
./sync/install.sh          # writes ~/.today-robski.env, then run it again
```

Fill in `SYNC_KEY` and `TANA_MCP_TOKEN` (from `~/.claude.json` →
`mcpServers.tana-local`), then re-run. It installs a launchd job that syncs
every 15 minutes and skips quietly when Tana isn't running.

```bash
tail -f ~/Library/Logs/today-sync.log     # watch it
launchctl kickstart -k gui/$UID/uk.robski.today-sync   # run now
launchctl bootout gui/$UID/uk.robski.today-sync        # stop
```

## Local development

```bash
cat > .dev.vars <<EOF
TODAY_KEY=dev-today-key
SYNC_KEY=dev-sync-key
EOF

npx wrangler d1 execute today-robski --local --file worker/schema.sql
npm run dev                                    # http://127.0.0.1:8788

SYNC_KEY=dev-sync-key TODAY_API=http://127.0.0.1:8788 npm run sync
npm run sync:dry                               # read Tana, push nothing
npm test                                       # timezone / DST maths
```

## API

Browser endpoints need `Authorization: Bearer $TODAY_KEY`.

| | |
|---|---|
| `GET /api/day?date=` | slots, calendar events, lane progress, settings |
| `GET /api/tasks?lane=&q=` | task mirror, P1 first |
| `POST /api/slots` | add a block |
| `PATCH /api/slots/:id` | move, resize, tick |
| `DELETE /api/slots/:id` | remove |
| `GET/PATCH /api/settings` | lane targets, day bounds |

Agent endpoints need `Authorization: Bearer $SYNC_KEY`.

| | |
|---|---|
| `POST /api/sync/tasks` | bulk upsert the mirror (`full: true` prunes) |
| `GET /api/sync/pending` | completions awaiting replay |
| `POST /api/sync/ack` | mark them applied |

## Tuning

Lane targets live in the `settings` table (`target_zazen` etc, in minutes) and
are editable via `PATCH /api/settings`. Zazen ships at 40 with a 60 stretch;
the rest are guesses.

```bash
npx wrangler d1 execute today-robski --remote \
  --command "UPDATE settings SET value='45' WHERE key='target_body'"
```
