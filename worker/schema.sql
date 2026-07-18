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
  url        TEXT,              -- carried over when the slot came from an activity
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_day ON slots(day, start_min);

-- Tasks dropped into a block. A block is a container of time; any number of
-- tasks can live in it. slots.tana_id is the legacy one-task link and is kept
-- only so old rows still read: everything new goes through here.
CREATE TABLE IF NOT EXISTS slot_tasks (
  slot_id  INTEGER NOT NULL,
  tana_id  TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slot_id, tana_id)
);
CREATE INDEX IF NOT EXISTS idx_slot_tasks ON slot_tasks(slot_id, position);

-- Old one-task slots become one-row containers, so there's a single code path.
INSERT OR IGNORE INTO slot_tasks (slot_id, tana_id, position)
  SELECT id, tana_id, 0 FROM slots WHERE tana_id IS NOT NULL;

-- Completions made in the web app, queued for the sync agent to replay into Tana.
-- Needed because the Tana API is write-only from the cloud: only the Mac can write back.
-- attempts guards against a poison row: if a node is trashed in Tana after its
-- slot was ticked, check_node fails forever. Without a cap, enough such rows
-- fill the fetch window and every later completion stops being replayed.
CREATE TABLE IF NOT EXISTS pending_writes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tana_id    TEXT NOT NULL,     -- for 'create', the local: placeholder id
  op         TEXT NOT NULL,     -- 'complete' | 'uncomplete' | 'create' | 'rename'
  payload    TEXT,              -- create: the task to build; rename: {old,new}
  created_at TEXT NOT NULL,
  applied_at TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending ON pending_writes(applied_at, attempts);

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

-- Life Areas and Priorities, mirrored from Tana by the agent.
-- The +New form needs real node ids to reference, and the worker can't read
-- Tana. Same shape as `tasks`: a mirror, never the truth.
CREATE TABLE IF NOT EXISTS tana_options (
  node_id TEXT PRIMARY KEY,
  kind    TEXT NOT NULL,   -- 'area' | 'priority'
  name    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tana_options ON tana_options(kind, name);

-- Repeatable things with a URL and a usual length, attached to a lane.
-- Not tasks: a task is done once and disappears, an activity is done again
-- tomorrow. Yoga, chi kung, a sit. Owned here, never synced to Tana.
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
  (3, 'body', '8 Pieces of Brocade', NULL, 15, 2),
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
