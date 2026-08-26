// Meeting notes (Daybook Friends): one shared note per pair of friends, taken
// together during a call. Reuses the sharing machinery - the note is a normal
// kind='note' block owned by whoever opened it first, shared with the other side
// (can_edit=1), so both edit the one block and the client's live-sync poll keeps
// them roughly in step. The `meetings` table keys it by the sorted user pair so
// either person reaches the same note, and there's never a duplicate.

import { areFriends } from './friends.js';

export async function openMeeting(env, friendId) {
  friendId = Number(friendId);
  if (!friendId || friendId === env.uid) throw new Error('Pick a friend.');
  if (!(await areFriends(env, friendId))) throw new Error('You can only take shared notes with someone you are connected to.');
  const lo = Math.min(env.uid, friendId), hi = Math.max(env.uid, friendId);

  const existing = await env.DB.prepare('SELECT note_id FROM meetings WHERE lo = ? AND hi = ?').bind(lo, hi).first().catch(() => null);
  if (existing) {
    const b = await env.DB.prepare("SELECT id FROM blocks WHERE id = ? AND kind = 'note' AND archived = 0").bind(existing.note_id).first().catch(() => null);
    if (b) {
      // Heal a lost share (e.g. it was unshared) so both sides keep access. The
      // share is always owner -> the OTHER member of the pair, whichever that is.
      await env.DB.prepare("INSERT OR IGNORE INTO shares (block_id, owner_id, friend_id, can_edit, created_at) SELECT ?, user_id, CASE WHEN user_id = ? THEN ? ELSE ? END, 1, ? FROM blocks WHERE id = ?")
        .bind(existing.note_id, lo, hi, lo, new Date().toISOString(), existing.note_id).run().catch(() => {});
      return { noteId: existing.note_id };
    }
    await env.DB.prepare('DELETE FROM meetings WHERE lo = ? AND hi = ?').bind(lo, hi).run();
  }

  const f = (await env.DB.prepare('SELECT name, subdomain FROM users WHERE id = ?').bind(friendId).first().catch(() => null)) || {};
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived, user_id) VALUES (?, 'note', NULL, 0, ?, ?, ?, ?, ?, 0, ?)")
      .bind(id, `Notes with ${f.name || f.subdomain || 'a friend'}`, '', JSON.stringify({ meeting: true }), now, now, env.uid),
    env.DB.prepare('INSERT OR IGNORE INTO shares (block_id, owner_id, friend_id, can_edit, created_at) VALUES (?, ?, ?, 1, ?)').bind(id, env.uid, friendId, now),
    env.DB.prepare('INSERT OR IGNORE INTO meetings (lo, hi, note_id, created_at) VALUES (?, ?, ?, ?)').bind(lo, hi, id, now),
  ]);
  // If the other side won a simultaneous create, drop my orphan and use theirs.
  const win = await env.DB.prepare('SELECT note_id FROM meetings WHERE lo = ? AND hi = ?').bind(lo, hi).first().catch(() => null);
  if (win && win.note_id !== id) { await env.DB.prepare('DELETE FROM blocks WHERE id = ? AND user_id = ?').bind(id, env.uid).run().catch(() => {}); return { noteId: win.note_id }; }
  return { noteId: id, created: true };
}
