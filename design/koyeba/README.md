# Handoff: Koyeba front-end redesign

Koyeba is the new name for Shizu (before that Daybook and Lifebook). Repo: `robskils/today-robski`. New domain: **koyeba.co**.

**Read this whole file before touching any UI code.** The design is deliberately restrained, and most of its quality comes from what it leaves out. If a change you're about to make adds a box, a shadow, a pill, a colour, an icon or a rounded corner, it is almost certainly wrong.

---

## 1. About these files

`Koyeba App.dc.html` and `Koyeba Logo.dc.html` are **design references built in HTML**. They are working prototypes of the intended look and behaviour, not production code.

- **Your task:** rebuild these designs inside the existing app (`public/*.html`, `public/*.js`, `public/*.css`, worker API), using its existing data and endpoints.
- **Don't** paste the prototype in, and don't load `support.js` in production.
- **Fidelity: high.** Colours, type, spacing, copy and interactions are final. Match them exactly.
- **To view:** open either `.dc.html` file in a browser, served from this folder so the fonts and assets load.
- **Tweaks:** the prototype has two props, `navigation` (`Folds` | `Index`) and `night`. Robin's default is **Folds**.
- **Not covered:** everything visual in the current app is replaced. The worker, data model, auth, sync and APIs are **unchanged**; this is a front-end job.

---

## 2. Non-negotiables (do not "improve" these)

