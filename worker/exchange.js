// The Exchange: a shared shelf where someone publishes one of their notes or routines
// and others find it and Take a copy into their own Kaya. A note copies into Notes; a
// routine copies into Routines. One accent of warmth - a quiet "arigato" anyone can
// give an item that helped them - but no ranking, no badges, no author leaderboard;
// it's a place where good things get passed on, not a marketplace.
//
// How it hangs together, reusing what already exists:
//   - Sharing a NOTE reuses the public-note machinery: the note gets an unguessable
//     `props.shareToken`, so it reads at /n/<token> like any published note.
//   - Sharing a ROUTINE lists the activities row; it has no public page, so it's
//     previewed in-app. block_id holds the synthetic key 'act-<id>' so the unique
//     index still gives one shelf row per routine.
//   - The instance owner (user 1) curates: a member's share lands PENDING and goes
//     live only when the owner approves it. The owner's own shares go live at once.
//   - "Take" is a real fork into the taker's own Notes / Routines - theirs to edit,
//     adapt or abandon - with a quiet "from <author>" recorded. Never a locked product.
//   - Attribution is per item: share under your name/handle, or anonymously.
//   - "Arigato" is one row per (item, person) in exchange_kudos: anonymous, reversible,
//     shown only as a count. You can't thank your own share.

const OWNER_ID = 1;                                     // the instance owner curates the shelf
const now = () => new Date().toISOString();
const tok = () => crypto.randomUUID().replace(/-/g, ''); // 32 hex - matches the /n/<token> route
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ');
const previewOf = (body, max = 180) => stripTags(body).replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const kindOf = (r) => (r && r.kind) || 'note';          // NULL kind (pre-migration rows) = a note
const actKey = (id) => 'act-' + Number(id);             // a routine's synthetic block_id
const routineHasVideo = (a) => {
  if (a.video) return true;
  try { const m = a.meta ? JSON.parse(a.meta) : null; return !!(m && Array.isArray(m.videos) && m.videos.some((v) => v && v.url)); } catch { return false; }
};
const routineMeta = (a) => JSON.stringify({ cadence: a.cadence || '', days: a.days || '', duration: Number(a.duration) || 0, hasVideo: routineHasVideo(a) });

