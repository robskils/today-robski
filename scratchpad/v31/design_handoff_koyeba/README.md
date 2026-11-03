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
| `--k-bg` | `oklch(0.23 0.035 158)` |
| `--k-panel` | `oklch(0.26 0.035 158)` |
| `--k-soft` | `oklch(0.29 0.035 158)` |
| `--k-ink` | `oklch(0.94 0.012 85)` |
| `--k-mute` | `oklch(0.74 0.02 80)` |
| `--k-line` | `oklch(0.36 0.03 158)` |
| `--k-gold` | `oklch(0.74 0.12 76)` |
| `--k-goldt` | `oklch(0.80 0.11 78)` |
| `--k-deep` | `oklch(0.18 0.035 158)` |

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
7. The public homepage (§10).
8. The Space page (§11).
9. The Mail page (§12).
10. The Goals page (§13).
11. Night mode, across everything (§14).
12. Smart Set something down (§15).
13. What next (§16).
14. Navigation: groups, top line, contents, mobile, and Find with Recent / Shared (§17).
15. Side by side (§18).
16. Using the whole screen: responsive grid (§19).
17. Notepad popover (§20).
18. Notes, Tasks and Reflection (§21–23), and the Money group (§17).
19. Start something new in the drawer (§15), and mobile Contents and Find (§24).
20. Calendar (§25).
21. Contents renamed to Menu (note above §17), and Settings (§26).
22. Set something down v2 (§27).
23. Back link (§28).
24. Find → Search rename (note above §17), Space page v2 (§29) and the Goal page (§30).
25. Notepad moves into Set something down (§31).
26. Flow and Practices go into Plans (§32).
27. Messages (§33).
28. The Reflection and People renames (notes above §17), Contacts (§34), Reflections on Today (§35), Journal (§36) and I Ching (§37).
29. Tarot, and the shared card back (§38).
30. Quote of the day (§39), Admin (§40), and Today v2 (§41).

**After each step, compare it side by side with `Koyeba App.dc.html`.** If they differ, the prototype is right.

---

## 10. Public website (koyeba.co homepage)

Reference: `Koyeba Website.dc.html`. It replaces the current homepage (`public/index.html` and its `pt/ fr/ es/ it/ de/` versions). It uses the **same tokens, type and rules as the app** (§2–3). Keep everything in the current `<head>` (SEO, hreflang, Open Graph, JSON-LD, the `today.token` redirect, cookie consent, sign-in modal, invite form handling); only the visible page changes.

**Fix in the copy across all languages:** spaced hyphens " - " become en dashes " – ". Remove "Sintra" and any other travel leftovers.

### Sections, in order
1. **Header:** the Mandombe "ko" (26px) and the wordmark, with links The idea · Tools · Privacy · Journal, then "Sign in" (text) and "Request an invite" (gold button). No wrapping: everything is `white-space: nowrap`. Move the language picker to the footer if the header gets tight.
2. **Hero:** eyebrow "Invite-only · early access", headline "Set it down. *It comes back* when you need it." (Cormorant 300, up to 86px), one-sentence lead, "Request an invite" (ink button) and "How it works →".
   - **On the right, a live demo of the capture drawer** (§6.11): a phrase types itself out, then the readout rows (Into · As · Reminds/Joins) fade up 8px. It cycles three examples: the dentist on Tuesday at nine, Ada's trip form, Biscuit's flea drops for €18.40. Respect `prefers-reduced-motion` by showing the first example still.
3. **The idea:** "We carry too much at once." and two short paragraphs, including "Koyeba is Lingala for *to know*".
4. **Tools:** "Everything you use, *talking to each other.*" **No icons and no grid of tiles.** Two columns of folding rows: **For the doing** (Mail, Calendar, Tasks, Notes, Messaging, Money, Contacts) and **For the inner life** (Journal, Reflection, Reviews, Goals, Coaching, Read & Watch, Bucket list). Each row has the name (Cormorant 28px), a one-line description and `+`/`−`. Opening it shows a sentence, then "Joins …" in gold text. One open at a time; Mail is open by default. Robin should check these descriptions.
5. **Spaces** (forest panel): copy on the left, with a folding "Share a Space with the people in it". On the right, a sample Space, "II The kids", whose Mail/Tasks/Calendar/Notes groups fold.
6. **The inner life:** centred, a short paragraph, "Read more +" unfolds the rest.
7. **Private by design:** "Yours. *Properly.*" Five folding points numbered I–V. **No ticks.**
8. **Made to be quick:** three columns, I · II · III.
9. **Invite** (night-forest panel): the full Mandombe word in ivory, "Come and set it down.", an email field on a single keyline with a gold "Request an invite" button, and "I already have an account".
10. **Footer:** wordmark and "For a life well lived", links, "Feito em Lisboa · © 2026 Koyeba". Then the **foot mark**: the full Mandombe word, 240px, 50% opacity rising to 100% on hover; clicking it scrolls to the top. Beneath it, the **dictionary entry**:
    - Line 1: **Koyeba** (Cormorant 500, 24px) · koh-YEH-bah (Jost 14px, muted) · *verb, Lingala* (Cormorant italic 18px, gold text)
    - Line 2: "To know – facts, places, people." (Cormorant 300, 20px, muted)
    - Translate line 2 in each language version, but keep the pronunciation as it is.

### Rules specific to the site
- Content max-width 1240px; section padding `clamp(64px,8vw,112px)` top and bottom. Two-column sections use `repeat(auto-fit, minmax(min(100%, 420–460px), 1fr))` so they stack on narrow screens.
- "Set it down" appears only in the hero and the invite. Don't add it anywhere else.
- No icons, no ticks, no tile grids, no shadows, square corners. The same non-negotiables as the app.

---

## 11. Space page (e.g. "Art")

Reference: `Koyeba Space.dc.html`. It **replaces the current Space page entirely**: no metric tiles, no icon tiles, no left column of tool cards, no activity box. Use the same tokens, type and non-negotiables as §2–3, and keep night mode.

### Structure, top to bottom
1. **App header:** the Mandombe "ko" with the wordmark, a breadcrumb "Spaces / Art" (Spaces in muted text), Search ⌘K, and Night/Day.
2. **Cover:** the Space's cover image, full content width, `clamp(180px,22vw,300px)` tall, `object-fit:cover`, square corners. It's optional; hide it if the Space has none.
3. **Title block:** an eyebrow "Space · III of 34" with a gold keyline; the Space name in Cormorant 300 at `clamp(80px,9vw,128px)`; the vision as one italic line beneath it.
   - On the right: member initials (36px squares on forest), a dashed + to invite, "Kept close" (a gold square toggle that replaces the star), "+ Add to this Space" (gold button) and ··· for the menu.
4. **Contents line:** between an ink rule above and a keyline below, a quiet run of counts, e.g. "3 goals · 48 tasks · 23 notes · 4 tables · 2 events · 24 emails · 9 files · 2 people · 1 book". The number is Cormorant 24, the word is Jost 14 muted. **Clicking a count opens that section and scrolls to it.**
   - "Search this Space" sits on the same line, as an underline input. Typing filters every section and opens the ones that have matches.
5. **Two columns:** `minmax(0,1fr)` and `minmax(260px,340px)`.
   - **Main column:** "Open all · Fold all" above a stack of folding sections, numbered I–IX: Vision & goals, Tasks, Notes, Tables, Calendar, Emails, Files, Contacts, Books & films.
     - **Header row:** the numeral (Cormorant italic, gold), the title (Cormorant 300, 30–38px), the count (Jost 13 muted), **a one-line hint when closed** (e.g. "Today: do a watercolour painting"), and +/−.
     - **When open:** the content is indented 48px and fades up 8px. Rows are separated by keylines, and each section ends with "All 23 notes →" (gold text) and "+ New note" (muted).
     - **Vision & goals:** the vision sits in a forest panel. Each goal has a thin gold progress line ("2 of 5 steps"), then a "One day" line for the bucket list.
     - **Tasks:** a 13px square checkbox that fills gold when ticked, with strikethrough. Done count lives in the header: "48 · 3 done this week".
     - Vision & goals and Tasks start open; the rest start folded. Remember each user's choice per Space.
   - **Side column (sticky):** three folding panels, each with an ink rule on top and a Jost uppercase label.
     - **Coming into view:** the next few dated things, each with a quiet gold "where it came from" line.
     - **Lately:** recent activity in plain sentences ("You updated the page Watercolour."), ending with "See all 40 →".
     - **In this Space:** the members, ending with "+ Invite someone".
6. **Foot:** the full Mandombe word, 200px, 45% opacity rising to 100% on hover; clicking it goes back to the top.

### Don't
- No icons, emoji or coloured status squares.
- No separate "Done" metric.
- No boxed tiles.
- No red goal icons.
- Don't truncate titles in narrow boxes. Rows run the full width, so text never wraps word by word.

---

## 12. Mail page

Reference: `Koyeba Mail.dc.html`. It **replaces the current Mail page layout**: no coloured pile tiles, no boxed folder buttons, no letter avatars, no boxed account chips. Use the same tokens, type and non-negotiables as §2–3, and keep night mode. The same header and title block as the Space page (§11).

### Structure
1. **Title block:** an eyebrow "Tool · Mail", or "Mail · Urgent" etc. when a pile is selected. Then "Mail" in Cormorant 300 at `clamp(72px,8vw,112px)`.
   - Below it, **one italic line that changes as you go**:
     - "Eight to sort. Clear them in one pass." → "One left to sort." → "All sorted. Deal with the urgent ones first."
     - In other piles, the pile's description.
   - On the right: an account switch (an underline dropdown: All accounts / each address with its count / "Manage accounts →"), "Guide" as plain text, and a gold "Write" button.
2. **Piles row:** To sort · Urgent · Important · Later · Archive. Each is a Cormorant 40px number, a Jost 16 word and a 12.5px muted description (e.g. "Today, or it's late").
   - The selected pile is ink with a 1px gold underline sitting on the keyline; the others are muted. **No colour coding per pile.**
   - Drafts · Sent · Spam · Bin sit as quiet text links on the right of the same row.
   - **The counts must be live and agree everywhere.** The To sort count equals the italic line and the progress line.
3. **Two columns** (`minmax(0,1fr)` and `minmax(260px,330px)`):
   - **Main column:**
     - **Top:** an underline search input, and (in To sort only) a thin gold progress line with "3 of 8 sorted".
     - **Emails, grouped by day** ("This morning", "Yesterday", "Earlier this week"). Each group header is an uppercase label, a count, a keyline and +/−, and the whole group folds.
     - **Row:** the time (58px column) · sender in Cormorant 23 (500 if unread, 300 if read) · account as small muted text (only when "All accounts") · subject in Jost 16 · one muted preview line, truncated · a 6px gold square if Koyeba noticed something · +/−.
     - **Clicking a row unfolds it in place** (accordion, one at a time, panel background, fades up 8px). It shows:
       - The body.
       - When something was spotted, a **Noticed** line between keylines: a gold uppercase label, an italic Cormorant sentence ("A six-week group, Mondays at seven, from 16 November.") and one action ("Add to calendar →"), which becomes "Done".
       - The action row:
         - In To sort only, **sort buttons**: Urgent (ink outline) · Important · Later · Archive (keyline outline), each with its key hint U / I / L / A.
         - Then "Make a task · Make a note · Add event".
         - Then Reply · Forward on the right.
     - **Sorting:** the email leaves To sort, **the next one opens automatically**, and the counts update. A quiet "Moved to Urgent. Undo" appears above the list.
     - **Keys U / I / L / A** sort the open email (except while typing in an input).
     - In a pile, newly sorted mail appears at the top under "Just sorted".
     - **Empty To sort:** "Nothing left to sort." / "Start with Urgent – it's waiting for you."
   - **Side column (sticky):** folding panels, as on the Space page.
     - **Noticed in your mail:** every spotted date, payment or deadline with its action.
     - **Waiting on a reply:** sent mail with no answer, each with "Nudge".
     - Below them, a muted keyboard hint.
4. The **Set something down** bar floats at the bottom, as everywhere else.

### Don't
- No red/orange/green/blue pile colours.
- No icons on folders.
- No letter avatars.
- No grey boxes around email addresses.
- No square checkbox per row; sorting replaces selection.

---

## 13. Goals page

Reference: `Koyeba Goals.dc.html`. It **replaces the current Goals page**: no coloured left bars, no boxed goal cards, no "ACTIVE" chips, no × buttons, no boxed view tabs or sort dropdown. Same header and title block as the Mail page (§12).

- **Title block:** "Goals" plus one italic line built from live data, e.g. "13 goals across 8 Spaces. Five are nearly there."
  - On the right: a "Highlight the best bits" toggle (a gold square) and a gold "+ New goal" button.
- **Views row** (the same style as the Mail piles): By Space · Starred · All goals · Bucket list, each a Cormorant 40 count with a word and a hint.
  - Order sits on the right as text: Starred first · Closest to done · Recently touched.
- **By Space:** one folding row per Space (numeral, name, goal count).
  - **When closed:** one italic line of the vision, truncated, and **a tiny progress line per goal** (26px wide, with a 3px gold fill) at the right.
  - Open all · Fold all sit above the list.
  - **When open:**
    - The vision as italic Cormorant at 23–27px, max-width 720px.
    - With "best bits" on, each paragraph's best phrase stays ink on a faint gold wash (gold at 22% opacity) and the rest goes muted.
    - "Edit the vision" as text.
    - No vision: "Picture this part of your life at its best." and "Write a vision →".
    - Then goal rows: a 9px star square (filled gold when starred) · title in Cormorant 25 · meta "This quarter · 11 of 20 tasks · touched 3d ago" · a 150px progress line with %.
    - End with "+ Add a goal" and "Open Art →".
- **Starred / All goals:** flat rows (the same row style), with the Space name in gold text in the meta. All goals is grouped by This quarter / This year.
- **Bucket list:** a short italic intro, then a two-column numbered list (I, II…) in Cormorant 26, with no progress bars. Click to mark done (strikethrough).
- **Side column (sticky, folding):** "Nearly there" (60% or more, with %) and "Gone quiet" (untouched for 5 or more days).
- Only show a status label when a goal is **not** active (Paused, Done).

## 14. Night mode – fix across the whole app

Reference: `Koyeba Night Mode.dc.html`. It has the token table, the list of what's wrong in the current build, and a correct night Messages screen.

**The rule: no literal colours anywhere in components.** Every colour comes from the CSS variables in §2: `--k-bg --k-panel --k-soft --k-ink --k-mute --k-line --k-gold --k-goldt --k-deep --k-ondeep`. Night mode only swaps their values on `body.night`. Search the codebase for hex/rgb/oklch literals outside the token definitions and replace them all.

**Night values:**
- bg `oklch(0.23 0.035 158)`
- panel `oklch(0.26 0.035 158)`
- soft `oklch(0.29 0.035 158)`
- ink `oklch(0.94 0.012 85)`
- mute `oklch(0.74 0.02 80)`
- line `oklch(0.36 0.03 158)`
- gold `oklch(0.74 0.12 76)`
- goldt `oklch(0.8 0.11 78)`
- deep `oklch(0.18 0.035 158)`
- ondeep `oklch(0.94 0.012 85)`

