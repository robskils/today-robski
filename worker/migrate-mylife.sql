-- July 2026: Admin -> My Life, Body becomes a practice, Portuguese gets a lane.
--
-- schema.sql is CREATE IF NOT EXISTS / INSERT OR IGNORE, so it can't rename an
-- existing lane or re-point a target that's already there. This does.
--
-- Run once:
--   npx wrangler d1 execute today-robski --remote --file worker/migrate-mylife.sql

-- Slots carry a lane key. Tasks self-heal on the next sync (the agent
-- recomputes lane from Area), but slots are owned here and nothing else
-- would ever fix them.
UPDATE slots SET lane = 'mylife' WHERE lane = 'admin';

-- Body slots stay in body: they were always practice blocks, not tasks.

INSERT INTO settings (key, value) VALUES ('target_mylife', '30')
  ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('target_portuguese', '30')
  ON CONFLICT(key) DO NOTHING;
DELETE FROM settings WHERE key = 'target_admin';

-- Body is 45 minutes now, not 30. UPDATE, not INSERT OR IGNORE: the row exists.
UPDATE settings SET value = '45' WHERE key = 'target_body';
