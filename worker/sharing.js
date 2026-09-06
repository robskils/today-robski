// Cross-account sharing of individual notes & tasks with friends (Daybook
// Friends, phase 3a). One `shares` row grants one friend access to one block.
// can_edit = 1 means collaborative (the default Robin chose); 0 is view-only.
//
// The security rule lives in one place - blockAccess() in index.js re-derives
// access from ownership + shares on every read and write, never trusting the
// client. This module only manages the share rows, and every mutating call is
// gated twice: you must OWN the block, and you must be FRIENDS with the person
// you share it to. A block that stops being owned by you, or a friendship that
// ends, cuts the access at the access-check, not here.

import { areFriends } from './friends.js';

// Blocks you're allowed to hand to a friend. A note or task is self-contained; a
// table also brings its rows, and a life area brings whatever is tagged to it -
// access to those children is derived in blockAccess()/listBlocks() in index.js.
const SHAREABLE = new Set(['note', 'task', 'table', 'area']);

async function ownsBlock(env, blockId) {
  const row = await env.DB.prepare('SELECT kind FROM blocks WHERE id = ? AND user_id = ?').bind(blockId, env.uid).first().catch(() => null);
  return row ? row.kind : null;
}

// Share (or re-share, updating can_edit) an owned block with a friend.
export async function shareBlock(env, blockId, friendId, canEdit) {
  friendId = Number(friendId);
  const kind = await ownsBlock(env, blockId);
  if (!kind) throw new Error('That is not yours to share.');
  if (!SHAREABLE.has(kind)) throw new Error('Only notes, tables, life areas and tasks can be shared.');
  if (!friendId || friendId === env.uid) throw new Error('Pick a friend to share with.');
  if (!(await areFriends(env, friendId))) throw new Error('You can only share with people you are connected to.');
  const ce = canEdit === false || canEdit === 0 ? 0 : 1;
  await env.DB.prepare(
    `INSERT INTO shares (block_id, owner_id, friend_id, can_edit, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(block_id, friend_id) DO UPDATE SET can_edit = excluded.can_edit`,
  ).bind(blockId, env.uid, friendId, ce, new Date().toISOString()).run();
  return listBlockShares(env, blockId);
}

export async function unshareBlock(env, blockId, friendId) {
  if (!(await ownsBlock(env, blockId))) throw new Error('That is not yours to share.');
  await env.DB.prepare('DELETE FROM shares WHERE block_id = ? AND owner_id = ? AND friend_id = ?').bind(blockId, env.uid, Number(friendId)).run();
  return listBlockShares(env, blockId);
}

// Who an owned block is currently shared with. Owner-only: a recipient can see
// they have access, but not the rest of the guest list.
export async function listBlockShares(env, blockId) {
  if (!(await ownsBlock(env, blockId))) throw new Error('That is not yours to share.');
  const rows = (await env.DB.prepare(
    `SELECT s.friend_id AS id, s.can_edit, u.name, u.subdomain
       FROM shares s JOIN users u ON u.id = s.friend_id
      WHERE s.block_id = ? AND s.owner_id = ? ORDER BY u.name`,
  ).bind(blockId, env.uid).all().catch(() => ({ results: [] }))).results || [];
  return { shares: rows.map((r) => ({ id: r.id, name: r.name || r.subdomain, subdomain: r.subdomain, canEdit: !!r.can_edit })) };
}

// Everyone who can currently SEE a block you own: people you shared it with
// directly, plus the members of any life area it's filed under (sharing an area
// shares its children). Owner-only. props.private hides it from area members, so
// then only direct shares remain - and even those don't see a private block, so
// we report it as private with an empty list. The UI shows these as faces.
export async function listBlockViewers(env, blockId) {
  const row = await env.DB.prepare('SELECT props, user_id FROM blocks WHERE id = ?').bind(blockId).first().catch(() => null);
  if (!row || row.user_id !== env.uid) throw new Error('That is not yours.');
  let props = {}; try { props = row.props ? JSON.parse(row.props) : {}; } catch {}
  if (props.private) return { viewers: [], private: true };
  const map = new Map();
  const direct = (await env.DB.prepare(
    `SELECT s.friend_id AS id, u.name, u.subdomain FROM shares s JOIN users u ON u.id = s.friend_id
      WHERE s.block_id = ? AND s.owner_id = ?`,
  ).bind(blockId, env.uid).all().catch(() => ({ results: [] }))).results || [];
  for (const r of direct) map.set(r.id, { id: r.id, name: r.name || r.subdomain, subdomain: r.subdomain, via: 'direct' });
  const areas = Array.isArray(props.areas) ? props.areas.filter(Boolean) : (props.area ? [props.area] : []);
  if (areas.length) {
    const ph = areas.map(() => '?').join(',');
    const arows = (await env.DB.prepare(
      `SELECT s.friend_id AS id, u.name, u.subdomain FROM shares s JOIN users u ON u.id = s.friend_id
        WHERE s.owner_id = ? AND s.block_id IN (${ph})`,
    ).bind(env.uid, ...areas).all().catch(() => ({ results: [] }))).results || [];
    for (const r of arows) if (!map.has(r.id)) map.set(r.id, { id: r.id, name: r.name || r.subdomain, subdomain: r.subdomain, via: 'area' });
  }
  return { viewers: [...map.values()], private: false };
}

// Notes & tasks other people have shared with me, newest share first, each
// carrying who shared it so the UI can label it.
export async function sharedWithMe(env) {
  const rows = (await env.DB.prepare(
    `SELECT b.*, s.can_edit, s.created_at AS shared_at, u.name AS owner_name, u.subdomain AS owner_sub
       FROM shares s
       JOIN blocks b ON b.id = s.block_id
       JOIN users u ON u.id = s.owner_id
      WHERE s.friend_id = ? AND b.archived = 0
      ORDER BY s.created_at DESC`,
  ).bind(env.uid).all().catch(() => ({ results: [] }))).results || [];
  return {
    items: rows.map((r) => {
      let props = {}; try { props = r.props ? JSON.parse(r.props) : {}; } catch {}
      return {
        id: r.id, kind: r.kind, title: r.title, canEdit: !!r.can_edit,
        owner: r.owner_name || r.owner_sub, ownerSub: r.owner_sub,
        done: !!props.done, priority: props.priority || null, updated_at: r.updated_at,
      };
    }),
  };
}
