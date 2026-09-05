import { normPlan } from './plans.js';
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
import { smtpSend, buildMessage } from './mail.js';
import { inviteEmail } from './invite-email.js';

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

// The invitation waiting for this address: created for them by name and not yet
// redeemed. This is what lets someone accept an invitation without ever seeing a
// code - they click the link in the email, sign in, and we find their invite.
async function pendingInvite(env, email) {
  return env.DB.prepare(
    'SELECT code, email, plan, free, free_months, created_by, used_by FROM invites WHERE email = ? AND used_by IS NULL ORDER BY created_at DESC LIMIT 1',
  ).bind(String(email || '').toLowerCase()).first().catch(() => null);
}
export async function hasPendingInvite(env, email) {
  return !!(await pendingInvite(env, email));
}

// Which invite is this signup running on? A typed code wins (someone was given
// one by hand); otherwise we look for the invitation emailed to this address.
// Returns the row, null (none), or a reason string the caller turns into an error.
//
// A code pinned to an email is a *hint for finding it*, not a lock: an invitation
// sent to a work address that someone then signs in with their personal one used
// to be a dead end, and the code itself - 8 characters, emailed to one person -
// is the credential.
async function resolveInvite(env, typed, email) {
  const code = String(typed || '').trim().toUpperCase();
  if (!code) return (await pendingInvite(env, email)) || null;
  const inv = await env.DB.prepare('SELECT code, email, plan, free, free_months, created_by, used_by FROM invites WHERE code = ?')
    .bind(code).first().catch(() => null);
  if (!inv) return 'unknown';
  if (inv.used_by) return 'used';
  return inv;
}

// Claim an account for a signed-in, allow-listed email.
export async function handleSignup(request, env, email, json, err) {
  const existing = await getUserByEmail(env, email);
  if (existing) return json({ user: existing, already: true }, request);

  const b = await request.json().catch(() => ({}));

  // The invitation comes first: if there isn't one, nothing else on the form
  // matters, and "pick a username" is noise in front of "you need an invite".
  // Invite-gated for now, but fully public-ready: set env.PUBLIC_SIGNUP='1' to
  // drop the requirement and let anyone sign up (free plan).
  const publicSignup = await isPublicSignup(env);
  const inv = await resolveInvite(env, b.invite, email);
  if (inv === 'unknown') return err('That invite code is not valid.', request, 400);
  if (inv === 'used') return err('That invitation has already been used. Ask whoever invited you to send a fresh one.', request, 400);
  if (!inv && !publicSignup) return err('Daybook is invite-only for now - you need an invitation from a member.', request, 403);

  const name = String(b.name || '').trim().slice(0, 40) || email.split('@')[0];
  const sub = normSubdomain(b.subdomain);
  if (!sub) return err('Pick a username: 2-30 letters, numbers or hyphens, e.g. tara', request, 400);
  if (await subdomainTaken(env, sub)) return err(`"${sub}" is taken - try another`, request, 409);

  // A code can carry a different plan and the BYO-key "free" flag.
  const code = inv ? inv.code : null;
  const plan = inv ? normPlan(inv.plan || 'byok') : 'free';
  const free = inv && inv.free ? 1 : 0;
  const invitedBy = inv ? (inv.created_by || null) : null;
  const now = new Date().toISOString();
  // A time-limited free invite stamps when the free run ends (billing, when it
  // exists, reads this); no limit or a paid invite leaves it null.
  let freeUntil = null;
  if (inv && inv.free && inv.free_months) { const d = new Date(); d.setMonth(d.getMonth() + Number(inv.free_months)); freeUntil = d.toISOString(); }
  const res = await env.DB.prepare(
    'INSERT INTO users (email, name, subdomain, plan, status, invited_by, voucher, free_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(email.toLowerCase(), name, sub, plan, 'active', invitedBy, code || null, freeUntil, now).run();
  const uid = res.meta.last_row_id;
  if (code) await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').bind(uid, now, code).run();
  await seedNewUser(env, uid);
  return json({ user: await getUserByEmail(env, email), free: !!free }, request, 201);
}

// A newcomer's default Today lanes. Robin's own lanes are his zen practice
// (Zazen, Forró...) and don't belong to a stranger; these are the generic set
// he chose. Stored per-account in lanes_config, so each member edits, adds and
// removes their own from day one via the Time streams settings. `other` is added
// automatically as the catch-all. Rest is the optional siesta; the rest are
// ordinary tracked lanes that can receive tasks. minutes = the daily target ring
// (0 = no ring, like a relationship you don't put a quota on).
const DEFAULT_LANES = [
  { key: 'body', label: 'Body / Health', hue: 145, minutes: 45 },
  { key: 'hobbies', label: 'Hobbies', hue: 25, minutes: 45 },
  { key: 'work', label: 'Work', hue: 220, minutes: 180 },
  { key: 'family', label: 'Family', hue: 70, minutes: 0 },
  { key: 'rest', label: 'Rest', hue: 305, minutes: 45, optional: true, practice: true },
  { key: 'personal', label: 'Personal', hue: 190, minutes: 30 },
  { key: 'reflect', label: 'Reflect', hue: 268, minutes: 15 },
];
// A starter life area maps onto the lane it most naturally feeds, so tasks tagged
// to that area land in the right Today lane. Titles must match STARTERS below.
const STARTER_AREA_LANE = {
  'Body / Health': 'body', Family: 'family', Hobbies: 'hobbies', Money: 'personal',
  People: 'family', Personal: 'personal', Reflect: 'reflect', Work: 'work',
};
// The life areas every new account is seeded with. The owner can override this
// list from the Admin dashboard (settings key 'default_life_areas'); this is the
// fallback when they haven't.
const DEFAULT_STARTERS = ['Body / Health', 'Family', 'Hobbies', 'Money', 'People', 'Personal', 'Reflect', 'Work'];
export async function defaultLifeAreas(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE user_id = 1 AND key = 'default_life_areas'").first();
    if (row && row.value) { const a = JSON.parse(row.value); if (Array.isArray(a) && a.length) return a.map((s) => String(s).slice(0, 60).trim()).filter(Boolean); }
  } catch {}
  return DEFAULT_STARTERS;
}

