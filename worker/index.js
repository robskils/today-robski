import { LANES, laneForArea } from '../shared/lanes.js';
import { isAuthed, requestCode, verifyCode } from './auth.js';
import { briefDue, briefEmail, briefSubject } from './brief.js';

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

// Activity URLs end up in an href. Anything but http(s) is refused, because
// `javascript:` in a link is a script you didn't write running as you.
function safeUrl(u) {
  const s = String(u ?? '').trim();
  if (!s) return null;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
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
  if (!res.ok) {
    const body = await res.text();
    console.error('google token:', res.status, body);
    // A dead refresh token is the one failure Robin can actually fix, and it
    // reads as a wall of JSON otherwise. Say what to do instead.
    if (body.includes('invalid_grant')) {
      throw new Error('Calendar sign-in has expired. Run npm run google-auth to reconnect.');
    }
    throw new Error(`google token: ${res.status} ${body}`);
  }
  const data = await res.json();
  // The scopes a refresh token carries are fixed at consent. Logging them turns
  // "why is this 403ing" into a one-line answer.
  console.log('google scope:', data.scope || '(none reported)');
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

// Create a real event on the Google calendar. Needs the calendar.events scope:
// the original consent asked only for calendar.readonly, and a refresh token
// carries the scopes it was granted with, so this 403s until google-auth is
// re-run. The error says so rather than leaving you guessing.
async function createEvent(request, env) {
  if (!env.GOOGLE_REFRESH_TOKEN) return err('Calendar not connected', request, 503);

  const b = await request.json().catch(() => ({}));
  const title = String(b.title || '').trim();
  if (!title) return err('title required', request);

  const day = b.day || todayStr(TZ);
  if (!isValidDay(day)) return err('bad date', request);

  const startMin = Number(b.start_min);
  const duration = Number(b.duration);
  if (!Number.isFinite(startMin) || startMin < 0 || startMin > 1440) return err('bad start', request);
  if (!Number.isFinite(duration) || duration < 5 || duration > 1440) return err('bad duration', request);

  // Wall-clock minutes -> a real instant, via the day's local midnight, so the
  // event lands at the time meant on either side of a DST change.
  const base = zonedDayStart(day, TZ).getTime();
  const startAt = new Date(base + startMin * 60000);
  const endAt = new Date(base + (startMin + duration) * 60000);

  try {
    const token = await googleAccessToken(env);
    const calId = env.GOOGLE_CALENDAR_ID || 'primary';
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: title,
          location: String(b.location || '').trim() || undefined,
          start: { dateTime: startAt.toISOString(), timeZone: TZ },
          end: { dateTime: endAt.toISOString(), timeZone: TZ },
        }),
      },
    );

    if (res.status === 401 || res.status === 403) {
      console.error('google create event:', res.status, await res.text());
      return err('Calendar is connected read-only. Re-run npm run google-auth to allow writing.', request, 403);
    }
    if (!res.ok) {
      console.error('google create event:', res.status, await res.text());
      return err('Google would not take that event.', request, 502);
    }

    const ev = await res.json();
    return json({ ok: true, id: ev.id }, request, 201);
  } catch (e) {
    console.error('createEvent:', e.message);
    return err('Could not reach Google Calendar.', request, 502);
  }
}

// Google keeps a deleted event in the calendar's bin for 30 days, so this is
// undoable at their end. Still the only destructive reach this app has outside
// its own D1, hence the confirm step in the UI.
async function deleteEvent(request, env, id) {
  if (!env.GOOGLE_REFRESH_TOKEN) return err('Calendar not connected', request, 503);

  try {
    const token = await googleAccessToken(env);
    const calId = env.GOOGLE_CALENDAR_ID || 'primary';
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );

    // 410 means it was already gone. That is the outcome the caller wanted, so
    // treat it as success rather than making them look at an error for it.
    if (res.ok || res.status === 410) return json({ ok: true }, request);

    if (res.status === 401 || res.status === 403) {
      console.error('google delete event:', res.status, await res.text());
      return err('Calendar is connected read-only. Re-run npm run google-auth to allow writing.', request, 403);
    }
    if (res.status === 404) return err('That event is not on the calendar.', request, 404);

    console.error('google delete event:', res.status, await res.text());
    return err('Google would not delete that event.', request, 502);
  } catch (e) {
    console.error('deleteEvent:', e.message);
    return err(e.message.startsWith('Calendar sign-in') ? e.message : 'Could not reach Google Calendar.', request, 502);
  }
}

// ── backup / export ───────────────────────────────────────────────────

// Everything the app owns, in one JSON file. The escape hatch: whatever happens
// to this worker, the data is downloadable and portable. otp_codes is left out
// (transient login codes, nothing to preserve); everything else goes in.
const EXPORT_TABLES = [
  'blocks', 'block_links',
  'tasks', 'slots', 'slot_tasks',
  'activities', 'settings', 'tana_options', 'quotes', 'pending_writes',
];

