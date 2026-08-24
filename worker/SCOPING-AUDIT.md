# Multi-tenant scoping audit (Daybook / branch `multi-tenant`)

Track B = owner (`user_id`) on every row. This file tracks which query sites are
tenant-scoped and which are still open. **Rule: do NOT invite a second user until
every box below is ticked and re-verified.** Until then only user 1 (Robin)
exists, so unscoped SELECTs still return only his data and the app works — the gap
is *isolation*, not function.

Plumbing (done): `resolveUser` in auth.js → `env.uid`/`env.user` set once per
request in `fetch`. Cron paths have no `env.uid`; they pass an explicit uid (1
for now — see the cron TODOs). `getSetting`/`setSetting` centralise the per-user
`settings` (PK `user_id,key`).

## Done ✅
- Plumbing: resolveUser, env.uid, scoped-env reassignment.
- Schema: users / invites / ai_usage; user_id on slots, slot_tasks, activities,
  blocks, block_links, mail_accounts, push_subs; settings rebuilt (user_id,key).
- blocks core: getBlock, createBlock, createBlocksBulk, handleFavorites,
  listBlocks, updateBlock, deleteBlock, searchBlocks, createBookmark(+capture=1).
- block_links: scoped in get/create/update/delete.
- settings: ALL sites via getSetting/setSetting or inline user_id
  (journal insights, bookmarkKey, lane config save, handleSettings, kv store,
  tracker categories, fin trends read, review-reminders handler).
- brief/reminders cron: settings scoped to uid 1 (functional interim).
- deletes: finchannel, tracker (kind + user_id).

## Open — index.js (blocks kinds & day) 🔲
Functionally fine for user 1; must scope before user 2. Grep `env.DB` in index.js.
- [ ] Area list query (`WHERE kind='area'`) in the areas/day handlers.
- [ ] Tasks list query (`kind='task'` roll-up for Today/Tasks).
- [ ] Task mutators: setTaskDone, patchTaskTitle, task-props update, task lookup
      by id (`WHERE id=? AND kind='task'`) — add `AND user_id=?`.
- [ ] Contacts list + contact import (INSERT relies on DEFAULT 1; SELECT/UPDATE
      unscoped — scope both).
- [ ] slots / slot_tasks: handleDay, slot create/adopt/delete, alerts cron,
      /api/export. slots.user_id exists (DEFAULT 1). Adopted-event unique index
      is (day,event_id) — revisit to (user_id,day,event_id) before user 2.
- [ ] activities: list + seed. activities.user_id exists (DEFAULT 1). New users
      need their own activity seed at signup (currently global seed = user 1).
- [ ] push_subs: scope by user_id; pushAll must target the right user's subs.
- [ ] recordRecent / recent list if it reads blocks unscoped.

## Open — mail.js 🔲 (27 env.DB sites)
- [ ] mail_accounts: scope every SELECT/INSERT/UPDATE/DELETE by user_id (the
      account list is the tenant boundary for mail).
- [ ] mail_cache / mail_cache_meta: keyed by account; safe *iff* the account set
      is filtered to the user first. Audit every cache read to confirm it starts
      from the user's accounts, not all accounts.
- [ ] cron warmMailCache / unseen counts: iterate per user's accounts.

## Open — portfolio.js 🔲 (17 sites, separate PORTFOLIO_DB)
- [ ] positions / sales / snapshots need user_id. On staging PORTFOLIO_DB == the
      staging DB, and **those tables don't exist there yet** — create them (+ a
      user_id column) so Financial works on staging. Live still shares the real
      portfolio-tracker DB; plan a user_id backfill there at cutover.

## Open — tracker.js / spending.js / advice.js 🔲
- [ ] tracker.js: loadTrackerBlocks / getTracker / addTrackerItem — `kind='tracker'`
      blocks; add user_id. trackerCategories reads settings (now per-user) — pass uid.
- [ ] spending.js: txn blocks (import/clear/list) — add user_id.
- [ ] advice.js: finchannel / finvideo blocks (pollChannels, synthesiseTrends,
      listing) — add user_id; kv_fin_trends per-user.

## Open — cron (scheduled) 🔲
- [ ] runDailyBrief, maybeReviewReminders, maybeSnapshotPortfolio,
      maybePollChannels, alerts: currently user-1 only (TODOs in code). Rework to
      loop over users (or per-user schedule) before multiple accounts rely on them.

## Open — onboarding / BYOK (new build, not scoping) 🔲
- [ ] Users/invites endpoints; subdomain pick + reserved-word denylist; voucher
      redemption; per-user encrypted AI keys (ai_anthropic_enc/ai_gemini_enc,
      AES-GCM like mail passwords); route every AI call through the user's key and
      log tokens+cost to ai_usage (the fair-use meter); per-user capture keys.
- [ ] Subdomain routing: wildcard `*.daybook.fyi` (once the zone is live) →
      resolveUser also matches hostname subdomain to users.subdomain.
