# CLAUDE.md — Koyéba front end

Koyéba (formerly Shizu, Daybook, Lifebook) is a calm, private home for a whole life: mail, calendar, tasks, notes and tables, messages, money and the inner life, joined up through **Spaces**. Domain: **koyeba.co** (moving from shizu.fyi). "Koyéba" is Lingala for "to know": things come into view when you need them.

## Source of truth
- The design lives in `design/koyeba/`: `README.md` (the full spec), `Koyeba App.dc.html` (the interactive prototype), `Koyeba Brand Pack.dc.html` (logo, colour, type, voice, do's and don'ts) and `Koyeba Logo.dc.html`.
- **If the code and the prototype disagree, the prototype is right.** Open it in a browser and compare side by side after every UI change.
- The prototype is a reference. Rebuild it in this codebase (`public/`, `worker/`); don't paste it in and don't ship `support.js`.
- The front end changes. The worker, schema, auth, sync and APIs stay as they are unless a task says otherwise.

## Rules — never break these
1. **One accent colour: gold.** No red, green, blue, orange or purple, not even for urgency or status. Show urgency with a filled gold square, importance with an outlined gold square, and lesser items with a grey square.
2. **Square corners.** `border-radius: 0` on everything: cards, buttons, inputs, chips, avatars, tiles. No pills.
3. **No shadows.** The one exception is the capture drawer's top shadow. No gradients. **Frosted glass only on what floats or what you choose or glance at** (the bars, Reflections and drawn cards, the tarot table), and on the note sheet (Robin, 2026-11-04), never on other close reading (mail text, task lists, tables). See `public/daylight.css`. (Robin, 2026-11-04.)
4. **Spaces have no colours:** a Space is its name, never a coloured dot, chip or tint. **1px warm keylines** (`--k-line`) separate things. No thick borders and no coloured left-border stripes.
5. **No sidebar of buttons.** Navigation is seven folding sections: Today, Spaces, Tools, People, Money, Inner life, Reviews. Only one is open at a time.
6. **Every titled section folds open and shut**, with a `+` / `−` glyph on the right. No chevron icons.
7. **The main button is glass: a white rim, a frosted background, its words centred** (see `public/daylight.css`). **No full-width buttons, ever.** A button is as wide as its words, and never stretches to fill a row or column (check it inside flex and grid parents, which stretch by default). (Robin, 2026-11-04: "no ugly full width buttons".)
8. **Large, legible text.** Body text is never under 13px; list rows are 15–17px.
9. **No icon libraries and no emoji.** Unicode glyphs only: `+ − → ✓ ✕ ⌘ · ‹ › ▶ ▼ ⌄`.
10. **Type is system 1a (§59).** Cormorant Garamond **500** for display only - page titles, section titles (30px), an opened item's title, big readings and glyphs. Cormorant **300 italic** only for the quote of the day and one-line reading texts. **Jost does all the rest**, in five levels: Item 17-18/500 · Body 16-16.5/1.65 · Meta 14/muted · Label 11/600 caps · the sender/person over an item 15/600. **Never set list rows, body or meta in Cormorant, and never Cormorant 300 upright** (one exception: practice names are Cormorant 500 in white; Robin, 2026-11-04). Emails and other people's words go on **white paper in Source Serif 4**, inside a frosted glass box (Robin, 2026-11-04). Eyebrows are Jost 500, 11px, uppercase, 0.28em tracking, gold, after a 28×1px gold rule.
11. **Connections stay subtle:** an italic Cormorant line, a gold dot, a Roman numeral for the Space. Never connector lines or "linked" badges.
12. **The page follows the real day: dawn, overcast by day, dusk, night. Koyéba is dark at every hour with white text** (Robin, 2026-11-04). A painted wash from `public/wash/` sits behind every page (`tools/wash/paint.py` paints them and prints contrast; bump the `?v=` in `syncLightLayer` after repainting). `applyTheme()` sets `data-light` and `data-theme` together, so text and wash can never disagree: never set one without the other. **No forest green anywhere** (Robin, 2026-11-04); night is a dark, moody indigo sky. Every text colour must stay at 4.5:1 on the strongest paint of its wash. **One opt-in exception: "Sensible" mode**, a calm light look modelled on LisbonSintraTours.com for anyone who finds the wash distracting. It is the FOURTH option in the one colour-scheme picker (footer/nav button `cycleTheme`→`setScheme`, Settings swatches, and the six-section "Colour scheme" row) - exclusive with Auto/Day/Night, never a separate toggle (Robin, 2026-11-07). It sets `html[data-plain]` (from `life.plain`, in `applyTheme()` and the first-paint script) and overrides the whole token set to a warm ivory palette + hides the wash, in the `:root[data-plain]` block at the foot of `public/daylight.css`. Off by default; the dark washes above are still the norm. Because it only redefines tokens, components follow for free - but **`data-theme` stays `dark` in Sensible**, so anything keyed off `[data-theme='dark']` that assumes a dark ground is invisible on the ivory page: hard-coded `color:#fff` (glass buttons), the `.brand-mark` ivory SVG, and the `.kmark-night` image marks all need `:root[data-plain]` overrides there too. (Robin, 2026-11-06/07.)
13a. **Never tint with the text colour.** `--ink` is pale now, so `color-mix(var(--ink), transparent)` washes things white: backdrops use a dark veil. **All page titles are one size** (`clamp(40px,4.4vw,56px)`); only Today's greeting is bigger.
13. **Use the tokens** (`--k-bg`, `--k-panel`, `--k-soft`, `--k-ink`, `--k-mute`, `--k-line`, `--k-gold`, `--k-goldt`, `--k-deep`, `--k-ondeep`). Their values for each time of day are in `public/daylight.css`, which overrides the older values in the README, §3. Don't hard-code new colours.
14. **No new visual elements.** Build anything new from the existing parts: folding sections, a ledger of Cormorant numbers, keyline rows, Space numerals, and gold only where something needs you.
15. **Eyebrow above the grid (two-column bands).** In a two-column section the eyebrow - the 28×1px gold rule and its Jost label - sits ABOVE the grid, full-width, never inside the left column. Both columns then begin level at the heading or lead, so the right column aligns with the heading (e.g. "Yours. Securely."), not with the eyebrow above it. Top-aligned two-column bands only; centred bands are exempt. (Robin's house style, 2026-10-31.)
16. **Never very-light text on a light surface.** Secondary and tertiary text on ivory/white must stay comfortably readable - Robin's eyesight. The lightest text tier (`--ink-3`) is `.70` opacity in the light themes (day + calm), never a faint hairline; `--ink-2` and `--k-mute` are already readable, keep them so. Text on white paper (emails, shared notes) takes a dark ink, never a muted light grey. If a new muted colour is needed, check it reads clearly on the card/ivory background before shipping. (Robin, 2026-11-03.)
17. **A goal is marked achieved only by dragging its slider to 100%.** There is no "mark as achieved" checkbox or button anywhere - not on the goal card, the Goals page, or any review (weekly/monthly/quarterly/yearly). The single 0-100% progress slider owns the status: `saveGoalProgress` sets it `done` at 100% and reopens it below. Keep this consistent across the whole site. (Robin, 2026-11-03.)
18. **One breadcrumb, the same everywhere but Today.** Every page except Today (home) carries a breadcrumb in ONE style: a plain, static line at the content inset just under the top nav - `Today / <section> / <page…>`, with " / " separators, links in `--k-mute`, and the current page in gold (`--k-goldt`). The section is the page's top-nav group (Keep · Plans · People · Reflection · Spaces · Money), inserted automatically by `crumbNav()` from the current view. `crumbNav()` is the single source; `.note-crumbs` pages are styled to match it exactly. Never a sticky blurred bar, never `·` or `›` separators, never a bespoke back-link row or an ink (non-gold) current crumb. Build any new page's breadcrumb with `crumbNav([{label:'Home',attr:'data-view-home'}, …])`. (Robin, 2026-11-03: "no more random breadcrumbs".)
19. **Words never touch an edge.** Nothing's text sits flush against the side of its box, its bar or the screen. Inputs, selects, chips, filter bars and buttons carry a comfortable horizontal inset (≈14-16px), left and right - the base `.sel` sets it, and any new control matches. Native `<select>` dropdowns are glass like everything else that floats. (Robin, 2026-11-05: "I don't like words right up against the edge of anything.")
20. **A search box is the Cormorant underline, never a boxed field.** The default search style is `.cvx-search` inside `.cvx-searchrow` - a transparent input, a 1px bottom rule, Cormorant 300 at `clamp(28px,3vw,40px)`, with a little room beneath (`.nx-searchrow`). Used on Contacts, Notes, Tables and Spaces; reuse it for any new search rather than a glass or bordered box. (Robin, 2026-11-05: "tasteful, I like".)
21. **The "+Tab" New-tab control lives in the breadcrumb row, right-aligned, and nowhere else.** It is produced once by `newTabBtnHtml()` and appended inside the breadcrumb bar by `crumbNav()` and by the Space's own crumb, so it sits in the SAME flex line as the crumbs (`.crumb-newtab`, `align-items:center`, `margin-left:auto`) and is therefore ALWAYS aligned with them, on every page - never a floating, `position:fixed`/`sticky`, or per-page-offset element, and never pushing the breadcrumbs down. It scrolls with the page and is desktop-only (hidden ≤820px). The breadcrumb's spacing is fixed and identical on every page by `.crumbbar-slim` (`margin:8px 0 36px`) - 8px + the pane's top padding above, 36px below. The full-page tab **strip** (`.tabstrip`) only exists from the second tab; with one tab it does not render and reserves no height. Any new page's breadcrumb must go through `crumbNav()` so it gets the +Tab and the spacing for free. (Robin, 2026-11-06: "be consistent with this. I shouldn't have to keep asking. Put it in the design system and stick to it.")

## Type — three fonts, self-hosted (type system 1a, §59)
- **Three fonts, self-hosted from `public/fonts/` with `@font-face` in `public/koyeba.css`:** Cormorant Garamond, Jost, and **Source Serif 4** (someone else's words, on white paper - email bodies, opened messages, shared notes; token `--k-read`). The prototype loads Source Serif from Google Fonts; we self-host it because the app CSP blocks the link. **Never** Inter, Fraunces, Georgia (except as the Source Serif fallback stack), system-ui or a Google Fonts link. If a font fails to load, fix the `@font-face`; don't swap the font.
- **Weights:** Cormorant 300, 300 italic and 500. Jost 400, 500 and 600. Source Serif 4 400 (+ the 600 axis) and 400 italic. No faux bold.
- **Cormorant 500** is display only (titles, section headings, opened-item titles, big readings/glyphs, the wordmark). **Cormorant 300 italic** is only for the quote of the day and one-line reading texts, plus the one gold word in a heading, Space Roman numerals, and quiet connection lines. **Never Cormorant 300 upright, and never Cormorant for list rows, body or meta** - that's Jost (§59).
- **Never italicise Jost or Source Serif.** If the prototype isn't italic there, you don't make it italic.
- After any UI change, check in DevTools (Computed → Rendered Fonts) that text is rendering in the intended face (Cormorant, Jost, or Source Serif 4 for others' words).

## When unsure
- **Don't use your initiative on look or wording.** Find the nearest example in `Koyeba App.dc.html` or `Koyeba Brand Pack.dc.html` and copy it exactly.
- If there's no example, **stop and ask Robin**. Don't invent.
- Never "tidy up", "modernise" or "improve" styling that already matches the prototype.

## Words
- Calm, warm, British English, short sentences. No hype, no exclamation marks, no emoji.
- "Spaces", never "Life Spaces". "Coming into view", never "My Shizu". "Set something down…", not "Quick add". "Not yet", not "Snooze". "12 days past", not "OVERDUE".
- No user-facing "Shizu", "Daybook" or "Lifebook" anywhere, in any language.
- **The name is spelt "Koyéba", accent on the e, everywhere people read it** (Robin, 2026-11-04). Plain "koyeba"/"Koyeba" is only for what can't or shouldn't carry an accent: the domain, file names, code identifiers, `User-Agent`/`PRODID` values, the SMS sender and the Resend `FROM_EMAIL` fallback.

## Brand
- **Logo:** the wordmark "Koyéba" in Cormorant Garamond 500, with a gold full stop.
- **Mandombe "ko"** (`assets/mandombe-ko-*.svg`) sits before the wordmark in the header and replaces 静 everywhere.
- **App icon / favicon:** `mandombe-ko-tile-gold.svg`.
- **The full Mandombe "koyeba"** appears only at the foot of Today (click it to go back to the top), on the welcome screen and on the website. Never behind text.

## Product behaviour that matters
- **Mail triage:** Inbox (to sort), then Urgent, Important, Read later and Archive. Keys 1–4 sort the open email, and sorting from the Inbox moves to the next one. Each email also has Turn into Note / Task / Event. When an email mentions dates, a "Dates found" line offers to add them to the calendar.
- **Capture (⌘. or the bar):** write it as you'd say it ("dentist Tuesday at 9am"). A rule-based parser, not AI, works out what it is, when, which Space and which reminders, and shows a readout you can tap to correct. **Speak** records the voice and transcribes it (Cloudflare Workers AI Whisper first, Gemini as an alternative; never store the audio; its own on/off switch in Settings), then runs the same parser.
- **AI is seasoning.** The app must work fully with AI switched off, and every use of AI has its own toggle.

## Before you finish any UI task
- Compare the result with the prototype at about 920px and at 1440px wide, in both day and night.
- Check: no new colours, no radius, no shadows, nothing that doesn't fold, no text that wraps one word per line.

---

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
  **Login-by-text** (`channel:'sms'`) is the escape hatch for the Catch-22 where
  a user's email lives *inside* Daybook: `requestCode` resolves the account by
  email (`getUserByEmail`) and texts the code to THAT user's own `settings.phone`
  (owner falls back to `env.ALERT_PHONE`) - never a single hardcoded number. No
  phone on file returns `smsUnavailable` and emails instead. On the gate it's a
  quiet self-selecting link ("Use Daybook for your email? Text me the code"), not
  a co-equal button - a phone-shaped button read as a phone *signup* and confused
  newcomers (email is the only identity; signup == signin).
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

## Keep in touch

A cadence on a contact ("speak to this person every 3 months"). The clock is an
ordinary repeating task carrying `props.kit` + `props.contact`, hidden behind its
snooze until due, so `repeat`/`snooze`/`setTaskDone` already do the work. The
contact holds `props.kitEvery` (a denormalised copy, so a list can show the badge
without loading tasks) and `props.kitTask`; the task is authoritative for dates.

- **The anchor is the point of the feature.** `setTaskDone` rolls a kit task
  forward from **today**, not from the date it fell due. It answers "how long
  since we actually spoke", so ticking a monthly one three weeks late buys a
  full month, not four days. Don't "unify" this with the ordinary repeat path:
  every other repeating task keeps its calendar on purpose (the plants are due
  when they're due). `toggleTask` in app.js mirrors it and must agree.
- **Nudges are not board work.** `notKit` filters them where tasks load, so the
  board, snoozed list, area pages, note-task picker and review stats never see
  them; `homeAlerts` drops them from `surfaced` and the P1 count so they stay out
  of Today and the morning brief. They live on the contact card and in Home's
  Keep in touch section only.
- `addPeriod` (worker) and `taskAddPeriod` (client) must stay identical, or a
  task rolls to one date on the client and another on the server. Both handle
  `quarterly`, `halfyearly`, `fortnightly` and custom `every:<n>:<d|w|m>`, and
  both clamp month ends (31 Aug + 1 month = 30 Sep).
- A nudge whose contact was deleted has nothing to name, so `homeAlerts` skips
  it rather than showing a headless row.

## Data facts worth remembering

Measured July 2026 across roughly 278 open tasks:

- `duration` is set on only ~24. Anything that schedules by length must have a
  fallback (the slot editor uses 30 min).
- ~35 tasks have no `area` and land in the untracked `other` lane.
- Zazen and Rest are `practice: true` in lanes.js: no area may map onto them,
  ever. Sitting is done daily, it is not a backlog. `npm test` enforces it.

## Gotchas

- **Any IMAP move MUST resolve the target through `resolveMailbox` - never pass a
  literal 'Trash'/'Junk'/'Archive'.** Providers localize and brand their special
  folders: Robin's Google Workspace bin is `[Google Mail]/Bin`, not `Trash` or
  even `[Gmail]/Trash`. `resolveMailbox` finds it by the RFC 6154 special-use flag
  (`\Trash`), which the hard-coded name list can't. A literal target silently
  misses, forcing the slow COPY-fail -> `STORE \Deleted` -> `EXPUNGE` fallback (or
  losing the move), which is what made deletes look broken. `im.move` throws on a
  failed COPY so a miss surfaces instead of faking success.
- **Bulk mail actions go through `/move-bulk` (one IMAP session for the whole
  set), not a `/move` per message.** A login/select/move/logout per message is
  brutally slow against Gmail from the edge. The UI keeps rows visible but
  `mail-pending` (dimmed) until the server confirms, then drops them; a
  `state.mail.gone` set stops an eventually-consistent Gmail refetch from
  resurrecting a just-deleted message (Undo clears it).
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
- **Every Google Calendar write carries `sendUpdates=none`.** Deleting an event
  Robin was *invited to* removes his attendance, and without this param Google
  emails the organizer that he declined - which is why people reported Robin
  "rejected their invitations". create/update/delete/series-trim all pin
  `sendUpdates=none` so Daybook never RSVPs or sends a change notice on his
  behalf. Don't drop it. (Note: a delete still sets his responseStatus to
  declined on the organizer's copy - it just doesn't email. Not calling
  events.delete on non-organized events at all is a larger, unbuilt change.)
  The other half of that same bug was duplicate creation: Gmail auto-adds an
  invitation to the calendar, and `mailInviteAdd` created a *second* copy, so
  Robin tidied up by deleting one - and hit the invited copy. `createEvent`
  (owner path) now looks the invite's iCalUID up on Google first
  (`events?iCalUID=`) and adopts the existing event (`existed:true`) instead of
  duplicating. The invite UID rides in the POST body as `b.uid`.
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
