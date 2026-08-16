-- today.robski.uk schema

-- The day itself. Owned by this app.
-- start_min NULL = a floating block: an intention for today with no fixed time.
-- Not every commitment wants a clock against it; a siesta happens when lunch
-- and energy say so, and pinning it at 14:00 just manufactures guilt.
CREATE TABLE IF NOT EXISTS slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL,     -- YYYY-MM-DD, local (Europe/Lisbon)
  lane       TEXT NOT NULL,
  tana_id    TEXT,              -- legacy one-task link (holds a task block id), NULL for a bare practice block
  title      TEXT NOT NULL,
  start_min  INTEGER,           -- minutes from local midnight, NULL = floating
  duration   INTEGER NOT NULL,  -- minutes
  done       INTEGER DEFAULT 0,
  note       TEXT,
  url        TEXT,              -- carried over when the slot came from an activity
  event_id   TEXT,              -- Google Calendar event this block was adopted from
  alerted_min INTEGER,          -- the start_min a 5-min SMS was sent for; NULL = none
  created_at TEXT NOT NULL
);
-- One block per calendar event, so clicking a sat Zazen twice can't count it
-- twice. Partial index: ordinary blocks all have NULL here.
CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_event
  ON slots(day, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slots_day ON slots(day, start_min);

-- Tasks dropped into a block. A block is a container of time; any number of
-- tasks can live in it. tana_id is a legacy column name: it now holds the task
-- block's id. slots.tana_id is the legacy one-task link, kept so old rows read.
CREATE TABLE IF NOT EXISTS slot_tasks (
  slot_id  INTEGER NOT NULL,
  tana_id  TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  -- How long this task is meant to take *in this block*, minutes. Its own
  -- length, not the block's: a 10-min task in a 90-min block stays 10.
  -- NULL = fall back to the task's own duration, then a default. Editing it
  -- never touches slots.duration.
  duration INTEGER,
  PRIMARY KEY (slot_id, tana_id)
);
CREATE INDEX IF NOT EXISTS idx_slot_tasks ON slot_tasks(slot_id, position);

-- Old one-task slots become one-row containers, so there's a single code path.
INSERT OR IGNORE INTO slot_tasks (slot_id, tana_id, position)
  SELECT id, tana_id, 0 FROM slots WHERE tana_id IS NOT NULL;

-- One is chosen per day, deterministically from the date, so it stays with you
-- all day rather than reshuffling on every reload.
CREATE TABLE IF NOT EXISTS quotes (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  text   TEXT NOT NULL UNIQUE,
  author TEXT
);

-- Mostly Sōtō: Dōgen, Sawaki, Suzuki. Same set as the LST admin dashboard.
INSERT OR IGNORE INTO quotes (text, author) VALUES
  ('To study the Way is to study the self. To study the self is to forget the self.', 'Dōgen Zenji'),
  ('Think not-thinking.', 'Dōgen Zenji'),
  ('Being is time, time is being.', 'Dōgen Zenji'),
  ('If you cannot find the truth right where you are, where else do you expect to find it?', 'Dōgen Zenji'),
  ('The whole moon and the entire sky are reflected in one dewdrop on the grass.', 'Dōgen Zenji'),
  ('A flower falls, even though we love it; and a weed grows, even though we do not love it.', 'Dōgen Zenji'),
  ('We are always in the midst of the Way.', 'Dōgen Zenji'),
  ('Mountains are mountains, waters are waters.', 'Dōgen Zenji'),
  ('Do not think you will necessarily be aware of your own enlightenment.', 'Dōgen Zenji'),
  ('Before enlightenment, chop wood, carry water. After enlightenment, chop wood, carry water.', 'Zen proverb'),
  ('Sitting quietly, doing nothing, spring comes, and the grass grows by itself.', 'Zenrin Kushū'),
  ('When you eat, eat. When you walk, walk.', 'Zen teaching'),
  ('Not knowing is most intimate.', 'Dizang Guichen'),
  ('The great way is not difficult for those who have no preferences.', 'Sengcan'),
  ('Do not seek the truth; only cease to cherish opinions.', 'Sengcan'),
  ('Wash your bowl.', 'Zhaozhou'),
  ('In the beginner''s mind there are many possibilities, but in the expert''s there are few.', 'Shunryu Suzuki'),
  ('Each moment is absolute, alive, and significant.', 'Shunryu Suzuki'),
  ('The most important thing is to find out what is the most important thing.', 'Shunryu Suzuki'),
  ('Without accepting the fact that everything changes, we cannot find perfect composure.', 'Shunryu Suzuki'),
  ('Each of you is perfect the way you are — and you can use a little improvement.', 'Shunryu Suzuki'),
  ('Seek not to follow in the footsteps of the wise. Seek what they sought.', 'Matsuo Bashō'),
  ('The obstacle is the path.', 'Zen proverb'),
  ('What was your face before your parents were born?', 'Zen koan'),
  ('To be a lamp unto yourself is to light the way for others.', 'Sōtō teaching'),
  ('Just this. Just this moment, nothing more.', 'Zen teaching'),
  ('The way out is through.', 'Zen proverb'),
  ('Zazen is good for nothing.', 'Kōdō Sawaki'),
  ('Do not be too hard, lest you break. Do not be too soft, lest you be squeezed.', 'Zen proverb'),
  ('Gaining is delusion, losing is enlightenment.', 'Kōdō Sawaki'),
  ('You cannot exchange even a single fart with the next person.', 'Kōdō Sawaki'),
  ('Practice is the whole of the Way, not a means to it.', 'Sōtō teaching'),
  ('Sit without expectation. That is shikantaza.', 'Sōtō teaching'),
  ('When walking, just walk. Above all, do not wobble.', 'Yunmen');

-- Email sign-in codes. One outstanding code per address; deleted on use.
-- attempts caps brute force, sent_at throttles resends.
CREATE TABLE IF NOT EXISTS otp_codes (
  email      TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,   -- unix seconds
  attempts   INTEGER DEFAULT 0,
  sent_at    INTEGER NOT NULL
);

-- Repeatable things with a URL and a usual length, attached to a lane.
-- Not tasks: a task is done once and disappears, an activity is done again
-- tomorrow. Yoga, chi kung, a sit. Owned here.
CREATE TABLE IF NOT EXISTS activities (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  lane     TEXT NOT NULL,
  title    TEXT NOT NULL,
  url      TEXT,
  duration INTEGER NOT NULL DEFAULT 30,   -- minutes
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_activities_lane ON activities(lane, position);

INSERT OR IGNORE INTO activities (id, lane, title, url, duration, position) VALUES
  (1, 'body', 'Yoga Download',      'https://www.yogadownload.com/', 50, 0),
  (2, 'body', 'Apple Health+',      NULL, 50, 1),
  -- Ba Duan Jin. Eight, not seven.
  (3, 'body', '8 Pieces of Brocade', NULL, 30, 2),
  (8, 'body', 'Body Strength App', NULL, 20, 3),
  (9, 'body', 'Holmes Place',      NULL, 90, 4),
  (4, 'music', 'Forró',       NULL, 60, 0),
  (5, 'music', 'Percussion',  NULL, 30, 1),
  (6, 'music', 'Singing',     NULL, 30, 2),
  (7, 'music', 'Songwriting', NULL, 60, 3);

-- Per-lane daily minute targets, and misc settings. Editable in the UI.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Zazen is an hour, and is the only target Robin has actually specified.
-- The rest are starting guesses, all editable.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('target_zazen',      '60'),
  ('target_body',       '50'),   -- one Body activity, which is 50 minutes
  ('target_music',      '60'),   -- Music & Dance, one hour a day
  ('target_art',        '30'),
  ('target_portuguese', '30'),
  ('target_work',       '180'),
  ('target_mylife',     '30'),
  ('target_rest',       '60'),
  ('day_start',    '360'),   -- 06:00
  ('day_end',      '1380');  -- 23:00

-- ── Robski Life: the block core ───────────────────────────────────────
-- The one model the whole Life app sits on. A task, a note, a table, a table
-- row - all the same thing: a block. This is what lets a note hold a task and
-- a task link to a table row without three separate silos.
--
-- Blocks are OWNED here: this is the source of truth, and tasks now live as
-- blocks (kind='task'). Nothing syncs it from anywhere.
CREATE TABLE IF NOT EXISTS blocks (
  id         TEXT PRIMARY KEY,        -- app-generated, crypto.randomUUID()
  kind       TEXT NOT NULL,           -- task | note | table | row | text ...
  parent_id  TEXT,                    -- nesting; NULL = top level
  position   REAL NOT NULL DEFAULT 0, -- order among siblings; REAL so a new
                                      -- block slots between two by averaging
  title      TEXT,                    -- name / first line
  body       TEXT,                    -- markdown or long content (notes)
  props      TEXT,                    -- JSON: typed fields (status, due, cols…)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_blocks_parent ON blocks(parent_id, position);
CREATE INDEX IF NOT EXISTS idx_blocks_kind   ON blocks(kind, archived);

-- [[links]] between blocks. Directed: from references to. The reverse read
-- (who points at me) is the backlink panel, hence the index on to_id.
CREATE TABLE IF NOT EXISTS block_links (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_block_links_to ON block_links(to_id);

-- Mail accounts for life.robski.uk/mail. The Worker speaks IMAP/SMTP to these
-- over Cloudflare TCP sockets (worker/mail.js). The password is AES-256-GCM
-- encrypted at rest with a key derived from AUTH_SECRET - never stored plain.
CREATE TABLE IF NOT EXISTS mail_accounts (
  id        TEXT PRIMARY KEY,
  email     TEXT NOT NULL,
  name      TEXT,
  color     TEXT,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 465,
  username  TEXT NOT NULL,
  pass_enc  TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  signature TEXT,
  blocked   TEXT              -- JSON array of blocked sender addresses
);

-- Background inbox cache: the cron syncs the latest INBOX headers here so
-- opening Mail reads from D1 (fast) instead of a live IMAP fetch (slow).
-- Bodies are never cached; they load on demand. Holds no passwords.
CREATE TABLE IF NOT EXISTS mail_cache (
  account TEXT NOT NULL, mailbox TEXT NOT NULL, uid INTEGER NOT NULL,
  subject TEXT, from_addr TEXT, from_name TEXT, date TEXT,
  seen INTEGER DEFAULT 0, flagged INTEGER DEFAULT 0,
  message_id TEXT, in_reply_to TEXT, refs TEXT, preview TEXT, synced_at TEXT,
  PRIMARY KEY (account, mailbox, uid)
);
CREATE INDEX IF NOT EXISTS mail_cache_list ON mail_cache(account, mailbox, date DESC);
CREATE TABLE IF NOT EXISTS mail_cache_meta (
  account TEXT NOT NULL, mailbox TEXT NOT NULL, unseen INTEGER DEFAULT 0, synced_at TEXT,
  PRIMARY KEY (account, mailbox)
);

-- Web Push subscriptions (one per installed browser/device). The worker sends
-- an encrypted push when new mail arrives, and the service worker badges the
-- app icon. Dead endpoints (404/410) are pruned on send.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  email      TEXT,
  created_at TEXT NOT NULL
);