// Share one of my own notes to The Exchange. One tap from any note: ensure it has a
// public token, then lodge a row. A member's row is PENDING (awaits the owner); the
// owner's own goes live at once. Re-sharing updates the row. `anon` hides my name.
export async function submitToExchange(env, blockId, opts = {}) {
  const anon = opts.anon ? 1 : 0;
  const row = await env.DB.prepare("SELECT title, body, props FROM blocks WHERE id = ? AND user_id = ? AND kind = 'note' AND archived = 0").bind(blockId, env.uid).first();
  if (!row) throw new Error('note not found');
  let props = {}; try { props = row.props ? JSON.parse(row.props) : {}; } catch { props = {}; }
  if (!props.shareToken) {
    props.shareToken = tok();
    await env.DB.prepare('UPDATE blocks SET props = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(JSON.stringify(props), now(), blockId, env.uid).run();
  }
  return lodge(env, { blockId, kind: 'note', activityId: null, token: props.shareToken, meta: null, title: row.title || 'A note', preview: previewOf(row.body), anon });
}

// Share one of my own routines to The Exchange. Same curation path; no public token
// (routines preview in-app). The display meta (rhythm, video) rides on the row.
export async function submitRoutineToExchange(env, activityId, opts = {}) {
  const anon = opts.anon ? 1 : 0;
  const a = await env.DB.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').bind(Number(activityId), env.uid).first();
  if (!a) throw new Error('routine not found');
  return lodge(env, { blockId: actKey(activityId), kind: 'routine', activityId: Number(activityId), token: '', meta: routineMeta(a), title: a.title || 'A routine', preview: previewOf(a.note), anon });
}

// Insert or refresh one shelf row. A member's lands pending; the owner's goes live.
// Re-sharing updates in place (and reopens a declined one to pending).
async function lodge(env, { blockId, kind, activityId, token, meta, title, preview, anon }) {
  const goLive = env.uid === OWNER_ID;
  const status = goLive ? 'live' : 'pending';
  const existing = await env.DB.prepare('SELECT id FROM exchange WHERE block_id = ?').bind(blockId).first();
  if (existing) {
    await env.DB.prepare('UPDATE exchange SET token = ?, anon = ?, title = ?, preview = ?, status = ?, submitted_at = ?, reviewed_at = ?, kind = ?, activity_id = ?, meta = ? WHERE id = ?')
      .bind(token, anon, title, preview, status, now(), goLive ? now() : null, kind, activityId, meta, existing.id).run();
  } else {
    await env.DB.prepare('INSERT INTO exchange (block_id, owner_id, token, status, anon, title, preview, submitted_at, reviewed_at, kind, activity_id, meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(blockId, env.uid, token, status, anon, title, preview, now(), goLive ? now() : null, kind, activityId, meta).run();
  }
  return { ok: true, status };
}

// The share state of one of my items, for its own UI: 'none' | 'pending' | 'live' |
// 'unlisted' | 'declined', plus whether it was shared anonymously.
export async function exchangeStatusFor(env, blockId) {
  const r = await env.DB.prepare('SELECT status, anon FROM exchange WHERE block_id = ? AND owner_id = ?').bind(blockId, env.uid).first();
  return { status: (r && r.status) || 'none', anon: !!(r && r.anon) };
}
export async function routineExchangeStatusFor(env, activityId) {
  const r = await env.DB.prepare('SELECT status, anon FROM exchange WHERE activity_id = ? AND owner_id = ? AND kind = ?').bind(Number(activityId), env.uid, 'routine').first();
  return { status: (r && r.status) || 'none', anon: !!(r && r.anon) };
}

// Pull my item off the shelf. The row goes; the note/routine itself is untouched.
export async function withdrawFromExchange(env, blockId) {
  await env.DB.prepare('DELETE FROM exchange WHERE block_id = ? AND owner_id = ?').bind(blockId, env.uid).run();
  return { ok: true };
}
export async function withdrawRoutineFromExchange(env, activityId) {
  await env.DB.prepare('DELETE FROM exchange WHERE activity_id = ? AND owner_id = ? AND kind = ?').bind(Number(activityId), env.uid, 'routine').run();
  return { ok: true };
}

// Which shelf rows have I already taken a copy of - notes (props.takenFromId) and
// routines (activities.meta.takenFromExchangeId) both point back at the exchange id.
async function takenIds(env) {
  const taken = new Set();
  try {
    const n = (await env.DB.prepare("SELECT json_extract(props,'$.takenFromId') AS t FROM blocks WHERE user_id = ? AND kind = 'note' AND archived = 0 AND json_extract(props,'$.takenFromId') IS NOT NULL").bind(env.uid).all()).results || [];
    for (const r of n) if (r.t != null) taken.add(Number(r.t));
  } catch {}
  try {
    const r = (await env.DB.prepare("SELECT json_extract(meta,'$.takenFromExchangeId') AS t FROM activities WHERE user_id = ? AND json_extract(meta,'$.takenFromExchangeId') IS NOT NULL").bind(env.uid).all()).results || [];
    for (const x of r) if (x.t != null) taken.add(Number(x.t));
  } catch {}
  return taken;
}

// Browse the live shelf. filter: 'all' | 'note' | 'routine'. sort: 'recent' (newest
// first) | 'appreciated' (most arigato first). Each item carries its arigato count and
// whether I gave one. mine = I shared it; took = I already have a copy.
export async function browseExchange(env, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 60, 1), 100);
  const q = String(opts.q || '').trim();
  const filter = ['note', 'routine'].includes(opts.filter) ? opts.filter : 'all';
  const sort = opts.sort === 'appreciated' ? 'appreciated' : 'recent';
  const binds = [env.uid];
  let sql = `SELECT e.id, e.owner_id, e.token, e.anon, e.title, e.preview, e.submitted_at, e.reviewed_at,
                    COALESCE(e.kind,'note') AS kind, e.activity_id, e.meta,
                    u.name AS owner_name, u.subdomain AS owner_sub,
                    (SELECT COUNT(*) FROM exchange_kudos k WHERE k.exchange_id = e.id) AS kudos,
                    (SELECT COUNT(*) FROM exchange_kudos k WHERE k.exchange_id = e.id AND k.user_id = ?) AS mine_kudo
             FROM exchange e JOIN users u ON u.id = e.owner_id WHERE e.status = 'live'`;
  if (filter !== 'all') { sql += " AND COALESCE(e.kind,'note') = ?"; binds.push(filter); }
  if (q) { sql += ' AND (e.title LIKE ? OR e.preview LIKE ?)'; binds.push('%' + q + '%', '%' + q + '%'); }
  sql += sort === 'appreciated' ? ' ORDER BY kudos DESC, e.reviewed_at DESC, e.id DESC LIMIT ?' : ' ORDER BY e.reviewed_at DESC, e.id DESC LIMIT ?';
  binds.push(limit);
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  const taken = await takenIds(env);
  return { items: rows.map((r) => shelfItem(r, env, taken)) };
}

