// Cross-account sharing of individual notes & tasks with friends (Kaya
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
  if (!SHAREABLE.has(kind)) throw new Error('Only notes, tables, Spaces and tasks can be shared.');
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

// My OWN notes & tables that I've shared out - either with a friend (a row in
// `shares`) or publicly via a link (props.shareToken). For the Notes "Shared"
// view, which shows both directions. Newest-edited first. (Robin, 2026-10-29.)
export async function sharedByMe(env) {
  // Notes, tables and Spaces I've shared out. Tasks are NOT here - they go
  // through assignments (assignedByMe), to avoid double-counting an accepted task
  // that also carries a shares row. (Robin, 2026-10-29.)
  const rows = (await env.DB.prepare(
    `SELECT b.id, b.kind, b.title, b.props, b.updated_at
       FROM blocks b
      WHERE b.user_id = ? AND b.archived = 0 AND b.kind IN ('note','table','area')
        AND ( EXISTS (SELECT 1 FROM shares s WHERE s.block_id = b.id AND s.owner_id = ?)
              OR json_extract(b.props, '$.shareToken') IS NOT NULL )
      ORDER BY b.updated_at DESC`,
  ).bind(env.uid, env.uid).all().catch(() => ({ results: [] }))).results || [];
  // Who each note is shared WITH, so the Notes "Shared" view can show faces and
  // name them. One pass over all my share rows (bounded by my own share count,
  // never a user-sized IN-list), grouped by block. (Robin, 2026-10-29.)
  const byBlock = new Map();
  const srows = (await env.DB.prepare(
    `SELECT s.block_id, s.friend_id AS id, s.can_edit, u.name, u.subdomain
       FROM shares s JOIN users u ON u.id = s.friend_id
      WHERE s.owner_id = ? ORDER BY u.name`,
  ).bind(env.uid).all().catch(() => ({ results: [] }))).results || [];
  for (const r of srows) {
    if (!byBlock.has(r.block_id)) byBlock.set(r.block_id, []);
    byBlock.get(r.block_id).push({ id: r.id, name: r.name || r.subdomain, subdomain: r.subdomain, canEdit: !!r.can_edit });
  }
  return {
    items: rows.map((r) => {
      let props = {}; try { props = r.props ? JSON.parse(r.props) : {}; } catch {}
      const shares = byBlock.get(r.id) || [];
      return { id: r.id, kind: r.kind, title: r.title, updated_at: r.updated_at, nshares: shares.length, public: !!props.shareToken, shares };
    }),
  };
}