**Fix specifically:**
1. Sidebar fold titles must use `--k-ink`. They're currently near-invisible. The open fold uses `--k-goldt`.
2. All keylines use `--k-line`. They're currently bright and heavy.
3. The Mandombe mark renders in the wrong colours at night. Keep the mark, and swap to `mandombe-ko-ivory.svg` on `body.night` (`mandombe-ko-ink.svg` by day).
4. A flat `--k-bg` ground. No gradients and no lighter inset panel behind the content.
5. Messages: plain rows on keylines, no boxed cards, no letter avatars. The unread marker is a 6px gold square.
6. The Set something down bar at night: `--k-deep` (darker than the page) with a 1px `--k-line` border.
7. Header: the breadcrumb is text, not a boxed back arrow and boxed "+ New".
8. Check every screen in both modes before calling it done: Today, a Space, Mail, Calendar, Tasks, Notes, Goals, Messages, Settings.

---

## 15. Smart "Set something down" (replaces the always-open bar)

Reference: `Koyeba Set Down.dc.html`. Click the tab or any example on the right.

**Folded by default.** The bar is no longer always open. At rest it's a small forest tab, bottom centre: "+ *Set something down* ⌘ ." (Cormorant italic 19, gold +).
- Click it or press **⌘ .** anywhere, and the drawer rises: translateY plus a fade, .55s `cubic-bezier(0.2,0.7,0.2,1)`, max-width 820px, `--k-deep` ground.
- **Esc** or "Fold away" closes it. The input is focused when it opens.

**It works out what you meant.** As you type, it picks one of **Task · Event · Note · Email · Money** and shows the choice as a row of words, with the chosen one underlined in gold.
- Beside it, one italic line says why, e.g. "Read as event – there's a day and a time".
- Tap another word, or press **Tab** / **Shift+Tab**, to change it. Once the user picks, show "You chose task".
- It also guesses the **Space** ("Into", with a Change link that cycles through Spaces).

