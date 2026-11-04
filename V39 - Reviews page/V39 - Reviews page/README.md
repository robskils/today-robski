# V39 – The Reviews page (one page)

Reference: `Koyeba Reviews v2.dc.html` (open it in a browser; it runs on its own with `support.js`). It opens in **night mode**; the Tweaks panel switches to day. **This replaces the current Reviews overview** (the five boxes, the bar chart, the rainbow wheel, and the "When reviews land" table).

**Change only this page.** The header, breadcrumbs and the type and colour rules (§59, §66, §70) still apply: Cormorant Garamond for anything that speaks, Jost for anything that labels, no other fonts. Night colours are the same as V38.

## Layout (max content width 1120px, left-aligned in the 1600px container)

1. **Breadcrumbs:** Today / Plans / **Reviews** (the current page in gold).

2. **Opening**, in two columns that wrap:
   - **Left:**
     - Eyebrow "PLANS · LOOKING BACK".
     - "Reviews" in Cormorant 500, 48–72px.
     - **One generated line** in Cormorant italic 300, 24–30px, e.g. "Your wheel is at its highest since you began. Two reviews are waiting for you." Build it from the latest score against previous ones and the number of reviews due or late. Don't mention streaks.
   - **Right:** a slim **Ask about your reviews…** line (gold underline, no box) and three suggestion chips (How was October? · What's improved since summer? · When am I happiest?). These go to the same assistant as "Give me an overview".

3. **Your rhythm:** five rows, **Daily · Weekly · Monthly · Quarterly · Yearly**, separated by hairlines. **No cards.** Each row is a grid with:
   - The cadence (uppercase label) over the period ("Week 45", "October", "Q3 2026") in Cormorant 500 30.
   - **Status:** "Closes tonight" / "Lands Sunday" / "3 days past" (gold when late) / "In progress", with a muted line under it ("in 5 days · last done 1 Nov").
   - **No streaks** – don't show done/missed marks or "in a row" counts anywhere on this page.
   - **One action:** filled gold if the item is late or closes today (Close the day / Start), otherwise outlined gold (Start early / Continue).
   - **+ / −** to fold.
   - **Opening a row** lists past reports, newest first: the date, **a one-line headline** (Cormorant 500 21, taken from that report's opening line), the wheel score, and "Read →" (opens the read-only report from V37).
   - Weekly is open by default, and only one row is open at a time.

4. **How things are going** (folds):
   - **Left:** "Your wheel, week by week". A thin gold line chart of the wheel average for the last 9–12 weekly reviews, with dashed gridlines at 2 and a solid one at 3. The latest point is filled and labelled. Mark a notable dip with a short Cormorant italic note taken from that week's review ("the move"). Under it, one or two sentences of plain-English reading.
   - **Right:**
     - **Rising:** three areas, "from → to".
     - **Asking for you:** three low or falling areas, each with a reason ("at 1 for six weeks").
     - **In your own words, lately:** about ten words or phrases that recur in the "In your own words" answers. Size and gold reflect frequency; the tooltip reads "In 6 of your last 9 weekly reviews". Tweak `showWords` hides it.

5. **The wheel of life** (folds): "26 areas · from your last weekly review".
   - **A single-colour petal chart** (300px): one wedge per area, length = score/5, gold at an opacity that rises with the score. Faint rings mark 1–5. The centre shows the average. **No rainbow colours and no colour legend.**
   - **Hover a petal** to highlight it, show its score in the centre, and name it below.
   - **Beside the chart:** the areas grouped into bands: **Flourishing** (4–5) · **Steady** (3) · **Getting by** (2) · **Asking for you** (1, names in gold).

6. **Footer line:** "Weekly reviews land on Sunday, monthly on the last day, quarterly and yearly at the end of each." plus **Change when they land →** (links to review settings). **This replaces the old table and the Review settings button.**

## Notes
- In the reference, the line chart and petal chart are drawn in code. **Build them as SVG components**, not images.
- Clicking a past report opens the V37 report page. Start / Continue opens the existing review form.

## When you're done
List anything you weren't sure about rather than guessing.