async function handleExport(request, env) {
  const dump = {};
  for (const t of EXPORT_TABLES) {
    // Table names here are a fixed allow-list, never user input.
    const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all();
    dump[t] = results;
  }
  const now = new Date();
  const payload = {
    app: 'robski-life',
    version: 1,
    exported_at: now.toISOString(),
    counts: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])),
    tables: dump,
  };
  const day = now.toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="robski-backup-${day}.json"`,
      ...cors(request),
    },
  });
}

// ── blocks: the Robski Life core API ──────────────────────────────────
//
// One set of endpoints for everything the Life app owns. A task, a note, an
// area, a table, a row - all blocks, told apart by `kind`. props is a JSON bag
// of typed fields (a task's status/area, an area's colour), so new field types
// need no schema change. This is native, owned data - nothing syncs it.

function parseBlock(row) {
  if (!row) return null;
  let props = {};
  try { props = row.props ? JSON.parse(row.props) : {}; } catch { props = {}; }
  return { ...row, props, archived: !!row.archived };
}

async function getBlock(env, id) {
  const row = await env.DB.prepare('SELECT * FROM blocks WHERE id = ?').bind(id).first();
  if (!row) return null;
  const block = parseBlock(row);
  // Backlinks: who points at me. Cheap, and the notes/links phase will lean on it.
  const links = await env.DB.prepare('SELECT to_id FROM block_links WHERE from_id = ?').bind(id).all();
  const back = await env.DB.prepare('SELECT from_id FROM block_links WHERE to_id = ?').bind(id).all();
  block.links = links.results.map((r) => r.to_id);
  block.backlinks = back.results.map((r) => r.from_id);
  return block;
}

async function createBlock(request, env) {
  const b = await request.json().catch(() => ({}));
  const kind = String(b.kind || '').trim();
  if (!kind) return err('kind required', request);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const parent = b.parent_id || null;

  // Default position: after the last sibling, so a new block lands at the end.
  let position = Number(b.position);
  if (!Number.isFinite(position)) {
    const row = await env.DB.prepare(
      'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM blocks WHERE parent_id IS ?',
    ).bind(parent).first();
    position = row.p;
  }

  await env.DB.prepare(
    `INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).bind(id, kind, parent, position, b.title ?? null, b.body ?? null,
    b.props ? JSON.stringify(b.props) : null, now, now).run();

  if (Array.isArray(b.links)) {
    for (const to of b.links) {
      await env.DB.prepare('INSERT OR IGNORE INTO block_links (from_id, to_id) VALUES (?, ?)')
        .bind(id, String(to)).run();
    }
  }
  return json(await getBlock(env, id), request, 201);
}

async function listBlocks(request, env, url) {
  const clauses = [];
  const args = [];
  const kind = url.searchParams.get('kind');
  if (kind) { clauses.push('kind = ?'); args.push(kind); }
  if (url.searchParams.has('parent_id')) {
    clauses.push('parent_id IS ?'); args.push(url.searchParams.get('parent_id') || null);
  }
  if (url.searchParams.get('archived') !== '1') clauses.push('archived = 0');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await env.DB.prepare(
    `SELECT * FROM blocks ${where} ORDER BY position, created_at`,
  ).bind(...args).all();
  return json(results.map(parseBlock), request);
}