function parseMeta(m) { try { return m ? JSON.parse(m) : {}; } catch { return {}; } }
function shelfItem(r, env, taken) {
  const kind = kindOf(r);
  return {
    id: r.id,
    kind,
    token: r.token || '',
    url: kind === 'note' && r.token ? `https://kaya.so/n/${r.token}` : '',
    title: r.title || (kind === 'routine' ? 'A routine' : 'A note'),
    preview: r.preview || '',
    rhythm: kind === 'routine' ? parseMeta(r.meta) : null,
    author: r.anon ? 'Anonymous' : (r.owner_name || r.owner_sub || 'Someone'),
    handle: r.anon ? '' : (r.owner_sub || ''),
    when: r.reviewed_at || r.submitted_at,
    mine: r.owner_id === env.uid,
    took: taken.has(r.id),
    kudos: Number(r.kudos) || 0,
    kudoed: !!Number(r.mine_kudo),
  };
}

// OWNER ONLY: the queue of items waiting to go on the shelf.
export async function pendingExchange(env) {
  if (env.uid !== OWNER_ID) throw new Error('not allowed');
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.token, e.anon, e.title, e.preview, e.submitted_at, COALESCE(e.kind,'note') AS kind, e.activity_id, e.meta,
            u.name AS owner_name, u.subdomain AS owner_sub
     FROM exchange e JOIN users u ON u.id = e.owner_id WHERE e.status = 'pending' ORDER BY e.submitted_at ASC`,
  ).all()).results || [];
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: kindOf(r),
      token: r.token || '',
      url: kindOf(r) === 'note' && r.token ? `https://kaya.so/n/${r.token}` : '',
      title: r.title || (kindOf(r) === 'routine' ? 'A routine' : 'A note'),
      preview: r.preview || '',
      rhythm: kindOf(r) === 'routine' ? parseMeta(r.meta) : null,
      author: (r.owner_name || r.owner_sub || 'Someone') + (r.anon ? ' (name hidden on the shelf)' : ''),
      when: r.submitted_at,
    })),
  };
}

// OWNER ONLY: approve a pending item onto the shelf, or decline it.
export async function reviewExchange(env, id, action) {
  if (env.uid !== OWNER_ID) throw new Error('not allowed');
  const status = action === 'approve' ? 'live' : 'declined';
  await env.DB.prepare("UPDATE exchange SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'").bind(status, now(), Number(id)).run();
  return { ok: true, status };
}

// OWNER ONLY: take a live item back off the shelf (hidden, record kept).
export async function unlistExchange(env, id) {
  if (env.uid !== OWNER_ID) throw new Error('not allowed');
  await env.DB.prepare("UPDATE exchange SET status = 'unlisted', reviewed_at = ? WHERE id = ?").bind(now(), Number(id)).run();
  return { ok: true };
}

