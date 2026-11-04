# V38 – Today: The feed tab (one page)

Reference: `Koyeba Today v3.dc.html` (open it in a browser; it runs on its own with `support.js`). It opens in **night mode**; the Tweaks panel switches to day.

**Change only The feed tab.** Leave the header, greeting, Calendar tab, Mail · Messages, Reflections sidebar and everything else exactly as they are. Type and colour rules (§59, §66, §70 of the main handover) still apply: Cormorant Garamond for anything that speaks, Jost for anything that labels, no other fonts.

## What the feed is
A short read of what has changed or come into view since you last looked, not a list of everything with a date. Every item has a way to say "I've dealt with this", and the feed shrinks as you act.

## Four parts, in this order (each hidden when empty)

### 1. Needs you
Things to act on. Each is a card: a 1px keyline, square corners, **no fill and no shadow**, padding 18 × 20. The keyline is **gold when late**, otherwise the normal line colour.
- **Left:** a 48px gold-keyline square holding a date number with its weekday (for birthdays) or the kind's initial (R review, T task, G goal, or the person's initial).
- **Meta line:** the kind in uppercase Jost 600 11 (gold when late), then · Space.
- **Title:** Cormorant 500 25.
- **One line of context:** Jost 15.5, muted.
- **Actions:** text links, the first in gold, the rest muted.
- **What goes here:** today's birthday, overdue reviews and tasks, invitations to a Space, and a goal **only when it needs you** (due within 7 days, or no movement for 3+ weeks).
- **Never list goals just because they have a year-end date.**

### 2. Worth knowing
Other people's activity in shared Spaces. Plain rows separated by hairlines, no cards.
- **Each row:** a 32px initial square, then "**{Who}** {did} **{where}**" (Jost 16; the name 600, the place gold 500 and linked). The item itself sits under it in Cormorant italic 19.
- **On the right:** the time, then an action (Open / Reply / See it) and **Seen**.
- Show 3, then "Show 2 more". **Mark all as seen** sits in the heading.
- **Kinds to support:** added, finished, commented, shared, moved, assigned to you, invited you.

### 3. Keep in touch
People Robin has asked to hear from. One row each: the name in Cormorant 22, "6 weeks since you spoke" (gold when long), and a note.
- **Contact buttons:** one for each way they can be reached, from their contact card: **WhatsApp**, **Email**, **Call**. People aren't on Koyeba, so never use "Send a message".
  - **WhatsApp:** `https://wa.me/<number>?text=<draft>` with a short draft. On return, ask quietly "Been in touch with {name}?"
  - **Email:** opens a new message in Koyeba Mail, already addressed. Sending it resets the counter automatically.
  - **Call:** `tel:`. Afterwards, ask the same quiet question.
- **Been in touch:** resets their counter to zero, removes the row, and shows an Undo.
- **Snooze:** opens chips: 3 days · A week · A month · **Stop reminding me** (turns keep in touch off for that person, the same as the switch on their card).

### 4. On the horizon
One line per item: a date number with its weekday, the title, a muted detail, and one action. Birthdays in the next 7 days (with the contact buttons), deadlines, booking windows closing.

## Actions everywhere – never a vague "Later"
- **Birthdays:** contact buttons, plus **Sent my wishes** (clears it for this year).
- **Tasks:** **Done**, **Open**, **Snooze** (Tomorrow · At the weekend · Next week · Pick a date).
- **Reviews:** **Do it now**, **Snooze**.
- **Goals:** **Check in** (opens the slider and resets the "not moved" clock), **Open**, **Snooze**.
- **Activity:** an action plus **Seen**.
- **Invitations:** **Join** or **Not now**.
- Anything cleared becomes a single muted line, "{what happened} · Undo", until the page is refreshed.

## Also on this page
- **Quote of the day:** remove "Keep it". There's only a quiet **×** on the right that closes it for today.
- **Night mode** (deep forest green, never blue-grey):
  - --k-bg oklch(0.2 0.03 160)
  - --k-ink oklch(0.93 0.018 85)
  - --k-mute oklch(0.74 0.022 110)
  - --k-line oklch(0.33 0.03 158)
  - --k-gold oklch(0.76 0.12 78)
  - --k-goldt oklch(0.8 0.11 80)
  - --k-soft oklch(0.25 0.03 160)
  - header oklch(0.17 0.028 160)
- **No "You're up to date" line.** "What should I do next ⌘/" stays as a quiet line at the foot.

## Later (not now)
Bills and renewals spotted in emails and set-down items, shown as suggestions until confirmed.

## When you're done
List anything you weren't sure about rather than guessing.
