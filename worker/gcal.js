// Per-member Google Calendar connect.
//
// A member connects their OWN Google account through a SEPARATE OAuth client
// (GCAL_MEMBER_CLIENT_ID/SECRET) that lives in its own Google Cloud project, so
// the owner's Internal client - and its non-expiring refresh token - is never
// touched (see CLAUDE.md). We store each member's refresh token AES-256-GCM
// encrypted (the same scheme as mail passwords and AI keys) on their users row.
//
// The whole flow hangs off one fixed redirect URI on the apex, because Google
// forbids wildcard subdomains. A signed `state` carries who is connecting, and
// the callback bounces them back to their own subdomain when it's done.
import { encryptSecret, decryptSecret } from './ai.js';
import { signJWT, verifyJWT } from './auth.js';

const REDIRECT_URI = 'https://lifefold.co/api/gcal/callback';
const SCOPES = 'openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email';

export const gcalAvailable = (env) => !!(env.GCAL_MEMBER_CLIENT_ID && env.GCAL_MEMBER_CLIENT_SECRET);
export const gcalStatus = (env) => ({
  available: gcalAvailable(env),
  connected: !!(env.user && env.user.gcal_refresh_enc),
  email: (env.user && env.user.gcal_email) || null,
  // The owner reads the shared Workspace calendar on the env token; surface which
  // address that is, so Settings > Calendar can name it (and offer to pause it).
  ownerConnected: Number(env.uid) === 1 && !!env.GOOGLE_REFRESH_TOKEN,
  ownerEmail: (Number(env.uid) === 1 && env.GOOGLE_REFRESH_TOKEN) ? (env.GOOGLE_CALENDAR_ID || null) : null,
});

