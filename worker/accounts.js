/**
 * Onboarding for Daybook (multi-tenant). A signed-in email with no `users` row
 * yet is "unprovisioned" - it can reach only /api/me and /api/signup until it
 * claims an account (invite-gated, with a subdomain). Everything else needs a
 * provisioned user (see resolveUser in auth.js).
 *
 * Invite-only for now: no code, no account. Robin is user 1, provisioned by the
 * schema-tenant.sql backfill, so he never sees signup.
 */

// Names we keep for infrastructure / the product itself, never handed to a user.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'mail', 'admin', 'root', 'support', 'help', 'status',
  'blog', 'staging', 'stage', 'dev', 'test', 'daybook', 'account', 'accounts',
  'billing', 'login', 'signup', 'me', 'settings', 'static', 'assets', 'cdn',
  'ns1', 'ns2', 'mx', 'smtp', 'imap', 'pop', 'webmail', 'about', 'legal',
  'privacy', 'terms', 'docs', 'book', 'go', 'auth', 'oauth',
]);
// 2-30 chars, letters/numbers/hyphens, no leading or trailing hyphen.
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])$/;

export function normSubdomain(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!SUBDOMAIN_RE.test(v)) return null;
  if (RESERVED_SUBDOMAINS.has(v)) return null;
  return v;
}

// Resolves by the account's primary email OR any alias in user_emails, so all
// of a person's addresses reach the one account.
export async function getUserByEmail(env, email) {
  const e = String(email || '').toLowerCase();
  return env.DB.prepare(
    `SELECT id, email, name, subdomain, plan, status FROM users
      WHERE email = ? OR id = (SELECT user_id FROM user_emails WHERE email = ?)`,
  ).bind(e, e).first().catch(() => null);
}

// Is this subdomain free to claim?
async function subdomainTaken(env, sub) {
  return !!(await env.DB.prepare('SELECT id FROM users WHERE subdomain = ?').bind(sub).first().catch(() => null));
}

// Claim an account for a signed-in, allow-listed email.
export async function handleSignup(request, env, email, json, err) {
  const existing = await getUserByEmail(env, email);
  if (existing) return json({ user: existing, already: true }, request);

  const b = await request.json().catch(() => ({}));
  const name = String(b.name || '').trim().slice(0, 40) || email.split('@')[0];
  const sub = normSubdomain(b.subdomain);
  if (!sub) return err('Choose a web address: 2-30 letters, numbers or hyphens, e.g. tara', request, 400);
  if (await subdomainTaken(env, sub)) return err(`"${sub}.daybook.fyi" is taken - try another`, request, 409);

  const code = String(b.invite || '').trim();
  if (!code) return err('Daybook is invite-only right now - you need an invite code.', request, 403);
  const inv = await env.DB.prepare('SELECT code, email, plan, free, created_by, used_by FROM invites WHERE code = ?')
    .bind(code).first().catch(() => null);
  if (!inv) return err('That invite code is not valid.', request, 400);
  if (inv.used_by) return err('That invite has already been used.', request, 400);
  if (inv.email && inv.email.toLowerCase() !== email.toLowerCase()) return err('That invite is for a different email address.', request, 400);

  const plan = inv.plan || 'standard';
  const free = inv.free ? 1 : 0;
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO users (email, name, subdomain, plan, status, invited_by, voucher, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(email.toLowerCase(), name, sub, plan, 'active', inv.created_by || null, code, now).run();
  const uid = res.meta.last_row_id;
  await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').bind(uid, now, code).run();
  await seedNewUser(env, uid);
  return json({ user: await getUserByEmail(env, email), free: !!free }, request, 201);
}

// First-run defaults so the app is usable immediately (lane targets + day window).
async function seedNewUser(env, uid) {
  const defaults = [
    ['target_zazen', '60'], ['target_body', '50'], ['target_music', '60'], ['target_art', '30'],
    ['target_portuguese', '30'], ['target_work', '180'], ['target_mylife', '30'], ['target_rest', '60'],
    ['day_start', '360'], ['day_end', '1380'],
  ];
  await env.DB.batch(defaults.map(([k, v]) =>
    env.DB.prepare('INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)').bind(uid, k, v)));
}

// ── Invites (admin) ───────────────────────────────────────────────────
export async function listInvites(env) {
  const { results } = await env.DB.prepare(
    'SELECT code, email, plan, free, note, used_by, used_at, created_at FROM invites ORDER BY created_at DESC',
  ).all();
  return results || [];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no ambiguous 0/O/1/I
function randomCode() {
  let s = '';
  for (const n of crypto.getRandomValues(new Uint8Array(8))) s += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return s;
}
export async function createInvite(env, input) {
  const code = (String(input.code || '').trim() || randomCode()).toUpperCase().slice(0, 24);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO invites (code, email, plan, free, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(code, (input.email || '').trim().toLowerCase() || null, input.plan || 'standard', input.free ? 1 : 0, input.note || null, env.uid, now).run();
  return { code };
}

// ── Account ───────────────────────────────────────────────────────────
// Name, primary email, extra email aliases, phone, plan. All scoped to env.uid.
export async function getAccount(env) {
  const u = await env.DB.prepare('SELECT id, email, name, subdomain, plan, status FROM users WHERE id = ?').bind(env.uid).first();
  const al = await env.DB.prepare('SELECT email FROM user_emails WHERE user_id = ? ORDER BY email').bind(env.uid).all().catch(() => ({ results: [] }));
  const ph = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'phone'").bind(env.uid).first().catch(() => null);
  const sms = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'sms_block_alerts'").bind(env.uid).first().catch(() => null);
  return {
    name: (u && u.name) || '', email: (u && u.email) || '', subdomain: (u && u.subdomain) || '',
    plan: (u && u.plan) || 'free', status: (u && u.status) || 'active',
    phone: ph ? ph.value : '', smsAlerts: !sms || sms.value !== '0',
    aliases: (al.results || []).map((r) => r.email),
  };
}
export async function patchAccount(env, body) {
  if (body.name !== undefined) await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(body.name).slice(0, 60), env.uid).run();
  if (body.phone !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'phone', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, String(body.phone).slice(0, 40)).run();
  return getAccount(env);
}
// Adding an alias here trusts the owner. Before public signups, gate this behind
// an emailed verification of the alias address (same code flow as sign-in).
export async function addAlias(env, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That does not look like an email address.');
  const clash = await env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ? UNION SELECT 1 AS x FROM user_emails WHERE email = ?').bind(e, e).first().catch(() => null);
  if (clash) throw new Error('That email is already in use.');
  await env.DB.prepare('INSERT OR IGNORE INTO user_emails (email, user_id) VALUES (?, ?)').bind(e, env.uid).run();
  return getAccount(env);
}
export async function removeAlias(env, email) {
  await env.DB.prepare('DELETE FROM user_emails WHERE email = ? AND user_id = ?').bind(String(email || '').toLowerCase(), env.uid).run();
  return getAccount(env);
}