What each type shows (label column 76px, uppercase 10px):
- **Task:** Into · Due · Reminds (on the due day at 08:30, or "In your Monday review" if there's no date).
- **Event:** Into · When · Reminds. Default reminders are the evening before and 45 minutes ahead (just the morning of if there's no time).
- **Email:** Into · To (matched from Contacts) · Subject (from "about …") · a starter Draft (editable). The button reads "Draft it". **It only ever creates a draft in Mail, and never sends.**
- **Money:** Into · Amount · On. Filed against the Space.
- **Note:** Into · Kept. Findable with ⌘K.

**After setting it down:** the drawer folds away, the item fades into Today, and a quiet confirmation appears above the tab: "Set down as a task in Art." with **Change** (reopens it with the text and choices intact) and **Undo**. It dismisses after 6 seconds.

**Intelligence:** the reference uses simple keyword rules only to show the behaviour. In the real build, use the user's own AI key (opt-in, as everywhere else) to classify, extract the date, time, recipient and Space, and draft the email. **Learn from corrections**: if they change a note to a task, weight that next time. Without AI, fall back to rules like the reference.

### Start something new (V15) – replaces the old "+ New" dropdown
- **When the drawer is open and the input is empty,** show a list under the hint: an uppercase gold label "Or start something new" (with ⌘N beside it), then a grid of numbered words in Cormorant 22: **Note · Task · Event · Email · Table · Goal · Journal page · Space · Review**. No icons.
- Choosing one closes the drawer and opens a blank one of that type.
- **As soon as the user types, the list gives way** to the usual reading of what they wrote.
- **⌘N** opens the drawer straight to this list; ⌘. opens it to type. On mobile, the gold + square does the same.
- Tool pages keep their single gold "New note" / "New goal" button. **Don't bring back the "+ New" dropdown or the breadcrumb bar.**

## 16. "What next" – one wise suggestion at a time

Same reference file, at the top of Today, and from the "What next?" button bottom-right (page ground, 1px gold border, Cormorant italic, gold text).

- **A block under the greeting**, between a gold rule above and a keyline below. It folds.
  - An eyebrow "What next" and a muted "one thing at a time" ("2 done ·" once some are done).
  - **One suggestion only**: a sentence in Cormorant 30–42px ("Sign Ada's trip form first."), then **one italic "because" line** in a calm, fatherly voice: short, warm, never nagging.
  - Then a gold button with a verb that fits ("Done it", "Write it", "Hold the hour", "Remind me at six"), plus **Not now** and **Something else** as text.
  - On the right, "Why this?" unfolds the joined dots: Email / Task / Calendar / Goal / Vision lines it used.
- **Each choice** fades the next suggestion in. When nothing is left: "That's enough for today." with a gentle line (e.g. take the dog out). It knows when to stop.
- **How to choose** (with the user's AI key; rules otherwise), roughly in this order:
  1. Things that will be late soon and are quick.
  2. Urgent mail.
  3. Commitments with a deadline today or tomorrow.
  4. A goal that's gone quiet, matched to free time in the calendar and tied back to their own vision words.
  5. People they meant to contact.
- Never more than one at a time. No scores, no streaks, no guilt.
- **Voice:** British English, plain, kind. Speak like someone who knows them: "This is what you said you wanted."

---

> **Naming (V16):** the overview called "Contents" everywhere below is now labelled **Menu** in the UI (desktop header, mobile bottom bar, the overlay eyebrow, breadcrumbs). The behaviour is unchanged.

> **Naming (V19):** "Find" is now labelled **Search** everywhere in the UI: the header (Search ⌘K), the mobile bottom bar, the panel heading and any "Try Find" copy. Behaviour is unchanged; ⌘K still opens it.

> **Naming (V20):** the group **Inner life** is now called **Reflection** (header, Menu, mobile). Its sheet lists, in order: **Overview · Journal · Dreams · Coaching · Compass · I Ching · Spirit Cards · Horoscope · Insights**. Description: "Room for the rest of you". **Every tool in every sheet gets its numeral**: Horoscope is VIII and Insights IX, which are currently missing. The sheet grid must fit the content width with no tool cut off at the right edge; use `repeat(auto-fill,minmax(220px,1fr))`, not a fixed 6 columns that overflow.

> **Naming (V21):** the group **Conversations** is now called **People** (header, Menu, mobile, eyebrows). It holds Mail · Messages · Contacts (with Keep in touch inside Contacts, §34). The unread count stays beside it.

> **Naming (V22):** in Settings → How it looks and works, rename the group **"Reflection practices" → "Reflection tools"**, and add **Tarot** to it (On by default). "Practices" now only means repeating habits (Plans → Soon, §32). The Reflection menu panel now lists ten tools: Overview · Journal · Dreams · Coaching · Compass · I Ching · Spirit Cards · Horoscope · Insights · **Tarot (X)**, on desktop, in Menu and on mobile.

## 17. Navigation – new groups, top line, contents page, mobile

Reference: `Koyeba Navigation.dc.html` (2a desktop, 2b mobile). **This replaces the sidebar on desktop and the boxed icon drawer and icon tab bar on mobile.**

### The seven groups (the "Tools" group is gone)
1. **Spaces:** each Space.
2. **Conversations:** Mail · Messages · Contacts · Sharing.
3. **Plans:** Calendar · Tasks · Discover.
4. **Keep** (reference): Notes · Tables · Saved · Files · Read & Watch.
5. **The long game:** Goals · Bucket list · Reviews.
6. **Inner life:** Journal · Reflection · Coaching (and Practices, Insights if they exist).
7. **Money:** Spending · Bills · Accounts. **Optional.** It's always listed last. Nothing about money appears on Today, in What next or in hints unless the user has set Money up. Hints never show amounts ("Receipts, filed by Space", not "€46 this month").

**Today is not a group.** The wordmark takes you to Today. Don't give Today a tab, and don't make it the first item in a list.

### Desktop (2a)
- **Header:** the wordmark, then the seven group names (Jost 15, muted). The current group is ink, and the open group has a 1px gold underline sitting on the keyline. A gold count shows only where something waits (e.g. Conversations 8).
  - On the right: "Search ⌘K", and "Menu" (with a gold underline).
- **Clicking a group folds a sheet down** below the header, on `--k-soft` ground, fading up 8px. It shows the group name (Cormorant 34), a one-line description, "Fold away", then a grid of its tools.
  - Each tool is a numeral, a name in Cormorant 24, and **one live line** ("8 to sort", "Parkrun at nine").
  - Choosing a tool closes the sheet.
- **Contents (⌘/):** a full-page overlay under the header, with the seven groups in two columns numbered I–VII, each listing its tools. Esc closes it, and typing filters.

### Mobile (2b)
- **Top:** a small wordmark (to Today), with a breadcrumb or the date on the right.
- **Bottom: three things only**, on a keyline, at thumb height. **No icons and no five-tab bar.**
  - "Contents" (left, text).
  - **A 52px gold square "+"** (centre): Set something down.
  - "Find" (right, text).
- **Contents** opens full screen:
  - "Kept close" at the top: the user's pinned tools as Cormorant 24 words with counts. Press and hold any tool to pin it. **This replaces drag handles.**
  - Then the seven groups as folding rows: numeral, name in Cormorant 27, one hint line when closed. Tools open beneath as 44px+ rows, each with a hint.
- **Set something down on mobile** is a **bottom sheet**, not a floating bar:
  - It rises over a dimmed page, on forest ground, with a grab line at the top.
  - It holds the input (Cormorant 30), the type words (Event · Task · Note · Email) with the chosen one underlined in gold, the italic "Read as…" line, and the readout rows.
  - At the bottom: SPEAK, and a gold "Set down" button.
  - Same behaviour as §15. **Remove the full-width green bar on mobile.**

### No icons, anywhere
No ✉ ▤ ✓ ☺ ◐ ✳ glyphs, **no target/bullseye icon for goals**, no emoji in navigation. Words, numerals, counts and the single gold square only.

### Find holds Recent and Shared with you (V9)
- **The header stays:** wordmark · seven groups · Search ⌘K · Menu. Don't add Recent or Shared as header items.
- **Opening Find (click or ⌘K) shows, before any typing:** **Shared with you** first, with "3 new" when something is new, then **Recent**. Both are folding lists: a Cormorant 21 title, then a muted line with the type, Space or person, and when.
  - Typing replaces them with "Found" results from everywhere.
  - Desktop: a 520px panel under the header, right-aligned. Mobile: full screen from the Find text at the bottom right.
- **A gold count beside Find** shows only when something new has been shared, and clears when the panel is closed or an item is picked.
- **On Today:** one quiet line, only when something's new: a 6px gold square, "Joana added three things to The kids." and "See them" (it opens Find). Nothing shows otherwise.
- **Contents lists only the seven groups.**

### Plans absorbs The long game (V11) – six groups
- **The groups are now six:** Spaces · Conversations · **Plans** · Keep · Inner life · Money. **"The long game" no longer exists as a group.**
- **Plans** is "From today to one day". Its fold-down sheet has **three labelled rows**: **Soon** (Calendar · Tasks · Discover), **Further off** (Goals · Bucket list) and **Looking back** (Weekly review · Monthly review · Quarterly review · Year in review, plus any custom rhythm the user adds). Each row has an uppercase 10px muted label in a 110px column, then the tool grid.
- In Contents and on mobile, Plans lists all its tools in that order.
- **Every tool in a sheet shows a live hint line** ("Parkrun at nine", "Tonight"). Never leave one blank, or the names sit at different heights. If there's nothing live, use a quiet description.
- Update breadcrumbs: `Plans / Goals`, `Plans / Reviews`. The rule is now "six groups, seven at most".

### Money group (V14)
- **Tools:** Overview · Spending · Investments · Advice. Don't put a tool called "Money" inside Money; the overview is **Overview**.
- **Sheet strapline:** "What things cost, and what's growing". Before the user has set Money up, it reads "Optional – only if you want it".
- **Hints are words, never amounts:** "Where it all stands", "Filed by Space", "How they're doing", "Questions for a calm look".
- **Inside Money:** no red ▼ or green ▲ arrows. Show change as words in muted or gold text ("€240 less than last month").

### Night, Settings, Guide, Welcome
- **They aren't in the header.** They sit as **a quiet footer row at the bottom of Contents** (desktop and mobile): Night · Settings · Guide · Welcome in Jost 14, muted, on a keyline, with the person's name on the right.
- Night also keeps its keyboard shortcut and follows the system setting ("Auto") by default.
- "Welcome" reopens the onboarding.

### Rules for the top line
- **Six groups, seven at most.** New features go inside a group, never alongside one.
- **Below about 1100px wide,** collapse the group words. Show the wordmark, the breadcrumb ("Plans / Calendar"), Find and Contents. The contents page does the navigating.

---

## 18. Side by side – two panes

References: `Koyeba Side by Side.dc.html` (desktop) and `Koyeba Side by Side Mobile.dc.html`.

### Desktop
- **Two panes at most.** Opening a third replaces the older one. Shift-click anything, or use "Open beside…" (shown when only one pane is open), to open a second pane. It slides in from the right (.5s, fading in from 40px).
- **Pane header:** the group eyebrow and title (Cormorant 40). In the right pane: a pane switcher (e.g. Notes · Tasks), "Keep pair" with an 8px gold square ("Pair kept" when on), | and "Fold away".
- **Divider:** a 1px keyline with a 13px hit area. Drag it to resize (30–70%), and double-click it to reset to 50/50. It turns gold while you drag.
- **Drag to join the dots:** drag an email onto the right pane.
  - The pane shows a dashed gold outline and an italic hint ("Drop to make a note from Ana's email").
  - On drop, a **linked** note or task fades in at the top with "From Ana's email" in gold. The email row shows "note linked".
  - A forest confirmation with Undo appears, and dismisses after 5 seconds.
  - Without dragging: an open email offers "Make a note beside →" and "Make a task beside →".
- **Pairs:** "Keep pair" remembers the combination. "Open beside…" lists **Your pairs** first ("Mail with Notes – Most mornings").

### Mobile
- **One pane at a time.** When a pair is open, a 40px line under the status bar, with a gold keyline beneath, says "Notes is beside – tap to flip" or "Back to Mail". Tapping it slides between them (left/right, .45s); × ends the pair.
- **Long-press an email** to open a bottom sheet: Make a note beside · Make a task beside · Open Notes beside · Reply.
- After making something, a forest confirmation offers "See it", which flips to the other pane, where the new item sits at the top with its gold "From …" line.

## 19. Using the whole screen – responsive page grid (V10)

Reference: `Koyeba Wide Screens.dc.html` (1a 1280, 1b 1920, 1c 2560). **The current build pins content to a fixed column on the left. It looks accidental. Replace it on every page.**

### The grid
- **The header and the page share one container:** `max-width` + `margin: 0 auto` + side padding, so the wordmark lines up with the content.
- **Columns grow with the screen. Sections never stretch; they move between columns.** Use CSS grid with `grid-template-areas`:
  - **Under 900px:** 1 column. Areas: a, then b, then c.
  - **900–1599px:** 2 columns, `minmax(0,1.45fr) minmax(320px,1fr)`, areas `"a b" "a c"`. Gap 64px, padding 48px.
  - **1600–2199px:** 3 columns, `minmax(0,1.35fr) minmax(0,1fr) minmax(320px,0.85fr)`, areas `"a b c"`. Gap 72px, padding 64px.
  - **2200px and up:** the same 3 columns, **capped at max-width 2240px and centred**. Gap 96px, padding 80px. Extra space stays calm, or is offered to a second pane (§18).
- **The headline scales with the screen:** `clamp(56px, 3.4vw, 80px)`.
- **Body text keeps a readable line length:** never more than about 75 characters. If a column would get wider, add a column instead.

### Today, by area
- **a: the day.** Eyebrow, greeting, a quiet counts line (emails to sort · things to do · events tomorrow), **What next** (§16), then the **Today** fold.
- **b: Coming into view.** The "something shared" line (§17), then Deadlines.
- **c: the quiet things.** Spaces kept close (two columns of numeral + name, then "All 34 Spaces →"), Notepad, and **A reading** (the I Ching reading and the spirit card, folded by default).
- **In 3-column layouts,** b and c start level with What next (they sit below the greeting), not at the very top.

### Apply the same grid to other pages
- **Mail, Goals, Space:** main list in a (spanning a+b when there are 3 columns), side panels in c.
- **Notes / Tables:** one reading column at most 760px wide, with the list in c.

### Remove from the current build
- **The sub-header bar** with the boxed ← back arrow and "+ New". Keep **a slim, unboxed breadcrumb line** instead (see below). Set something down replaces "+ New".

### Breadcrumb (decided)
- **A slim line** at the top of the page container, above the page eyebrow: Jost 14, muted segments, a `/` separator in `--k-line`, and the current segment in ink. No box, no arrow, no bar background, and no keyline of its own.
- **The path starts at the group, not "Home":** `Conversations / Mail / Ana Ribeiro – Class on Saturday`. The wordmark is home.
- **Every segment except the last is a link.** Esc, or ⌘[, goes up one level.
- **Hide it at the top level of a tool** (e.g. just Mail): the page title already says where you are. It appears once you're deeper than that.
- **Long titles truncate** with an ellipsis, middle segments first. Never wrap.
- **On mobile:** show the parent segment only ("‹ Mail"), as text, 44px tall.
- **"€0 spent this month"** and any other money figure on Today (§17: money is optional and never pushed).
- **Red left bars, red text and target icons on deadlines.** Late items show "14 days late" in `--k-goldt` (Jost 500, 13px). Upcoming items are muted.
- **The spirit card's box, sparkle icon and ×.** It becomes a quiet entry inside "A reading".
- **The full-width green Set something down bar.** It should be the small folded tab (§15).

## 20. Notepad – a popover, not a section (V12)

Reference: `Koyeba Notepad.dc.html`. **Remove the Notepad section from Today.** The Notepad becomes a popover you open, write in and close.

### What it is (and isn't)
- **Set something down** files things: it classifies and sends them to the right tool.
- **Notepad** just keeps things: **one running page per person, never sorted, never tidied**, always exactly as left.

### Trigger
- **Desktop:** fixed at bottom-left (left 32px, bottom 24px), level with the Set down tab at the centre. "*Notepad*" in Cormorant italic 20, then a muted count of open lines. `--k-bg` ground, padding 9px 16px, 1px `--k-line` border (`--k-gold` while open).
- **Shortcut ⌘;** toggles it from anywhere.
- **Mobile:** "Notepad" sits at the top of Contents, above Kept close, and opens full screen.

### Popover
- **Placement:** rises from the trigger (left 32px, bottom 76px). Width min(440px, 100% − 64px), `max-height: calc(100vh − 100px)`, flex column, `--k-panel` ground, 1px keyline, square corners, no shadow. Fades up 8px over .4s.
- **Header:** "Notepad" (Cormorant 30), "Kept · just now" (muted 12.5px), and "Close · Esc" on the right. The header always stays visible; the list scrolls (`flex:1; min-height:0; overflow:auto`).
- **Lines:** each line is an **auto-growing textarea** (`rows=1`, `resize:none`, `overflow:hidden`, `box-sizing:border-box`, height set to scrollHeight on input). Cormorant 300, 21px/1.35, padding 10px 0, with a 1px keyline under each, like lined paper. **Long lines wrap; never clip.**
- **Keys:**
  - ↵ starts a new line below.
  - Backspace on an empty line removes it and moves up.
  - ↑ at the start of a line, or ↓ at the end, moves between lines.
  - Esc, or clicking outside, closes it.
- **Saving:** **autosave** on every change (debounced), per user, synced. Opening it focuses the last, empty line ("Write anything…").
- **Sending a line on:** on the focused, non-empty line, show "**Set down →**" (gold, Jost 500, 12.5px) on the right.
  - Clicking it hands the text to **Set something down** (§15), which classifies it as usual.
  - The line then stays in the notepad **struck through and muted**, with "→ a task" (or event, note…) in gold. **It's never deleted.**
  - A forest confirmation appears with **Undo**, which unstrikes the line and removes the created item.
- **Footer:** muted 12.5px: "Never sorted, never tidied. ↵ for a new line. Send any line on with 'Set down →'."

### Don't
- No Notepad section on Today.
- No titles, folders or formatting toolbar.
- No auto-sorting of notepad lines.

## 21. Notes (V14)

Reference: `Koyeba Notes.dc.html` (click a note to open it). **This replaces the six-across card grid and the current note page.**

**Index**
- Title block: "Notes", then an italic line naming the note you were last in.
- One line holds the search ("Search notes – titles, words, links"), Recent · By Space · A – Z, and a gold "New note" button.
- **Notes are grouped** (Today / This week / Earlier in October, or by Space). Each group folds. Use two columns of rows on wide screens.
- **Each row:** the title in Cormorant 24 (one line), the Space in gold, the first line of the note in muted text, and the date.
- **Side column:** Kept close, and By Space with counts (click a Space to filter).

**A note**
- A slim breadcrumb, then the title in Cormorant up to 80px, then meta: the Space (gold) · edited · word count.
- **No inset box. The reading column is at most 760px.** Body text is Jost 17.5/1.75.
- **Headings** are Cormorant 32 with a keyline beneath and **fold** (−/+, with a count shown when closed). No ▼ arrows and no bold gold sans.
- **Plain links** are one row each: the link's own title, then "domain →" in gold. **No boxed preview cards.**
- **A rich preview** appears only when the page has a real image and description: the title, description and "domain →" between keylines, with the page's og:image at 150×100. **Never fall back to the Koyeba logo.**
- **Right column:**
  - At the top: Kept close (gold square), Share and ···.
  - Folding sections: **In Spaces** (+ Add to another Space), **Also findable as** (words in italic, + Add a word), **Linked** (tasks, emails, files, with "+ Task · File · Scan · Link"), and **Shared with**.
  - "Delete this note" as a muted line at the bottom.
- **Remove:** the icon toolbar (star, avatar, image, paperclip, bin), the coloured Space chips, the "Add Space" dropdown, the search-term input box, and the boxed "Linked & attached" buttons with emoji.

## 22. Tasks (V14)

Reference: `Koyeba Tasks.dc.html`. **This replaces the endless single list and the form-like task page.**

**Index**
- Title block plus an italic line built from live data ("Four things come first. Start with '…'.").
- **Two orders, remembered per person:**
  - **By priority (default):** piles First · Soon · Whenever · Done. Tasks are grouped by Space inside a pile, and long piles end with "And 180 more, across other Spaces".
  - **By date:** Now (late and today) · This week · Later · Someday · Done.
- **Quick add line** at the top of the list. In priority order, its placeholder is "Add something to First…" and the task goes into the open pile.
- **Row:** a 13px square to tick (it fills gold, with "Done. Nicely." and Undo), the title, then the Space (gold) · duration · status. The due date sits on the right; **late dates** are gold, Jost 500.
- **Side:** By Space, and Waiting on someone.

**A task**
- A slim breadcrumb, then a 28px square to tick and the title in Cormorant up to 72px.
- **The properties are a sentence, not a form:** "Due *Friday 30 October*, *doesn't repeat*. Remind me *the morning of*. Takes *about 2 hours*, *first priority*, *not started*." Each value has a dotted gold underline and changes when clicked (a small popover in the real build). **No dropdowns.**
- **Steps** (a folding checklist with "2 of 4" and "+ Add a step"), then **Notes**.
- **Right column:**
  - Kept close · Assign · Share · ···.
  - Folding sections: **In Spaces**, **Linked**, **Also findable as**, and **Who can see this** ("Only you" + Share).
  - "Delete this task" at the bottom.
- **Remove:** the boxed P1 / duration / status dropdowns, the coloured Space chips, the calendar emoji, the boxed panels and the emoji button row.

## 23. Reflection (V14)

Reference: `Koyeba Reflection.dc.html` (open Spirit cards, I Ching, Compass and Horoscope from the practices list).

- **Main Reflection page:**
  - A title and an italic line ("You last wrote three days ago – you said you were tired."). **No stat boxes and no icon tile grid.**
  - **Lately:** all entries as rows, with the kind (uppercase gold) · the text (journal entries and dreams in italic, I Ching questions under the reading) · when. Filters: All · Journal · Dreams · Cards · I Ching.
  - **Side:** today's card, then the **practices** as a numbered list with live hints (I Journal … VIII Insights).
- **Spirit cards:**
  - **The back:** forest, with a gold double keyline and the ivory Mandombe "ko". Draw another deals it face down ("Tap to turn"). Only the back, or "Turn over", flips it (rotateY, .9s).
  - **The face:** ivory, with the numeral, the name in Cormorant 38, a gold rule and the line in italic.
  - **The art is generated, not illustrated.** It's a gold horizon line, one or two fine gold circles (sometimes with a 14–22% gold wash), and the card's initial in large gold Cormorant italic. Pick one of five fixed compositions from a hash of the card name, so each card always looks the same. **No emoji, no clip art, and no stock images.**
  - **History:** a wrapping row of small ivory cards (numeral + name), then rows with date · name · line.
- **I Ching:**
  - The question goes on an underline, with a gold "Cast the coins" button.
  - The result shows six drawn lines, solid or broken, with the changing line in gold, beside the character, name, subtitle and reading.
  - Past readings are rows: date · character (no wrap) · name → name · the question in italic.
- **Compass:**
  - The decision on an underline. Option A and B, each with a name and "The real case for it…" on lined paper.
  - Then a sentence to click through: "It *can be undone*, it belongs to *Business*, and it matters *this year*."
  - "Find my bearing" gives "The weight leans towards *A*." with three lenses (Regret, Undoing, Your own words).
- **Horoscope:** a page, **not a modal**. Sun / Moon / Rising as words in Cormorant (**no zodiac emoji**), a one-line character sketch, today's reading, and "Edit birth details".

## 24. Mobile Contents and Find – full screen, properly (V15)

Reference: `Koyeba Mobile Contents and Find.dc.html`. **In the current build, both open as a thin strip over the page, the Today text shows through and overlaps it, and desktop hints ("⌘/ · Esc to close") appear. That's wrong.**

### How they must open (both)
- **A full-screen layer:** `position:fixed; inset:0` (below the status bar safe area), **opaque `--k-bg`**, above everything except the bottom bar. **Nothing from the page shows through.**
- **Lock page scroll while open** (`body { overflow:hidden }`). The layer scrolls on its own.
- **Motion:** it rises 24px and fades in over .45s. Closing reverses it. Close sits top-right, 44px tall, and the Android back gesture or a swipe down also closes it.
- **No keyboard hints on touch devices.**

### Contents (mobile)
- **Top row:** gold keyline, "CONTENTS" eyebrow, and "Close" on the right.
- **Then Today as the first, largest row:** "Today" in Cormorant 46 with "Sunday 1 November" in italic, and an ink rule beneath.
- **Kept close:** pinned tools as Cormorant 25 words with gold counts.
- **The six groups** as folding rows, at least 64px tall: numeral · name (Cormorant 29) · one hint line when closed · +/−. The open group's name is gold. Its tools sit beneath in 52px rows, each with a name, hint and count.
- **Footer:** Day/Night · Settings · Guide · Welcome.
- **Bottom bar:** stays visible, with "Contents" in gold while it's open.

### Find (mobile)
- **Covers the bottom bar too.** The keyboard opens immediately with the input focused.
- **Input:** Cormorant 34, "Search", on an ink underline, with "Cancel" at the right.
- **Before typing:**
  - A line of suggested searches in gold italic (recent searches or useful words).
  - Then **Shared with you** ("3 new") and **Recent** as folding lists. Each row has a title in Cormorant 23 (one line), the type, Space or person beneath, and when on the right.
- **While typing:** results are **grouped by kind** (Notes, Tasks, Mail, Spaces…), each with a gold uppercase label and count, then rows. If nothing matches: "Nothing by that name yet."

## 25. Calendar (V16)

Reference: `Koyeba Calendar.dc.html` (List · Week · Month; click a day). **This replaces the current Calendar entirely.**

### Title and controls
- **Title block:** eyebrow "Plans · Calendar", then the **month name** (Cormorant up to 96px) with the year muted beside it. One italic line built from live data: "Five things today. Yves' 80th at three, in Cascais." Times in this line are words ("at three"), or 24-hour when not on the hour.
- **Remove:** the second "All of November 2026" heading and the live clock.
- **One control line** between an ink rule and a keyline, all text except the one button:
  - ‹ Today ›
  - **List · Week · Month** (the chosen one underlined in gold)
  - **Quieten repeats** (a gold square toggle, **on by default**)
  - An underline search
  - **A single gold "New event"**
- **Remove:** the boxed Day / Month / Today / ⚙ / Add from file / Discover buttons. "Add from file" moves into the New event drawer (and Set something down). Discover lives in Plans.

### Month
- **Grid:** keylines only. **No filled chips and no gold bars.** Day numbers are Cormorant 21, top-right. **Today** sits in a 26px gold square with dark ink. Days outside the month fade to 45%, and the selected day has a `--k-soft` ground.
- **Events are text only:**
  - **Timed:** the time (Jost 11.5, muted), then the title (Jost 13, ink).
  - **All day:** the title in **gold Cormorant italic** with no time.
  - **Holidays:** muted Cormorant italic. **No flags or emoji.**
  - **Weekly repeats (when quietened):** muted, Jost 12.5, sorted below the one-offs.
- **At most 3 events per cell,** then "+2 more" in gold.
- **Below 1100px wide,** drop the time prefix in cells.

### Week
- Seven short columns of stacked events: a muted day label with the number in Cormorant 28 above an ink rule (gold for the selected day). Each event shows its time or "All day" / "Holiday", then the title. **No hour grid.**

### List
- The next 14 days that have something in them. Each day has a heading (Cormorant 28, "Today" / "Tomorrow" muted beside it), then rows: range · title · place.

### Selected day (side column)
- **Placement:** sticky at 300–360px on screens 1200px and wider. **Below 1200px it stacks under the calendar,** so the grid keeps its full width.
- **Content:** the eyebrow "Today" or the weekday, then the date in Cormorant 40 above a gold rule. Then rows: range · title, with the place muted and any note in gold ("Until Monday"). End with "+ Add to this day". When empty: "Nothing planned. A clear day."

### Event emoji
- Strip emoji from event titles everywhere (⚽, flags, ↻ repeat icons). Repeats are shown by muting, and "Repeats weekly" appears in the side panel.

## 26. Settings (V17)

Reference: `Koyeba Settings.dc.html`. **This replaces the nine-tab Settings entirely.** Reach it from the Menu footer (§17).

### Structure: one page, six folding sections
Each section is a row: a numeral · its name in Cormorant 30–38 · **a one-line summary when closed** · +/−. "You" starts open. Open all / Fold all sit above. **The right column (sticky)** lists the six sections (click to open and scroll there), then "Signed in as Robin Savile · Premium Plus" with Admin · Sign out.

1. **You:** name, email and phone (Edit) · "Also sign in with" as a summary sentence (Manage · + Add) · Your Koyeba card (See it · Edit) · **Security:** Two-step sign-in.
2. **Plan and AI:** plan choice (Premium Plus / Premium – your own key) · Billing (Monthly / Annual) · **Use AI at all** (master switch) · **Where Koyeba uses AI:** one On/Off row per use. No "Your AI" or "Gemini" badges; if a feature uses a specific model, say so in the explanation.
3. **How it looks and works:** Day and night (Auto · Day · Night) · Week starts on · Currency · Dates read as · **Tools you use** · **Reflection practices** · **Your phone's Today** (a summary + Rearrange, which opens a drag list) · **Notifications**.
4. **Connections:** **Calendars** (connected accounts with Disconnect · + Google · + iCloud or other) · **On your calendar** (holidays and teams as sentences, with Change) · **Mail** accounts · **Bring things in** (Notes · Contacts, with "Choose files").
5. **Invitations:** a summary ("22 invited · 12 joined · 10 waiting") · + Invite · **Waiting:** the first four, each with "Resend · Copy link · Cancel" as text, then "And 6 more – Show all" · **Joined:** folded into one line of names + Show all. **Don't show invite codes.**
6. **Your data:** Where it lives · Download everything · How we handle your data · **Leaving:** Sign out of this device · Close your account (gold text link that opens a confirmation).

### Row pattern (use it everywhere in Settings)
- **Left:** the label (Jost 16 for settings, Cormorant 23 for named things), with an optional muted 13px explanation beneath.
- **Right, one of:**
  - **An On/Off toggle:** a 9px gold square (filled = on) plus the word "On" or "Off".
  - **A choice:** 2–4 words, with the chosen one in ink and a gold underline. **No dropdowns.** Use a popover list only for long sets, such as countries.
  - **Text links:** the first in gold, the rest muted.
- A keyline under every row.

### Remove
- The boxed tab bar and the doubled "Settings" title.
- The "i" info boxes.
- Checkboxes, pill switches and dropdowns.
- Boxed or filled gold buttons, except a single primary action where one is truly needed.
- Coloured chips, and flag or football emoji.
- The octagram "App mark" choice and the single-colour accent picker.
- Invite codes, and the boxed invite rows.

## 27. Set something down v2 (V18) – replaces the silent auto-filing

Reference: `Koyeba Set Down v2.dc.html` (tap the five examples at the top). **This replaces the behaviour in §15.** The folded tab, ⌘. / ⌘N and the "Start something new" list stay as they are.

### The promise
**You pick the kind; Koyeba fills in the rest. It shows where every detail came from, asks when it doesn't know, and saves nothing until Enter.**

### 1. The kind is always visible
- Under the input is a row: **Task · Event · Note · Email · Just set it down**.
- As the user types, the best guess is underlined faintly with a small gold "GUESS" tag. One tap (or Tab to cycle) overrides it, and the override sticks.
- **If the guess isn't confident, don't guess.** Ask one question instead ("A task or a note?") with 2–3 boxed word buttons.

### 2. Take the details out, and use what's left as the title
Parse the sentence into fields, **remove each matched phrase from the text**, and use the remainder (tidied, first letter capitalised) as the title. Never put the whole sentence in the title.

Example: "7pm Today Aguarela II with Joaquim until 10pm repeat every week, remind 1 hour before" →
- Title: Aguarela II
- When: Today, Mon 2 Nov, 19:00–22:00
- How long: 3 hours
- Repeats: Every week, on Mondays
- Remind me: An hour before, at 18:00
- With: Joaquim
- Space: Art

What to recognise (use an LLM pass with a structured output schema; the prototype's regex is only a stand-in):
- **Time ranges:** "7pm until 10pm", "9–11am", "from 3 to 5"; a single time ("at 9am"); and an end time alone ("until 10").
- **Days:** today, tonight, tomorrow, weekdays (meaning the next one), and dates.
- **Repeats:** "every week", "weekly", "every Monday", "every other Friday", "daily", "monthly".
- **Reminders:** "remind me 30 minutes / an hour / 2 hours before". Show the clock time too.
- **People:** "with Joaquim", "with Ana and Rui", matched to contacts and offered an invite (never sent automatically).
- **Space:** from keywords plus history (e.g. "Aguarela" → Art).

### 3. Every detail shows where it came from
Each field is a labelled tile: an uppercase label, the value in Cormorant 24, and **a gold source line** beneath: "From your words" · "Like your last two visits" · "Your calls usually take this" · "From your contacts" · "Where the dentist usually goes". Tap a value to change it.

### 4. Never invent a duration
- Duration comes **only** from the words (a range or "for 2 hours") **or** from history for the same kind of thing ("Piano – 45 minutes, like last Monday").
- Otherwise show the question "How long?" with quick picks (15m · 30m · 1h · 2h · Open-ended, or Skip for tasks).
- The same goes for any missing required field: ask with picks rather than filling in a default.
- **Tasks always ask "How soon?" (First · Soon · Whenever)** unless the words say so. Robin works by priority, not due dates.

### 5. Sequences become a short plan
If the sentence chains actions ("pick up Maya, take her to piano, then dinner"), show **"Three things, one afternoon"** as a list of steps. Each step has a time, a title, a source and a duration (or a question). Start times come from known facts (school finish time, a recurring lesson).
- **Travel:** offer it as a question ("About 15 minutes from school to piano?" Yes / No), never added silently.
- **Save as:** three events · one block · a task list.

### 6. The honest fallback
**Just set it down** saves the words exactly as typed to an Inbox to sort later. It's also the default when nothing is recognised. Nothing is ever filed wrongly.

### 7. Learning
Remember corrections and answers: kind overrides for similar phrases, durations ("piano is 45 minutes"), and Spaces for keywords. Next time, show the answer with its source ("45m, like last week").

### Footer
On the left, a quiet one-line explanation of what it did. On the right, a gold button whose label names the action (Add to calendar ↵ · Set down as a task ↵ · Start the draft ↵ · Add three events ↵). After saving, show a one-line confirmation: "Done. Change any of it from where it landed."

## 28. Back link (V18)

The old boxed back arrow comes back as **plain text at the start of the slim location line** (the unboxed line agreed in §19, option a).

- **Format:** `← Mail · Message from Priya`, with the arrow in gold and the parent's name as a Jost 14 link in muted ink (gold on hover), then a · and the current item in ink. **No box, no button, no icon-only arrow.** The link always names where it goes.
- **When it shows:** only on pages deeper than a group's top level: an open message, note, task card, goal, event, Space sub-page, settings sub-page, and so on. Top-level pages (Today, Mail, Notes, a group's first page) **don't show it**.
- **Where it goes:** always to the **logical parent** (Message → Mail, Note → Notes or the note's parent page, Task → Tasks, nested note → its parent note), not browser history. That way it's predictable even after arriving from Find, a link or a notification. The browser back button still works as usual.
- **Keyboard:** Esc on a deep page (with no drawer or popover open) does the same as the link. Alt+← also works.
- **Mobile:** `‹ Mail` at the top left of every deep screen, Jost 15, with a tap target of at least 44px. It replaces the screen title's left slot, and the group name moves to the centre.
- **Don't** bring back "+ New" in this line; ⌘N and the Set something down tab cover that.

## 29. Space page v2 (V19)

Reference: `Koyeba Space v2.dc.html` (Art as the example). **This supersedes §20's Space layout.**

### Spaces have no colour
Remove per-Space colours everywhere (chips, dots, bars, accents). A Space is identified by its **name, numeral (Space III) and vision line**. Gold stays the single accent.

### Structure, top to bottom
1. **Location line:** `← Spaces · Art` (§28).
2. **Heading:** an eyebrow "Space III" with a gold keyline; the name in Cormorant 300 at `clamp(80px,9vw,128px)`; the vision as one italic line; and on the right, four quiet figures (Cormorant 40 plus a muted label): Tonight · First tasks · Waiting on you · Nearest goal.
3. **What matters now** (open by default): **a 2–3 sentence summary in Koyeba's voice** (Cormorant 26–32), with the single most important thing in gold. Then up to four rows, each with a kind (Event / Mail / Task / Goal), a title, **why it's here** ("Waiting on you for four days") and one action (Open · Reply · Start · See it). This is the Space-level "What next" (§16).
4. **Notes** (open by default, the most prominent section; **no dates shown**):
   - "Look through {Space} notes…" filters titles and text live. If nothing matches, it points to Search.
   - A view switch, **By group · A to Z**, and "+ New note".
   - **Pinned** shows first, as one full-width line: the title plus the opening words in italics.
   - **By group** is a grid of columns (`repeat(auto-fill,minmax(270px,1fr))`). Each group has its name in Cormorant 26 with a count over a 1px gold rule, then its notes as a title (Cormorant 23) with two lines of excerpt. Child pages are indented with └. "+ Add to {group}" sits at the foot of each column.
   - **A to Z** is a two-column list of titles, each with its group name.
5. **Organising notes:**
   - Each note belongs to one Space. Within a Space, notes sit in **groups**: just names, one level, with no folders inside folders.
   - Pages can sit one level inside other pages.
   - Ungrouped notes go in **Loose**.
   - Koyeba may suggest a grouping, quietly and once per pattern ("The three loose notes look like Technique. Put them together?" Group them · Not now). **It never moves notes without asking.**
6. **Recent:** everything from the Space across Notes, Tasks, Mail, Events and Files, newest first, grouped Today / Yesterday / This week / Earlier.
   - Each row has a kind, a title in Cormorant 23, a one-line excerpt and a time.
   - **A 6px gold dot marks items new since the last visit**, with "{n} new since {day}" next to the title.
   - Filter by kind: All · Notes · Tasks · Mail · Events · Files, with counts.
7. **Open tasks** (folded, with a summary like "2 first · 3 soon · 4 whenever") and **Goals** (folded, with progress lines).
8. **Right column (sticky, each panel folds):** **Coming up** · **People** (anyone waiting on you shown in gold) · **Kept here** (pinned notes, files, links).

## 30. Goal page (V19)

Reference: `Koyeba Goal.dc.html` (night by default). **This replaces the boxed goal page.**

### Remove
- The boxed card, the pink Space colour (Spaces have no colour), the "ACTIVE" tag (only show a status when a goal isn't active), the emoji darts, the "+ Add Space" dropdown, and "Pick a date" as a boxed button.
- The separate Tasks / Connected notes / Connected contacts / Web links / Connected boxes, the Notes wall box, and the boxed "+ New" and "Delete".

### Structure
1. **Location line:** `← Goals · {goal title}` (§28).
2. **Heading:**
   - An eyebrow "Goal · {Space} · {period}" with a gold keyline, then the star (a 9px gold square plus "Starred" / "Star").
   - The title in Cormorant 300 at `clamp(52px,5.6vw,88px)`, with balanced wrapping.
3. **Progress:**
   - A large % (Cormorant 64) with a quiet note: "Drag the slider", changing to "Let go to set it" while dragging.
   - Below it, **a slider**: a 1px track, a 3px gold fill, faint ticks at 25 / 50 / 75, and **a 14px square gold handle**. The handle grows 1.25× while dragging and snaps to 5%. It can be dragged with pointer or touch (pointer capture), and tapping the track jumps to that point. Arrow keys move it in 5% steps when focused.
   - **Progress is always set by hand. There is no Measure choice and no automatic progress from steps.**
   - "Mark achieved" sits at the right (it sets 100%).
   - To the right of all this, two quiet figures: days left (with the date beneath) and steps to go.
4. **On your radar** (optional, one at most): a `--k-soft` band with a gold eyebrow on its own line, one italic sentence that surfaces something relevant ("Seikuji's winter sesshin runs 7–13 December – before your deadline. Hold the week?"), and **Hold it · Not now**.
5. **Folding sections** (Cormorant 36 titles, with a summary when closed):
   - **Why this matters:** an unboxed textarea in Cormorant italic 24–29.
   - **How I'll get there:** a checklist of steps. Each row has a 10px gold square, a title in Cormorant 24, an optional muted line, and its priority on the right (First in gold). Each step **is a task** in the goal's Space. Add a step with a borderless "+" input.
   - **Thinking:** replaces the Notes wall. An "Add a thought…" input, then dated thoughts, newest first.
   - **Timing and settings** (folded by default): Deadline (End of quarter · Pick a date · None) · Check in (Weekly review · Monthly review · Never) · Remind me · Spaces. All are word choices. "Delete this goal…" is a gold text link at the end, and asks for confirmation.
6. **Right column (sticky): Connected.** One list grouped as People · Events · Notes · Links, each item a Cormorant 21 title with a muted detail, then a single "+ Connect a note, person, event or link…" that takes a pasted link or a typed name.

## 31. Notepad moves into Set something down (V19)

Reference: `Koyeba Set Down v2.dc.html`. **Remove the floating Notepad button in the bottom-left corner, and its popover, everywhere.** The Set something down tab at the bottom centre is the only floating element.

- **The drawer has two words at the top** in place of the old "Set something down" eyebrow: **Set down ⌘.** · **Notepad ⌘J**. They're uppercase Jost 10.5 with wide tracking; the active one is gold with a 1px gold underline, the other is ivory at 60%.
- **Set down** works as described in §27.
- **Notepad** is a plain scratch page. It is **never parsed, guessed at or filed**.
  - A borderless textarea in Cormorant 22–27, line height 1.5, autosaving as you type.
  - A footer line: "Kept as you write · {last edited}", plus two text links: **Set the selected line down →** (sends the selected line, or the first line, to Set down for parsing) and **Clear the page** (asks for confirmation).
- **The drawer remembers which mode was used last.** ⌘. always opens Set down, and ⌘J always opens Notepad.
- **On Today:** a quiet "Notepad" line showing its first few words. Tap it to open the drawer in Notepad.
- **On mobile:** the gold + square opens the same sheet, with the same two words at the top.
- The notepad's contents carry over from the existing Notepad feature; don't lose anything in the move.

## 32. Flow and Practices go into Plans (V19)

Both fell out of the navigation when it was regrouped into six groups. They go back in under **Plans → Soon**, which now reads:
**Calendar · Tasks · Practices · Discover · Flow**

- **Flow** is the day planner: it shapes today around a few chosen things. It sits at the end of the row (V23). Live line: "Today, planned around three things", or "Not planned yet".
- **Practices** are repeating things Robin wants to do (sitting, Chi Kung, drawing, Portuguese), which makes them **close cousins of tasks, not part of Inner life**. They sit next to Tasks, with a live line ("Two still to do today") and a gold count of what's left today.
  - Remove Practices from Inner life wherever it appears. The Settings group formerly called "Reflection practices" is now **Reflection tools** (V22), so "Practices" only ever means repeating habits.
  - On Today, any practices due appear in the "Today" list, ticked off the same way as tasks.
- Plans now has three rows: **Soon** (5) · **Further off** (Goals · Bucket list) · **Looking back** (the reviews).
- The same order applies in Menu and on mobile.

## 33. Messages (V20)

Reference: `Koyeba Messages.dc.html` (night by default). **This replaces the boxed list and the side drawer over a greyed-out page.**

### Remove
- The full-width boxed rows, the initial squares, the dimmed page with a drawer, boxed message bubbles, solid gold blocks for my messages, the emoji button, the boxed input and the big gold "Send" button.

### Layout
- **One page, two columns:** the list `minmax(280px,400px)` and the conversation `minmax(0,1fr)`, separated by a 1px keyline.
- The page is `100vh`. **Each column scrolls on its own**; the page itself doesn't scroll.
- Below about 900px it becomes list → conversation, with `‹ Messages` as the back link (§28).

### The list
- The eyebrow "Conversations", then "Messages" in Cormorant 64.
- "Look for a person or a word…" (an underlined input that searches names and message text), with "+ New" on the right.
- **Two groups:** **Waiting on you** (their message is last and unread) and **Everyone else**, each an uppercase label with a count and a keyline.
- **Each row:**
  - A 6px gold square when unread, the name in Cormorant 24 (weight 500 when unread, otherwise 300), the time (gold when unread), and one line of the last message ("You: …" when it's mine).
  - The selected row has a `--k-soft` background. No avatars and no boxes.
- Opening a conversation marks it read.

### The conversation
- **Header:**
  - The name in Cormorant 48, then the presence: a 6px round dot (gold) with "Here now", or a keyline-coloured dot with "Seen {when}".
  - On the right, muted text links: "In {Space}" · Contact · Mute.
- **Messages:**
  - **Theirs:** plain Jost 17/1.5 on the page, with no fill.
  - **Mine:** right-aligned with a soft fill (`--k-mine`: day `oklch(0.92 0.03 82)`, night `oklch(0.31 0.04 150)`), padding 10px 16px, square corners. Never solid gold.
  - Maximum width min(560px, 80%).
- **Runs:** consecutive messages from the same person are grouped. The name and time appear once, above the first ("PETER · 21:02", uppercase Jost 11 muted). Gaps are 6px inside a run and 18px between runs.
- **Day dividers:** a centred uppercase label ("THURSDAY") between keylines.
- **Writing:** "{name} is writing…" in Cormorant italic.
- **Auto-scroll:** the thread starts at the bottom and stays there when new messages arrive.

### Writing
- An underlined input, "Write to {name}…", in Cormorant 24, then **Send ↵** as gold text (muted when empty). **Enter sends; Shift+Enter makes a new line.**
- No emoji button; the system emoji keyboard works as usual.
- Below: "Turn the last message into **a task · a note · an event**". This hands the message text to Set something down (§27), with the kind already chosen.

### Notifications (Robin asked for this)
- New messages must notify reliably, without a refresh:
  - Use a realtime subscription (websocket or SSE), not polling-on-load.
  - Update the header's Conversations count and the list immediately.
  - Show the in-app toast from §14 when the conversation isn't open.
  - Send a system or push notification when the tab is in the background (ask for permission once, in Settings → Notifications).
- **Test with two accounts.** Peter reported he only got notified after refreshing.

## 34. Contacts and Keep in touch (V21)

Reference: `Koyeba Contacts.dc.html`. This replaces both the old contact card and the separate (now missing) Keep in touch page, **which becomes a view inside Contacts**.

- **Layout:** the same two-column, `100vh` layout as Messages (§33). The list sits on the left at `minmax(300px,420px)`, the card on the right, each scrolling on its own.
- **List views,** shown as five numbers with labels across the top (the selected one has a gold underline): **Keep in touch** (the default) · **Starred** · **Recent** · **On Koyeba** · **All**.
  - **Keep in touch:** a muted italic line explaining it, then **Now** (due today, tomorrow or overdue, in gold) and **Coming up**, soonest first. Each row says "Last in touch {ago}".
  - **Recent:** This week, then Earlier, by the last contact of any kind (message, mail, call, event).
  - **On Koyeba:** **Here now** first, then the rest.
  - **All:** A–Z, with letter headings.
  - **Rows:** a 7px gold square if starred, the name in Cormorant 23, a value on the right (when, or when due), and the Spaces on a muted line beneath. **No avatars, no colours, no boxes.**
- **Card:**
  - An eyebrow "Contact · {first Space}" with the star, then the name in Cormorant `clamp(52px,5vw,76px)`.
  - "On Koyeba · here now" with a presence dot, and "In {Spaces}".
  - **Actions as one row of words between keylines:** Message (gold, first) · Email · Call · WhatsApp · Directions, or "Invite to Koyeba" if they aren't on it. Only show what's possible. **No icon tiles.**
  - **Keep in touch,** in a `--k-soft` band:
    - One sentence in Cormorant 24–29 ("You were last in touch 6 days ago. Koyeba will nudge you tomorrow.").
    - The frequency as words: Every week · Fortnight · Month · Quarter · Off.
    - **I've just been in touch** on the right.
    - **The clock restarts on any contact:** a message, mail, call log or shared event.
  - **Coming up:** the next birthday ("turns 52 in 179 days") and "Remind me a week before".
  - **Folding sections:**
    - **Details:** an uppercase label column with values; Copy on the right; Map · Directions under an address.
    - **Together:** messages, mail, events and notes involving them, with "Start a note · a task · an event · + Connect something".
    - **Notes to self:** an unboxed italic textarea.
    - **Spaces and settings:** Spaces, + Add a Space, Edit details · Merge with… · Delete contact… (asks for confirmation).
- **Nudges** appear on Today under *Keep in touch* and in What next (§16). They never appear as system notifications.

## 35. Reflections on Today (V21)

**Rename the Today section "A reading" to "Reflections".** It folds like every other section.

- **What goes in it:** anything drawn or cast today: a Spirit card, an I Ching reading, the horoscope, the Compass check-in, and a journal question if one was offered.
- **Each one stays for the day.** It appears when you do the reading and stays until the next morning, or until you put it away. Then it lives on in its tool's history. This brings back the old "stays until I close it" behaviour, but moves it out of the top of the page.
- **Rows:**
  - An uppercase kind label (Spirit card · I Ching · Horoscope), then the title in Cormorant 23 ("Wonder", "噬嗑 Biting Through → Innocence", "Taurus, Monday"), then one italic line.
  - On the right, **Open** (gold) and **Put away** (muted text). **No ×.**
- **Header:** "Reflections" plus a count ("3 today"). When folded, it shows a one-line summary ("Wonder · Biting Through · Today's horoscope").
- **Empty state:** one muted italic line, "Nothing drawn yet today", followed by "Draw a card · Cast the coins · Today's horoscope" as gold links.
- **Order:** newest first. It sits after What next and the day's list, never at the very top.

## 36. Journal (V21)

Reference: `Koyeba Journal.dc.html`.

- **Remove:** the 20 boxed prompt rows shown all at once, the boxed entry cards, the coloured kind chips, and the duplicate entries (16 Aug appears twice and overlaps; fix the data or the rendering).
- **Today's page sits at the top, open,** under an ink keyline.
  - "Start with" (muted label, no wrapping) offers six kinds as words: Free write · Reflect on the day · Gratitude · Work through something · Set an intention · A dream.
  - **Only one question shows at a time,** in gold Cormorant italic 26–34, with "Another question · 2 of 4" to cycle through the others. Free write shows its one-line description instead.
  - The writing area is an unboxed textarea in Cormorant 23–27, line height 1.6, autosaving.
  - **Footer:** a live status ("Kept as you write · 42 words"), Speak, and **Keep this page ↵** in gold text.
- **Your pages:**
  - A title with a count, "Look through your pages…" (searches the text), and filters by kind.
  - Pages are grouped by month, and each month folds.
  - **Each page:** the date (Jost 13, weight 500), the kind as muted text, and the text in Cormorant 22 clamped to two lines. Click to expand it in place.
- **Right column (sticky, folding):**
  - **On this day:** a month ago and three months ago.
  - **What keeps coming up:** recurring themes with page counts, each with a gentle one-line observation. It's never diagnostic.
  - Then "Only you can read these pages."

## 37. I Ching (V21)

Reference: `Koyeba I Ching.dc.html`.

- **Remove:** the narrow centred card, the yin-yang icon, the small boxed input, the doubled "Past readings" header, the boxed rows with ×, and bold Jost names.
- **Left (main):**
  - The title and an italic instruction.
  - **One large underlined question input** ("What would you like to understand?", Cormorant 26–34).
- **Casting is six real throws.** One click means one line. Each line is a 10px bar: solid for yang, broken for yin. **Lines build from the bottom up. Changing lines (6 and 9) are gold.**
  - Each throw's coins are described in words ("Heads, tails, tails – a young yang line").
  - The button reads "Cast the coins", then "Cast line 2 of 6", and so on. "Start again" appears once casting has begun.
  - The lines column and the text sit side by side when there's room, and stack when there isn't (`repeat(auto-fit,minmax(min(100%,220px),1fr))`).
- **The reading:**
  - The characters in Cormorant 64, with "Hexagram 21" beside them, the name in Cormorant 40, then the judgement in italics.
  - Then the changing line(s) under a keyline, then **Becoming:** the second hexagram with its name and one line.
  - Actions: Write about it in the Journal · Ask the companion · Cast again.
  - The reading is saved automatically and appears in Reflections on Today (§35).
- **Right (sticky): Past readings,** grouped by month, each month folding.
  - Each row: the characters (`white-space:nowrap`, min 56px), the name "A → B" in Cormorant 21, the date, and the question in italics if there was one.

## 38. Tarot (V22)

Reference: `Koyeba Tarot.dc.html` (night by default). **A new tool: Reflection X**, after Horoscope VIII and Insights IX. Add it to the Reflection menu panel and to Settings → Reflection tools.

- **Tone:** "Not a forecast – a mirror." Never predictive or fatalistic. Readings are offered as pictures to think with.
- **Top of the page:**
  - The question on one underlined line ("What's on your mind?", Cormorant 26–34).
  - **Spread** as words: One card (Today) · Three cards (Behind you · Where you stand · Coming into view) · The cross, five cards (The heart of it · What crosses it · Beneath · Advice · Where it leans).
  - A gold **Shuffle and draw** button.
- **The table:** a forest-green surface (`oklch(0.28 0.04 155)`), with the cards **in one row that never wraps**. Each card column is `flex:1 1 0; min-width:0; max-width:230px` (170px for five cards).
- **Card back** (shared with Spirit cards):
  - `oklch(0.22 0.035 158)`, with a fine gold lattice made of two `repeating-linear-gradient`s at ±45° (gold at 8% opacity, 1px lines every 14–16px).
  - A 1px gold border at 70% and an inset 1px gold outline at 35%, offset −8 to −10px.
  - The Mandombe "ko" mark in ivory, centred, at about 34% of the card width.
- **Card front** (the Spirit card family):
  - Ivory, with a 1px gold border and an inset outline.
  - The numeral in gold italic at the top, the generated composition in the middle (a horizon line, one or two fine gold circles, sometimes a faint wash, and the initial in gold italic), and the name at the bottom.
  - **Reversed cards are drawn rotated 180°.**
- **Turning:** each card is turned by the user, one at a time, with a 3D flip (0.9s). Under each card are its position (uppercase gold) and "Tap to turn", then "Upright" or "Reversed".
- **Deck:** the 22 Major Arcana, each with a keyword, an upright reading and a reversed reading (see the data in the reference; refine the wording, but keep it plain and kind). Reversed comes up about 25% of the time.
- **The reading builds as cards turn.** Each card gets a row: its position and what that position asks, the name, the orientation and keyword, and the reading in Cormorant italic 23.
- **Read together:** when all cards are turned, a `--k-soft` band with a synthesis in Cormorant 24–30. Use an LLM with the question, the positions and the cards; the template in the reference is only a stand-in.
  - Then "A question to sit with: …", and Write about it in the Journal · Ask the companion · Draw again.
- **Saving:** the spread is saved automatically, with its question, and appears in Reflections on Today (§35).
- **Right column (sticky):** **Past spreads** (kind, date, cards and question; labels and dates don't wrap), then **Keeps turning up** (a card that recurs, and when).

### Spirit card back updated
The Spirit card back (`Koyeba Reflection.dc.html`) now uses **the same back as Tarot**: deep forest with the gold lattice, the gold border and inset outline, and the Mandombe mark. Keep its small uppercase label under the mark.

## 39. Quote of the day (V23)

The quote of the day comes back as **a quiet closing line on Today**, a small reward for reaching the end of the page. It never goes in the header or the greeting.

- **Where:** at the very end of Today, **above the large Mandombe mark** that takes you back to the top. On mobile it sits in the same place, above the mark.
- **Look:**
  - A 28px gold keyline, centred.
  - The quote in Cormorant italic 300, `clamp(26px,2.6vw,34px)/1.4`, with `text-wrap:balance`, at a maximum width of 720px.
  - The author underneath in uppercase Jost 10.5 with wide tracking, muted.
  - A small "Keep it" (muted) that changes to "Kept in your Notes" (gold) and saves the quote to a "Quotes I've kept" note.
  - No box, no icon, no "Quote of the day" label.
- **Rules:**
  - **One quote a day,** the same on every device, changing at local midnight.
  - Drawn from the Admin quote pool (§40). No repeats within 90 days.
  - There's no "another one" button; that's what keeps it special.
- **Also on Reflection → Overview:** the same quote, in the same style, at the top of the page under the title.
- **Settings:** "A daily quote" (Notifications, §26) switches it off in both places.

## 40. Admin (V23)

Reference: `Koyeba Admin.dc.html`. **This replaces the seven boxed tabs.** It uses the same pattern as Settings (§26): one page, folding sections, and a sticky index on the right that hides below 1100px.

### Remove
- The boxed tab bar, the per-tab headings, gold "Premium Plus" blocks, green "online now", green "ALL UP" / "UP" badges, the checkbox, boxed inputs with filled "Add" buttons, and × on every quote.
- **The outdated Brand tab:** the octagram icons, the "Lb." Lifebook icons, and the four near-identical golds.

### Top
- The eyebrow "Only you and Peter see this", "Admin" in Cormorant 64–96, and **one sentence that sums up the state** ("Everything is running. One person is waiting to join.").
- Then four figures between keylines: Members · Here this week · This month so far · Services.

### Sections (numerals, Cormorant titles, a one-line summary when folded)
1. **Members:**
   - Views as number plus label, each on one line: Here today · This week · This month · Everyone · Gone quiet (30+ days) · Invited. Then "+ Invite someone" in gold text.
   - **Rows:** a round gold presence dot when here now; the name in Cormorant 24 (no wrapping, ellipsis); the handle; when they were last here (gold "here now"); then a muted line with the plan as plain text and "joined {date}".
   - **Join requests** sit inline, with Let them in · Not now.
   - **Invited** rows show "Resend · Copy link · Cancel".
2. **Feedback:** the message in Cormorant italic, who sent it and from which Guide page, when, and Reply · Make a task · Done. Empty state: one muted line.
3. **Running costs:**
   - This month as a large figure, with the AI and hosting split.
   - Then a row per month: an 8px bar with hosting (keyline colour) and AI (gold) side by side, and the total in Cormorant.
   - A legend underneath.
4. **Health:**
   - One sentence ("All four services are up. Last checked 5 minutes ago.").
   - One row per service: a 7px gold square when up, the name and provider, and the state in words. **When something is down, the state reads "Down since 14:20" in gold text.** No green, no red.
   - "Check now" as a text link.
5. **Setup:**
   - Who can join (Invite-only · Open) and New accounts start with (No Spaces · a preset · Choose…), as word choices.
   - **Hidden for now:** each hidden part with what it is, when it was hidden, and "Bring it back".
6. **Quotes:**
   - Underlined inputs for the quote (Cormorant italic) and who said it, with "Add ↵".
   - The list shows each quote in Cormorant italic in quotation marks, the author, and a quiet "Remove".
   - "Show all {n}". This is the pool for the quote of the day (§39).
7. **Brand:**
   - The Mandombe mark with the wordmark, the four real colours (ivory, forest, ink, gold), and links to the Brand Pack and "Download all files".
   - **Replace every app icon, favicon and touch icon with the Mandombe mark versions from the Brand Pack.**

## 41. Today v2 (V23)

Reference: `Koyeba Today v2.dc.html`. **This is the current Today, and it supersedes Today in `Koyeba App.dc.html`.** It brings together §15–§17, §31, §35 and §39.

1. **Header (§17)** with Night/Day.
2. **Greeting:**
   - The date as a gold eyebrow, then "Good evening, Robin." in Cormorant `clamp(60px,6.4vw,100px)`.
   - Then one italic line for the time of day ("The day is drawing in.").
   - **Nothing else goes in the greeting:** no Mandombe mark, no quote.
3. **What next (§16):**
   - A forest-green band with the gold uppercase label "What next" and **one suggestion** in Cormorant 28–36.
   - "Why this?" reveals the reasoning in italics.
   - A gold action button named for the action ("Write to Marta"), "Not today" (which moves on to the next suggestion), and a quiet "Then: …" that doesn't wrap.
4. **The day** (open):
   - Grouped as Earlier · This evening · Anytime today.
   - Each row: the time (or "First" in gold for top-priority tasks), a 9px gold square for tasks and practices (tick it to strike it through), the title in Cormorant 23, a muted note, and the Space on the right.
   - **Events have no square.** Practices (§32) appear here and are ticked like tasks.
   - Summary when folded: "{n} still to tick · {n} practices · Aguarela at seven".
5. **Reflections (§35).**
6. **Keep in touch** (folded by default): who's due, with why ("two weeks – longer than you'd like", in gold when overdue), the right action (Call / Message / Reply), and Done.
7. **Notepad (§31):** one quiet line with the first words in italics and "Open ⌘J".
8. **The quote of the day (§39),** then **the large Mandombe mark**, which scrolls back to the top.
9. **Set something down:** the small folded tab, fixed at the bottom centre (§27).

**Two columns.** Items 3–7 sit in a main column `minmax(0,1fr)`. Beside them is a sticky **Your Spaces** column (`minmax(300px,400px)`), which stacks below the main column under 1000px.
- **Header:** "Your Spaces", a count ("7 · 2 need you", no wrapping), "All →".
- **Each Space:** its numeral, the name in Cormorant 25, a 6px gold square if it needs you, and +/−. Under that, one live line, in gold when it needs you.
- **Unfolding a Space** shows its top 2–3 items (with their kind) and "Open {Space} →".
- "+ New Space" sits at the foot.
- The quote and the Mandombe mark stay full width below both columns.

## 42. Birthday reminders (V23)

- **Where they show:**
  1. **Today:** a **Birthdays** group at the top of The day ("Tomorrow · Katarina's birthday · turns 40 · message her, or send a card"), appearing as many days ahead as that person's reminder is set.
  2. **What next** (§16) on the day itself, if you haven't been in touch yet.
  3. **Calendar** as an all-day line.
  4. **A notification** at 09:00 on the reminder day, the one time Keep in touch sends a system notification.
- **The usual setting:** Settings → Notifications → **Birthday reminders**: On the day · **A day before** (default) · A week before · Off.
- **Per person:** on the contact card under "Coming up", **Remind me**: On the day · 1 day before · 3 days · A week · Off. Show "your usual" when it matches the Settings value, otherwise "just for {name}". This overrides the usual setting for that person only.
- **Needs a birthday:** if a contact has none, show "Add a birthday" in Details. Import birthdays from vCards and Google Contacts.

## 43. New mail, quickly (V23)

Reference: `Koyeba Today v2.dc.html`. New mail should be **noticed in a glance and dealt with in one move**, without leaving the page. **This applies on every page, not just Today.**

### 1. "Mail" in the header
- It sits just before Search.
- When anything is new, show the count beside it in **Cormorant italic 19, gold text**. No badge, circle or pill.
- When nothing is new, show just the word, muted.
- **Click it, or press ⌘E, to open the sheet.** While the sheet is open, "Mail" turns ink with a gold underline.

### 2. The arrival line
- **When a new email arrives while the user is in the app,** one line slides in just under the header (`kfade`, 0.6s): a 6px round gold dot, then in Cormorant italic 21, "A letter from {name}, {organisation} – "{subject}"".
- **Read it** (gold) opens the sheet with that email already open. **Later** (muted) files it as Read later.
- **Show only one line at a time.** If more arrive, it becomes "Three new letters – Marta, Mrs Okafor and Joaquim".
- **It disappears once the sheet has been opened.**
- **Quiet by default:** no sound, no toast, no pop-up. A system notification only for senders marked "Let through" (§33).

### 3. The "New since you looked" sheet
- It drops down under the header across the full width, on `--k-soft` with a keyline beneath. It pushes the page down and doesn't cover it.
- **Header:**
  - "New since you looked" in Cormorant 34, not wrapping.
  - A muted count ("3 new · sort each one, or open it").
  - On the right: **Open Mail →** (gold) · **Fold away** (muted). Esc also closes it.
- **One row per new email:**
  - A 6px gold dot if it arrived since the last look.
  - The sender in Cormorant 23.
  - The subject in Jost 15, then the first words in muted text, on one line with an ellipsis.
  - The time on the right, in gold if it's new.
- **Click a row to read it in place:**
  - The text in Cormorant italic 22, max 760px.
  - Then one row of words:
    - **Reply** (gold)
    - a 1px divider, then **Urgent · Important · Read later** (the triage piles, §24)
    - a divider, then **Make a task · Add as event · Keep as note** (§24).
  - No buttons, no icons.
- **Triaging an email removes it from the sheet,** and the header count drops.
- **When all are sorted:** "All sorted. Nothing new since {time}." in muted Cormorant italic.

### Mobile
- **"Mail" with its count is the first item in the bottom row's People group** (§17).
- **The arrival line** sits above the bottom row.
- **The sheet** becomes a bottom sheet with the same rows and actions.

## 44. What next becomes something you ask (V24)

**What next is no longer the first thing on Today.** It's a tool the user reaches for, which supersedes the "front and centre" placement in §16 and §41.

- **On Today, where the band was:** one quiet line, a 7px gold-outlined square and, in Cormorant italic 26, **"What should I do next?"**, with ⌘/ on the right, all above a keyline.
- **Click it, or press ⌘/ anywhere,** and the forest-green band from §16 unfolds beneath it (`kfade`, 0.45s). It holds the same single suggestion, with Why this?, the action button, Not today, and Then.
  - While it's open, the line reads "Fold it away" and the square fills gold.
  - Doing the action folds it away again.
- **Starts folded every time.** Nothing is pre-computed onto the screen.
- **It's also reachable from:**
  - Search, by typing "next" or "what now".
  - The Set something down drawer, as a quiet "What should I do next?" link under the start list.
  - Plans → Soon, as a tool named **What next**, after Flow.
- **Unchanged:** birthdays and the What next logic (§16, §42). Only the placement changes.

## 45. Tomorrow, in one click (V24)

- **On Today, beside the "The day" title:** two words, **Today · Tomorrow**. The chosen one is in ink with a gold underline. Clicking one swaps the list in place (no page change) and opens the fold if it's closed.
- **Tomorrow's list** uses the same rows and groups (Birthdays · Morning · Afternoon · Evening · Anytime): events with the place or a note, tasks due tomorrow, and practices due tomorrow.
  - The title reads "Tomorrow", and the summary says "Tue 3 Nov · four things in the diary · {birthday}".
  - Travel or preparation notes go in the muted note ("then piano at 16:00, home by 17:15").
- **The T key** (when not typing) toggles Today and Tomorrow.
- **After 18:00, show a quiet line at the foot of the day list:** "Tomorrow starts with Zazen at 07:30 – see it all". Clicking it switches to Tomorrow.
- **Mobile:** the same two words sit above the day list. Swiping left on the list shows Tomorrow.
- **Further ahead stays in Calendar.** Don't add "This week" here; two words is the point.

## 46. Your Spaces: only the lively ones (V24)

The Your Spaces column on Today (§41) **doesn't list every Space.**

- **Order:** Spaces that need you come first (something overdue, waiting on a reply, or due today), then the rest by **most recent activity**: mail, messages, notes, tasks or events touched.
- **Show the first 8.** Then one line: **"All {n} Spaces →"** (gold), with "{n} quieter ones live there" muted beside it. **It goes to the Spaces home page.** It doesn't expand in place.
- **A Space with no activity for 30 days or more is never in the first 8**, unless it needs you.
- **The heading count shows all of them:** "18 · 2 need you". There's no separate "All →" link; the line at the foot does that job.
- **Pinning:** on the full Spaces page, "Keep on Today" pins a Space into the 8 whatever its activity. Pinned Spaces count towards the 8.
- **On mobile:** show the first 5, then the same "All {n} Spaces →" line.
- **Never use a horizontal row or carousel** of Spaces on Today.

## 47. Notepad lives in the header (V24)

**This supersedes §31** (Notepad inside Set something down) **and the Notepad line on Today.**

- **Header:** the word **Notepad** sits between Mail and Search, muted. When the panel is open, it turns ink with a gold underline. No icon.
- **Click it, or press ⌘J anywhere,** and a panel slides in from the right.
  - It runs from under the header to the bottom of the screen, `min(440px,92vw)` wide, on `--k-bg` with a keyline on the left (this is the one place a soft shadow is allowed, because it floats over the page).
  - **The page stays usable behind it.** It's not a modal.
- **Inside:**
  - "Notepad" in Cormorant 34, a live status ("Kept as you write" / "Empty"), and "Close ⌘J".
  - Then an unboxed textarea in Cormorant 23, line height 1.6, filling the height. Placeholder: "Jot anything. It keeps until you clear it."
  - At the foot: **Make it a note** (gold) · Make it a task · **Clear** (muted, on the right).
- **Close it** with the word, ⌘J again, or Esc. The text is kept, so it reopens just as it was left.
- **There's only one notepad, synced across devices.** It's not a note in any Space until "Make it a note".
- **Mobile:** Notepad goes in the Menu footer and opens as a full-height sheet.
- **Don't** put a floating or draggable edge tab on the screen.

## 48. Contacts, simpler (V26) – supersedes §34

Reference: `Koyeba Contacts v2.dc.html`. **Plain contacts come first; Keep in touch is optional and quiet.**

### The Contacts page (a single column, max 1280px)
- **Top:** the "People" eyebrow, "Contacts" in Cormorant 60–92, the total count, and **+ New contact** (gold) · Import.
- **The search box comes first and is big:**
  - An unboxed input in Cormorant `clamp(28px,3vw,40px)` with a 1px ink rule beneath. Placeholder: "Search by name, place, email or Space".
  - It filters as you type and hides the card shelves while it's searching.
  - **No results:** "No one by that name." followed by "Add "{query}" as a new contact".
- **Card shelves** (when not searching): **Starred** (up to 8), then **Recently in touch** (6).
  - The grid is `repeat(auto-fill,minmax(200px,1fr))` with a 16px gap.
  - **Each card:** a 1px keyline border (gold on hover), square corners, no shadow. Inside: a 52px square with a gold keyline holding the initials in gold Cormorant italic; a 7px gold square in the corner if starred; the name in Cormorant 25 (no wrapping, ellipsis); "{Space} · {place}" muted.
  - Use a photo in place of the initials if the contact has one, cropped square.
- **Keep in touch** is **one quiet line** under the shelves, only when someone is due: a 6px gold square, "Five people you wanted to keep up with are due." in Cormorant italic, and **See who**.
  - See who unfolds the list in place. Each row: the name, "overdue by 1 day / today / tomorrow" in gold, and "Last in touch {ago}" muted, **on its own line**.
- **Everyone:** A–Z in CSS columns (`columns:3 280px`), with a gold italic letter for each heading. Each row: the name in Cormorant 22 (ellipsis) and the Space muted on the right. Sort by surname-independent display name, ignoring titles like "Mrs".
- **Remove:** the five-number view bar, Keep in touch as the default view, and every layout where the name and "Last in touch" share a line (the source of the overlapping text).

### A contact
- **Top:** "← Contacts · {name}" back line, the "Contact" eyebrow with Star on the right, the name in Cormorant 56–88, and "In {Spaces} · {place}".
- **Actions as words between keylines:** Message (gold) · Email · Call · WhatsApp · Directions. Show only what's possible.
- **Folding sections, in this order:**
  1. **Details** (open by default)
  2. **Birthday** (open if there is one), with Remind me (§42)
  3. **Together**
  4. **Keep in touch**
  5. **Notes to self**
- **Keep in touch on a contact:**
  - **Off by default for everyone.** Folded, it reads "Off".
  - The **fold state is remembered per contact**, so the user can close it for anyone.
  - When on, it shows the sentence, the frequency words (Every week · Fortnight · Month · Quarter · **Off**) and "I've just been in touch".
  - When off and opened, it shows "Off for {name}. Koyeba won't nudge you." and "Keep in touch with {name}" (which turns it on monthly).
  - **Choosing Off folds the section.**
- **Details rows:** an uppercase label, the value, and **Copy** or **Map** as text. **No icon tiles and no boxed copy buttons.**
- **At the foot:** Edit details · Merge with… · Delete contact…

## 49. On your radar – the feed for your life (V26)

**This supersedes the top of Today in §41 and §44.**

- **The first section on Today, straight after the greeting,** is **On your radar**: one folding section that's open by default. It brings together everything with a date or a nudge, from every tool.
  - **Overdue** (gold label): overdue tasks, missed reviews ("Your weekly review – due Sunday, a day late"), Keep in touch people who are overdue, and goals past their date.
  - **The next few days:** birthdays (§42), task deadlines, events that need something done (booking, RSVP, deposit), and bills.
  - **Further ahead:** goals with a deadline and progress ("due 31 Dec · 0 of 4 tasks"), the next monthly or quarterly review, and renewals (passport, insurance, MOT).
- **Each row:**
  - The kind as an uppercase muted label (Review · Task · Birthday · Deadline · Goal · Keep in touch · Renewal).
  - The text in Cormorant 23, with when it's due beside it (gold if overdue).
  - On the right, the obvious action (Do it now · Open · Send a message · Book · Make a task) and **Later** (muted). Later hides it until tomorrow.
  - The Space on a muted line beneath.
- **When folded,** it shows a summary in gold ("3 overdue · Katarina turns 40 tomorrow · weekly review"). When empty: "Nothing pressing. A clear run."
- **Order:** Overdue, then by date. **No more than 4 per group**, then "And 3 more".
- **Birthdays move here from The day.**
- **Keep in touch moves here too.** Remove the separate Keep in touch section from Today. Due and overdue people appear as rows of kind "Keep in touch" ("Ring Mum · two weeks – longer than you'd like · Call · Later", "Helena wrote on Tuesday · waiting for you · Reply"). Contacts keeps its own quiet line (§48).
- **The name is "On your radar".** Use it everywhere the feed is referred to (Today, mobile, Settings → Notifications).
- **What next is demoted** to one small muted italic line at the foot of this section, "Or ask: what should I do next?" (⌘/). It still opens the §16 band, now beneath it. Remove the big "What should I do next?" line from §44.
- **Under the greeting:** a keyline, then one row (max 760px, wrapping) with:
  - **the time**, live, in Cormorant 34;
  - **the temperature** in Cormorant 34 beside the conditions and place ("Clearing, Lisbon");
  - "Tomorrow 19° and bright", and "Sunset 17:24", both muted.
  Use the place from Settings, or the device location if the user allows it. There are no weather icons. If there's no weather, show just the time.
- **Today's order is now:** greeting → time and weather → + New and at a glance (§50) → On your radar → The day (Today · Tomorrow) → Reflections → Keep in touch → quote → mark, with Your Spaces in the right column.

## 50. "+ New" and the at-a-glance row (V26)

Reference: `Koyeba Today v2.dc.html`. On Today, straight under the time and weather and above On your radar, is **one row between an ink rule (top) and a keyline (bottom)**:

### "+ New" (left)
- **The one filled gold button on Today:** "+" plus "NEW" in uppercase Jost with wide tracking, and a small ▾.
- **Click opens a list** (300px, square corners, keyline border, the soft shadow allowed for floating panels). It holds numbered items in Cormorant 22: Note · Task · Event · Email · Message · Table · Goal · Journal page · Contact · Space · Review.
  - The first four show shortcuts (⌥N, ⌥T, ⌥E, ⌥M).
  - A footer reads "Or just write it – Set something down ⌘.".
- **Choosing an item** opens a blank one of that type. Esc or clicking outside closes the list.
- **It sits alongside Set something down, not in its place.** New is for when you know what you're making; Set something down is for when you'd rather just write.

### At a glance (the rest of the row)
- Words with live counts in gold Cormorant italic: **Mail 3 · Messages 2 · Tasks 13 · Calendar · Notes · Goals**.
- **One click unfolds a panel in place** under the row. It shows the top 3–4 items from that tool (title in Cormorant 23, context muted, when on the right) plus "Open {tool} →" and "Fold away".
- **Only one panel is open at a time;** clicking the same word again folds it.
- The open word turns ink with a 2px gold underline.
- **Mobile:** the row scrolls sideways and the panel opens beneath it. "+ New" stays first.

## 51. Mail in the header just opens Mail (V27) – supersedes §43.3

**Remove the "New mail" / "New since you looked" sheet entirely.** It repeated the Mail app badly.

- **"Mail {count}" in the header, and ⌘E, go straight to the Mail page** (§24), opened on **New** with the newest at the top.
- **The arrival line's "Read it"** opens Mail with that message open.
- **The quick view lives in one place only:** Mail in the At a glance row on Today (§50), showing at most 4.

### Hierarchy for every list of emails (Mail, At a glance, Search)
The screenshot reads as one size because sender, subject and preview all compete. Use three clear levels:
1. **Sender:** Jost 15, **weight 500**, ink, one line. Show the display name only. Never show raw addresses or "'x.com' via Name"; strip quotes and use the name.
2. **Subject:** Cormorant 22–23, ink, one line with an ellipsis. **This is the largest thing in the row.**
3. **Preview:** Jost 13.5, muted, **one line** with an ellipsis, maximum 90 characters.
- The time sits on the right in Jost 13, muted (gold if new).
- **Spacing:** 14px vertical padding per row, with a keyline between rows. No more than about 72px per row.
- **The triage words (Urgent · Important · Read later) appear only on hover or focus,** right-aligned in place of the time, **never on every row.** On touch, swipe left to reveal them.
- Unread rows get a 6px gold dot on the left; read rows don't.

### Clicking an item opens that item (this is a bug)
- **In At a glance, one click on any row unfolds it in place.** Mail shows the text (Cormorant italic 21), then **Reply** (gold) · Urgent · Important · Read later, then "Open this in Mail →" on the right. Tasks show Done · Tomorrow · Not today. Messages show Reply. Events, notes and goals show Open. Triaging a row removes it.
- **Every "Open … →" is a deep link to that exact item:** `/mail/{messageId}`, `/messages/{threadId}`, `/tasks/{id}`, `/notes/{id}`, `/calendar/{eventId}`, `/goals/{id}`. The page opens with that item selected and scrolled into view. **Never land on the tool's front page** when the user chose a specific thing. This applies everywhere: At a glance, On your radar, Search, the arrival line, notifications.
- In mail lists inside At a glance, the sender sits on top (Jost 14.5, weight 500) and the subject below it (Cormorant 22).

### Clean the text before showing it (this is a bug)
- **Decode properly.** Respect each part's charset and Content-Transfer-Encoding (quoted-printable and base64). Decode RFC 2047 headers. The "TradingÂ 212", "digressÃ£o" and "â€" junk in the screenshot comes from UTF-8 being read as Latin-1.
- **Previews come from the text part.** If there's only HTML, convert it to text. Strip zero-width and invisible characters (\u200B–\u200D, \u034F, \u00AD, \uFEFF), tracking pixels and leftover markup. Collapse whitespace. Strip a reply's quoted history ("On Sun, 1 Nov… wrote").
- **Subjects:** drop leading emoji and pictograph icons (the 📄 in the screenshot). Don't shout: if a subject is entirely in capitals and longer than 12 characters, show it in sentence case.

## 52. The Set something down tab must stay small (V28 – a bug)

The resting tab has grown again in the build. Fix it to these exact sizes and add a check, so it doesn't drift:
- **Resting:** `position:fixed; bottom:22px; left:50%; transform:translateX(-50%)`, with `padding:12px 20px` and a gap of 12px. It holds the "+" (Jost 300 20px, gold), "Set something down" (Cormorant italic 19px, 85% opacity) and "⌘ ." (Jost 500 10px, 55% opacity).
- **Total size:** about **44px tall and 260px wide.** It sizes to its content (`white-space:nowrap`, no width or min-width). Never use 100% width, fixed widths, or padding above 12px vertically.
- **It never covers content.** Every page gets `padding-bottom:120px`. While the user scrolls down, fade it to 40% opacity, and return it to full opacity on scroll up or hover.
- **It only grows when opened** (click or ⌘.), into the drawer (§15 and §27). Esc returns it to the tab.
- Add a quick automated check (Playwright or similar) that the resting tab's height stays at or below 48px and its width at or below 300px on every page.

## 53. A Space is everything about that part of life (V28) – supersedes §29

Reference: `Koyeba Space v3.dc.html`. **The point of a Space is to see all the mail, tasks, notes and events for that part of life. Vision and goals are optional extras.**

### Layout
- **Top:**
  - "← Spaces · {name}", the "Space {numeral}" eyebrow, and the name in Cormorant 64–108.
  - **The vision as one muted italic line, only if there is one.** No "What matters now" section, no "Nearest goal %" figure.
  - On the right: **+ Add to this Space** (gold) · ··· (rename, cover, archive).
- **Main column:**
  - Views as number plus label: **Everything · Mail · Tasks · Events · Notes**, with the count in Cormorant 34. "Look in this Space…" sits on the right of the same row.
  - **The default is Everything:** one stream, newest first, grouped **Today · This week · Earlier**.
- **Each row:**
  - The kind as an uppercase label (Mail in gold, the others muted).
  - For mail, the sender (Jost 14, weight 500); then the title in Cormorant 23, one line; then the context, muted, one line.
  - When it's due, on the right (gold if today).
- **One click unfolds a row in place,** with actions as words:
  - **Mail:** the text, Reply · Make a task · Add as event · Keep as note · Open in Mail →.
  - **Task:** Done · Tomorrow · Open in Tasks →.
  - **Event:** Open in Calendar → · Directions.
  - **Note:** the text, Open note → · Pin.
  - **"Not this Space"** sits on the right of every unfolded row.
- **No right column.** Under the title, a full-width folding strip, **Around this Space**, has three columns (auto-fit, min 240px): **Coming up** · **People** · **Goals · optional**. Each shows 2–3 compact rows and a "+ Add" or "Open goals →" link. When folded, it shows a one-line summary. The single column is max 1180px.
- **Remove:**
  - The What matters now section and the Nearest goal figure.
  - The Notes-first library (A–Z and groups move to Notes itself).
  - The separate Recent, Open tasks and Goals accordions, which the stream replaces.
  - The empty "Nothing coming up" boxes; just leave out empty sections.

### Filing must be right (this is the "random notes" bug)
- **Koyeba only files something into a Space automatically when it's confident** (a sender or contact linked to the Space, an explicit mention, or the user choosing it). Otherwise it goes in the Inbox, untouched. **Never file by vague keyword similarity.**
- **"Not this Space"** removes the item and confirms: "'{title}' is out of {Space}. Koyeba won't file things like it here again", with Undo. Learn from it: don't file that sender or that kind of note there again.
- **Sensitive notes** (passwords, account numbers): detect them and offer "This looks like a password – keep it in a locked note?" Never show the secret in previews, Recent, Search snippets or On your radar. Show "Locked note" instead.

## 54. Your Spaces on Today: the latest thing, then go (V28) – amends §46

- **No folding.** Each Space row is a link straight to its Space page.
- **Each row:** the numeral, the name, a 6px gold square if it needs you, and **when the latest thing happened**, on the right.
- **Under that, the single most recent item:** its kind as a small uppercase label, then the item ("MAIL · Marta – The show in March"). It's gold if it needs you. **Never "Nothing new".** A quiet Space shows its last item, however old.
- The first 8 by activity, then "All {n} Spaces →" (§46).

## 55. Type: readable first (V28) – supersedes the Cormorant-300-everywhere rule

Cormorant 300 is too thin for structure, so it's now for display only. **Jost does the work.**

- **Cormorant Garamond 500** is kept only for: page titles (h1), the wordmark, large display figures, and the quote of the day (Cormorant italic). **Never use Cormorant 300 for UI text, list items, row titles or body text.**
- **Jost** for everything else, at these levels:
  - **Section and group labels:** 600, 11px, uppercase, letter-spacing .18–.22em, muted.
  - **Row title (the thing):** **500, 17px**, ink, one line.
  - **Sender or secondary name above a title:** 600, 13.5px, muted.
  - **Context line:** 400, 14.5px, muted.
  - **When or meta:** 500, 13.5px (gold if it's today or overdue).
  - **Body text (opened items, notes, mail):** 400, 16px, line-height 1.6.
  - **Actions:** 500, 14px. The primary action is gold, the rest ink. Quiet actions ("Not this Space", "Later") are 400 and muted.
  - **Tabs and views:** label 500, 16px, with the count 400, 13.5px muted beside it (not big Cormorant numbers).
  - **Navigation:** 500, 15px.
- **Each row should have at most three levels** of visual weight, so the structure reads at a glance.
- **Apply this everywhere,** starting with Space (§53), Mail, Today and Contacts. Reference: `Koyeba Space v3.dc.html`.

## 56. A Space, revised: tasks and notes as cards (V28) – amends §53

Reference: `Koyeba Space v3.dc.html`.

- **Top:** the title only. **No vision line.**
- **One thin row** under the title, between an ink rule and a keyline: **Coming up** (the next 2) and **People** (2), as inline text. No column boxes.
- **The first section is Calendar** (open): this Space's events. Each row: the day (gold for today), a 7px gold square, the title (Jost 500 17.5), a detail line, and the time. Upcoming events come first; the last past one is dimmed. Then "Open in Calendar →". It replaces the "Coming up" text in the thin row, which now shows People only.
- **Then the other folding sections**, each with a Cormorant 500 30px title, a muted hint, a "+ Task" or "+ Note" link and +/−:
  1. **Tasks** (open), as **cards**.
     - The grid is `repeat(auto-fill,minmax(250px,1fr))` with a 14px gap.
     - **Each card:** a 1px keyline (gold on hover) and square corners. Top row: a 14px gold tick square, the priority (First in gold; Soon and Whenever muted) and the due date. Then the title (Jost 500 17), and at the foot where it came from (muted 13.5).
     - Ticking strikes the task through. Clicking the card opens the task.
  2. **Notes** (open), as **cards** in the same grid, min-height 170px.
     - **Each card:** a gold tag (Trip, Ideas…), when, the title (Jost 500 17), and the first three lines of text (muted 14px).
     - **Clicking a card opens a reader under the grid**, with a gold keyline. It shows the title (Cormorant 26), the full text (Jost 16/1.65), and Open note → · Pin · Close. The card shows as selected.
  3. **Mail** (folded; the hint "Ines wrote today · 3 in this Space"): the mail for this Space, with rows that unfold and "Not this Space". **Events are not mixed in with mail.**
  - **Near the top,** beside "+ Add to this Space", the words **Vision** and **Goals {n}** (muted, gold on hover). Clicking either opens the Vision and goals section and smooth-scrolls to it.
  - **Editing a goal:** each goal row shows its title, a thin progress line, the % and **Edit**. Edit unfolds it in place with:
    - The title as an underlined input.
    - **How far along:** a **draggable slider** (0–100, steps of 5, gold, labelled "Just begun · Halfway · Done"), with the % in Cormorant 30 gold. **Progress is always by feel, using the slider. There is no "by number" mode** (§30).
    - **By when:** This month · This quarter · This year · **Pick a date** · No date. Pick a date reveals an underlined date input, and the goal's line then reads "By 21 Mar 2027". The date also feeds On your radar (§49).
    - A "Why it matters" text box.
    - Done editing · Add a task towards it · Archive goal.
  4. **Vision and goals** (**folded by default**, hint "optional · 2 goals"): the vision as plain text, goals with thin progress lines, + Add a goal · Edit the vision.
- **Order of tasks:** First, then Soon, then Whenever, with due ones first. **Notes:** pinned first, then most recently edited. Show up to 8 of each, then "All {n} →".

## 57. Mail: no empty side panels (V28 – a bug)

The right column on Mail shows "Noticed in your mail 0 – Nothing spotted just now", "Waiting on a reply 0" and a keys hint. **Empty sections take up space and say nothing.**

- **What they're for:**
  - **Noticed in your mail:** dates, events, bookings and to-dos Koyeba spots in emails (a festival with dates becomes "Add event").
  - **Waiting on a reply:** emails you sent that haven't had an answer after 3 days.
- **New rule:**
  - **Remove the right column on Mail.** The list and the reading pane use the full width.
  - **Only when there's something** do these appear, as **one quiet line above the list**, each opening in place:
    - "Koyeba noticed 2 things – a festival on 14 March, a dentist booking · Show"
    - "3 emails waiting on a reply · Show"
  - **When the count is 0, show nothing.** No "0", no "Nothing spotted".
  - Better still, show "Noticed" items **inside the email itself**, at the top of the reading pane: "This mentions 14–16 March · Add as event".
- **The keys hint** ("U urgent · I important · L later · A archive") appears only when you're sorting with the keyboard, as a small line that fades away after 4 seconds, and in the Guide. Never permanently.
- **App-wide rule:** a section with nothing in it is hidden, not shown empty. Exceptions: deliberate first-use empty states on a tool's own page ("No notes yet · + New note").

## 58. Mail v3 (V29) – supersedes the Mail layout in §43 and §57

Reference: `Koyeba Mail v3.dc.html`. **Type follows 1a** (§59).

- **The header is compact:** "Mail" in Cormorant 500 44px, then one muted line ("4 to sort – clear them in one pass."), then **All accounts ▾** and a gold **Write** on the right. **No giant 120px title.**
- **Piles are one row of tabs:** To sort · Urgent · Important · Later · Archive. Each is a label (Jost 500 16) with its count (Jost 600 13; gold for To sort and Urgent). No big Cormorant numbers, no descriptions. Drafts · Sent · Spam · Bin sit quietly on the right.
- **Search** is one line. **"2 waiting on a reply"** sits at the end of the search line, in gold, **only when there are any**. **There is no right column.**
- **The list is grouped** This morning · Yesterday · Earlier, and each group folds.
- **Each row has three clear levels:**
  1. **The sender:** Jost 600 15 if unread, 500 if read. Then "to {account}" in muted 12.5, only when you have several accounts.
  2. **The subject:** Jost 17.5, 500 if unread, 400 if read.
  3. **The preview:** Jost 400 14.5, muted, one line.
  - The time on the right, gold if unread, and a 7px gold dot for unread.
- **An opened email sits on white paper:** a #fff card with a 1px warm keyline (oklch(0.85 0.014 80)) and square corners. **The email's own content is set in Source Serif 4:** the subject 600 24px, the body 400 17px/1.7, max 680px. Koyeba's interface stays in Jost, so you can always tell what's the email and what's Koyeba.
- **Below the card, outside it:** the "Koyeba noticed" line (uppercase gold label) and the action row. The card header (sender, time, subject) is the click target that closes it.
- **The same rule applies anywhere someone else's words appear in full** (opened messages, shared notes): white paper, Source Serif.
- **Click a row to open it in place, and click its header again to close it.**
  - Open, the subject grows to Cormorant 500 28 and wraps, and the preview hides.
  - Then a **Noticed** line if there is one ("This mentions Friday after 14:00 · Add as event"), then the body (Jost 16.5/1.65, max 700px).
  - Then the action row: **Reply** (gold) · Forward | Urgent · Important · Later · Archive | Make a task · Add as event · Keep as note.
  - Only one email is open at a time. Esc closes it.
- **Triage removes the email** from the pile and shows a toast, "Moved to Urgent · Undo".
- **Previews are clean text** (§51): never raw HTML like `<table role=…>`. Strip the tags and decode entities.

## 59. Type system 1a – the rule for every page (V29) – replaces §55

Reference: `Koyeba Type System.dc.html` (1a). **Every page uses these five levels. Nothing else.**
- **Display:** Cormorant Garamond 500. Page titles 44–64; section titles 30; an opened item's title 28; big readings and glyphs 34–38. Cormorant italic 300 is **only** for the quote of the day and the one-line reading texts.
- **Item** (the thing on each row): Jost 500 17–18, ink. Read or done items are 400.
- **Body:** Jost 400 16–16.5, line-height 1.65, max width about 700px.
- **Meta:** Jost 400 14–14.5, muted. Times are Jost 500 13.5 (gold when new or overdue).
- **Label:** Jost 600 11, uppercase, tracking .14em.
- **Sender or person name over an item:** Jost 600 15.
- **Actions:** Jost 500 14.5. The primary action is a gold block (Jost 600 12, uppercase).
- **Darker text (V31) for every page:** ink `oklch(0.17 0.015 60)`, muted `oklch(0.38 0.02 70)` (it was 0.46, which was too faint), and gold text `oklch(0.5 0.11 68)`. Muted text must pass a 4.5:1 contrast check on ivory. **Never use opacity to mute text.**
- **Never set list items, body text or meta in Cormorant.** Never use Cormorant 300 upright.

## 60. Today v3 (V29) – supersedes §41 and §49–§50 for layout

Reference: `Koyeba Today v3.dc.html`. **The page is mostly folding sections, not a long scroll.**
1. **Greeting:** the date label, "Good evening, Robin." (Cormorant 500 44–64), and the time and weather line. **+ New** (gold, with its dropdown) sits on the right.
2. **The readings band** (open by default; "Fold the readings" hides it):
   - The **quote of the day** in full width, centred, in Cormorant italic 30–42, with the author and "Keep it".
   - Under it, three columns: **I Ching** (the hexagram characters in gold Cormorant 38, then the name), **Horoscope**, and **Spirit card**. Each shows its kind label, title, one italic line, and when, with an action.
   - Click a column to expand the fuller reading in place. **No emoji glyphs:** use the hexagram characters or a letter.
3. **Folding sections:** each row is the title (Cormorant 500 30), a count (Jost 600 13, gold if it needs you), a one-line summary (shown only when folded) and +/−. In order:
   - **On your radar** (open)
   - **The day** (Today · Tomorrow)
   - **Mail** (emails open in place and can be triaged)
   - **Messages**
   - **Your Spaces** (the latest item each, then "All {n} Spaces →")
   - "Fold all" sits above them.
4. The Set something down tab stays fixed at the bottom.

## 61. Your Spaces on Today: rows are links, not folds (V30 – a bug)

In the build, clicking a Space in the right column on Today expands an empty panel. **That's wrong.**
- **Each row is a plain link to that Space's page** (`/spaces/{id}`, §53 and §56). It never expands, so remove any fold or +/− on these rows.
- **Each row:** the Space name (Jost 500 16) and the when of the latest item on the right (Jost 500 12.5, muted). Under that, one line: "{Kind} · {the latest item}" (Jost 14, muted, or gold if it needs you), for example "Mail · Marta – The show in March".
- **It's never empty:** a quiet Space shows its last item, however old. Hide Spaces with no items at all.
- "All {n} Spaces →" goes to the Spaces page.

## 62. Today v3, final layout (V30) – amends §60

Reference: `Koyeba Today v3.dc.html`.
- **The arrival line,** under the header and only when new mail arrives: a 7px gold dot, then "A letter from **{sender}**, just now – "{subject}"" (Cormorant italic 22, with the sender in Jost 600 15), then **Read it** (gold) · Later.
  - Read it opens the Mail section on Today with that email unfolded.
- **The greeting** and **+ New**, as in §60.
- **Two columns:** `minmax(0,1fr) minmax(300px,380px)`, with a gap of `clamp(36px,4.5vw,80px)`. **Below 1000px, it's one column.**
- **Left (main), folding sections in this order:**
  1. **Calendar** (open): confirmed events only, Today · Tomorrow. Each row: the time, a 7px gold square, the title (Jost 500 18), a note, and the Space.
     - Under the events, one row of **Practices** as tick boxes (ticked ones struck through), then "Open Calendar →".
     - **Tasks are not in Calendar.**
  2. **On your radar** (open): **Today** (First-priority tasks), then Overdue, The next few days and Further ahead (§49).
  3. **Mail** (folded): emails open in place (§58).
  4. **Messages** (folded).
- **Right (sticky):**
  - **Today's readings** (folds): I Ching, Horoscope and Spirit card as compact rows. Each has its glyph (Cormorant 32, gold, column `minmax(46px,max-content)`), kind label, title and one italic line; click to expand.
    - **The quote of the day sits at the foot of the readings**, in Cormorant italic 20, with the author and Keep it. **It's no longer a full-width banner.**
  - **Your Spaces** (folds): links, not folds (§61).
- **Labels and "Fold all"** never wrap (`white-space:nowrap`).

## 63. Back means back (V31 – a bug)

The ← in the breadcrumb line currently goes to the parent page (Space → Spaces). **Wrong. ← returns to wherever the user actually came from.**
- **← is `history.back()`** (the router's back), with the same result as the browser's back button. Today → a Space → ← lands on **Today**, scrolled to where they were, with the same folds open. Mail → an email → a contact → ← lands on the email.
- **The label after ← names the place you'll return to:** "← Today", "← Mail", "← Search results". It **isn't** the parent in the hierarchy.
- **The parent link is separate.** After a "·", the rest of the breadcrumb shows the hierarchy as plain links ("← Today · Spaces · Ines & Robin"). "Spaces" there goes to the Spaces page. So "back" and "up" are two different things, both visible.
- **No history** (the page was opened directly or from a bookmark): ← falls back to Today, labelled "← Today".
- **Restore state on back:** scroll position, open folds, the selected tab (§64 Space tabs), and search text. Store it per history entry.
- **Tabs, folds and peeks inside a page don't add history entries.** Opening a different item (another Space, an email, a note) does.
- **Mobile:** the same rule applies. A left-edge swipe equals ←.

## 64. Today: the quote under the greeting, and images for the readings (V31)

Reference: `Koyeba Today v3.dc.html`.
- **The quote of the day moves to just under the greeting's weather line.** It's one line of Cormorant italic 300 24px in ink (max 820px), followed by the author (Jost 500 13.5, muted) and Keep it. Remove it from the foot of the readings, and never show it as a full-width banner.
- **Every reading in "Today's readings" has a small card image** on the left: 72 × 100px, square corners, a 1px gold border, and an inner gold outline inset 5px. A tiny name sits at the foot in uppercase gold Jost 6.5px with wide tracking.
  - **Spirit card:** the same generated face as the full card (Reflection §38): ivory, a gold horizon line, two gold circles, the card's initial in Cormorant italic, and the name at the foot. **Use the same component at mini size.**
  - **Horoscope:** forest green (`oklch(0.28 0.04 155)`). The **zodiac sign's glyph** (♈–♓) is in gold, set in **Noto Sans Symbols** (Google Fonts). Always append the text-presentation selector U+FE0E so it never renders as an emoji. Add a thin gold circle behind it, and the sign's name at the foot. It works for all twelve signs.
  - **I Ching:** ivory with **the actual hexagram drawn as six bars**, built bottom to top (yang a solid bar, yin a broken bar), with **changing lines in gold**, and the hexagram's numeral at the foot.
  - **Tarot (when drawn):** the drawn card's face at mini size (§38).
- **Clicking a reading opens it** (the expand in place on Today). Its action link ("Open reading →", "Read in full →", "See the card →") goes straight to that reading in its tool (§51 deep links).

### Bug: Spirit card and Horoscope don't open
In the live app, **"Open" on the Spirit card and Horoscope readings does nothing.** Wire both to their tools, opening today's reading: `/reflection/spirit-cards/{drawId}` and `/reflection/horoscope/{date}`. Check every "Open" on Today with a quick test.

## 65. A Space, tabbed (V31) – supersedes the folding layout in §53 and §56

Reference: `Koyeba Space v4.dc.html`.
- **Top:** "← {where you came from}" (§63) · Spaces · {name}, then the title (Cormorant 500). On the right, **Vision · Goals {n}** (muted links that open the Vision and goals tab) and **+ Add to this Space**.
- **Search this Space:** a prominent white bar (1px keyline, gold when active) with a gold ⌕. The placeholder is "Search everything in {Space} – mail, notes, tasks, events", Jost 19, with ⌘F.
  - Typing replaces the tab content with results grouped Calendar · Tasks · Notes · Mail, and a count line.
  - Clicking a result opens its tab. Clear brings the tabs back.
- **The tab row is sticky:** I Overview · II Calendar {n} · III Tasks {n} · IV Notes {n} · V Mail {n new} · VI Vision and goals.
  - Each tab has a gold italic numeral and a label in Jost 500 17, with its count in Jost 600 12.5 (gold when it needs you).
  - The active tab is ink with a 2px gold underline. Content fades in on switching.
  - **Switching tabs doesn't add a history entry,** but the tab is restored on back (§63).
- **Overview** (the default): four tall cards in a grid (min 250px). Each has the kind label, a count, the one most important item (Cormorant 500 26), a detail line, and "See all… →". The Mail card is on white.
- **Calendar tab:** event rows (§56).
- **Tasks tab:** task cards (§56).
- **Notes tab:** a **Sort** row: Newest first · A to Z · By tag. **Pressing the active sort again reverses it** (Oldest first · Z to A · By tag Z–A), with a gold ↓ or ↑. Then note cards with the reader (§56).
- **Mail tab:** mail rows (§58 rules).
- **Vision and goals tab:**
  - **"Vision" label** (gold uppercase), then the vision in Cormorant italic 300 30–40, then Edit the vision.
  - A **"Goals {n}"** label with + Add a goal, then **goal cards on white** (grid min 380px). Each card: when (uppercase label) and Edit; the title in Cormorant 500 28; **the % in Cormorant 500 46, gold**; a 6px gold progress bar; and the why line.
  - **Edit** expands the card to full width with the title input, **the draggable slider**, **By when:** This month · This quarter · This year · **Custom date…** (opens a date input; the card shows "By 21 Mar 2027") · No date, then Why it matters, and Done editing · Add a task towards it · Archive goal.

---

## Files in this bundle
- `Koyeba App.dc.html`: the full interactive prototype, covering every screen above.
- `Koyeba Logo.dc.html`: the Mandombe logo explorations, 2a–2f.
- `Koyeba Brand Pack.dc.html`: the brand rules (logo, colour, type, voice, do's and don'ts).
- `Koyeba Business Card.dc.html`: the business card (3a is the chosen direction).
- `Koyeba Website.dc.html`: the public homepage for koyeba.co (see §10).
- `Koyeba Mail.dc.html`: the Mail page (see §12).
- `Koyeba Goals.dc.html`: the Goals page (see §13).
- `Koyeba Navigation.dc.html`: the new groups and navigation, desktop and mobile (see §17).
- `Koyeba Side by Side.dc.html` and `Koyeba Side by Side Mobile.dc.html`: two panes and pairs (see §18).
- `Koyeba Wide Screens.dc.html`: the responsive page grid (see §19).
- `Koyeba Notepad.dc.html`: the Notepad popover (see §20).
- `Koyeba Notes.dc.html`, `Koyeba Tasks.dc.html`, `Koyeba Reflection.dc.html`: see §21–23.
- `Koyeba Mobile Contents and Find.dc.html`: mobile Contents and Find (see §24).
- `Koyeba Calendar.dc.html`: the Calendar (see §25).
- `Koyeba Space v4.dc.html`: a Space, current and tabbed (§65).
- `Koyeba Space v3.dc.html`: the folding version, superseded by v4.
- `Koyeba Space v2.dc.html`: superseded, the Space page (see §29).
- `Koyeba Goal.dc.html`: a single goal (see §30).
- `Koyeba Contacts v2.dc.html`: Contacts, current (§48).
- `Koyeba Contacts.dc.html`: superseded by v2, Contacts and Keep in touch (§34).
- `Koyeba Journal.dc.html`: Journal (§36).
- `Koyeba I Ching.dc.html`: I Ching (§37).
- `Koyeba Today v3.dc.html`: Today, current (§60).
- `Koyeba Mail v3.dc.html`: Mail, current (§58).
- `Koyeba Type System.dc.html`: the type system; use option 1a (§59).
- `Koyeba Today v2.dc.html`: superseded, the current Today (§41).
- `Koyeba Admin.dc.html`: Admin (§40).
- `Koyeba Tarot.dc.html`: Tarot (§38).
- `Koyeba Messages.dc.html`: Messages (see §33).
- `Koyeba Set Down v2.dc.html`: the new Set something down (see §27). It supersedes the parsing in `Koyeba Set Down.dc.html`.
- `Koyeba Settings.dc.html`: Settings (see §26).
- `Koyeba Set Down.dc.html`: the smart Set something down drawer and What next (see §15–16).
- `Koyeba Night Mode.dc.html`: night tokens, fixes and a reference screen (see §14).
- `Koyeba Space.dc.html`: the Space page (see §11). `assets/art-cover.png` is sample content only.
- `email-signature.html`: a ready-to-paste email signature.
- `support.js`: the runtime needed only to open the prototypes locally.
- `fonts/`: Cormorant Garamond and Jost, woff2.
- `assets/`: the Mandombe SVGs.
