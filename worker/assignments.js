// Assigning a task to a friend (Daybook Friends, phase 3b). Robin's chosen flow:
// send -> they accept -> it becomes a shared live task whose status syncs both
// ways.
//
// An `assignments` row is the relationship (task, from, to, status). On accept
// we also drop a `shares` row (can_edit=1) so the existing access oracle
// (blockAccess in index.js) grants the assignee read+write on the one task
// block - that shared block is the single source of truth, so a tick by either
// side is seen by both. Every mutating call is gated on ownership + friendship.

import { areFriends } from './friends.js';

async function ownsTask(env, taskId) {
  return !!(await env.DB.prepare("SELECT 1 FROM blocks WHERE id = ? AND kind = 'task' AND user_id = ?").bind(taskId, env.uid).first().catch(() => null));
}

// Owner assigns an owned task to a friend. Idempotent: re-assigning just returns
// the current list.
export async function assignTask(env, taskId, toId) {
  toId = Number(toId);
  if (!(await ownsTask(env, taskId))) throw new Error('That is not yours to assign.');
  if (!toId || toId === env.uid) throw new Error('Pick a friend to assign it to.');
  if (!(await areFriends(env, toId))) throw new Error('You can only assign to people you are connected to.');
  await env.DB.prepare(
    "INSERT OR IGNORE INTO assignments (task_id, from_id, to_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
  ).bind(taskId, env.uid, toId, new Date().toISOString()).run();
  return listTaskAssignees(env, taskId);
}

// Who an owned task is assigned to, and whether each has accepted. Owner-only.
export async function listTaskAssignees(env, taskId) {
  if (!(await ownsTask(env, taskId))) throw new Error('That is not yours to assign.');
  const rows = (await env.DB.prepare(
    `SELECT a.to_id AS id, a.status, u.name, u.subdomain
       FROM assignments a JOIN users u ON u.id = a.to_id
      WHERE a.task_id = ? AND a.from_id = ? ORDER BY u.name`,
  ).bind(taskId, env.uid).all().catch(() => ({ results: [] }))).results || [];
  return { assignees: rows.map((r) => ({ id: r.id, name: r.name || r.subdomain, subdomain: r.subdomain, status: r.status })) };
}

// Owner revokes an assignment: drop it and the access that came with it.
export async function unassign(env, taskId, toId) {
  toId = Number(toId);
  if (!(await ownsTask(env, taskId))) throw new Error('That is not yours to assign.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM assignments WHERE task_id = ? AND from_id = ? AND to_id = ?').bind(taskId, env.uid, toId),
    env.DB.prepare('DELETE FROM shares WHERE block_id = ? AND owner_id = ? AND friend_id = ?').bind(taskId, env.uid, toId),
  ]);
  return listTaskAssignees(env, taskId);
}

// Everything relevant to me as an assignee: tasks I've been assigned but not yet
// answered (pending), and ones I've accepted (my live shared tasks). Each row
// carries who assigned it and the task's current title/priority/done.
export async function myAssignments(env) {
  const rows = (await env.DB.prepare(
    `SELECT a.task_id, a.status, b.title, b.props, u.name AS from_name, u.subdomain AS from_sub
       FROM assignments a
       JOIN blocks b ON b.id = a.task_id AND b.archived = 0
       JOIN users u ON u.id = a.from_id
      WHERE a.to_id = ? ORDER BY a.created_at DESC`,
  ).bind(env.uid).all().catch(() => ({ results: [] }))).results || [];
  const map = (r) => {
    let p = {}; try { p = r.props ? JSON.parse(r.props) : {}; } catch {}
    return { id: r.task_id, title: r.title, status: r.status, from: r.from_name || r.from_sub, fromSub: r.from_sub, done: !!p.done, priority: p.priority || null };
  };
  return { pending: rows.filter((r) => r.status === 'pending').map(map), accepted: rows.filter((r) => r.status === 'accepted').map(map) };
}

// Assignee accepts: flip to accepted and grant edit access via a share row.
export async function acceptAssignment(env, taskId) {
  const a = await env.DB.prepare('SELECT from_id FROM assignments WHERE task_id = ? AND to_id = ?').bind(taskId, env.uid).first().catch(() => null);
  if (!a) throw new Error('No such assignment.');
  await env.DB.batch([
    env.DB.prepare("UPDATE assignments SET status = 'accepted' WHERE task_id = ? AND to_id = ?").bind(taskId, env.uid),
    env.DB.prepare('INSERT OR IGNORE INTO shares (block_id, owner_id, friend_id, can_edit, created_at) VALUES (?, ?, ?, 1, ?)').bind(taskId, a.from_id, env.uid, new Date().toISOString()),
  ]);
  return myAssignments(env);
}

// Assignee declines (or later removes) an assignment: drop it and its access.
export async function declineAssignment(env, taskId) {
  const a = await env.DB.prepare('SELECT from_id FROM assignments WHERE task_id = ? AND to_id = ?').bind(taskId, env.uid).first().catch(() => null);
  if (a) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM assignments WHERE task_id = ? AND to_id = ?').bind(taskId, env.uid),
      env.DB.prepare('DELETE FROM shares WHERE block_id = ? AND owner_id = ? AND friend_id = ?').bind(taskId, a.from_id, env.uid),
    ]);
  }
  return myAssignments(env);
}