1. **One accent colour: gold.** No red, green, blue, orange or purple anywhere, including for urgency, errors or status. Urgency is shown with a **filled gold square**, lesser states with an **outlined gold square** or a **grey square**. The only exception is a genuine destructive error.
2. **Square corners everywhere.** `border-radius: 0` on cards, buttons, inputs, chips, avatars and tiles. No pills.
3. **No shadows on cards or panels.** The only shadow in the app is on the capture drawer (`0 -18px 50px rgba(30,25,10,.10)`). There is no glassmorphism and no blur.
4. **1px warm keylines** separate things. Never thick borders, and never a coloured left-border "accent stripe".
5. **No sidebar of buttons.** Navigation is folding sections (Folds) or a top row that unfolds a panel (Index). See §5.
6. **Every titled section folds open and shut**, using a `+` / `−` glyph on the right. Nothing uses chevron icons.
7. **No full-width buttons.** Buttons are small: uppercase Jost, 11px, 0.22–0.24em tracking, padding `11px 22px`. The primary button is solid gold with forest-ink text; the secondary has a 1px keyline.
8. **Large, legible text** (Robin's eyesight). Body text is never below 13px, and list items are 15–17px.
9. **No icon fonts and no emoji.** The only glyphs used are `+ − → ✓ ✕ ⌘ · ‹ › ▶ ▼ ⌄`.
10. **Cormorant Garamond 300 for anything that speaks** (headings, names, numbers, quotes). **Jost for anything that labels** (UI text, metadata, buttons, eyebrows).
11. **Connections between items stay subtle:** an italic Cormorant sentence, a small gold dot, a Roman numeral. Never arrows, lines or "linked" badges.
12. **Night mode is a deep forest green, never blue-grey and never black.**
13. **Voice:** calm, warm, British English, short sentences, no hype, no exclamation marks, no emoji. Say "Set something down…", not "Quick add". Say "Not yet", not "Snooze". Say "12 days past", not "OVERDUE".

---

## 3. Design tokens

All colours are given in OKLCH (as used in the prototype), with hex approximations.

### Day (default)
| Token | OKLCH | ≈ Hex | Use |
|---|---|---|---|
| `--k-bg` | `oklch(0.975 0.012 85)` | `#f8f4ec` | Page (ivory) |
| `--k-panel` | `oklch(0.99 0.006 85)` | `#fdfbf7` | Cards, drawer, inputs-in-panels |
| `--k-soft` | `oklch(0.94 0.016 82)` | `#efe9dc` | Selected row, inner dividers, open sheet |
| `--k-ink` | `oklch(0.22 0.018 60)` | `#2a2620` | Text |
| `--k-mute` | `oklch(0.46 0.022 70)` | `#6b6357` | Secondary text |
| `--k-line` | `oklch(0.88 0.014 80)` | `#e0d9cc` | 1px keylines |
| `--k-gold` | `oklch(0.72 0.13 75)` | `#c99a3e` | Accent fills, rules, markers |
| `--k-goldt` | `oklch(0.55 0.11 70)` | `#8f6c2a` | Gold **text** (passes contrast on ivory) |
| `--k-deep` | `oklch(0.28 0.04 155)` | `#2c4a3a` | Forest: capture bar, notification, avatars |
| `--k-ondeep` | `oklch(0.975 0.012 85)` | `#f8f4ec` | Text on forest |

### Night (`body.night`)
| Token | OKLCH |
|---|---|
| `--k-bg` | `oklch(0.19 0.02 160)` |
| `--k-panel` | `oklch(0.22 0.022 160)` |
| `--k-soft` | `oklch(0.25 0.024 160)` |
| `--k-ink` | `oklch(0.94 0.012 85)` |
| `--k-mute` | `oklch(0.74 0.02 80)` |
| `--k-line` | `oklch(0.33 0.02 160)` |
| `--k-gold` | `oklch(0.74 0.12 76)` |
| `--k-goldt` | `oklch(0.80 0.11 78)` |
| `--k-deep` | `oklch(0.14 0.02 160)` |

Text on a solid gold button is always `oklch(0.22 0.018 60)`, in both day and night.

### Type
Fonts are self-hosted in `fonts/` (latin woff2): Cormorant Garamond 300, 300 italic and 500; Jost 400, 500 and 600.

| Role | Spec |
|---|---|
| Greeting (Today) | Cormorant 300, 70px / 1.02, two lines. The name is *italic gold*; the second line is muted |
| Space title | Cormorant 300, 84px / 1, with an italic gold Roman numeral at 36px before it |
| Screen title (Mail, Calendar…) | Cormorant 300, 44–56px |
| Section heading (folds) | Cormorant 300, 30px; hint in Jost 14px muted; `+`/`−` in Jost 300 18px muted |
| Item / list title | Cormorant 300, 23–26px |
| Big numbers (ledger) | Cormorant 300, 40–46px |
| Reading subject | Cormorant 300, 44px / 1.1 |
| Capture input | Cormorant 300, 38px, bottom keyline in ink |
| Body / list rows | Jost 400, 15–17px, line-height 1.4–1.7 |
| Meta | Jost 400, 12.5–14px, muted |
| Eyebrow | Jost 500, 11px, `letter-spacing: .28em`, uppercase, gold text, preceded by a 28×1px gold rule with a 12px gap |
| Field label | Jost 600, 10px, `.2em`, uppercase, muted |
| Button | Jost 500, 11px, `.22–.24em`, uppercase |
| Space numeral | Cormorant 300 italic, 15–17px, `--k-goldt` (I, II, III, IV, V) |
| Logo wordmark | Cormorant 500, 28–32px, "Koyeba" followed by a gold "." |

### Spacing and shape
- **Page padding:** `52px clamp(24px,4vw,64px) 160px`. The 160px bottom leaves room for the capture bar.
- **Content max-width:** 1220px.
- **Rows:** 10–18px vertical padding, separated by 1px `--k-line`; inner rows use `--k-soft`.
- **Cards** (Space page only): `--k-panel` background, 1px `--k-line` border, padding `22px 26px`, header underlined by a **1px gold** rule.
- **Radius:** 0. **Shadows:** none (except the drawer).
- **Markers:** 6–8px squares. Filled gold means it needs you or is urgent; outlined gold means important; grey means lesser.
- **Motion:** `fadeUp` 8px over 0.4–0.5s `cubic-bezier(0.2,0.7,0.2,1)` when something unfolds. The drawer slides 0.6s on the same curve. Colour transitions take 0.4s ease. No bounces, no springs.

---

## 4. Layout shell

```
┌──────────┬────────────────────────────────────────────┐
│  Folds   │  Screen (scrolls)                          │
│  nav     │                                            │
│  clamp   │                                            │
│ (210px,  │                                            │
│  21vw,   │                                            │
│  280px)  │                                            │
│          │          [ + Set something down…  ⌘ . ]    │ ← floating forest bar
└──────────┴────────────────────────────────────────────┘
```
- Full viewport height; only the screen area scrolls.
- The capture bar sits at the bottom centre, 460px wide, 24px from the bottom. It is forest green, with a gold `+` and italic Cormorant placeholder text. Clicking it, or pressing ⌘., opens the drawer.
- Responsive: every two-pane screen uses `clamp()` widths for its list column. Grids use `repeat(auto-fit, minmax(min(100%, Npx), 1fr))`. It must work at around 920px wide.

---

## 5. Navigation (replaces the old sidebar)

The 35 sidebar buttons are regrouped into **seven folds**, and only one is open at a time:

| Fold | Closed hint (live) | Items |
|---|---|---|
| Today | "Friday · two still to tick" | Home, Flow, Practices |
| Spaces | "Five · one shared" | each Space, with its Roman numeral |
| Tools | "Mail N to sort · Tasks 4" | Mail (badge = inbox count), Calendar, Tasks, Notes, Tables, Goals, Saved, Discover |
| People | "N new messages" or "Mum is due a call" | Contacts, Messages (badge = unread), Connect |
| Money | "€1,240 in October" | Spending, Money, Portfolio, Advice |
| Inner life | today's I Ching | Reflection, Journal, Coaching, Dreams, Compass, I Ching, Spirit Cards, Horoscope, Insights |
| Reviews | "Weekly, on Sunday" | Daily, Weekly, Monthly, Quarterly, Yearly |

- **Folds nav (default):** the left column holds the logo, then "Find… ⌘K", then the folds. The open fold lists its items in Jost 16px. The current screen's fold title and item turn gold-text. At the bottom are text links: Night · Settings · Guide · Welcome. Admin and Sign out go in Settings, not the nav.
- **Index nav (alternative):** the seven fold names run across the top. Clicking one unfolds a full-width `--k-soft` sheet of its items, each with a one-line description. "Fold away ✕" or Esc closes it.
- **"Life Spaces" are now just "Spaces"** everywhere.

---

## 6. Screens

### 6.1 Today (home)
1. **Eyebrow:** "Friday · an overcast evening" (day, weather word and part of the day).
2. **Greeting:** "Good evening, *Robin.*" then, muted, "The day is drawing in."
3. **Ledger:** four numbers in a row: emails to sort, things to do today, events tomorrow, spent this month. Clicking one unfolds its rows beneath the ledger, with a gold underline on the active number and an "Open Mail →" style link. Only one is open at a time.
4. **Two columns** (auto-fit, min 320px):
   - **Left, Today:** a timeline. Each row is the time (Jost 500 13px muted), a 7px gold-outlined square on a 1px vertical line, then the title (17px), with the Space numeral and name plus a meta line beneath, and a tick box (18px square) on the right. A ticked item's square fills gold and the row drops to 55% opacity. The timeline ends with a gold "22:04" marker and the italic line "Now. The rest of the evening is yours." Below it, **Your spaces** is shown as tiles: numeral and name, a one-line status, a 2px progress line, and a footnote.
   - **Right, Coming into view** (this is "My Shizu", renamed; keep this name). Its groups each fold away:
     - **Messages** (only when there are unread messages): `Name: last message`.
     - **Deadlines:** Spaces that have a deadline. Due text: "12 days past" (filled gold, gold text), "Tomorrow" (outlined), "In 7 days" (grey).
     - **Do next:** P1 and next tasks. The count shows 12, it is **folded by default**, and it ends with "And 9 more in Tasks →".
     - **Back today:** snoozed tasks whose date has arrived.
     - **Keep in touch:** people on a cadence. Ticking rolls the date forward from today.
     Then come **A line for the evening** (I Ching: the character, *name*, "I Ching · changing", one-line reading) and the **Notepad** (a plain textarea, no box).
5. **Foot mark:** the Mandombe "koyeba" at the bottom, centred, 240px wide, at 55% opacity rising to 100% on hover, with "KOYEBA · TO KNOW" beneath. **Clicking it scrolls to the top**, the same as clicking the wordmark.

Data: `/api/day`, plus the brief (`worker/brief.js`), plus `surfaced`, `keepInTouch` and `open_p1` from `worker/index.js`.

### 6.2 Space (e.g. The kids)
- "← Today", then the numeral and the title (84px).
- A meta row: the status line; if the Space is shared, square avatars (forest and gold, 28px, overlapping by 8px) with "Shared with Joana — she sees only this space"; on the right, the gold text links "Share" and "Give it a deadline".
- A ledger of four stats between keylines.
- **Cards** (auto-fit, min 340px) for Tasks, Calendar, Mail, Notes, Money and People. Each folds and has "+ Add" at the bottom.
- A Space with a deadline counts down. This is the same model as a project (see the brand note).

### 6.3 Mail — Robin's actual triage model
**Left column** (`clamp(280px,34%,420px)`): "Mail" with "+ Compose" in gold text, then "All accounts · N unread ⌄". The **piles** are folding rows, each with a marker, name, hint and count:

| Pile | Hint | Marker |
|---|---|---|
| Inbox | To sort | grey outline |
| Urgent | Important and timely | **filled gold**, gold count |
| Important | Important, not rushed | gold outline |
| Read later | Worth a read, no rush | grey fill |
| Archive | Done | keyline |

Below the piles, a folded **Folders** row holds Drafts, Sent, Spam and Trash. The open pile lists its messages: unread dot, sender, subject, snippet, time and Space numeral. An empty Inbox shows, in italic, "Inbox clear. Nothing left to sort." Piles with more history show "and N earlier".

**Reading pane:**
- Eyebrow: "II The kids · Thu · Inbox".
- Subject (44px Cormorant), then "From Name · address".
- **Sort row**, between keylines: `SORT  ■ Urgent 1  □ Important 2  ▪ Read later 3  — Archive 4`. The current pile is gold-underlined.
- **Turn into row:** Note · Task · Event.
- **Dates found** (only when the email contains dates): a `--k-panel` box with a 1px gold left keyline (the one place this is allowed, because it is the same weight as the other edges). It shows the eyebrow "DATES FOUND", the event name (Cormorant 23px) and the date, with "Add to calendar →", which becomes "Added ✓" once used.
- Body (Jost 16.5px / 1.7, max 640px), then Reply (gold) and Forward (keyline).
- If the email is already linked to something, an italic Cormorant line says so, e.g. "Already a task: Book booster jab · due today."

**Behaviour:** keys **1–4** sort the open email (only when focus isn't in a field). Sorting from the Inbox auto-selects the next Inbox email and shows a toast: "Moved to Urgent. 4 left to sort." The Inbox count, the Tools fold hint and the Mail badge all update live.

Data: `worker/mail.js` (`move`, `move-bulk`, `flag`, `messages`, `cached`, `unread`).

### 6.4 Calendar
- Header row (no wrapping): "Calendar", a **Day by day | Month** toggle (gold underline), muted "Search · From a file" (ellipsis when tight), and **+ Event** (gold button) on the right.
- **Day by day:** each day is a row with the date (Cormorant 48px) and label on the left and its events on the right (time · title · where · Space). Today's top rule is gold. An empty day says "Nothing yet. Just this."
- **Month:** a 7-column grid of 1px keyline cells; each event is a gold 5px square and its title.
- **New event** keeps every field from the current app but loses the boxes:
  - The title is a 36px Cormorant input on a bottom keyline, with the Space selector beside it.
  - From/to date and time, All day (square box) and Repeat.
  - Where, Remind me (multi-select: a dot with its label; several allowed; "+ Custom") and Note.
  - Connect, which folds out: a website, a contact, a note, an email.
  - Add to calendar (gold) and Close (text).

### 6.5 Tasks
Title "Things to do", then a summary line. The groups fold: **Today** · **Back today** (snoozes that have arrived) · **Keep in touch** (cadence) · **Resting** (snoozed, folded by default). Each row has a tick box, title, meta, and Space numeral and name. Clicking a title unfolds "Set aside: Tomorrow · Next week · Pick a day", the priority, and an italic link line.

### 6.6 Notes and tables
- **Left:** notes grouped by Space (folding), with a "TABLE" tag on notes that contain a table.
- **Right:** eyebrow, a **Note | Table** toggle, and the title (52px).
- Blocks:
  - **Toggle headings:** a gold ▶/▼, the heading in Cormorant 30px gold-text, and indented lines underneath.
  - **Paragraphs.**
  - **Inline tables:** a label, a top rule in ink, uppercase column heads, `--k-soft` row lines, and "+ Row · Sort · Total".
- Footer hint: "Type, or press / for a toggle, a table, a link…"
- **Note ⇄ Table** flips the same content into a table and back without loss (`public/notes.js`, `public/tables.js`).

### 6.7 Messages
- **Left:** threads, each with a square forest avatar showing initials, the name, Space numeral, last line, time and an unread gold square.
- **Right:** the thread. Bubbles are square with a 1px keyline: theirs on `--k-panel` on the left, yours on `--k-soft` on the right. Below is an input (24px Cormorant on an ink bottom rule) with "Send ↵", and then, in muted text, "Make it a task · Add to calendar · File to a space".
- **Incoming notification:** a forest card, top right, 360px. It shows a gold dot, the name, the Space numeral, "The kids · just now", the message in Cormorant 22px, and **Reply →** and **Later**. It hides as soon as that thread is read or open.

### 6.8 Reflection (inner life)
- Today's question in italic Cormorant 58px, then a textarea (`--k-panel`, keyline) and the links "Saved to Journal · File to a space · Ask Coaching about this →".
- Three folding columns: **This week** (a small bar chart; today in gold), **I Ching** history, and **Reviews**.

### 6.9 Money
- "€1,240" at 92px, with a one-sentence explanation.
- Bars by Space, 10px tall, gold, on a `--k-soft` track.
- "Filed themselves this week": the list of payments that were sorted automatically.

### 6.10 Search (⌘K)
A centred overlay, 760px, on a 35% ink scrim. A 38px Cormorant input. Results are grouped Spaces / Mail / Tasks / Calendar / Notes, each with its Space numeral. With an empty query it shows recent items. If nothing matches: "Nothing by that name yet." Esc closes it.

### 6.11 Capture: "Set it down" (⌘. or the bar)
A drawer slides up from the bottom (800px wide, `--k-panel`, top shadow only). It has the eyebrow "SET IT DOWN", the input "I've got the dentist on Tuesday at 9am", and "Esc · fold away".
- **Empty:** "Just write it as you'd say it. Try …" with three clickable examples.
- **While typing**, a live readout: "Koyeba reads this as — tap a line to change it". Its rows are **What** · **As** (tap to cycle Event, Task, Note, Spend) · **When** · **Into** (tap to cycle Spaces; shows "guessed from 'dentist'") · **Remind** (with a one-line reason).
- **Parsing is rule-based, not AI** (the brand promise is that it works without AI):
  - Strip lead-ins ("I've got", "remind me to"…). Normalise curly apostrophes first.
  - Day: today, tomorrow and weekdays; "next" adds 7 days. Time: 9am, 9:30, 14:00, "at ten", noon. A bare hour below 8 is taken as pm.
  - Type: € or "spent" means Spend; "remind/need to/buy/call/book/pay/send/order" with no time means Task; a day or time means Event; anything else is a Note.
  - Space: keyword lists (vet/Biscuit → the dog; Ada/Tom/school → kids; boxes/keys/Remax → the move; Priya/Geeza/proposal → work; dentist/doctor/Mum/zazen → Body & mind). In production, learn these from each Space's own words.
  - Reminders: an appointment (dentist, doctor, vet, flight…) gets **"The evening before, 20:00" plus "1 hour before"**; a timed event gets 30 minutes before; an all-day event gets 09:00 on the day; a task with a day gets 09:00 on that day.
- **Set down ↵** files it and shows a toast, e.g. "Dentist — Tue 3 Nov at 09:00. I'll remind you the evening before, 20:00 and 1 hour before."

### 6.11b Voice capture: "Speak"
- **Entry points:** a **Speak** button at the right of the capture input (a keyline button, gold 7px square, uppercase Jost 11px), and a small **Speak** on the floating capture bar, which opens the drawer and starts recording straight away.
- **While recording, the input is replaced by:**
  - Italic Cormorant 34px reading "Listening…", which changes to "Heard" once words arrive.
  - A row of 48 thin gold bars (3px wide, 3px gap) whose heights follow the live mic level.
  - The timer `0:07` (tabular numerals).
  - A forest **Done** button.
  - The bottom rule turns gold.
  - Interim words appear underneath in Cormorant 24px as they're heard.
- **On Done**, or when speech ends, the transcript goes into the input and through **the same parser and readout as typed text** (§6.11). The user can correct it before pressing Set down. Esc cancels.
- **Footer copy while voice is used:** "Your voice is transcribed, then the recording is discarded."
- **Transcription (Claude cannot transcribe audio), in order of preference:**
  1. **Cloudflare Workers AI, Whisper** (`@cf/openai/whisper` or `whisper-large-v3-turbo`). It runs on the same Cloudflare account as the worker, so no third party holds the audio. Record with `MediaRecorder` (webm/opus), POST to `/api/transcribe`, return the text.
  2. **Gemini** (audio input) as an alternative, if Whisper's quality isn't good enough for Robin's accents and languages (English and Portuguese).
  3. **Browser Web Speech API** as an instant fallback. On Safari/iOS it can run on the device; on Chrome, audio goes to Google, so say so in settings.
- **Privacy:** following the brand rule that every AI use has its own switch, put a "Voice capture" toggle in Settings. Never store the audio. Never send anything without the user pressing Speak.
- **Prototype behaviour:** the prototype uses the browser's Web Speech API if one is available (en-GB). Otherwise it types out a demo phrase.

### 6.12 Welcome (onboarding, 4 steps)
A progress row of 1px segments.
1. The Mandombe mark, then "NASEPELI KOYEBA YO" / "Pleased to know you." / a name input.
2. "The parts of your life." Choose starter Spaces (the `DEFAULT_STARTERS` in `worker/accounts.js`).
3. "Bring your tools in." Google, IMAP, iCloud or Fastmail (CalDAV), Notion or Tana.
4. "Share a space, if you like."

### 6.13 Placeholders
These were not designed in this pass: Goals, Contacts, Dreams, Compass, Coaching, Spirit Cards, Horoscope, Insights, Reviews detail, Flow, Practices, Saved, Discover, Portfolio, Advice, Tables index. **Build them from the same parts:** folding sections, a ledger of Cormorant numbers, keyline rows, Space numerals, gold only where something needs you. **Don't invent new visual elements.**

---

## 7. Logo and brand

- **The primary logo is the wordmark:** "Koyeba" in Cormorant Garamond 500, with a gold full stop.
- **Mandombe** (the script) spells *ko-ye-ba*. Its vowel strokes are gold (red in the source, recoloured). See `Koyeba Logo.dc.html` for the uses:
  - **2a/2b:** the full lockup (script, a short gold rule, the wordmark, "TO KNOW"), for the website, print and the welcome screen.
  - **2c:** the app icon. **Just "ko"** on a gold tile (`assets/mandombe-ko-tile-gold.svg`) or a forest tile (night). Use it for the favicon and apple-touch and 192/512 icons, replacing all the `public/icon-*.png` and `apple-touch-icon*.png` files.
  - **2d:** the header. A small "ko" mark (26–28px tall) sits before the wordmark and **replaces the 静 character everywhere**.
  - **2f:** the welcome screen.
  - **Today:** the full word at the foot of the page (see 6.1). **Not** behind the greeting; Robin tried that and it was too busy.
- ⚠️ The strokes were traced by eye from a screenshot. **Have a Mandombe reader verify them** before public launch.
- The meaning of Koyeba is "to know" in Lingala. *Nasepeli koyeba yo* means "pleased to know you".

### Assets (`assets/`)
| File | Use |
|---|---|
| `mandombe-koyeba-ink.svg` / `-ivory.svg` | Full word, day/night, with gold vowels |
| `mandombe-koyeba-ink-mono.svg` | Single-colour full word |
| `mandombe-ko-ink.svg` / `-ivory.svg` | "ko" for the header |
| `mandombe-ko-tile-gold.svg` / `-tile-forest.svg` | App icon and favicon |
| `mandombe-koyeba-soft*.svg`, `-faint*.svg` | Low-opacity versions (spare) |

---

## 8. Rename and domain move (Shizu → Koyeba, shizu.fyi → koyeba.co)

- **Copy:** replace every user-facing "Shizu", "Daybook" and "Lifebook" with **Koyeba**. That includes `public/*.html`, `/blog`, and the `pt/`, `fr/`, `es/`, `de/` and `it/` pages and their journal posts, `i18n.js`, the invite and OTP emails (`worker/invite-email.js`, `worker/auth.js`), push notifications, and `robots`/`sitemap` in `worker/index.js`.
- "My Shizu" becomes **"Coming into view"**; "Life Spaces" becomes **"Spaces"**; the brand mark 静 becomes the Mandombe "ko".
- **`wrangler.toml`:** add the koyeba.co routes and custom domain, and update the `FROM_EMAIL` brand name. Check `ADMIN_EMAILS`.
- **Google OAuth:** add koyeba.co to the authorised origins and redirects.
- **SEO:** update `canonical`, `hreflang`, `og:url` and `og:image`, then add **301 redirects from shizu.fyi/* to koyeba.co/*** (same path).
- **localStorage keys** (e.g. `daybook.consent`): **leave them alone**, or migrate them, so users aren't signed out or re-prompted.
- **Manifest and theme colour:** set `theme-color` to forest (`#2c4a3a`) instead of `#111327` navy.

---

## 9. Suggested order for Claude Code

1. Put the tokens (§3) into one CSS file with day and night variables, and remove the old navy theme.
2. Replace the shell and navigation (§4–5).
3. Today (§6.1), then Mail (§6.3), then Capture (§6.11). These carry the most of the product's feel.
4. Calendar, Tasks, Notes, Space and Messages.
5. Brand assets and the rename and domain work (§7–8).
6. Placeholders (§6.13), built from the same parts.

**After each step, compare it side by side with `Koyeba App.dc.html`.** If they differ, the prototype is right.

---

## Files in this bundle
- `Koyeba App.dc.html`: the full interactive prototype, covering every screen above.
- `Koyeba Logo.dc.html`: the Mandombe logo explorations, 2a–2f.
- `support.js`: the runtime needed only to open the prototypes locally.
- `fonts/`: Cormorant Garamond and Jost, woff2.
- `assets/`: the Mandombe SVGs.
