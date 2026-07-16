-- today.robski.uk schema

-- Mirror of the #Task supertag in Tana. Written only by the local sync agent.
-- Tana is the source of truth for everything in here.
CREATE TABLE IF NOT EXISTS tasks (
  tana_id    TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  area       TEXT,              -- raw Tana Life Area name, eg "Body / Health"
  lane       TEXT,              -- mapped lane key, eg "body"
  priority   TEXT,              -- P1 | P2 | P3 | P4
  status     TEXT,              -- Backlog | In progress | Done
  duration   INTEGER,           -- minutes, NULL when unset in Tana (most tasks)
  done       INTEGER DEFAULT 0,
  breadcrumb TEXT,
  created    TEXT,
  synced_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_lane ON tasks(lane, done);
CREATE INDEX IF NOT EXISTS idx_tasks_prio ON tasks(priority, done);

-- The day itself. Owned by this app, never synced from Tana.
-- start_min NULL = a floating block: an intention for today with no fixed time.
-- Not every commitment wants a clock against it; a siesta happens when lunch
-- and energy say so, and pinning it at 14:00 just manufactures guilt.
CREATE TABLE IF NOT EXISTS slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL,     -- YYYY-MM-DD, local (Europe/Lisbon)
  lane       TEXT NOT NULL,
  tana_id    TEXT,              -- set when this slot is a Tana task, NULL for a bare practice block
  title      TEXT NOT NULL,
  start_min  INTEGER,           -- minutes from local midnight, NULL = floating
  duration   INTEGER NOT NULL,  -- minutes
  done       INTEGER DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_day ON slots(day, start_min);

-- Completions made in the web app, queued for the sync agent to replay into Tana.
-- Needed because the Tana API is write-only from the cloud: only the Mac can write back.
-- attempts guards against a poison row: if a node is trashed in Tana after its
-- slot was ticked, check_node fails forever. Without a cap, enough such rows
-- fill the fetch window and every later completion stops being replayed.
CREATE TABLE IF NOT EXISTS pending_writes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tana_id    TEXT NOT NULL,
  op         TEXT NOT NULL,     -- 'complete' | 'uncomplete'
  created_at TEXT NOT NULL,
  applied_at TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending ON pending_writes(applied_at, attempts);

-- Per-lane daily minute targets, and misc settings. Editable in the UI.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Zazen is the only target Robin specified: 40 min floor, 60 preferred.
-- The rest are starting guesses, all editable.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('target_zazen', '40'),
  ('target_body',  '30'),
  ('target_music', '30'),
  ('target_art',   '30'),
  ('target_forro', '30'),
  ('target_work',  '180'),
  ('target_admin', '30'),
  ('target_rest',  '60'),
  ('stretch_zazen','60'),
  ('day_start',    '360'),   -- 06:00
  ('day_end',      '1380');  -- 23:00