async function updateBlock(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM blocks WHERE id = ?').bind(id).first();
  if (!existing) return err('not found', request, 404);
  const b = await request.json().catch(() => ({}));

  const sets = [];
  const args = [];
  if ('title' in b) { sets.push('title = ?'); args.push(b.title); }
  if ('body' in b) { sets.push('body = ?'); args.push(b.body); }
  if ('position' in b) { sets.push('position = ?'); args.push(Number(b.position)); }
  if ('parent_id' in b) { sets.push('parent_id = ?'); args.push(b.parent_id || null); }
  if ('archived' in b) { sets.push('archived = ?'); args.push(b.archived ? 1 : 0); }
  if ('props' in b) {
    // Merge, so a caller can set one field without resending the whole bag.
    let cur = {};
    try { cur = existing.props ? JSON.parse(existing.props) : {}; } catch { cur = {}; }
    sets.push('props = ?'); args.push(JSON.stringify({ ...cur, ...b.props }));
  }
  sets.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  await env.DB.prepare(`UPDATE blocks SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();

  if (Array.isArray(b.links)) {
    await env.DB.prepare('DELETE FROM block_links WHERE from_id = ?').bind(id).run();
    for (const to of b.links) {
      await env.DB.prepare('INSERT OR IGNORE INTO block_links (from_id, to_id) VALUES (?, ?)')
        .bind(id, String(to)).run();
    }
  }
  return json(await getBlock(env, id), request);
}

async function deleteBlock(env, request, id) {
  // Re-parent orphaned children to this block's parent, so a deleted area or
  // note doesn't strand whatever lived under it.
  const row = await env.DB.prepare('SELECT parent_id FROM blocks WHERE id = ?').bind(id).first();
  if (!row) return err('not found', request, 404);
  await env.DB.batch([
    env.DB.prepare('UPDATE blocks SET parent_id = ? WHERE parent_id = ?').bind(row.parent_id, id),
    env.DB.prepare('DELETE FROM block_links WHERE from_id = ? OR to_id = ?').bind(id, id),
    env.DB.prepare('DELETE FROM blocks WHERE id = ?').bind(id),
  ]);
  return json({ ok: true }, request);
}

// One box to find anything. Searches every block by title and body, so tasks,
// notes, table rows and areas all come back from the same query. LIKE for now;
// swap to SQLite FTS if it ever feels slow.
async function searchBlocks(request, env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 1) return json([], request);
  // Strip LIKE wildcards from the query so a stray % or _ can't match everything.
  const like = `%${q.replace(/[%_\\]/g, '')}%`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM blocks
      WHERE archived = 0 AND (title LIKE ? OR body LIKE ?)
      ORDER BY updated_at DESC LIMIT 50`,
  ).bind(like, like).all();
  return json(results.map(parseBlock), request);
}

// ── SMS alerts ────────────────────────────────────────────────────────