// The full read of one shelf item, for an in-app preview. A routine has no public
// page, so this is how you look before you take: its rhythm, instructions and video.
export async function previewExchangeItem(env, id) {
  const e = await env.DB.prepare("SELECT id, token, anon, title, preview, COALESCE(kind,'note') AS kind, activity_id, meta, status, owner_id FROM exchange WHERE id = ?").bind(Number(id)).first();
  if (!e || (e.status !== 'live' && !(env.uid === OWNER_ID && e.status === 'pending'))) throw new Error('that item is no longer on the shelf');
  if (kindOf(e) !== 'routine') return { kind: 'note', title: e.title || 'A note', token: e.token || '', url: e.token ? `https://kaya.so/n/${e.token}` : '' };
  const a = await env.DB.prepare('SELECT title, note, video, meta FROM activities WHERE id = ?').bind(Number(e.activity_id)).first();
  if (!a) throw new Error('that routine is no longer available');
  const vids = [];
  if (a.video) vids.push(a.video);
  try { const m = a.meta ? JSON.parse(a.meta) : null; if (m && Array.isArray(m.videos)) for (const v of m.videos) if (v && v.url) vids.push(v.url); } catch {}
  return { kind: 'routine', title: a.title || e.title || 'A routine', rhythm: parseMeta(e.meta), note: a.note || '', videos: [...new Set(vids)] };
}

// Take a copy of a shelf NOTE into my own Notes: a real fork of the block, mine to
// keep, edit or abandon, with a quiet "from <author>" in its props.
async function takeNote(env, e, author) {
  const src = await env.DB.prepare("SELECT title, body FROM blocks WHERE id = ? AND kind = 'note' AND archived = 0").bind(e.block_id).first();
  if (!src) throw new Error('that note is no longer available');
  const props = { takenFrom: author, takenFromId: Number(e.id), takenAt: now() };
  const nid = crypto.randomUUID();
  const n = now();
  const posRow = await env.DB.prepare('SELECT COALESCE(MAX(position)+1,0) AS p FROM blocks WHERE parent_id IS NULL AND user_id = ?').bind(env.uid).first();
  await env.DB.prepare(
    `INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived, user_id)
     VALUES (?, 'note', NULL, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).bind(nid, posRow.p, src.title || 'A note', src.body || '', JSON.stringify(props), n, n, env.uid).run();
  return { ok: true, kind: 'note', id: nid, title: src.title || 'A note', from: author };
}

// Take a copy of a shelf ROUTINE into my own Routines: a fresh activities row from the
// live source, mine to keep. It comes across UNFILED: no Space (area = NULL) and the
// neutral 'other' lane, never the sharer's own lane - their "Personal" (or any other)
// grouping is theirs, not mine, so a taken routine must not land in a folder I didn't
// choose (Robin, 2026-11-20). The rhythm, instructions and video do come across.
async function takeRoutine(env, e, author) {
  const a = await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(Number(e.activity_id)).first();
  if (!a) throw new Error('that routine is no longer available');
  const n = now();
  const lane = 'other';   // the catch-all; keeps it out of any named Space/lane the taker didn't pick
  const pos = await env.DB.prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM activities WHERE lane = ? AND user_id = ?').bind(lane, env.uid).first();
  let meta = {}; try { meta = a.meta ? JSON.parse(a.meta) : {}; } catch { meta = {}; }
  // Only the shape of the routine travels - not the sharer's private connections.
  const takerMeta = { takenFrom: author, takenFromExchangeId: Number(e.id), takenAt: n };
  if (Array.isArray(meta.videos)) takerMeta.videos = meta.videos.filter((v) => v && v.url).map((v) => ({ url: v.url, title: v.title || '' }));
  const r = await env.DB.prepare(
    `INSERT INTO activities (lane, title, url, duration, position, user_id, area, note, video, timed, tracked, days, time_min, cadence, priority, avoid, avoid_since, meta)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
  ).bind(lane, a.title || 'A routine', a.url || null, Number(a.duration) || 30, pos.p, env.uid, null, a.note || null, a.video || null,
    a.timed == null ? 1 : a.timed, a.tracked == null ? 1 : a.tracked, a.days || null, a.time_min != null ? a.time_min : null,
    a.cadence || null, a.priority || null, 0, null, JSON.stringify(takerMeta)).first();
  return { ok: true, kind: 'routine', id: r && r.id, title: a.title || 'A routine', from: author };
}

