-- Daybook multi-tenant migration (Track B: owner on every row).
--
-- RUN ONCE, AFTER worker/schema.sql, on a database that is currently
-- single-tenant. It:
--   1. creates the tenant tables (users, invites, ai_usage),
--   2. makes Robin user 1,
--   3. adds user_id to every owned table and backfills it to 1,
--   4. rebuilds `settings` as per-user (user_id, key).
--
-- The same script is the cutover backfill for the live DB: every existing row
-- becomes Robin's. It is deliberately NOT re-runnable (ALTER ... ADD COLUMN has
-- no IF NOT EXISTS in SQLite); run it exactly once per database.
--
-- Nothing here scopes `quotes` (shared reference data) or `otp_codes` (keyed by
-- the email a code was sent to - login, not tenant data).

-- ── The tenant ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT,                            -- wordmark owner: "Robski", "Tara"
  subdomain    TEXT UNIQUE,                     -- tara -> tara.daybook.fyi; NULL until chosen
  plan         TEXT NOT NULL DEFAULT 'free',    -- free | standard | premium | power
  status       TEXT NOT NULL DEFAULT 'active',  -- active | invited | suspended
  ai_anthropic_enc TEXT,                        -- BYO Anthropic key, AES-256-GCM (as mail passwords)
  ai_gemini_enc    TEXT,                        -- BYO Gemini key, same encryption
  invited_by   INTEGER,                         -- users.id of the inviter
  voucher      TEXT,                            -- redeemed invite/discount code, if any
  free_until   TEXT,                            -- ISO date the free period ends (NULL = not time-limited)
  gcal_refresh_enc TEXT,                        -- member's own Google Calendar refresh token, AES-256-GCM
  gcal_email   TEXT,                            -- the Google account they connected (shown in Settings)
  totp_secret_enc TEXT,                         -- optional 2FA: TOTP shared secret, AES-256-GCM (NULL = not set up)
  totp_enabled INTEGER NOT NULL DEFAULT 0,      -- 1 once the authenticator code has been confirmed
  totp_recovery TEXT,                           -- JSON array of SHA-256-hashed one-time recovery codes
  created_at   TEXT NOT NULL
);

-- Robin is user 1. His real name in the wordmark; subdomain reserved.
INSERT OR IGNORE INTO users (id, email, name, subdomain, plan, status, created_at)
  VALUES (1, 'robin@lumley-savile.com', 'Robski', 'robski', 'premium', 'active', '2026-08-24T00:00:00Z');

-- ── Invite / discount codes ───────────────────────────────────────────
-- The friends round and every later promo run through here. `free=1` is the
-- daughter-and-friends case: Standard at no charge, provided they add own keys.
CREATE TABLE IF NOT EXISTS invites (
  code        TEXT PRIMARY KEY,
  email       TEXT,                             -- optional: pre-assigned to one address
  plan        TEXT NOT NULL DEFAULT 'standard', -- plan the code grants
  free        INTEGER NOT NULL DEFAULT 0,       -- 1 = 100% off (BYO-key required)
  free_months INTEGER,                          -- length of the free period (NULL = no limit / forever)
  note        TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL,
  used_by     INTEGER,                          -- users.id who redeemed
  used_at     TEXT
);

-- ── AI usage meter (the "never out of pocket" ledger) ─────────────────
-- Every Anthropic/Gemini call logs its tokens and estimated cost against the
-- account. This is what enforces the Premium fair-use cap and tells us when to
-- nudge someone up to the Power tier. One row per call; roll up by user + month.
CREATE TABLE IF NOT EXISTS ai_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  ts         TEXT NOT NULL,                     -- ISO8601
  provider   TEXT NOT NULL,                     -- anthropic | gemini
  model      TEXT,
  feature    TEXT,                              -- journal-coach | insights | advice | reply | ...
  in_tokens  INTEGER NOT NULL DEFAULT 0,
  out_tokens INTEGER NOT NULL DEFAULT 0,
  cost_eur   REAL NOT NULL DEFAULT 0,           -- estimated, from a per-model rate card
  byok       INTEGER NOT NULL DEFAULT 0         -- 1 = ran on the user's own key (cost is theirs)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, ts);

-- ── user_id on every owned table, backfilled to Robin (1) ─────────────
ALTER TABLE slots       ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE slot_tasks  ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activities  ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE blocks      ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE block_links ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mail_accounts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE push_subs   ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

-- The DEFAULT 1 already backfills existing rows to Robin; these indexes make the
-- per-user reads that now front every query cheap.
CREATE INDEX IF NOT EXISTS idx_blocks_user      ON blocks(user_id, kind, archived);
CREATE INDEX IF NOT EXISTS idx_blocks_user_parent ON blocks(user_id, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_slots_user       ON slots(user_id, day, start_min);
CREATE INDEX IF NOT EXISTS idx_activities_user  ON activities(user_id, lane, position);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_user ON mail_accounts(user_id, position);
CREATE INDEX IF NOT EXISTS idx_block_links_user ON block_links(user_id, to_id);

-- ── settings become per-user (user_id, key) ───────────────────────────
-- Can't ALTER a primary key in SQLite, so rebuild. Existing global rows (Robin's
-- targets, day_start/end) migrate to user 1; new users get their own defaults
-- seeded in code at signup.
ALTER TABLE settings RENAME TO settings_global;
CREATE TABLE settings (
  user_id INTEGER NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
INSERT INTO settings (user_id, key, value) SELECT 1, key, value FROM settings_global;
DROP TABLE settings_global;