// Send one SMS through GatewayAPI. Lifted from the LST admin's routes/sms.js,
// the setup Robin already has credit on: his own number as the sender, so an
// alert reads as a text from himself. Needs GATEWAYAPI_KEY and ALERT_PHONE
// (the recipient) as secrets; without either, alerting is simply off.
async function sendSms(env, message) {
  const to = String(env.ALERT_PHONE || '').replace(/\D/g, '');
  if (!env.GATEWAYAPI_KEY || !to) return { ok: false, skipped: 'not configured' };

  // Robin's account is on GatewayAPI's EU platform, whose tokens are rejected
  // by the default gatewayapi.com host with a bare "Invalid token" - the one
  // difference that had every send 401ing. Overridable, but defaults to EU.
  const host = env.GATEWAYAPI_HOST || 'gatewayapi.eu';
  const res = await fetch(`https://${host}/rest/mtsms`, {
    method: 'POST',
    headers: { Authorization: `Token ${env.GATEWAYAPI_KEY}`, ...JSON_HEADERS },
    body: JSON.stringify({
      // Alphanumeric sender: an alert isn't a conversation, and it's the same
      // brand the rest of the tool carries. Falls back to the LST number if
      // a network rejects a lettered sender.
      sender: env.ALERT_SENDER || 'Robski',
      message,
      recipients: [{ msisdn: to }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('gatewayapi:', res.status, detail);
    return { ok: false, status: res.status, detail };
  }
  return { ok: true, ...(await res.json()) };
}

// Fired by the cron trigger every minute. Finds today's timed blocks starting
// in about five minutes that haven't been alerted for this start time, and
// texts one line about each. alerted_min holds the start it fired for: move a
// block and it re-arms, leave it and it never fires twice, even if the cron
// runs late and the block appears in two consecutive windows.
async function runAlerts(env) {
  const now = localParts(new Date(), TZ);          // { date, min } in Lisbon
  const target = now.min + 5;

  // A 3-minute window (4-6 min out) absorbs a skipped or late cron tick
  // without alerting twice, since alerted_min guards the repeat.
  const due = await env.DB.prepare(
    `SELECT id, lane, title, start_min FROM slots
      WHERE day = ? AND start_min IS NOT NULL
        AND start_min BETWEEN ? AND ?
        AND (alerted_min IS NULL OR alerted_min != start_min)`,
  ).bind(now.date, target - 1, target + 1).all();

  const rows = due.results || [];
  for (const s of rows) {
    const when = `${String((s.start_min / 60) | 0).padStart(2, '0')}:${String(s.start_min % 60).padStart(2, '0')}`;
    const mins = s.start_min - now.min;
    const r = await sendSms(env, `You have ${s.title} starting in ${mins} minutes (${when}).`);
    // Only mark it sent if it actually sent. A GatewayAPI hiccup should let the
    // next tick try again while the block is still inside the window.
    if (r.ok) {
      await env.DB.prepare('UPDATE slots SET alerted_min = ? WHERE id = ?')
        .bind(s.start_min, s.id).run();
    }
  }
  return { checked: now, due: rows.length };
}

// ── the morning brief ─────────────────────────────────────────────────

// Sent once a day at 08:45, off the same every-minute cron as the alerts.
//
// It lives here rather than in a Claude routine because a routine in the cloud
// cannot read Tana: the API is write-only and the MCP bridge is on the Mac. The
// worker has both halves already, the calendar through its own refresh token
// and the tasks through the D1 mirror, so the brief is complete rather than
// half a day.
//
// The tasks side is a mirror the Mac agent refreshes every 15 minutes. If the
// Mac slept all night the P1 list is however old the last sync was, which is
// the same staleness the web app has always had and is fine for a list that
// changes daily, not hourly.
// `force` is the preview button: it sends today's brief on demand and never
// touches last_brief_day, so testing it at noon cannot swallow tomorrow's.
async function runDailyBrief(env, { force = false } = {}) {
  const now = localParts(new Date(), TZ);
  if (!force) {
    const last = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_brief_day'").first();
    if (!briefDue(now.min, now.date, last?.value)) return { sent: false, reason: 'not due' };

    // Claim the day before sending, not after. Two ticks a minute apart both
    // reading "not sent yet" would otherwise send twice, and a duplicate brief
    // is worse than a late one. The UPDATE only fires when the stored day is
    // actually different, so `changes` tells us whether this tick won the claim.
    const claim = await env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES ('last_brief_day', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value
          WHERE settings.value <> excluded.value`,
    ).bind(now.date).run();
    if (!claim.meta?.changes) return { sent: false, reason: 'already claimed' };
  }

  try {
    const [cal, quote, tasksRes] = await Promise.all([
      calendarEvents(env, now.date),
      quoteForDay(env, now.date),
      // Every open P1. Ordered oldest first: a P1 that has sat for a month is
      // the one that most deserves to be read first.
      env.DB.prepare(
        `SELECT title, lane FROM tasks
          WHERE done = 0 AND priority = 'P1'
          ORDER BY created IS NULL, created LIMIT 25`,
      ).all(),
    ]);

    // A calendar failure must not cost Robin the rest of the brief. The empty
    // list reads as "nothing scheduled", so say so explicitly instead.
    if (cal.error) console.error('brief calendar:', cal.error);

    const labels = Object.fromEntries(LANES.map((l) => [l.key, l.label]));
    const tasks = (tasksRes.results || []).map((t) => ({
      title: t.title,
      lane_label: t.lane && t.lane !== 'other' ? labels[t.lane] : null,
    }));

    const payload = { day: now.date, events: cal.events, tasks, quote };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [env.BRIEF_EMAIL],
        subject: briefSubject(payload),
        html: briefEmail(payload),
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status} ${await res.text()}`);
    return { sent: true, events: cal.events.length, tasks: tasks.length };
  } catch (e) {
    // Hand the day back so a later tick inside the window can try again. A
    // Resend blip before 10:15 should cost a few minutes, not the brief.
    if (!force) {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'last_brief_day' AND value = ?")
        .bind(now.date).run();
    }
    throw e;
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

  const [slotsRes, settings, cal, quote, actsRes, linksRes] = await Promise.all([
    // Floating blocks (start_min NULL) sort last; the client splits them out.
    env.DB.prepare(
      'SELECT * FROM slots WHERE day = ? ORDER BY start_min IS NULL, start_min',
    ).bind(day).all(),
    getSettings(env),
    calendarEvents(env, day),
    quoteForDay(env, day),
    env.DB.prepare('SELECT * FROM activities ORDER BY lane, position, id').all(),
    // The tasks inside each of today's blocks, in one query rather than one
    // per block.
    env.DB.prepare(
      `SELECT st.slot_id, st.position, st.duration AS slot_duration,
              t.tana_id, t.title, t.lane, t.priority, t.done, t.duration AS task_duration
         FROM slot_tasks st
         JOIN slots s ON s.id = st.slot_id
         LEFT JOIN tasks t ON t.tana_id = st.tana_id
        WHERE s.day = ?
        ORDER BY st.slot_id, st.position`,
    ).bind(day).all(),
  ]);

  const slots = slotsRes.results;

  const byslot = new Map();
  for (const r of linksRes.results) {
    // LEFT JOIN: a task trashed in Tana leaves the link but no row.
    if (!r.tana_id) continue;
    if (!byslot.has(r.slot_id)) byslot.set(r.slot_id, []);
    byslot.get(r.slot_id).push({
      tana_id: r.tana_id, title: r.title, lane: r.lane,
      priority: r.priority, done: r.done,
      // This task's own length in this block: the per-link value if set, else
      // its Tana Duration, else null (the client shows a default).
      duration: r.slot_duration ?? r.task_duration ?? null,
    });
  }
  for (const s of slots) s.tasks = byslot.get(s.id) || [];

  // Progress per lane.
  //
  // A block carrying tasks is done when it's ticked. A category block - a bare
  // practice, no task behind it - is done the moment it's on the schedule: you
  // don't complete an hour of Music, you just do it, so it counts on placement
  // and shows no tick. `practice` tells the client to leave the checkbox off.
  const progress = {};
  for (const l of LANES) progress[l.key] = { planned: 0, done: 0 };
  for (const s of slots) {
    s.practice = !((s.tasks && s.tasks.length) || s.tana_id);
    const p = progress[s.lane] || (progress[s.lane] = { planned: 0, done: 0 });
    p.planned += s.duration;
    if (s.practice || s.done) p.done += s.duration;
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
    activities: actsRes.results,
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

  // Adopting a calendar event into a lane. The unique index is what actually
  // stops a double count, since a double click races past any read-then-write.
  const eventId = b.event_id ? String(b.event_id).slice(0, 256) : null;

  let res;
  try {
    res = await env.DB.prepare(
      `INSERT INTO slots (day, lane, tana_id, title, start_min, duration, note, url, event_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(
      day, b.lane, b.tana_id || null, b.title,
      startMin, Math.round(duration), b.note || null, safeUrl(b.url), eventId,
      new Date().toISOString(),
    ).first();
  } catch (e) {
    if (eventId && /UNIQUE|constraint/i.test(e.message)) {
      return err('That event is already counted.', request, 409);
    }
    throw e;
  }

  // A block created from a task starts as a one-task container.
  if (b.tana_id) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO slot_tasks (slot_id, tana_id, position) VALUES (?, ?, 0)',
    ).bind(res.id, b.tana_id).run();
  }

  res.tasks = [];
  return json(res, request, 201);
}

// Drop a task into an existing block. Blocks hold any number.
async function addSlotTask(request, env, slotId) {
  const b = await request.json().catch(() => ({}));
  const tanaId = String(b.tana_id || '').trim();
  if (!tanaId) return err('tana_id required', request);

  const slot = await env.DB.prepare('SELECT id FROM slots WHERE id = ?').bind(slotId).first();
  if (!slot) return err('not found', request, 404);
  const task = await env.DB.prepare('SELECT tana_id FROM tasks WHERE tana_id = ?').bind(tanaId).first();
  if (!task) return err('no such task', request, 404);

  const next = await env.DB.prepare(
    'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM slot_tasks WHERE slot_id = ?',
  ).bind(slotId).first();

  await env.DB.prepare(
    'INSERT OR IGNORE INTO slot_tasks (slot_id, tana_id, position) VALUES (?, ?, ?)',
  ).bind(slotId, tanaId, next.p).run();

  return json({ ok: true }, request);
}

async function removeSlotTask(env, request, slotId, tanaId) {
  await env.DB.prepare('DELETE FROM slot_tasks WHERE slot_id = ? AND tana_id = ?')
    .bind(slotId, tanaId).run();
  return json({ ok: true }, request);
}

// Set how long a task is meant to take inside a block. Touches only the link,
// never slots.duration - a task's length and its block's length are separate.
async function setSlotTaskDuration(env, request, slotId, tanaId) {
  const b = await request.json().catch(() => ({}));
  const duration = Number(b.duration);
  if (!Number.isFinite(duration) || duration < 5 || duration > 720) {
    return err('bad duration', request);
  }
  const res = await env.DB.prepare(
    'UPDATE slot_tasks SET duration = ? WHERE slot_id = ? AND tana_id = ?',
  ).bind(Math.round(duration), slotId, tanaId).run();
  if (!res.meta.changes) return err('not in that block', request, 404);
  return json({ ok: true }, request);
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

  if (b.url !== undefined) b.url = safeUrl(b.url);

  const fields = [];
  const binds = [];
  for (const k of ['title', 'lane', 'start_min', 'duration', 'note', 'url']) {
    if (b[k] !== undefined) { fields.push(`${k} = ?`); binds.push(b[k]); }
  }
  if (b.done !== undefined) { fields.push('done = ?'); binds.push(b.done ? 1 : 0); }
  if (!fields.length) return json(existing, request);

  binds.push(id);
  const updated = await env.DB.prepare(
    `UPDATE slots SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
  ).bind(...binds).first();

  // Ticking a block ticks everything in it. The block is the session; saying it
  // happened says its contents happened. A block you only half finished is one
  // you leave open, and tick the tasks inside individually.
  if (b.done !== undefined && !!b.done !== !!existing.done) {
    // Only the ones actually changing. A task already ticked inside the block
    // would otherwise queue a second identical write to Tana.
    const { results } = await env.DB.prepare(
      `SELECT st.tana_id FROM slot_tasks st
         JOIN tasks t ON t.tana_id = st.tana_id
        WHERE st.slot_id = ? AND t.done != ?`,
    ).bind(id, b.done ? 1 : 0).all();
    for (const r of results) await setTaskDone(env, r.tana_id, !!b.done);
  }

  return json(updated, request);
}

// One place for "a Tana task changed state", so ticking a task in the list and
// ticking its scheduled block behave identically.
//
// The Tana API is write-only from out here, so the queue is the only way home:
// the Mac agent replays pending_writes on its next pass.
async function setTaskDone(env, tanaId, done) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO pending_writes (tana_id, op, created_at) VALUES (?, ?, ?)')
      .bind(tanaId, done ? 'complete' : 'uncomplete', new Date().toISOString()),
    env.DB.prepare('UPDATE tasks SET done = ? WHERE tana_id = ?')
      .bind(done ? 1 : 0, tanaId),

    // A block holding exactly this one task *is* this task, so it follows: tick
    // the task and the ring counts the time, which is what you meant.
    //
    // A block holding several is a session. Finishing one of five tasks doesn't
    // finish the hour, so it stays open and you tick the block when it's over.
    env.DB.prepare(
      `UPDATE slots SET done = ?
        WHERE id IN (SELECT slot_id FROM slot_tasks WHERE tana_id = ?)
          AND (SELECT COUNT(*) FROM slot_tasks x WHERE x.slot_id = slots.id) = 1`,
    ).bind(done ? 1 : 0, tanaId),
  ]);
}

async function updateTask(request, env, tanaId) {
  const b = await request.json().catch(() => ({}));
  const existing = await env.DB.prepare('SELECT done, title FROM tasks WHERE tana_id = ?')
    .bind(tanaId).first();
  if (!existing) return err('not found', request, 404);

  // Rename: flows to Tana as a search-and-replace, so it carries the old title
  // (the mirror's current one) and the new. Successive renames chain, each old
  // being the previous new, so edit_node always finds its target.
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title) return err('title required', request);
    if (title !== existing.title) {
      await env.DB.batch([
        env.DB.prepare('UPDATE tasks SET title = ? WHERE tana_id = ?').bind(title, tanaId),
        // A block titled after the task keeps in step; a category block that
        // merely holds it keeps its own name.
        env.DB.prepare('UPDATE slots SET title = ? WHERE tana_id = ? AND title = ?')
          .bind(title, tanaId, existing.title),
        env.DB.prepare('INSERT INTO pending_writes (tana_id, op, payload, created_at) VALUES (?, ?, ?, ?)')
          .bind(tanaId, 'rename', JSON.stringify({ old: existing.title, new: title }), new Date().toISOString()),
      ]);
    }
  }

  if (b.done !== undefined && !!b.done !== !!existing.done) {
    await setTaskDone(env, tanaId, !!b.done);
  }

  return json({ ok: true, tana_id: tanaId }, request);
}

// ── activities ────────────────────────────────────────────────────────

async function createActivity(request, env) {
  const b = await request.json().catch(() => ({}));
  const title = String(b.title || '').trim();
  if (!title) return err('title required', request);
  if (!LANES.some((l) => l.key === b.lane)) return err('bad lane', request);

  const duration = Number(b.duration);
  if (!Number.isFinite(duration) || duration < 5 || duration > 720) return err('bad duration', request);

  const next = await env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM activities WHERE lane = ?',
  ).bind(b.lane).first();

  const row = await env.DB.prepare(
    `INSERT INTO activities (lane, title, url, duration, position)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
  ).bind(b.lane, title, safeUrl(b.url), Math.round(duration), next.p).first();

  return json(row, request, 201);
}

async function updateActivity(request, env, id) {
  const b = await request.json().catch(() => ({}));
  if (b.lane !== undefined && !LANES.some((l) => l.key === b.lane)) return err('bad lane', request);
  if (b.title !== undefined && !String(b.title).trim()) return err('title required', request);
  if (b.duration !== undefined) {
    const d = Number(b.duration);
    if (!Number.isFinite(d) || d < 5 || d > 720) return err('bad duration', request);
    b.duration = Math.round(d);
  }
  if (b.url !== undefined) b.url = safeUrl(b.url);

  const fields = [];
  const binds = [];
  for (const k of ['lane', 'title', 'url', 'duration', 'position']) {
    if (b[k] !== undefined) { fields.push(`${k} = ?`); binds.push(b[k]); }
  }
  if (!fields.length) return err('nothing to update', request);

  binds.push(id);
  const row = await env.DB.prepare(
    `UPDATE activities SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
  ).bind(...binds).first();
  if (!row) return err('not found', request, 404);
  return json(row, request);
}

// ── new task -> Tana ──────────────────────────────────────────────────

// The Input API would put a task into Tana instantly, but it needs a workspace
// token that isn't findable in the current Tana UI. The Mac already has write
// access through the MCP bridge - it's how ticks get home - so a new task takes
// the same road: queue it, the agent builds it, within 15 minutes.
//
// The row is written here first with a local: id so the task shows up straight
// away. The agent swaps in the real node id once Tana has it, and the mirror
// prune skips local: rows so an unsent one isn't swept away meanwhile.
async function createTask(request, env) {
  const b = await request.json().catch(() => ({}));
  const title = String(b.title || '').trim();
  if (!title) return err('title required', request);

  const duration = b.duration ? Math.round(Number(b.duration)) : null;
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
    return err('bad duration', request);
  }

  const localId = `local:${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // Area and Priority are references to real nodes, so the client sends ids it
  // got from /api/tana-options rather than free text.
  const payload = JSON.stringify({
    title,
    area_id: b.area_id || null,
    priority_id: b.priority_id || null,
    duration,
  });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tasks (tana_id, title, area, lane, priority, status, duration, done, breadcrumb, created, synced_at)
       VALUES (?, ?, ?, ?, ?, 'Backlog', ?, 0, 'Inbox', ?, ?)`,
    ).bind(localId, title, b.area || null, laneForArea(b.area), b.priority || null, duration, now, now),
    env.DB.prepare(
      'INSERT INTO pending_writes (tana_id, op, payload, created_at) VALUES (?, ?, ?, ?)',
    ).bind(localId, 'create', payload, now),
  ]);

  return json({ ok: true, tana_id: localId, pending: true }, request, 201);
}