// First-run defaults so the app is usable immediately: the day window, a starter
// set of Today lanes with their targets, and a starter set of life areas mapped
// onto those lanes. The owner (1) is never seeded - these run once, at signup.
async function seedNewUser(env, uid) {
  const now = new Date().toISOString();
  const lanes = DEFAULT_LANES.map((l) => ({ key: l.key, label: l.label, hue: l.hue, ...(l.practice ? { practice: true } : {}), ...(l.optional ? { optional: true } : {}) }));

  // A blank Life Areas page doesn't tell a newcomer that Daybook orbits their
  // life areas. Seed the common ones (a Wheel-of-Life spread) so tasks, notes,
  // goals and spending categories all have somewhere to land. Ordinary blocks:
  // rename, recolour or delete any. Hues walk the wheel from a blue base so each
  // reads distinct. Keep their ids to map each area onto its Today lane.
  const STARTERS = await defaultLifeAreas(env);
  const areaMap = {};
  const areaStmts = STARTERS.map((title, i) => {
    const id = crypto.randomUUID();
    areaMap[id] = STARTER_AREA_LANE[title] || 'other';
    const hue = Math.round((210 + i * 137.5) % 360);
    return env.DB.prepare(
      `INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived, user_id)
       VALUES (?, 'area', NULL, ?, ?, NULL, ?, ?, ?, 0, ?)`,
    ).bind(id, i, title, JSON.stringify({ hue }), now, now, uid);
  });

  const settings = [
    ['day_start', '360'], ['day_end', '1380'],
    ['lanes_config', JSON.stringify(lanes)],
    ['area_lanes', JSON.stringify(areaMap)],
    ...DEFAULT_LANES.filter((l) => l.minutes > 0).map((l) => [`target_${l.key}`, String(l.minutes)]),
  ];
  const setStmts = settings.map(([k, v]) =>
    env.DB.prepare('INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)').bind(uid, k, v));

  await env.DB.batch([...areaStmts, ...setStmts]);
}

