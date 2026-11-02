# CLAUDE.md — Koyeba front end

Koyeba (formerly Shizu, Daybook, Lifebook) is a calm, private home for a whole life: mail, calendar, tasks, notes and tables, messages, money and the inner life, joined up through **Spaces**. Domain: **koyeba.co** (moving from shizu.fyi). "Koyeba" is Lingala for "to know": things come into view when you need them.

## Source of truth
- The design lives in `design/koyeba/`: `README.md` (the full spec), `Koyeba App.dc.html` (the interactive prototype), `Koyeba Brand Pack.dc.html` (logo, colour, type, voice, do's and don'ts) and `Koyeba Logo.dc.html`.
- **If the code and the prototype disagree, the prototype is right.** Open it in a browser and compare side by side after every UI change.
- The prototype is a reference. Rebuild it in this codebase (`public/`, `worker/`); don't paste it in and don't ship `support.js`.
- The front end changes. The worker, schema, auth, sync and APIs stay as they are unless a task says otherwise.

## Rules — never break these
1. **One accent colour: gold.** No red, green, blue, orange or purple, not even for urgency or status. Show urgency with a filled gold square, importance with an outlined gold square, and lesser items with a grey square.
2. **Square corners.** `border-radius: 0` on everything: cards, buttons, inputs, chips, avatars, tiles. No pills.
3. **No shadows.** The one exception is the capture drawer's top shadow. No blur, no glass, no gradients.
4. **1px warm keylines** (`--k-line`) separate things. No thick borders and no coloured left-border stripes.
5. **No sidebar of buttons.** Navigation is seven folding sections: Today, Spaces, Tools, People, Money, Inner life, Reviews. Only one is open at a time.
6. **Every titled section folds open and shut**, with a `+` / `−` glyph on the right. No chevron icons.
7. **No full-width buttons.** Buttons are small: Jost 500, 11px, uppercase, 0.22em tracking, padding `11px 22px`.
8. **Large, legible text.** Body text is never under 13px; list rows are 15–17px.
9. **No icon libraries and no emoji.** Unicode glyphs only: `+ − → ✓ ✕ ⌘ · ‹ › ▶ ▼ ⌄`.
10. **Type:** Cormorant Garamond 300 for anything that speaks (headings, names, numbers, quotes); Jost for anything that labels. Eyebrows are Jost 500, 11px, uppercase, 0.28em tracking, in gold text, after a 28×1px gold rule.
11. **Connections stay subtle:** an italic Cormorant line, a gold dot, a Roman numeral for the Space. Never connector lines or "linked" badges.
12. **Night mode is deep forest green.** Never blue-grey, navy or black.
13. **Use the tokens** (`--k-bg`, `--k-panel`, `--k-soft`, `--k-ink`, `--k-mute`, `--k-line`, `--k-gold`, `--k-goldt`, `--k-deep`, `--k-ondeep`). Their values for both themes are in the README, §3. Don't hard-code new colours.
14. **No new visual elements.** Build anything new from the existing parts: folding sections, a ledger of Cormorant numbers, keyline rows, Space numerals, and gold only where something needs you.

## Type — exact, no substitutes
- **Only two fonts exist:** Cormorant Garamond and Jost, self-hosted from `design/koyeba/fonts/` with `@font-face`. **Never** Inter, Fraunces, Georgia, system-ui or a Google Fonts link. If a font fails to load, fix the `@font-face`; don't swap the font.
- **Weights:** Cormorant 300 (and 300 italic), plus 500 for the wordmark only. Jost 400, 500 and 600. Nothing else, and no faux bold.
- **Italic is allowed in only four places,** always Cormorant 300 italic:
  1. the one gold word in a heading ("Good evening, *Robin.*");
  2. Roman numerals for Spaces (I, II, III);
  3. quiet connection lines ("Already a task: …", "Nothing yet. Just this.");
  4. quotations and the daily question.
- **Never italicise Jost. Never italicise whole headings, buttons, labels or body text.** If the prototype isn't italic there, you don't make it italic.
- After any UI change, check in DevTools (Computed → Rendered Fonts) that the text really is rendering in Cormorant Garamond or Jost.

## When unsure
- **Don't use your initiative on look or wording.** Find the nearest example in `Koyeba App.dc.html` or `Koyeba Brand Pack.dc.html` and copy it exactly.
- If there's no example, **stop and ask Robin**. Don't invent.
- Never "tidy up", "modernise" or "improve" styling that already matches the prototype.

## Words
- Calm, warm, British English, short sentences. No hype, no exclamation marks, no emoji.
- "Spaces", never "Life Spaces". "Coming into view", never "My Shizu". "Set something down…", not "Quick add". "Not yet", not "Snooze". "12 days past", not "OVERDUE".
- No user-facing "Shizu", "Daybook" or "Lifebook" anywhere, in any language.

## Brand
- **Logo:** the wordmark "Koyeba" in Cormorant Garamond 500, with a gold full stop.
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
