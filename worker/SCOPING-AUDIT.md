# Multi-tenant scoping audit (Daybook / branch `multi-tenant`)

Track B = owner (`user_id`) on every row. This tracks which query sites are
tenant-scoped. The **data-query sweep is COMPLETE and verified on staging**: a
synthetic user 2 sees none of user 1's data in any module, and cannot read,
modify, or delete user 1's rows even given the exact id (404 across the board).

Plumbing: `resolveUser` (auth.js) → `env.uid`/`env.user` set once per `/api`
request in index.js `fetch`. Cron paths have no `env.uid`; they scope to user 1
explicitly (interim — see cron TODOs). `getSetting`/`setSetting` centralise the
per-user `settings` (PK `user_id,key`).

## Done ✅ (scoped + verified on staging)
- Plumbing: resolveUser, env.uid, scoped-env reassignment; mail-attachment
  signed-link path sets env.uid from the account owner.
- Schema: users / invites / ai_usage; user_id on slots, slot_tasks, activities,
  blocks, block_links, mail_accounts, push_subs; settings rebuilt (user_id,key);
  portfolio positions/sales/snapshots get user_id (snapshots PK user_id,ts).
- blocks (all kinds): get/create/bulk/favorites/list/update/delete/search,
  createBookmark, createTask, importContacts, journal insights, tracker/txn/
  finchannel/finvideo blocks. Deletes for finchannel/tracker.
- day/planner: handleDay, handleTasks, createSlot, add/remove/duration slot
  tasks, updateSlot, setTaskDone, updateTask, activities CRUD, review-mirror,
  slot/activity deletes.
- settings: every site (journal insights, bookmark key, lane config,
  handleSettings, kv store, tracker cats, fin trends, review reminders).
- mail (mail.js): listAccounts(env,uid)/getAcct(env,id,uid); account add/list/
  patch/delete (with ownership check) + unread + cached; sync throttle on the
  user_id=1 system row.
- push_subs: subscribe/unsubscribe/pushAll(uid) scoped.
- finance: portfolio (positions/sales/snapshots, seed for user 1 only),
  tracker, spending, advice — all scoped.
- attachments.js: loadProps/saveProps scoped.
- export: per-user dump (quotes shared).

## Cron — interim: pinned to user 1, works for Robin 🟡
These run only from `scheduled()` (never on staging) and are hard-scoped to user
1 today, with TODO(multi-tenant cron) markers. Not leaks; they simply serve only
Robin until reworked to loop over users (or per-user schedules):
- runDailyBrief / briefDue (last_brief_day, P1 query)
- runAlerts (SMS — user 1 slots only, so no other user can text Robin)
- maybeReviewReminders, maybePushMail, maybeSnapshotPortfolio, maybePollChannels
- syncMailCache warms ALL accounts (correct — background job, not user-scoped).

## Still to build (NOT scoping — new features) 🔲
- Onboarding: users/invites endpoints; subdomain pick + reserved-word denylist;
  voucher redemption; per-user activity/settings seed at signup.
- BYOK: per-user encrypted AI keys (ai_anthropic_enc/ai_gemini_enc, AES-GCM like
  mail passwords); route every Anthropic/Gemini call through the user's key and
  log tokens+cost to ai_usage (the fair-use meter). Currently AI uses the shared
  env.ANTHROPIC_API_KEY / env.GEMINI_API_KEY secrets.
- Per-user capture keys (bookmark capture is user 1's for now).
- Subdomain routing: wildcard `*.daybook.fyi` (zone now registered, propagating)
  → resolveUser also matches hostname subdomain to users.subdomain.
- Wordmark: BRAND.owner (app.js) → the signed-in account's name.

## Cutover tasks (live) 🔲
- Run worker/schema-tenant.sql on the LIVE today-robski D1 (backfills all rows
  to Robin=1) at cutover.
- Portfolio shares the live portfolio-tracker D1 with the standalone
  portfolio.robski.uk app: ALTER positions/sales/snapshots ADD COLUMN user_id
  DEFAULT 1 there, and note the standalone app keeps working (its queries ignore
  user_id). Snapshots PK change needs care (rebuild) since both apps write it.
- Make cron multi-tenant (loop users) before real traffic depends on it.
