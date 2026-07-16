import { LANES, laneForArea } from '../shared/lanes.js';
import { isAuthed, requestCode, verifyCode } from './auth.js';

const TZ = 'Europe/Lisbon';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const ALLOWED_ORIGINS = [
  'https://today.robski.uk',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
];

function cors(request) {
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
}

function json(data, request, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...cors(request) },
  });
}

function err(message, request, status = 400) {
  return json({ error: message }, request, status);
}

// Constant-time-ish compare so a wrong key can't be probed byte by byte.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// ── time helpers ──────────────────────────────────────────────────────

export function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour % 24), +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

// Midnight of a local calendar day, as a real UTC instant. Two passes so the
// answer stays right on DST changeover days.
export function zonedDayStart(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    guess = naive - tzOffsetMinutes(new Date(guess), tz) * 60000;
  }
  return new Date(guess);
}

function todayStr(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function nextDayStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// Local calendar date + wall-clock minutes for an instant. Slots store wall-clock
// minutes, so events have to be measured the same way: an elapsed-minutes delta
// from midnight drifts by an hour either side of a DST change.
export function localParts(date, tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

function isValidDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ── Google Calendar ───────────────────────────────────────────────────

let tokenCache = { token: null, expires: 0 };

async function googleAccessToken(env) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expires > now + 30_000) return tokenCache.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`google token: ${res.status} ${await res.text()}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expires: now + data.expires_in * 1000 };
  return data.access_token;
}

async function calendarEvents(env, day) {
  if (!env.GOOGLE_REFRESH_TOKEN) return { events: [], error: 'not_configured' };

  const start = zonedDayStart(day, TZ);
  // Not start + 24h: a Lisbon DST day is 23 or 25 hours long, which would drop
  // a late event in October and pull in a small-hours one in March.
  const end = zonedDayStart(nextDayStr(day), TZ);
  const calId = env.GOOGLE_CALENDAR_ID || 'primary';

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
  );
  url.searchParams.set('timeMin', start.toISOString());
  url.searchParams.set('timeMax', end.toISOString());
  url.searchParams.set('singleEvents', 'true'); // expands recurrences into instances
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '50');

  try {
    const token = await googleAccessToken(env);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { events: [], error: `google_${res.status}` };
    const data = await res.json();

    const events = (data.items || [])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => {
        const allDay = !!e.start?.date;
        let startMin = 0;
        let duration = 24 * 60;
        if (!allDay) {
          const sp = localParts(new Date(e.start.dateTime), TZ);
          const ep = localParts(new Date(e.end.dateTime), TZ);
          // Google returns anything overlapping the window, so an event can
          // start yesterday or end tomorrow. Clip it to this day.
          startMin = sp.date < day ? 0 : sp.min;
          const endMin = ep.date > day ? 1440 : ep.min;
          duration = Math.max(15, endMin - startMin);
        }
        return {
          id: e.id,
          title: e.summary || '(no title)',
          location: e.location || null,
          allDay,
          start_min: startMin,
          duration,
        };
      });
    return { events, error: null };
  } catch (e) {
    return { events: [], error: String(e.message || e) };
  }
}

// ── handlers ──────────────────────────────────────────────────────────

// FNV-1a. Any stable hash will do; the point is that a given date always picks
// the same quote, on every device, all day.
function dayHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function quoteForDay(env, day) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM quotes').first();
  if (!row?.n) return null;
  return env.DB.prepare('SELECT text, author FROM quotes ORDER BY id LIMIT 1 OFFSET ?')
    .bind(dayHash(day) % row.n).first();
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

async function handleDay(request, env, url) {
  const day = url.searchParams.get('date') || todayStr(TZ);
  if (!isValidDay(day)) return err('bad date', request);

  const [slotsRes, settings, cal, quote] = await Promise.all([
    // Floating blocks (start_min NULL) sort last; the client splits them out.
    env.DB.prepare(
      'SELECT * FROM slots WHERE day = ? ORDER BY start_min IS NULL, start_min',
    ).bind(day).all(),
    getSettings(env),
    calendarEvents(env, day),
    quoteForDay(env, day),
  ]);

  const slots = slotsRes.results;

  // Progress per lane = minutes of slots marked done today.
  const progress = {};
  for (const l of LANES) progress[l.key] = { planned: 0, done: 0 };
  for (const s of slots) {
    const p = progress[s.lane] || (progress[s.lane] = { planned: 0, done: 0 });
    p.planned += s.duration;
    if (s.done) p.done += s.duration;
  }

  const syncedAt = await env.DB.prepare(
    'SELECT MAX(synced_at) AS t FROM tasks',
  ).first();

  return json({
    day,
    today: todayStr(TZ),
    slots,
    events: cal.events,
    calendar_error: cal.error,
    progress,
    settings,
    lanes: LANES,
    quote,
    last_sync: syncedAt?.t || null,
  }, request);
}

async function handleTasks(request, env, url) {
  const lane = url.searchParams.get('lane');
  const q = url.searchParams.get('q');

  let sql = 'SELECT * FROM tasks WHERE done = 0';
  const binds = [];
  if (lane && lane !== 'all') { sql += ' AND lane = ?'; binds.push(lane); }
  if (q) { sql += ' AND title LIKE ?'; binds.push(`%${q}%`); }
  // P1 first, then most recently created.
  sql += " ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, created DESC LIMIT 300";

  const { results } = await env.DB.prepare(sql).bind(...binds).all();

  const { results: counts } = await env.DB.prepare(
    'SELECT lane, COUNT(*) AS n FROM tasks WHERE done = 0 GROUP BY lane',
  ).all();

  return json({
    tasks: results,
    counts: Object.fromEntries(counts.map((c) => [c.lane, c.n])),
  }, request);
}

async function createSlot(request, env) {
  const b = await request.json();
  if (!b.title || !b.lane) return err('title and lane required', request);
  const day = b.day || todayStr(TZ);
  if (!isValidDay(day)) return err('bad date', request);

  if (!LANES.some((l) => l.key === b.lane)) return err('bad lane', request);

  // null start_min is legitimate: a floating block, to be placed when the day
  // actually decides where it goes.
  let startMin = null;
  if (b.start_min !== null && b.start_min !== undefined) {
    startMin = Number(b.start_min);
    if (!Number.isFinite(startMin) || startMin < 0 || startMin > 1440) return err('bad start_min', request);
    startMin = Math.round(startMin);
  }

  const duration = Number(b.duration);
  if (!Number.isFinite(duration) || duration < 5 || duration > 720) return err('bad duration', request);

  const res = await env.DB.prepare(
    `INSERT INTO slots (day, lane, tana_id, title, start_min, duration, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).bind(
    day, b.lane, b.tana_id || null, b.title,
    startMin, Math.round(duration), b.note || null,
    new Date().toISOString(),
  ).first();

  return json(res, request, 201);
}

