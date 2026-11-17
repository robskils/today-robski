// The Exchange: a shared shelf where someone publishes one of their notes and others
// find it and Take a copy into their own Kaya. Deliberately plain - no likes, counts,
// rankings or badges; it's a place where notes get swapped, not a marketplace.
//
// How it hangs together, reusing what already exists:
//   - Sharing a note reuses the public-note machinery: the note gets an unguessable
//     `props.shareToken`, so it reads at /n/<token> like any published note. The
//     Exchange adds a row that lists it on the shelf.
//   - The instance owner (user 1) curates: a member's share lands PENDING and goes
//     live only when the owner approves it. The owner's own shares go live at once.
//   - "Take" is a real fork of the note block into the taker's own notes - theirs to
//     edit, adapt or abandon - with a quiet "from <author>" in its props. Never a
//     locked product.
//   - Attribution is per note: share under your name/handle, or anonymously.

const OWNER_ID = 1;                                     // the instance owner curates the shelf
const now = () => new Date().toISOString();
const tok = () => crypto.randomUUID().replace(/-/g, ''); // 32 hex - matches the /n/<token> route
const previewOf = (body, max = 180) => String(body || '').replace(/\s+/g, ' ').trim().slice(0, max);

// Share one of my own notes to The Exchange. One tap from any note: ensure it has a
// public token, then lodge a row. A member's row is PENDING (awaits the owner); the
// owner's own goes live at once. Re-sharing updates the row (and reopens a declined
// one to pending). `anon` hides my name on the shelf.
export async function submitToExchange(env, blockId, opts = {}) {
  const anon = opts.anon ? 1 : 0;
  const row = await env.DB.prepare("SELECT title, body, props FROM blocks WHERE id = ? AND user_id = ? AND kind = 'note' AND archived = 0").bind(blockId, env.uid).first();
  if (!row) throw new Error('note not found');
  let props = {}; try { props = row.props ? JSON.parse(row.props) : {}; } catch { props = {}; }
  if (!props.shareToken) {
    props.shareToken = tok();
    await env.DB.prepare('UPDATE blocks SET props = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(JSON.stringify(props), now(), blockId, env.uid).run();
  }
  const title = row.title || 'A note';
  const preview = previewOf(row.body);
  const goLive = env.uid === OWNER_ID;
  const status = goLive ? 'live' : 'pending';
  const existing = await env.DB.prepare('SELECT id FROM exchange WHERE block_id = ?').bind(blockId).first();
  if (existing) {
    await env.DB.prepare('UPDATE exchange SET token = ?, anon = ?, title = ?, preview = ?, status = ?, submitted_at = ?, reviewed_at = ? WHERE id = ?')
      .bind(props.shareToken, anon, title, preview, status, now(), goLive ? now() : null, existing.id).run();
  } else {
    await env.DB.prepare('INSERT INTO exchange (block_id, owner_id, token, status, anon, title, preview, submitted_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(blockId, env.uid, props.shareToken, status, anon, title, preview, now(), goLive ? now() : null).run();
  }
  return { ok: true, status };
}

// The share state of one of my notes, for its own UI: 'none' | 'pending' | 'live' |
// 'unlisted' | 'declined', plus whether it was shared anonymously.
export async function exchangeStatusFor(env, blockId) {
  const r = await env.DB.prepare('SELECT status, anon FROM exchange WHERE block_id = ? AND owner_id = ?').bind(blockId, env.uid).first();
  return { status: (r && r.status) || 'none', anon: !!(r && r.anon) };
}

// Pull my note off the shelf. The row goes; the note and its /n/ link are untouched.
export async function withdrawFromExchange(env, blockId) {
  await env.DB.prepare('DELETE FROM exchange WHERE block_id = ? AND owner_id = ?').bind(blockId, env.uid).run();
  return { ok: true };
}

// Browse the live shelf, newest first. Author is the sharer's name/handle, or
// 'Anonymous'. mine = I shared it; took = I already have a copy.
export async function browseExchange(env, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 48, 1), 100);
  const q = String(opts.q || '').trim();
  const binds = [];
  let sql = `SELECT e.id, e.owner_id, e.token, e.anon, e.title, e.preview, e.submitted_at, e.reviewed_at,
                    u.name AS owner_name, u.subdomain AS owner_sub
             FROM exchange e JOIN users u ON u.id = e.owner_id WHERE e.status = 'live'`;
  if (q) { sql += ' AND (e.title LIKE ? OR e.preview LIKE ?)'; binds.push('%' + q + '%', '%' + q + '%'); }
  sql += ' ORDER BY e.reviewed_at DESC, e.id DESC LIMIT ?'; binds.push(limit);
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  const taken = new Set();
  try {
    const mine = (await env.DB.prepare("SELECT json_extract(props,'$.takenFromId') AS t FROM blocks WHERE user_id = ? AND kind = 'note' AND archived = 0 AND json_extract(props,'$.takenFromId') IS NOT NULL").bind(env.uid).all()).results || [];
    for (const m of mine) if (m.t != null) taken.add(Number(m.t));
  } catch {}
  return {
    items: rows.map((r) => ({
      id: r.id,
      token: r.token,
      url: `https://kaya.so/n/${r.token}`,
      title: r.title || 'A note',
      preview: r.preview || '',
      author: r.anon ? 'Anonymous' : (r.owner_name || r.owner_sub || 'Someone'),
      handle: r.anon ? '' : (r.owner_sub || ''),
      when: r.reviewed_at || r.submitted_at,
      mine: r.owner_id === env.uid,
      took: taken.has(r.id),
    })),
  };
}