// The agent calls this once Tana has minted the real node id, so every
// reference to the placeholder moves across in one go.
async function syncCreated(request, env) {
  const b = await request.json().catch(() => ({}));
  const localId = String(b.local_id || '');
  const tanaId = String(b.tana_id || '');
  if (!localId.startsWith('local:') || !tanaId) return err('local_id and tana_id required', request);

  await env.DB.batch([
    env.DB.prepare('UPDATE tasks SET tana_id = ? WHERE tana_id = ?').bind(tanaId, localId),
    env.DB.prepare('UPDATE slot_tasks SET tana_id = ? WHERE tana_id = ?').bind(tanaId, localId),
    env.DB.prepare('UPDATE slots SET tana_id = ? WHERE tana_id = ?').bind(tanaId, localId),
    // Any tick made while it was still local: has to point at the real node too,
    // or the completion is replayed against an id Tana has never heard of.
    env.DB.prepare(
      "UPDATE pending_writes SET tana_id = ? WHERE tana_id = ? AND op != 'create'",
    ).bind(tanaId, localId),
  ]);

  return json({ ok: true }, request);
}

// The Area and Priority pickers need real node ids. They're mirrored by the
// agent so the worker can serve them without reaching Tana.
async function tanaOptions(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT kind, node_id, name FROM tana_options ORDER BY kind, name, node_id',
  ).all();

  // Tana has more than one node for some Life Areas (two "Art", two "Portugal"),
  // so the mirror does too. The picker only wants one entry per name - a task's
  // lane is decided by the area's name, not which duplicate node it points at.
  // node_id order makes the kept node deterministic across reloads.
  const dedupe = (kind) => {
    const seen = new Set();
    return results.filter((r) => {
      if (r.kind !== kind || seen.has(r.name)) return false;
      seen.add(r.name);
      return true;
    });
  };

  return json({
    areas: dedupe('area'),
    priorities: dedupe('priority'),
  }, request);
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
    // Skip local: rows. They're tasks made in +New that Tana hasn't minted an
    // id for yet, so the agent's pull can't mention them, and pruning them
    // would delete a task you just typed.
    await env.DB.prepare(
      "DELETE FROM tasks WHERE synced_at < ? AND tana_id NOT LIKE 'local:%'",
    ).bind(now).run();
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

