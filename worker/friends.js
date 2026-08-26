// Friends on Daybook: connections, presence, and matching your contacts to
// people who are also on Daybook. Phase 1 - no cross-account data sharing yet;
// that lands in later phases behind explicit shares.
//
// The friends table holds one directed row per side: (me, them, status). A
// request writes 'out' for me and 'in' for them; accepting flips both to
// 'accepted'. Every query is scoped to env.uid.

const ONLINE_MS = 3 * 60 * 1000;
const isOnline = (lastSeen) => !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < ONLINE_MS;

export async function touchPresence(env) {
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(new Date().toISOString(), env.uid).run().catch(() => {});
  return { ok: true };
}

export async function getFriends(env) {
  const rows = (await env.DB.prepare(
    `SELECT f.friend_id AS id, f.status, f.can_assign, u.name, u.subdomain, u.last_seen
       FROM friends f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ? ORDER BY u.name`,
  ).bind(env.uid).all()).results || [];
  const map = (r) => ({ id: r.id, name: r.name || r.subdomain, subdomain: r.subdomain, canAssign: !!r.can_assign, online: isOnline(r.last_seen) });
  const friends = rows.filter((r) => r.status === 'accepted').map(map);
  const incoming = rows.filter((r) => r.status === 'in').map(map);
  const outgoing = rows.filter((r) => r.status === 'out').map(map);

  // Suggestions: my contacts whose email belongs to a Daybook account I'm not
  // already connected to.
  const connected = new Set(rows.map((r) => r.id)); connected.add(env.uid);
  const cts = (await env.DB.prepare("SELECT title, props FROM blocks WHERE kind='contact' AND archived=0 AND user_id=?").bind(env.uid).all()).results || [];
  const emails = [];
  for (const c of cts) { let p = {}; try { p = JSON.parse(c.props || '{}'); } catch {} if (p.email) emails.push([String(p.email).toLowerCase(), c.title]); }
  const suggestions = [];
  const uniq = [...new Set(emails.map((e) => e[0]))];
  if (uniq.length) {
    const ph = uniq.map(() => '?').join(',');
    const byEmail = {};
    const us = await env.DB.prepare(`SELECT id, name, subdomain, lower(email) AS em FROM users WHERE lower(email) IN (${ph})`).bind(...uniq).all().catch(() => ({ results: [] }));
    for (const r of us.results || []) byEmail[r.em] = r;
    const al = await env.DB.prepare(`SELECT lower(ue.email) AS em, u.id, u.name, u.subdomain FROM user_emails ue JOIN users u ON u.id = ue.user_id WHERE lower(ue.email) IN (${ph})`).bind(...uniq).all().catch(() => ({ results: [] }));
    for (const r of al.results || []) byEmail[r.em] = { id: r.id, name: r.name, subdomain: r.subdomain };
    const seen = new Set();
    for (const [em, title] of emails) { const u = byEmail[em]; if (u && !connected.has(u.id) && !seen.has(u.id)) { seen.add(u.id); suggestions.push({ id: u.id, name: u.name || u.subdomain, subdomain: u.subdomain, contactName: title }); } }
  }
  return { friends, incoming, outgoing, suggestions };
}

export async function requestFriend(env, targetId) {
  targetId = Number(targetId);
  if (!targetId || targetId === env.uid) throw new Error('That is not a valid person to add.');
  // If they already asked me, accept instead of creating a duplicate.
  const existing = await env.DB.prepare('SELECT status FROM friends WHERE user_id=? AND friend_id=?').bind(env.uid, targetId).first().catch(() => null);
  if (existing && existing.status === 'in') return acceptFriend(env, targetId);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?,?,'out',?)").bind(env.uid, targetId, now),
    env.DB.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?,?,'in',?)").bind(targetId, env.uid, now),
  ]);
  return getFriends(env);
}
export async function acceptFriend(env, id) {
  id = Number(id);
  await env.DB.batch([
    env.DB.prepare("UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=?").bind(env.uid, id),
    env.DB.prepare("UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=?").bind(id, env.uid),
  ]);
  return getFriends(env);
}
export async function removeFriend(env, id) {
  id = Number(id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friends WHERE user_id=? AND friend_id=?').bind(env.uid, id),
    env.DB.prepare('DELETE FROM friends WHERE user_id=? AND friend_id=?').bind(id, env.uid),
  ]);
  return getFriends(env);
}
