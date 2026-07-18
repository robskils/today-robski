# today.robski.uk

Robin's personal daily schedule tool. Plain HTML/CSS/JS on a Cloudflare Worker
with D1. No build step, no framework.

Read README.md first: it explains the architecture and why the sync agent exists.

## Stack

- **Worker + static assets:** one `wrangler deploy` serves `public/` and `/api/*`
  from `today.robski.uk`. There is no Pages project.
- **D1** `today-robski`. Schema in `worker/schema.sql`.
- **Auth:** email OTP -> 7-day HS256 JWT signed with `AUTH_SECRET` (browser),
  plus `SYNC_KEY` (Mac agent). Codes go via Resend from
  `Today <today@incremento.co>` - the one domain verified on the free tier.
  Sender domain is incidental; the Robski branding is in the body. Don't
  "fix" it to robski.uk: that's $20/mo, and the Cloudflare alternative means
  editing the SPF record Purelymail depends on.
- **Sync agent:** `sync/sync.js`, plain Node, launchd every 15 min.
- `ADMIN_EMAILS` takes whole addresses or `*@domain`. `isAllowed` in auth.js
  matches the domain exactly - never loosen it to endsWith, that would let
  `robski.uk.evil.com` in. `npm test` covers it.

## The constraint that shapes everything

Tana's API is **write-only**. A worker cannot read the graph. Reads only happen
on Robin's Mac through the `tana-local` MCP bridge (`127.0.0.1:8262`, JSON-RPC,
no handshake needed). So:

- `tasks` in D1 is a **mirror**, written only by the agent. Tana is the truth.
- Web-app completions queue in `pending_writes` and are replayed by the agent.
  Never assume a tick reaches Tana synchronously.
- `setTaskDone` in worker/index.js is the single door for "a Tana task changed
  state": it queues the write, updates the mirror, and closes a *sole-task*
  block. Both checkboxes go through it. Don't add a third path.
- `slot_tasks` is the link table: a block holds any number of tasks.
  `slots.tana_id` is legacy, kept so old rows read; new links go in slot_tasks.
  Ticking a block only queues the tasks whose state actually changes, or a
  half-finished block re-queues writes Tana already has.
- `slots` (the day itself) are owned here and never sync to Tana.
- **+ New** queues `op='create'` with a JSON payload and a `local:` placeholder
  id, so the task is usable instantly. The agent builds it via
  `import_tana_paste`, then `POST /api/sync/created` swaps the placeholder for
  the real id everywhere. Don't reach for the Input API: its workspace token
  isn't findable in Tana's current UI, and this needs no credential at all.
- The prune skips `local:%` rows, and the agent re-reads anything it just
  created. Tana's search index lags a create by a moment, so the pull misses it
  and `full: true` would delete the task you just typed.

The agent applies write-backs **before** pulling, otherwise the pull would see
the task still open in Tana and clobber the completion.

## Layout

```
shared/lanes.js     LANES + AREA_TO_LANE. Imported by both worker and agent.
worker/index.js     API. Router at the bottom.
worker/schema.sql   tasks, slots, pending_writes, settings
public/             index.html, today.css, today.js, favicon.svg
sync/sync.js        Tana <-> API. Parses read_node markdown.
sync/google-auth.js one-off refresh-token helper (Robin runs it)
sync/install.sh     launchd install
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

Measured July 2026 against the live graph, 278 open tasks:

- `Duration` is set on only ~24. Anything that schedules by length must have a
  fallback (the slot editor uses 30 min).
- ~35 tasks have no `Area` and land in the untracked `other` lane.
- Zazen and Rest are `practice: true` in lanes.js: no Area may map onto them,
  ever. Sitting is done daily, it is not a backlog. `npm test` enforces it.
  Forró has 5 tasks. All three are filled with bare `+ Block` slots.
- Field ids: Priority `26tfBPLpiSWh`, Task status `6yXD6FBXzbR3`,
  Area `LTJ3jUP44jDx`, Duration `iOVl90NPxuDU`. `#Task` tag is `-ESIZpZjQpNx`.
- Ticking a node via `check_node` makes Tana set `Task status` to Done by itself.

## Gotchas

- `.gate` and `.sheet-bg` set `display`, which outranks the UA `[hidden]` rule.
  `[hidden] { display: none !important }` in today.css keeps `hidden` working.
  Don't remove it.
- Mobile grid must be `minmax(0, 1fr)`. A bare `1fr` floors at min-content and a
  long task title stretches the page.
- `compatibility_date` must not exceed what the installed wrangler runtime
  supports, or `wrangler dev` refuses to boot.
- **`CREATE TABLE IF NOT EXISTS` never adds a column to an existing table.** A
  column appended to schema.sql is silently absent on the live D1 until an
  `ALTER TABLE ... ADD COLUMN` runs - and local dev rebuilds the schema each
  time, so it always looks fine there. The gap only surfaces as a 500 on the
  first insert naming the column. After any column addition, run `npm run audit`
  (or `node worker/audit-schema.mjs --fix`) against remote. `slots.url`,
  `pending_writes.payload` were both caught this way.
- Google Calendar is **read + write of events** (`calendar.events`). It began as
  `calendar.readonly`; a refresh token carries the scopes it was granted with,
  so widening the scope means re-running `npm run google-auth`. `createEvent`
  turns a 401/403 into "connected read-only" rather than a bare failure.
- Calendar events are instants; slots are wall-clock minutes. Convert with
  `localParts`, never with an elapsed delta from the day start, or events shift
  an hour around a DST change. `npm test` covers both Lisbon transitions.
- The sync agent only sends `full: true` when every `read_node` succeeded. A
  partial read must not prune, or a Tana hiccup empties the mirror.

## Testing the write-back

Don't test it against a real task. Create a throwaway `#Task` in the Inbox, run
it through the loop, then `trash_node` it. A `full: true` sync prunes the mirror.

## Deploy

```bash
npm run deploy
```

Per [[feedback_always_push]], commit and push without asking.