export async function takeFromExchange(env, id) {
  const e = await env.DB.prepare("SELECT e.id, e.block_id, e.owner_id, e.anon, COALESCE(e.kind,'note') AS kind, e.activity_id, u.name AS owner_name, u.subdomain AS owner_sub FROM exchange e JOIN users u ON u.id = e.owner_id WHERE e.id = ? AND e.status = 'live'").bind(Number(id)).first();
  if (!e) throw new Error('that item is no longer on the shelf');
  const author = e.anon ? 'The Exchange' : (e.owner_name || e.owner_sub || 'The Exchange');
  return kindOf(e) === 'routine' ? takeRoutine(env, e, author) : takeNote(env, e, author);
}

// Give or take back a quiet "arigato". Anonymous and reversible; you can't thank your
// own share. Returns the new state for the one card.
export async function toggleKudo(env, id) {
  const e = await env.DB.prepare("SELECT id, owner_id, status FROM exchange WHERE id = ?").bind(Number(id)).first();
  if (!e || e.status !== 'live') throw new Error('that item is no longer on the shelf');
  const count = async () => Number((await env.DB.prepare('SELECT COUNT(*) AS c FROM exchange_kudos WHERE exchange_id = ?').bind(Number(id)).first()).c) || 0;
  if (e.owner_id === env.uid) return { ok: true, kudoed: false, kudos: await count(), own: true }; // can't thank yourself
  const have = await env.DB.prepare('SELECT 1 FROM exchange_kudos WHERE exchange_id = ? AND user_id = ?').bind(Number(id), env.uid).first();
  if (have) await env.DB.prepare('DELETE FROM exchange_kudos WHERE exchange_id = ? AND user_id = ?').bind(Number(id), env.uid).run();
  else await env.DB.prepare('INSERT OR IGNORE INTO exchange_kudos (exchange_id, user_id, created_at) VALUES (?,?,?)').bind(Number(id), env.uid, now()).run();
  return { ok: true, kudoed: !have, kudos: await count() };
}

// Dispatcher for /api/exchange and /api/exchange/*. Mounted in the authed section of
// the router, so env.uid is always set.
export async function handleExchange(request, env, path, json, err) {
  try {
    if (path === '/api/exchange' && request.method === 'GET') {
      const u = new URL(request.url);
      return json(await browseExchange(env, { q: u.searchParams.get('q') || '', limit: u.searchParams.get('limit'), filter: u.searchParams.get('filter') || 'all', sort: u.searchParams.get('sort') || 'recent' }), request);
    }
    if (path === '/api/exchange/status' && request.method === 'GET') {
      const u = new URL(request.url);
      const act = u.searchParams.get('activity');
      return json(act ? await routineExchangeStatusFor(env, act) : await exchangeStatusFor(env, u.searchParams.get('block')), request);
    }
    if (path === '/api/exchange/preview' && request.method === 'GET') {
      const u = new URL(request.url);
      return json(await previewExchangeItem(env, u.searchParams.get('id')), request);
    }
    if (path === '/api/exchange/submit' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const r = b.kind === 'routine' || b.activity != null
        ? await submitRoutineToExchange(env, b.activity != null ? b.activity : b.block, { anon: !!b.anon })
        : await submitToExchange(env, b.block, { anon: !!b.anon });
      return json(r, request, 201);
    }
    if (path === '/api/exchange/withdraw' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return json(b.activity != null ? await withdrawRoutineFromExchange(env, b.activity) : await withdrawFromExchange(env, b.block), request);
    }
    if (path === '/api/exchange/pending' && request.method === 'GET') return json(await pendingExchange(env), request);
    if (path === '/api/exchange/review' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return json(await reviewExchange(env, b.id, b.action), request);
    }
    if (path === '/api/exchange/unlist' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return json(await unlistExchange(env, b.id), request);
    }
    if (path === '/api/exchange/take' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return json(await takeFromExchange(env, b.id), request, 201);
    }
    if (path === '/api/exchange/kudo' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return json(await toggleKudo(env, b.id), request);
    }
    return err('not found', request, 404);
  } catch (e) {
    return err(e.message || 'error', request, e.message === 'not allowed' ? 403 : 400);
  }
}