// The consent URL to send the member to. `prompt=consent` + `access_type=offline`
// is what makes Google hand back a refresh token (without it, a re-connect gets
// only an access token and the calendar would quietly stop after an hour).
export async function gcalConnectUrl(env) {
  if (!gcalAvailable(env)) throw new Error('Calendar connect is not set up yet.');
  const now = Math.floor(Date.now() / 1000);
  const state = await signJWT({ k: 'gcal', uid: env.uid, sd: (env.user && env.user.subdomain) || 'robski', iat: now, exp: now + 600 }, env.AUTH_SECRET);
  const p = new URLSearchParams({
    client_id: env.GCAL_MEMBER_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

const bounce = (loc) => new Response(null, { status: 302, headers: { Location: loc, 'Cache-Control': 'no-store' } });
const home = (sd, q) => `https://${sd || 'robski'}.daybook.fyi/calendar?gcal=${q}`;

// Google redirects here (unauthenticated - the member's session lives on their
// subdomain, not the apex), so trust comes from the signed `state`, not a cookie.
export async function gcalCallback(request, env, url) {
  let st = null;
  try { st = await verifyJWT(url.searchParams.get('state') || '', env.AUTH_SECRET); } catch {}
  if (!st || st.k !== 'gcal') return bounce(home('robski', 'error'));
  const sd = st.sd;
  if (url.searchParams.get('error') || !url.searchParams.get('code')) return bounce(home(sd, 'denied'));
  if (!gcalAvailable(env)) return bounce(home(sd, 'error'));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: env.GCAL_MEMBER_CLIENT_ID,
      client_secret: env.GCAL_MEMBER_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) { console.error('gcal exchange:', res.status, await res.text().catch(() => '')); return bounce(home(sd, 'error')); }
  const data = await res.json();
  if (!data.refresh_token) return bounce(home(sd, 'noretry'));   // consent returned no refresh token

  let email = '';
  try { if (data.id_token) email = JSON.parse(atob(data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch {}
  if (!email && data.access_token) {
    try { email = (await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` } }).then((r) => r.json())).email || ''; } catch {}
  }
  if (st.add) {
    // An additional account - store it as its own calendar_accounts row, leaving
    // the user's first (users.gcal) connection exactly as it is.
    await gcalStoreAddedAccount(env, st.uid, data.refresh_token, email);
    return bounce(home(sd, 'added'));
  }
  const enc = await encryptSecret(env, data.refresh_token);
  await env.DB.prepare('UPDATE users SET gcal_refresh_enc = ?, gcal_email = ? WHERE id = ?').bind(enc, email || null, st.uid).run();
  return bounce(home(sd, 'connected'));
}

// A member's own calendar access token, refreshed from their stored token and
// cached per uid (the isolate lives long enough to reuse it within a burst).
const cache = {};
export async function gcalMemberToken(env) {
  const enc = env.user && env.user.gcal_refresh_enc;
  if (!enc || !gcalAvailable(env)) return null;
  const c = cache[env.uid];
  if (c && c.expires > Date.now() + 30_000) return c.token;
  let refresh; try { refresh = await decryptSecret(env, enc); } catch { return null; }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GCAL_MEMBER_CLIENT_ID, client_secret: env.GCAL_MEMBER_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  if (!res.ok) { console.error('gcal member token:', res.status, await res.text().catch(() => '')); return null; }
  const data = await res.json();
  cache[env.uid] = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

// Disconnect: revoke at Google (best-effort) and drop the stored token.
export async function gcalDisconnect(env) {
  const enc = env.user && env.user.gcal_refresh_enc;
  if (enc) { try { const r = await decryptSecret(env, enc); await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(r)}`, { method: 'POST' }); } catch {} }
  delete cache[env.uid];
  await env.DB.prepare('UPDATE users SET gcal_refresh_enc = NULL, gcal_email = NULL WHERE id = ?').bind(env.uid).run();
}

// ── multiple connected calendars (calendar_accounts) ───────────────────────
// Beyond the single users.gcal above, a user can connect several more Google
// accounts (and, in phase 2, CalDAV). Each is a row in calendar_accounts, merged
// onto the calendar as an extra source. The consent flow is the same - the only
// difference is `add:1` in the signed state, which tells the callback to INSERT a
// new row instead of overwriting the users row. (Robin, 2026-10-25.)
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 16);
// Spread connected calendars around the colour wheel so each reads distinctly.
const ACCT_HUES = [205, 150, 275, 35, 330, 95, 250, 15];

export async function gcalAddConnectUrl(env) {
  if (!gcalAvailable(env)) throw new Error('Calendar connect is not set up yet.');
  const now = Math.floor(Date.now() / 1000);
  const state = await signJWT({ k: 'gcal', add: 1, uid: env.uid, sd: (env.user && env.user.subdomain) || 'robski', iat: now, exp: now + 600 }, env.AUTH_SECRET);
  const p = new URLSearchParams({
    client_id: env.GCAL_MEMBER_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

// Called from gcalCallback when the signed state carries add:1. Stores the new
// account as its own calendar_accounts row (never touching the users.gcal path).
export async function gcalStoreAddedAccount(env, uid, refreshToken, email) {
  const enc = await encryptSecret(env, refreshToken);
  const n = await env.DB.prepare('SELECT COUNT(*) AS c FROM calendar_accounts WHERE user_id = ?').bind(uid).first().catch(() => ({ c: 0 }));
  const hue = ACCT_HUES[((n && n.c) || 0) % ACCT_HUES.length];
  await env.DB.prepare(
    "INSERT INTO calendar_accounts (id, user_id, provider, label, color, refresh_enc, cal_id, writable, enabled, created_at) VALUES (?, ?, 'google', ?, ?, ?, 'primary', 1, 1, ?)",
  ).bind(rid(), uid, email || 'Google account', String(hue), enc, new Date().toISOString()).run();
}

// The user's extra connected calendars, for the picker + the settings list.
export async function listCalendarAccounts(env, uid = env.uid) {
  const rows = (await env.DB.prepare('SELECT id, provider, label, color, cal_id, writable, enabled FROM calendar_accounts WHERE user_id = ? ORDER BY created_at').bind(uid).all().catch(() => ({ results: [] }))).results || [];
  return rows.map((r) => ({ id: r.id, provider: r.provider, label: r.label, color: r.color, calId: r.cal_id, writable: r.writable !== 0, enabled: r.enabled !== 0 }));
}

// One extra account's refresh-token row (decrypted token lives only in memory).
export async function getCalendarAccount(env, id, uid = env.uid) {
  return env.DB.prepare('SELECT * FROM calendar_accounts WHERE id = ? AND user_id = ?').bind(id, uid).first().catch(() => null);
}

// An access token for a specific connected Google account, cached by its id.
export async function gcalAccountToken(env, acct) {
  if (!acct || acct.provider !== 'google' || !acct.refresh_enc || !gcalAvailable(env)) return null;
  const key = `acct:${acct.id}`;
  const c = cache[key];
  if (c && c.expires > Date.now() + 30_000) return c.token;
  let refresh; try { refresh = await decryptSecret(env, acct.refresh_enc); } catch { return null; }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GCAL_MEMBER_CLIENT_ID, client_secret: env.GCAL_MEMBER_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  if (!res.ok) { console.error('gcal acct token:', acct.id, res.status); return null; }
  const data = await res.json();
  cache[key] = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

export async function removeCalendarAccount(env, id, uid = env.uid) {
  const acct = await getCalendarAccount(env, id, uid);
  if (acct && acct.refresh_enc) { try { const r = await decryptSecret(env, acct.refresh_enc); await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(r)}`, { method: 'POST' }); } catch {} }
  delete cache[`acct:${id}`];
  await env.DB.prepare('DELETE FROM calendar_accounts WHERE id = ? AND user_id = ?').bind(id, uid).run().catch(() => {});
}
