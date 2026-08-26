/**
 * Onboarding for Daybook (multi-tenant). A signed-in email with no `users` row
 * yet is "unprovisioned" - it can reach only /api/me and /api/signup until it
 * claims an account (invite-gated, with a subdomain). Everything else needs a
 * provisioned user (see resolveUser in auth.js).
 *
 * Invite-only for now: no code, no account. Robin is user 1, provisioned by the
 * schema-tenant.sql backfill, so he never sees signup.
 */

import { sendCodeMail } from './auth.js';
import { isPublicSignup } from './admin.js';

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

// Resolves by the account's primary email OR any *verified* alias in
// user_emails, so all of a person's addresses reach the one account - but an
// unconfirmed alias can't sign in until its owner proves control of it.
export async function getUserByEmail(env, email) {
  const e = String(email || '').toLowerCase();
  return env.DB.prepare(
    `SELECT id, email, name, subdomain, plan, status FROM users
      WHERE email = ? OR id = (SELECT user_id FROM user_emails WHERE email = ? AND verified = 1)`,
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

  // Invite-gated for now, but fully public-ready: set env.PUBLIC_SIGNUP='1' to
  // drop the invite requirement and let anyone sign up (free plan). Until then a
  // valid invite - from any member, or Robin - is required. A code can also carry
  // a different plan / a pre-assigned email / the BYO-key "free" flag.
  const publicSignup = await isPublicSignup(env);
  const code = String(b.invite || '').trim();
  if (!code && !publicSignup) return err('Daybook is invite-only for now - you need an invite from a member.', request, 403);
  let plan = 'free', free = 0, invitedBy = null;
  if (code) {
    const inv = await env.DB.prepare('SELECT code, email, plan, free, created_by, used_by FROM invites WHERE code = ?')
      .bind(code).first().catch(() => null);
    if (!inv) return err('That invite code is not valid.', request, 400);
    if (inv.used_by) return err('That invite has already been used.', request, 400);
    if (inv.email && inv.email.toLowerCase() !== email.toLowerCase()) return err('That invite is for a different email address.', request, 400);
    plan = inv.plan || 'standard';
    free = inv.free ? 1 : 0;
    invitedBy = inv.created_by || null;
  }
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO users (email, name, subdomain, plan, status, invited_by, voucher, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(email.toLowerCase(), name, sub, plan, 'active', invitedBy, code || null, now).run();
  const uid = res.meta.last_row_id;
  if (code) await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').bind(uid, now, code).run();
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

// ── Invites ───────────────────────────────────────────────────────────
// Any member can invite others (referral model); Robin (user 1) is admin and
// sees/controls everything. A member sees only their own invites.
export async function listInvites(env) {
  const admin = env.uid === 1;
  const stmt = admin
    ? env.DB.prepare('SELECT code, email, plan, free, note, used_by, used_at, created_at, created_by FROM invites ORDER BY created_at DESC')
    : env.DB.prepare('SELECT code, email, plan, free, note, used_by, used_at, created_at, created_by FROM invites WHERE created_by = ? ORDER BY created_at DESC').bind(env.uid);
  const { results } = await stmt.all();
  return results || [];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no ambiguous 0/O/1/I
function randomCode() {
  let s = '';
  for (const n of crypto.getRandomValues(new Uint8Array(8))) s += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return s;
}
const MEMBER_INVITE_CAP = 5;   // unused invites a non-admin member may hold at once
export async function createInvite(env, input) {
  const admin = env.uid === 1;
  if (!admin) {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND used_by IS NULL').bind(env.uid).first().catch(() => ({ n: 0 }));
    if ((c.n || 0) >= MEMBER_INVITE_CAP) throw new Error(`You already have ${MEMBER_INVITE_CAP} unused invites out. Wait for one to be used before making more.`);
  }
  const code = (String(input.code || '').trim() || randomCode()).toUpperCase().slice(0, 24);
  const now = new Date().toISOString();
  // Only the owner may set a plan / the free (BYO-key) flag / pre-assign an email.
  // A member's invite always grants the default free plan.
  const plan = admin ? (input.plan || 'standard') : 'free';
  const free = admin && input.free ? 1 : 0;
  const email = admin ? ((input.email || '').trim().toLowerCase() || null) : null;
  const note = admin ? (input.note || null) : null;
  await env.DB.prepare(
    'INSERT INTO invites (code, email, plan, free, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(code, email, plan, free, note, env.uid, now).run();
  return { code };
}

// ── Account ───────────────────────────────────────────────────────────
// Name, primary email, extra email aliases, phone, plan. All scoped to env.uid.
export async function getAccount(env) {
  const u = await env.DB.prepare('SELECT id, email, name, subdomain, plan, status, ai_anthropic_enc, ai_gemini_enc FROM users WHERE id = ?').bind(env.uid).first();
  const al = await env.DB.prepare('SELECT email, verified FROM user_emails WHERE user_id = ? ORDER BY email').bind(env.uid).all().catch(() => ({ results: [] }));
  const ph = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'phone'").bind(env.uid).first().catch(() => null);
  const sms = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'sms_block_alerts'").bind(env.uid).first().catch(() => null);
  return {
    name: (u && u.name) || '', email: (u && u.email) || '', subdomain: (u && u.subdomain) || '',
    plan: (u && u.plan) || 'free', status: (u && u.status) || 'active',
    phone: ph ? ph.value : '', smsAlerts: !sms || sms.value !== '0',
    aliases: (al.results || []).map((r) => ({ email: r.email, verified: !!r.verified })),
    // Never return the keys themselves - only whether one is stored.
    aiAnthropicSet: !!(u && u.ai_anthropic_enc), aiGeminiSet: !!(u && u.ai_gemini_enc),
    isOwner: env.uid === 1,
  };
}
export async function patchAccount(env, body) {
  if (body.name !== undefined) await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(body.name).slice(0, 60), env.uid).run();
  if (body.phone !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'phone', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, String(body.phone).slice(0, 40)).run();
  return getAccount(env);
}
// Adding an alias no longer trusts the owner on its own: the address is stored
// unverified and a 6-digit code is emailed to it. Only once the owner enters
// that code (proving they control the inbox) does the alias become usable to
// sign in - so nobody can attach someone else's address to their account.
export async function addAlias(env, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That does not look like an email address.');
  const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(env.uid).first().catch(() => null);
  if (u && String(u.email).toLowerCase() === e) throw new Error('That is already your primary address.');
  // A clash with someone else's account (primary or a verified alias) is a hard
  // stop. An unverified alias already sitting on *your* account just re-sends.
  const clash = await env.DB.prepare(
    'SELECT user_id FROM users WHERE email = ? UNION SELECT user_id FROM user_emails WHERE email = ? AND (verified = 1 OR user_id <> ?)',
  ).bind(e, e, env.uid).first().catch(() => null);
  if (clash) throw new Error('That email is already in use.');
  await env.DB.prepare('INSERT OR IGNORE INTO user_emails (email, user_id, verified) VALUES (?, ?, 0)').bind(e, env.uid).run();
  // If the code can't be sent, don't leave a stranded pending alias behind.
  try { await sendAliasCode(env, e); }
  catch (err) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM user_emails WHERE email = ? AND user_id = ? AND verified = 0').bind(e, env.uid),
      env.DB.prepare('DELETE FROM alias_codes WHERE email = ? AND user_id = ?').bind(e, env.uid),
    ]);
    throw err;
  }
  return getAccount(env);
}
// Email (or re-email) the confirmation code for a pending alias on this account.
export async function sendAliasCode(env, email) {
  const e = String(email || '').trim().toLowerCase();
  const own = await env.DB.prepare('SELECT verified FROM user_emails WHERE email = ? AND user_id = ?').bind(e, env.uid).first().catch(() => null);
  if (!own) throw new Error('That address is not on your account.');
  if (own.verified) throw new Error('That address is already confirmed.');
  const now = Math.floor(Date.now() / 1000);
  const recent = await env.DB.prepare('SELECT sent_at FROM alias_codes WHERE email = ?').bind(e).first().catch(() => null);
  if (recent && now - recent.sent_at < 30) throw new Error(`Hold on ${30 - (now - recent.sent_at)}s before asking for another code.`);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await env.DB.prepare(
    `INSERT INTO alias_codes (email, user_id, code, expires_at, attempts, sent_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, code = excluded.code, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`,
  ).bind(e, env.uid, code, now + 600, now).run();
  const res = await sendCodeMail(env, e, code, 'alias');
  if (!res.ok) { console.error('alias code send:', res.status, await res.text().catch(() => '')); throw new Error('Could not send the code. Try again shortly.'); }
  return { ok: true };
}
// Confirm a pending alias with the code emailed to it.
export async function verifyAlias(env, email, code) {
  const e = String(email || '').trim().toLowerCase();
  const c = String(code || '').trim();
  if (!e || !c) throw new Error('Missing email or code.');
  const row = await env.DB.prepare('SELECT code, expires_at, attempts, user_id FROM alias_codes WHERE email = ?').bind(e).first().catch(() => null);
  if (!row || row.user_id !== env.uid) throw new Error('No code outstanding for that address. Send a new one.');
  const now = Math.floor(Date.now() / 1000);
  if (now > row.expires_at) { await env.DB.prepare('DELETE FROM alias_codes WHERE email = ?').bind(e).run(); throw new Error('That code has expired. Send a new one.'); }
  if (row.attempts >= 5) { await env.DB.prepare('DELETE FROM alias_codes WHERE email = ?').bind(e).run(); throw new Error('Too many attempts. Send a new code.'); }
  if (String(row.code) !== c) { await env.DB.prepare('UPDATE alias_codes SET attempts = attempts + 1 WHERE email = ?').bind(e).run(); throw new Error('Incorrect code.'); }
  await env.DB.batch([
    env.DB.prepare('UPDATE user_emails SET verified = 1 WHERE email = ? AND user_id = ?').bind(e, env.uid),
    env.DB.prepare('DELETE FROM alias_codes WHERE email = ?').bind(e),
  ]);
  return getAccount(env);
}
// Permanently delete this account and everything it owns. Irreversible; the
// owner (user 1) is protected. Best-effort per table so a missing table/column
// never blocks the rest. Portfolio data lives in a separate DB and is untouched.
export async function closeAccount(env) {
  const uid = env.uid;
  if (uid === 1) throw new Error('The owner account cannot be closed here.');
  const email = env.user && env.user.email ? String(env.user.email).toLowerCase() : null;
  const del = async (sql, ...binds) => { try { await env.DB.prepare(sql).bind(...binds).run(); } catch {} };
  // Mail cache is keyed by the account id, so clear it before the accounts go.
  await del('DELETE FROM mail_cache WHERE account IN (SELECT id FROM mail_accounts WHERE user_id = ?)', uid);
  await del('DELETE FROM mail_cache_meta WHERE account IN (SELECT id FROM mail_accounts WHERE user_id = ?)', uid);
  await del('DELETE FROM mail_accounts WHERE user_id = ?', uid);
  await del('DELETE FROM blocks WHERE user_id = ?', uid);
  await del('DELETE FROM block_links WHERE user_id = ?', uid);
  await del('DELETE FROM slots WHERE user_id = ?', uid);
  await del('DELETE FROM slot_tasks WHERE user_id = ?', uid);
  await del('DELETE FROM settings WHERE user_id = ?', uid);
  await del('DELETE FROM ai_usage WHERE user_id = ?', uid);
  await del('DELETE FROM push_subs WHERE user_id = ?', uid);
  await del('DELETE FROM webinars WHERE host_id = ?', uid);
  await del('DELETE FROM shares WHERE owner_id = ? OR friend_id = ?', uid, uid);
  await del('DELETE FROM assignments WHERE from_id = ? OR to_id = ?', uid, uid);
  await del('DELETE FROM friends WHERE user_id = ? OR friend_id = ?', uid, uid);
  await del('DELETE FROM messages WHERE from_id = ? OR to_id = ?', uid, uid);
  await del('DELETE FROM meetings WHERE lo = ? OR hi = ?', uid, uid);
  await del('DELETE FROM invites WHERE created_by = ? AND used_by IS NULL', uid);
  await del('DELETE FROM alias_codes WHERE user_id = ?', uid);
  await del('DELETE FROM user_emails WHERE user_id = ?', uid);
  if (email) await del('DELETE FROM otp_codes WHERE email = ?', email);
  await del('DELETE FROM users WHERE id = ?', uid);
  return { closed: true };
}
export async function removeAlias(env, email) {
  const e = String(email || '').toLowerCase();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_emails WHERE email = ? AND user_id = ?').bind(e, env.uid),
    env.DB.prepare('DELETE FROM alias_codes WHERE email = ? AND user_id = ?').bind(e, env.uid),
  ]);
  return getAccount(env);
}