// Notes & tasks other people have shared with me, newest share first, each
// carrying who shared it so the UI can label it.
export async function sharedWithMe(env) {
  const rows = (await env.DB.prepare(
    `SELECT b.*, s.can_edit, s.created_at AS shared_at, u.id AS owner_id, u.name AS owner_name, u.subdomain AS owner_sub
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
        owner: r.owner_name || r.owner_sub, ownerSub: r.owner_sub, ownerId: r.owner_id,
        done: !!props.done, priority: props.priority || null, updated_at: r.updated_at,
        shared_at: r.shared_at || null,
      };
    }),
  };
}

// ── Sharing a single contact (minus the private info) with a friend ──────────
// Modelled on getPublicCard's redaction, NOT on blockAccess: a contact share
// never grants whole-block access. It stores a WHITELIST of prop keys per
// recipient (`fields`); the server emits only those, so body ("Notes to self")
// and anything off the list never leave the owner's tenant. (Robin, 2026-11-15.)
const CONTACT_SHARE_FIELDS = ['phones', 'emails', 'telegram', 'instagram', 'signal', 'addresses', 'birthday', 'photo'];
const cleanShareFields = (fields) =>
  [...new Set((Array.isArray(fields) ? fields : []).map(String))].filter((f) => CONTACT_SHARE_FIELDS.includes(f));

async function ownedContact(env, id) {
  return env.DB.prepare("SELECT props FROM blocks WHERE id = ? AND user_id = ? AND kind = 'contact' AND archived = 0")
    .bind(id, env.uid).first().catch(() => null);
}

export async function shareContact(env, contactId, friendId, fields) {
  friendId = Number(friendId);
  const c = await ownedContact(env, contactId);
  if (!c) throw new Error('That is not a contact of yours to share.');
  let props = {}; try { props = c.props ? JSON.parse(c.props) : {}; } catch {}
  if (props.private) throw new Error('This contact is private - unmark it before sharing.');
  if (!friendId || friendId === env.uid) throw new Error('Pick a friend to share with.');
  if (!(await areFriends(env, friendId))) throw new Error('You can only share with people you are connected to.');
  await env.DB.prepare(
    `INSERT INTO contact_shares (contact_id, owner_id, friend_id, fields, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(contact_id, friend_id) DO UPDATE SET fields = excluded.fields`,
  ).bind(contactId, env.uid, friendId, JSON.stringify(cleanShareFields(fields)), new Date().toISOString()).run();
  return listContactShares(env, contactId);
}

export async function unshareContact(env, contactId, friendId) {
  if (!(await ownedContact(env, contactId))) throw new Error('That is not a contact of yours.');
  await env.DB.prepare('DELETE FROM contact_shares WHERE contact_id = ? AND owner_id = ? AND friend_id = ?')
    .bind(contactId, env.uid, Number(friendId)).run();
  return listContactShares(env, contactId);
}

// Who I've shared this contact with, and which fields each of them gets. Owner-only.
export async function listContactShares(env, contactId) {
  if (!(await ownedContact(env, contactId))) throw new Error('That is not a contact of yours.');
  const rows = (await env.DB.prepare(
    `SELECT cs.friend_id AS id, cs.fields, u.name, u.subdomain
       FROM contact_shares cs JOIN users u ON u.id = cs.friend_id
      WHERE cs.contact_id = ? AND cs.owner_id = ? ORDER BY u.name`,
  ).bind(contactId, env.uid).all().catch(() => ({ results: [] }))).results || [];
  return {
    shares: rows.map((r) => {
      let f = []; try { f = JSON.parse(r.fields || '[]'); } catch {}
      return { id: r.id, name: r.name || r.subdomain, subdomain: r.subdomain, fields: Array.isArray(f) ? f : [] };
    }),
  };
}

// Redact a contact's props to the whitelist, emitting both the canonical array and
// its legacy mirror so the recipient's existing card renderer works unchanged.
// Name (title) is handled by the caller; body/kit/xmas/private/areas never appear.
function redactContact(props, fields) {
  const out = {}; const has = (k) => fields.includes(k);
  if (has('photo') && props.photo) out.photo = props.photo;
  if (has('emails')) { const e = (Array.isArray(props.emails) ? props.emails : (props.email ? [props.email] : [])).filter(Boolean); out.emails = e; out.email = e[0] || ''; }
  if (has('phones')) { const p = Array.isArray(props.phones) ? props.phones : []; out.phones = p; out.phone = props.phone || (p[0] ? [p[0].cc, p[0].number].filter(Boolean).join(' ').trim() : ''); }
  if (has('addresses')) { out.addresses = Array.isArray(props.addresses) ? props.addresses : []; if (props.address) out.address = props.address; }
  for (const k of ['telegram', 'instagram', 'signal']) if (has(k) && props[k]) out[k] = props[k];
  if (has('birthday') && props.birthday) out.birthday = props.birthday;
  return out;
}

// Contacts other people have shared with me, redacted to what each chose. They
// never appear in my owned kind='contact' list (that query is owner-scoped); the
// client surfaces these separately and read-only. (Robin, 2026-11-15.)
export async function contactsSharedWithMe(env) {
  const rows = (await env.DB.prepare(
    `SELECT b.id, b.title, b.props, cs.fields, cs.created_at AS shared_at,
            u.id AS owner_id, u.name AS owner_name, u.subdomain AS owner_sub
       FROM contact_shares cs
       JOIN blocks b ON b.id = cs.contact_id AND b.archived = 0
       JOIN users u ON u.id = cs.owner_id
      WHERE cs.friend_id = ? ORDER BY cs.created_at DESC`,
  ).bind(env.uid).all().catch(() => ({ results: [] }))).results || [];
  return {
    items: rows.map((r) => {
      let props = {}; try { props = r.props ? JSON.parse(r.props) : {}; } catch {}
      let fields = []; try { fields = JSON.parse(r.fields || '[]'); } catch {}
      fields = (Array.isArray(fields) ? fields : []).filter((f) => CONTACT_SHARE_FIELDS.includes(f));
      return {
        id: r.id, kind: 'contact', title: r.title || '',
        props: redactContact(props, fields),
        sharedBy: r.owner_name || r.owner_sub, ownerId: r.owner_id, ownerSub: r.owner_sub,
        sharedFields: fields, shared_at: r.shared_at || null, readonly: true,
      };
    }),
  };
}
