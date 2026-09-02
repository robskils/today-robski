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

const REDIRECT_URI = 'https://daybook.fyi/api/gcal/callback';
const SCOPES = 'openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email';

export const gcalAvailable = (env) => !!(env.GCAL_MEMBER_CLIENT_ID && env.GCAL_MEMBER_CLIENT_SECRET);
export const gcalStatus = (env) => ({
  available: gcalAvailable(env),
  connected: !!(env.user && env.user.gcal_refresh_enc),
  email: (env.user && env.user.gcal_email) || null,
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