// ── Invites ───────────────────────────────────────────────────────────
// Any member can invite others (referral model); Robin (user 1) is admin and
// sees/controls everything. A member sees only their own invites.
export async function listInvites(env) {
  const admin = env.uid === 1;
  const stmt = admin
    ? env.DB.prepare('SELECT code, email, plan, free, free_months, note, used_by, used_at, created_at, created_by FROM invites ORDER BY created_at DESC')
    : env.DB.prepare('SELECT code, email, plan, free, free_months, note, used_by, used_at, created_at, created_by FROM invites WHERE created_by = ? ORDER BY created_at DESC').bind(env.uid);
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
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const joinLink = (code) => `https://daybook.fyi/join/${code}`;

// Create an invite and, when it names an address, *send it*. The inviter types
// their friend's email and a note and the invitation lands in their inbox with a
// one-click link - nobody copies a code between two apps. Leaving the email blank
// still just mints a code to share by hand.
export async function createInvite(env, input) {
  const admin = env.uid === 1;
  // Anyone may address an invite to a person - that is how it gets sent. Only the
  // owner may set a plan or the free (BYO-key) flag; a member's invite always
  // grants the default free plan.
  const email = (String(input.email || '').trim().toLowerCase()) || null;
  if (email && !EMAIL_RE.test(email)) throw new Error('That does not look like an email address.');
  if (email && await getUserByEmail(env, email)) throw new Error(`${email} is already on Daybook.`);

  // Inviting the same person twice re-sends their standing invitation rather than
  // leaving two live codes with one name on them. That also means a re-send never
  // trips the cap: it costs no new invite. Its plan and free flag stay as first
  // set - changing them is what a fresh code is for.
  const existing = email ? await pendingInvite(env, email) : null;
  if (!admin && !existing) {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND used_by IS NULL').bind(env.uid).first().catch(() => ({ n: 0 }));
    if ((c.n || 0) >= MEMBER_INVITE_CAP) throw new Error(`You already have ${MEMBER_INVITE_CAP} invitations open. Wait for one to be accepted before sending more.`);
  }

  const code = existing ? existing.code
    : (String(input.code || '').trim() || randomCode()).toUpperCase().slice(0, 24);
  if (!existing) {
    const plan = admin ? normPlan(input.plan || 'byok') : 'free';
    const free = admin && input.free ? 1 : 0;
    // A time-limited free run: 3, 6 or 12 months, or NULL for no limit. Only
    // meaningful on a free invite.
    const fm = free ? ([3, 6, 12].includes(Number(input.freeMonths)) ? Number(input.freeMonths) : null) : null;
    const note = admin ? (input.note || null) : null;
    await env.DB.prepare(
      'INSERT INTO invites (code, email, plan, free, free_months, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(code, email, plan, free, fm, note, env.uid, new Date().toISOString()).run();
  }

  let sent = false, sendError = null;
  if (email && input.send !== false) {
    try { await sendInviteMail(env, { to: email, code, message: input.message }); sent = true; }
    catch (e) { sendError = e.message || 'Could not send the email.'; }
  }
  return { code, email, link: joinLink(code), sent, sendError, reused: !!existing };
}

// Send (or re-send) one unused invitation. The inviter can nudge someone whose
// invite got lost without minting a second code.
export async function resendInvite(env, code) {
  const c = String(code || '').trim().toUpperCase();
  const inv = await env.DB.prepare('SELECT code, email, created_by, used_by FROM invites WHERE code = ?').bind(c).first().catch(() => null);
  if (!inv) throw new Error('No such invite.');
  if (env.uid !== 1 && inv.created_by !== env.uid) throw new Error('That is not your invite.');
  if (inv.used_by) throw new Error('That invitation has already been used.');
  if (!inv.email) throw new Error('That invite has no email address on it - share its link instead.');
  await sendInviteMail(env, { to: inv.email, code: inv.code });
  return { code: inv.code, email: inv.email, sent: true };
}

// Cancel (delete) an unused invitation you sent, freeing the slot. A used one is
// left alone - it's now an account, not an invite. Owner (1) can cancel any.
export async function cancelInvite(env, code) {
  const c = String(code || '').trim().toUpperCase();
  const inv = await env.DB.prepare('SELECT code, created_by, used_by FROM invites WHERE code = ?').bind(c).first().catch(() => null);
  if (!inv) throw new Error('No such invite.');
  if (env.uid !== 1 && inv.created_by !== env.uid) throw new Error('That is not your invite.');
  if (inv.used_by) throw new Error("That invitation has already been used - it can't be cancelled.");
  await env.DB.prepare('DELETE FROM invites WHERE code = ?').bind(c).run();
  return { code: c, cancelled: true };
}

// ── The invitation email ──────────────────────────────────────────────
// From Daybook, but *about* the person who sent it: "Robin has invited you to
// join Daybook". Replies go to the inviter, so a "what is this?" reaches a human.
async function sendInviteMail(env, { to, code, message }) {
  // The name goes into a Subject header, so strip anything that could start a
  // header line of its own.
  const from = String((env.user && env.user.name) || 'Someone').replace(/[\r\n]+/g, ' ').trim().slice(0, 40) || 'Someone';
  const subject = `${from} has invited you to join Daybook`;
  const link = joinLink(code);
  const html = inviteEmail({ from, message, link });
  const text = `${from} has invited you to join Daybook.\n\n${message ? `"${message}"\n\n` : ''}Accept the invitation: ${link}\n\nDaybook is a calm home for your day - your calendar, mail, tasks, notes, money and more, all in one place. You own everything in it, and it's private to you.`;
  const replyTo = (env.user && env.user.email) || null;

  if (env.BRIEF_SMTP_PASS) {
    // Same sender as the morning brief: a real Purelymail mailbox, so SPF/DKIM
    // pass natively with no Resend domain to verify (see CLAUDE.md).
    const acct = {
      email: env.BRIEF_FROM || 'contact@daybook.fyi', name: 'Daybook',
      username: env.BRIEF_SMTP_USER || 'contact@daybook.fyi',
      smtp_host: 'smtp.purelymail.com', smtp_port: 465, pass: env.BRIEF_SMTP_PASS,
    };
    await smtpSend(env, acct, { rcpts: [to], raw: buildMessage(acct, { to, subject, html, text, replyTo }) });
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Could not send the invitation (${res.status}).`);
}

// ── Account ───────────────────────────────────────────────────────────
// Name, primary email, extra email aliases, phone, plan. All scoped to env.uid.
export async function getAccount(env) {
  const u = await env.DB.prepare('SELECT id, email, name, subdomain, plan, status, ai_anthropic_enc, ai_gemini_enc FROM users WHERE id = ?').bind(env.uid).first();
  const al = await env.DB.prepare('SELECT email, verified FROM user_emails WHERE user_id = ? ORDER BY email').bind(env.uid).all().catch(() => ({ results: [] }));
  const ph = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'phone'").bind(env.uid).first().catch(() => null);
  const sms = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'sms_block_alerts'").bind(env.uid).first().catch(() => null);
  const brief = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'brief_enabled'").bind(env.uid).first().catch(() => null);
  const qOff = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'quote_off'").bind(env.uid).first().catch(() => null);
  const aiOff = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'ai_off'").bind(env.uid).first().catch(() => null);
  const surfEmail = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'surface_email'").bind(env.uid).first().catch(() => null);
  const surfSms = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'surface_sms'").bind(env.uid).first().catch(() => null);
  return {
    name: (u && u.name) || '', email: (u && u.email) || '', subdomain: (u && u.subdomain) || '',
    plan: (u && u.plan) || 'free', status: (u && u.status) || 'active',
    phone: ph ? ph.value : '', smsAlerts: !sms || sms.value !== '0',
    briefEmail: !brief || brief.value !== '0',
    surfaceEmail: !surfEmail || surfEmail.value !== '0',   // default on
    surfaceSms: !!(surfSms && surfSms.value === '1'),       // default off (costs money, needs a number)
    dailyQuote: !(qOff && qOff.value === '1'),
    aiOff: !!(aiOff && aiOff.value === '1'),
    aliases: (al.results || []).map((r) => ({ email: r.email, verified: !!r.verified })),
    // Never return the keys themselves - only whether one is stored.
    aiAnthropicSet: !!(u && u.ai_anthropic_enc), aiGeminiSet: !!(u && u.ai_gemini_enc),
    isOwner: env.uid === 1,
  };
}
export async function patchAccount(env, body) {
  if (body.name !== undefined) await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(body.name).slice(0, 60), env.uid).run();
  if (body.subdomain !== undefined) {
    const sub = normSubdomain(body.subdomain);
    if (!sub) throw new Error('That username has invalid characters or is reserved. Use a-z, 0-9 and hyphens.');
    const taken = await env.DB.prepare('SELECT id FROM users WHERE subdomain = ? AND id <> ?').bind(sub, env.uid).first().catch(() => null);
    if (taken) throw new Error(`"${sub}.daybook.fyi" is taken - try another.`);
    await env.DB.prepare('UPDATE users SET subdomain = ? WHERE id = ?').bind(sub, env.uid).run();
  }
  if (body.phone !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'phone', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, String(body.phone).slice(0, 40)).run();
  if (body.briefEmail !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'brief_enabled', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, body.briefEmail ? '1' : '0').run();
  if (body.dailyQuote !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'quote_off', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, body.dailyQuote ? '0' : '1').run();
  if (body.aiOff !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'ai_off', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, body.aiOff ? '1' : '0').run();
  if (body.surfaceEmail !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'surface_email', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, body.surfaceEmail ? '1' : '0').run();
  if (body.surfaceSms !== undefined) await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'surface_sms', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, body.surfaceSms ? '1' : '0').run();
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
  // Portfolio holdings live in their own D1, so purge them there too - otherwise a
  // member who tracked a portfolio leaves orphaned rows behind on closure.
  if (env.PORTFOLIO_DB) {
    for (const sql of ['DELETE FROM positions WHERE user_id = ?', 'DELETE FROM sales WHERE user_id = ?', 'DELETE FROM snapshots WHERE user_id = ?']) {
      try { await env.PORTFOLIO_DB.prepare(sql).bind(uid).run(); } catch {}
    }
  }
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