// OWNER ONLY: the queue of notes waiting to go on the shelf.
export async function pendingExchange(env) {
  if (env.uid !== OWNER_ID) throw new Error('not allowed');
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.token, e.anon, e.title, e.preview, e.submitted_at, u.name AS owner_name, u.subdomain AS owner_sub
     FROM exchange e JOIN users u ON u.id = e.owner_id WHERE e.status = 'pending' ORDER BY e.submitted_at ASC`,
  ).all()).results || [];
  return {
    items: rows.map((r) => ({
      id: r.id,
      token: r.token,
      url: `https://kaya.so/n/${r.token}`,
      title: r.title || 'A note',
      preview: r.preview || '',
      author: (r.owner_name || r.owner_sub || 'Someone') + (r.anon ? ' (name hidden on the shelf)' : ''),
      when: r.submitted_at,
    })),
  };
}

// OWNER ONLY: approve a pending note onto the shelf, or decline it.
export async function reviewExchange(env, id, action) {
  if (env.uid !== OWNER_ID) throw new Error('not allowed');
  const status = action === 'approve' ? 'live' : 'declined';
  await env.DB.prepare("UPDATE exchange SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'").bind(status, now(), Number(id)).run();
  return { ok: true, status };
}

// OWNER ONLY: take a live note back off the shelf (hidden, record kept).
export async function unlistExchange(env, id) {
  if (env.uid !== OWNER_ID) throw new Error('not allowed');
  await env.DB.prepare("UPDATE exchange SET status = 'unlisted', reviewed_at = ? WHERE id = ?").bind(now(), Number(id)).run();
  return { ok: true };
}

// Take a copy of a shelf note into my own Notes: a real fork of the block, mine to
// keep, edit or abandon, with a quiet "from <author>" in its props.
export async function takeFromExchange(env, id) {
  const e = await env.DB.prepare("SELECT e.block_id, e.owner_id, e.anon, u.name AS owner_name, u.subdomain AS owner_sub FROM exchange e JOIN users u ON u.id = e.owner_id WHERE e.id = ? AND e.status = 'live'").bind(Number(id)).first();
  if (!e) throw new Error('that note is no longer on the shelf');
  const src = await env.DB.prepare("SELECT title, body FROM blocks WHERE id = ? AND kind = 'note' AND archived = 0").bind(e.block_id).first();
  if (!src) throw new Error('that note is no longer available');
  const author = e.anon ? 'The Exchange' : (e.owner_name || e.owner_sub || 'The Exchange');
  // Only the words come across - no share token, no Space filing, no sharing. The
  // copy is the taker's own, cleanly.
  const props = { takenFrom: author, takenFromId: Number(id), takenAt: now() };
  const nid = crypto.randomUUID();
  const n = now();
  const posRow = await env.DB.prepare('SELECT COALESCE(MAX(position)+1,0) AS p FROM blocks WHERE parent_id IS NULL AND user_id = ?').bind(env.uid).first();
  await env.DB.prepare(
    `INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived, user_id)
     VALUES (?, 'note', NULL, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).bind(nid, posRow.p, src.title || 'A note', src.body || '', JSON.stringify(props), n, n, env.uid).run();
  return { ok: true, id: nid, title: src.title || 'A note', from: author };
}

// Dispatcher for /api/exchange and /api/exchange/*. Mounted in the authed section of
// the router, so env.uid is always set.
export async function handleExchange(request, env, path, json, err) {
  try {
    if (path === '/api/exchange' && request.method === 'GET') {
      const u = new URL(request.url);
      return json(await browseExchange(env, { q: u.searchParams.get('q') || '', limit: u.searchParams.get('limit') }), request);
    }
    if (path === '/api/exchange/status' && request.method === 'GET') {
      const u = new URL(request.url);
      return json(await exchangeStatusFor(env, u.searchParams.get('block')), request);
    }
    if (path === '/api/exchange/submit' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return json(await submitToExchange(env, b.block, { anon: !!b.anon }), request, 201);
    }
    if (path === '/api/exchange/withdraw' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return json(await withdrawFromExchange(env, b.block), request);
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
    return err('not found', request, 404);
  } catch (e) {
    return err(e.message || 'error', request, e.message === 'not allowed' ? 403 : 400);
  }
}