async function updateSlot(request, env, id) {
  const b = await request.json();
  const existing = await env.DB.prepare('SELECT * FROM slots WHERE id = ?').bind(id).first();
  if (!existing) return err('not found', request, 404);

  // Same bounds as createSlot: a negative duration would render a broken
  // timeline and push lane progress negative.
  // start_min: null is meaningful here, it unpins a block back to floating.
  if (b.start_min !== undefined && b.start_min !== null) {
    const v = Number(b.start_min);
    if (!Number.isFinite(v) || v < 0 || v > 1440) return err('bad start_min', request);
    b.start_min = Math.round(v);
  }
  if (b.duration !== undefined) {
    const v = Number(b.duration);
    if (!Number.isFinite(v) || v < 5 || v > 720) return err('bad duration', request);
    b.duration = Math.round(v);
  }
  if (b.lane !== undefined && !LANES.some((l) => l.key === b.lane)) return err('bad lane', request);
  if (b.title !== undefined && !String(b.title).trim()) return err('title required', request);

  const fields = [];
  const binds = [];
  for (const k of ['title', 'lane', 'start_min', 'duration', 'note']) {
    if (b[k] !== undefined) { fields.push(`${k} = ?`); binds.push(b[k]); }
  }
  if (b.done !== undefined) { fields.push('done = ?'); binds.push(b.done ? 1 : 0); }
  if (!fields.length) return json(existing, request);

  binds.push(id);
  const updated = await env.DB.prepare(
    `UPDATE slots SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
  ).bind(...binds).first();

  // Ticking off a slot that came from Tana queues a write-back. The Tana API is
  // write-only from out here, so the Mac agent is the only thing that can apply it.
  if (b.done !== undefined && existing.tana_id && !!b.done !== !!existing.done) {
    await env.DB.prepare(
      'INSERT INTO pending_writes (tana_id, op, created_at) VALUES (?, ?, ?)',
    ).bind(existing.tana_id, b.done ? 'complete' : 'uncomplete', new Date().toISOString()).run();

    await env.DB.prepare('UPDATE tasks SET done = ? WHERE tana_id = ?')
      .bind(b.done ? 1 : 0, existing.tana_id).run();
  }

  return json(updated, request);
}

async function handleSettings(request, env) {
  const b = await request.json();
  const stmts = Object.entries(b).map(([k, v]) =>
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(k, String(v)),
  );
  if (stmts.length) await env.DB.batch(stmts);
  return json(await getSettings(env), request);
}

// ── sync agent endpoints (separate key) ───────────────────────────────

async function syncTasks(request, env) {
  const b = await request.json();
  if (!Array.isArray(b.tasks)) return err('tasks[] required', request);

  const now = new Date().toISOString();
  const stmts = b.tasks.map((t) =>
    env.DB.prepare(
      `INSERT INTO tasks (tana_id, title, area, lane, priority, status, duration, done, breadcrumb, created, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tana_id) DO UPDATE SET
         title=excluded.title, area=excluded.area, lane=excluded.lane,
         priority=excluded.priority, status=excluded.status, duration=excluded.duration,
         done=excluded.done, breadcrumb=excluded.breadcrumb, synced_at=excluded.synced_at`,
    ).bind(
      t.tana_id, t.title || '(untitled)', t.area || null,
      t.lane || laneForArea(t.area), t.priority || null, t.status || null,
      t.duration ?? null, t.done ? 1 : 0, t.breadcrumb || null, t.created || null, now,
    ),
  );

  // D1 batches are capped; chunk to stay well under it.
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  // Anything the agent didn't mention is gone from Tana (deleted or trashed).
  // The agent only sets full when every node read cleanly.
  if (b.full === true && b.tasks.length) {
    await env.DB.prepare('DELETE FROM tasks WHERE synced_at < ?').bind(now).run();
  }

  // A tick landing between the agent's read and this push would be overwritten
  // by the upsert above, so the task would pop back into the list for an
  // interval. Its queued write is still authoritative, so re-assert it.
  await env.DB.prepare(
    `UPDATE tasks SET done = 1 WHERE tana_id IN (
       SELECT tana_id FROM pending_writes WHERE applied_at IS NULL AND op = 'complete')`,
  ).run();

  return json({ ok: true, count: b.tasks.length, synced_at: now }, request);
}

const MAX_ATTEMPTS = 5;

async function syncPending(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM pending_writes WHERE applied_at IS NULL AND attempts < ? ORDER BY id LIMIT 100',
  ).bind(MAX_ATTEMPTS).all();
  return json({ pending: results }, request);
}

async function syncAck(request, env) {
  const b = await request.json();
  const ids = Array.isArray(b.ids) ? b.ids : [];
  const failed = Array.isArray(b.failed) ? b.failed : [];
  const now = new Date().toISOString();

  const stmts = [];
  if (ids.length) {
    stmts.push(env.DB.prepare(
      `UPDATE pending_writes SET applied_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    ).bind(now, ...ids));
  }
  // A failure bumps attempts, so a permanently broken row eventually drops out
  // of the window instead of blocking everything behind it.
  for (const f of failed) {
    stmts.push(env.DB.prepare(
      'UPDATE pending_writes SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    ).bind(String(f.error || 'unknown').slice(0, 200), f.id));
  }
  if (stmts.length) await env.DB.batch(stmts);

  return json({ ok: true, acked: ids.length, failed: failed.length }, request);
}

// ── router ────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    const token = bearer(request);

    // The sync agent has its own key so a leaked browser key can't rewrite the mirror.
    if (path.startsWith('/api/sync/')) {
      if (!env.SYNC_KEY || !safeEqual(token, env.SYNC_KEY)) return err('unauthorized', request, 401);
      if (path === '/api/sync/tasks' && request.method === 'POST') return syncTasks(request, env);
      if (path === '/api/sync/pending' && request.method === 'GET') return syncPending(request, env);
      if (path === '/api/sync/ack' && request.method === 'POST') return syncAck(request, env);
      return err('not found', request, 404);
    }

    // Public: getting in. Rate limited inside; see auth.js.
    if (path === '/auth/request-code' && request.method === 'POST') {
      return requestCode(request, env,
        (d) => json(d, request), (m, s) => err(m, request, s));
    }
    if (path === '/auth/verify' && request.method === 'POST') {
      return verifyCode(request, env,
        (d) => json(d, request), (m, s) => err(m, request, s));
    }

    if (path.startsWith('/api/')) {
      if (!(await isAuthed(request, env))) return err('unauthorized', request, 401);

      if (path === '/api/day' && request.method === 'GET') return handleDay(request, env, url);
      if (path === '/api/tasks' && request.method === 'GET') return handleTasks(request, env, url);
      if (path === '/api/slots' && request.method === 'POST') return createSlot(request, env);
      if (path === '/api/settings' && request.method === 'GET') return json(await getSettings(env), request);
      if (path === '/api/settings' && request.method === 'PATCH') return handleSettings(request, env);

      const slotMatch = path.match(/^\/api\/slots\/(\d+)$/);
      if (slotMatch) {
        const id = Number(slotMatch[1]);
        if (request.method === 'PATCH') return updateSlot(request, env, id);
        if (request.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM slots WHERE id = ?').bind(id).run();
          return json({ ok: true }, request);
        }
      }
      return err('not found', request, 404);
    }

    return err('not found', request, 404);
  },
};