async function syncOptions(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!Array.isArray(b.options)) return err('options[] required', request);

  const stmts = b.options.map((o) =>
    env.DB.prepare(
      `INSERT INTO tana_options (node_id, kind, name) VALUES (?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET kind = excluded.kind, name = excluded.name`,
    ).bind(o.node_id, o.kind, o.name),
  );
  if (stmts.length) await env.DB.batch(stmts);

  // Drop anything renamed or deleted in Tana.
  if (b.options.length) {
    const ids = b.options.map((o) => o.node_id);
    await env.DB.prepare(
      `DELETE FROM tana_options WHERE node_id NOT IN (${ids.map(() => '?').join(',')})`,
    ).bind(...ids).run();
  }

  return json({ ok: true, count: b.options.length }, request);
}

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
  // Cloudflare fires this on the cron schedule in wrangler.toml. waitUntil
  // keeps the isolate alive until the sends finish.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env).catch((e) => console.error('runAlerts:', e.message)));
    // Both run off the same every-minute tick. The brief returns immediately on
    // all but one tick a day, so this costs a single indexed D1 read a minute.
    ctx.waitUntil(runDailyBrief(env).catch((e) => console.error('runDailyBrief:', e.message)));
  },

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
      if (path === '/api/sync/options' && request.method === 'POST') return syncOptions(request, env);
      if (path === '/api/sync/pending' && request.method === 'GET') return syncPending(request, env);
      if (path === '/api/sync/ack' && request.method === 'POST') return syncAck(request, env);
      if (path === '/api/sync/created' && request.method === 'POST') return syncCreated(request, env);
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
      if (path === '/api/export' && request.method === 'GET') return handleExport(request, env);

      // Robski Life block core + search.
      if (path === '/api/blocks' && request.method === 'GET') return listBlocks(request, env, url);
      if (path === '/api/blocks' && request.method === 'POST') return createBlock(request, env);
      if (path === '/api/search' && request.method === 'GET') return searchBlocks(request, env, url);
      const blockMatch = path.match(/^\/api\/blocks\/([\w-]+)$/);
      if (blockMatch) {
        const id = blockMatch[1];
        if (request.method === 'GET') {
          const block = await getBlock(env, id);
          return block ? json(block, request) : err('not found', request, 404);
        }
        if (request.method === 'PATCH') return updateBlock(request, env, id);
        if (request.method === 'DELETE') return deleteBlock(env, request, id);
      }
      if (path === '/api/tasks' && request.method === 'GET') return handleTasks(request, env, url);
      if (path === '/api/tasks' && request.method === 'POST') return createTask(request, env);
      if (path === '/api/tana-options' && request.method === 'GET') return tanaOptions(request, env);
      if (path === '/api/slots' && request.method === 'POST') return createSlot(request, env);
      if (path === '/api/events' && request.method === 'POST') return createEvent(request, env);
      // Send one alert now, to prove the SMS path end to end without waiting
      // for a block to come due. Authed, like everything below the gate.
      if (path === '/api/alert/test' && request.method === 'POST') {
        const r = await sendSms(env, 'You have Zazen starting in 5 minutes (07:00). [test]');
        return json(r, request, r.ok ? 200 : 502);
      }
      // Send today's brief now, to see it in the inbox without waiting for
      // 08:45. Does not consume the day: tomorrow's still goes out.
      if (path === '/api/brief/test' && request.method === 'POST') {
        try {
          return json(await runDailyBrief(env, { force: true }), request);
        } catch (e) {
          return err(String(e.message || e), request, 502);
        }
      }
      if (path === '/api/activities' && request.method === 'POST') return createActivity(request, env);
      if (path === '/api/settings' && request.method === 'GET') return json(await getSettings(env), request);
      if (path === '/api/settings' && request.method === 'PATCH') return handleSettings(request, env);

      // Tana ids look like -2io-VjFpQOl: word chars and hyphens.
      const taskMatch = path.match(/^\/api\/tasks\/([\w-]+)$/);
      if (taskMatch && request.method === 'PATCH') return updateTask(request, env, taskMatch[1]);

      // Google event ids are base32hex-ish, plus '_' on recurring instances.
      const evMatch = path.match(/^\/api\/events\/([\w-]+)$/);
      if (evMatch && request.method === 'DELETE') return deleteEvent(request, env, evMatch[1]);

      const actMatch = path.match(/^\/api\/activities\/(\d+)$/);
      if (actMatch) {
        const id = Number(actMatch[1]);
        if (request.method === 'PATCH') return updateActivity(request, env, id);
        if (request.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(id).run();
          return json({ ok: true }, request);
        }
      }

      // Tasks inside a block.
      const slotTasksMatch = path.match(/^\/api\/slots\/(\d+)\/tasks$/);
      if (slotTasksMatch && request.method === 'POST') {
        return addSlotTask(request, env, Number(slotTasksMatch[1]));
      }
      const slotTaskMatch = path.match(/^\/api\/slots\/(\d+)\/tasks\/([\w-]+)$/);
      if (slotTaskMatch && request.method === 'DELETE') {
        return removeSlotTask(env, request, Number(slotTaskMatch[1]), slotTaskMatch[2]);
      }
      if (slotTaskMatch && request.method === 'PATCH') {
        return setSlotTaskDuration(env, request, Number(slotTaskMatch[1]), slotTaskMatch[2]);
      }

      const slotMatch = path.match(/^\/api\/slots\/(\d+)$/);
      if (slotMatch) {
        const id = Number(slotMatch[1]);
        if (request.method === 'PATCH') return updateSlot(request, env, id);
        if (request.method === 'DELETE') {
          // No FK cascade in D1 by default, so clear the links by hand or they
          // outlive the block and leak into the next slot to reuse the id.
          await env.DB.batch([
            env.DB.prepare('DELETE FROM slot_tasks WHERE slot_id = ?').bind(id),
            env.DB.prepare('DELETE FROM slots WHERE id = ?').bind(id),
          ]);
          return json({ ok: true }, request);
        }
      }
      return err('not found', request, 404);
    }

    return err('not found', request, 404);
  },
};
