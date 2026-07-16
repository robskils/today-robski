// Email OTP login. Same shape as the Incremento admin: request a 6-digit code,
// exchange it for a 7-day HS256 JWT, send that as `Authorization: Bearer`.
//
// Differences from that one, both deliberate:
//   - codes are rate limited (see verifyCode). A 6-digit code is only 10^6
//     guesses, and Workers will happily serve a fast parallel brute force.
//   - there is no fallback key. The break-glass is D1: if the email never
//     arrives you can read the code out of otp_codes with wrangler, which
//     needs your Cloudflare login rather than a shared secret.

const enc = new TextEncoder();
const dec = new TextDecoder();

const CODE_TTL = 600;          // 10 minutes
const RESEND_COOLDOWN = 45;    // seconds between sends to one address
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 7;

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signJWT(payload, secret) {
  const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const b = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${h}.${b}`)));
  return `${h}.${b}.${sig}`;
}

export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, sig] = parts;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret),
      fromB64url(sig), enc.encode(`${h}.${b}`));
    // Never trust the payload before the signature checks out: it is attacker
    // supplied until then, alg:none and all that.
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64url(b)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

const allowed = (env) =>
  (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function isAuthed(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || !env.AUTH_SECRET) return false;
  const payload = await verifyJWT(auth.slice(7), env.AUTH_SECRET);
  return !!payload && allowed(env).includes((payload.sub || '').toLowerCase());
}

// ── POST /auth/request-code ───────────────────────────────────────────

export async function requestCode(request, env, json, err) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid request', 400); }

  const email = String(body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return err('That does not look like an email address', 400);

  // Deliberately the same response either way. Telling a stranger which
  // addresses are allowed is free reconnaissance.
  if (!allowed(env).includes(email)) return json({ ok: true });

  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare('SELECT sent_at FROM otp_codes WHERE email = ?')
    .bind(email).first();
  if (existing && now - existing.sent_at < RESEND_COOLDOWN) {
    return err(`Hold on ${RESEND_COOLDOWN - (now - existing.sent_at)}s before asking for another code`, 429);
  }

  // crypto.getRandomValues, not Math.random: this is a credential.
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');

  await env.DB.prepare(
    `INSERT INTO otp_codes (email, code, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code = excluded.code, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`,
  ).bind(email, code, now + CODE_TTL, now).run();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: `Today <${env.FROM_EMAIL}>`,
      to: [email],
      subject: `${code} — your Today sign-in code`,
      html: codeEmail(code),
      text: `Your Today sign-in code is ${code}. It expires in 10 minutes.`,
    }),
  });

  if (!res.ok) {
    console.error('resend:', res.status, await res.text());
    return err('Could not send the code. Try again shortly.', 502);
  }
  return json({ ok: true });
}

// ── POST /auth/verify ─────────────────────────────────────────────────

export async function verifyCode(request, env, json, err) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid request', 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!email || !code) return err('Missing email or code', 400);

  const row = await env.DB.prepare(
    'SELECT code, expires_at, attempts FROM otp_codes WHERE email = ?',
  ).bind(email).first();
  if (!row) return err('No code outstanding. Request a new one.', 400);

  const now = Math.floor(Date.now() / 1000);
  if (now > row.expires_at) {
    await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();
    return err('That code has expired. Request a new one.', 400);
  }

  // Burn the code after a few wrong guesses, or 10 minutes is plenty of time
  // to walk the whole six-digit space.
  if (row.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();
    return err('Too many attempts. Request a new code.', 429);
  }

  if (!timingSafeEqual(row.code, code)) {
    await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(email).run();
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return err(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code.', 400);
  }

  await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();

  const token = await signJWT(
    { sub: email, iat: now, exp: now + 60 * 60 * 24 * SESSION_DAYS },
    env.AUTH_SECRET,
  );
  return json({ token, email });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Warm paper and sumi ink, same as the app. Renders on a white card in clients
// that ignore the background.
function codeEmail(code) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#efeade;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efeade;padding:44px 0">
    <tr><td align="center">
      <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:440px;max-width:440px;background:#fffdf8;border:1px solid #e0d9c8;border-radius:16px">
        <tr><td style="padding:34px 38px 0" align="center">
          <!-- ensō -->
          <svg width="46" height="46" viewBox="0 0 64 64" style="display:block">
            <path d="M44 14a24 24 0 1 0 9 18" fill="none" stroke="#b4553a" stroke-width="6.5" stroke-linecap="round"/>
          </svg>
        </td></tr>
        <tr><td style="padding:18px 38px 0" align="center">
          <p style="margin:0;font-size:23px;color:#23201b;font-family:Georgia,serif">Today</p>
        </td></tr>
        <tr><td style="padding:22px 38px 0">
          <p style="margin:0;font-size:15px;color:#5d574e;line-height:1.6;text-align:center">Your sign-in code. It expires in <strong style="color:#23201b">10 minutes</strong>.</p>
        </td></tr>
        <tr><td style="padding:24px 38px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="background:#f7f4ee;border:1px solid #e0d9c8;border-radius:12px;padding:22px">
              <span style="font-size:38px;font-weight:700;letter-spacing:0.2em;color:#b4553a;font-family:'Courier New',monospace">${code}</span>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 38px 34px">
          <p style="margin:0;font-size:12px;color:#8d8578;line-height:1.6;text-align:center">Didn't ask for this? Ignore it, and nothing happens.</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:11px;color:#8d8578">today.robski.uk</p>
    </td></tr>
  </table>
</body></html>`;
}
