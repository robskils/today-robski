// Email OTP login: request a 6-digit code, exchange it for a 7-day HS256 JWT,
// send that as `Authorization: Bearer`.
//
// Sends via Resend, same as the Incremento admin and Career Club.
//
// FROM_EMAIL is on incremento.co because that is the one domain verified on the
// free tier, and a verified domain can send anywhere. The sender address is
// incidental: Career Club posts its codes from onboarding@resend.dev and carries
// its brand in the body, which is what this does too. Verifying robski.uk would
// mean $20/mo, and Cloudflare's free path would mean editing the SPF record that
// robski.uk's real mail already depends on. Neither is worth it to post six
// digits to one person.
//
// Two departures from the Incremento implementation, both deliberate:
//   - codes are rate limited (see verifyCode). A 6-digit code is only 10^6
//     guesses, and Workers will happily serve a fast parallel brute force.
//   - there is no fallback key. The break-glass is D1: if email breaks
//     entirely you can read the code out of otp_codes with wrangler, which
//     needs your Cloudflare login rather than a shared secret.

import { sendSms } from './sms.js';
// smtpSend/buildMessage are used only inside sendCodeMail (call time), so the
// auth.js <-> mail.js cycle (mail.js imports signJWT) resolves fine.
import { smtpSend, buildMessage } from './mail.js';

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

const patterns = (env) =>
  (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

// An entry is either a whole address, or `*@domain` for any mailbox on it.
//
// The wildcard is only as safe as the domain: whoever can read mail at
// robski.uk can sign in, because that's where the code goes. Which is the
// point - possession of the mailbox is the proof. Match the domain exactly,
// so *@robski.uk covers neither mail.robski.uk nor notrobski.uk.
export function isAllowed(email, env) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  const domain = e.slice(at + 1);
  return patterns(env).some((p) => (p.startsWith('*@') ? domain === p.slice(2) : p === e));
}

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function isAuthed(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || !env.AUTH_SECRET) return false;
  const payload = await verifyJWT(auth.slice(7), env.AUTH_SECRET);
  // Re-check on every request, not just at sign-in: dropping an address from
  // ADMIN_EMAILS should kill its live sessions, not wait out the 7 days.
  return !!payload && isAllowed(payload.sub, env);
}

// ── Multi-tenant: who is this request? ────────────────────────────────
// Resolves the signed-in JWT to a row in `users`. This is the single source of
// the current tenant's id (uid); every data query downstream scopes to it.
//
// Resolution is by JWT email for now. Once daybook.fyi is live, the subdomain
// (tara.daybook.fyi) becomes the primary key and this also checks the hostname
// matches the user's subdomain - so a valid token for one account can't be
// replayed against another account's subdomain.
//
// Returns the users row, or null when the token is bad / the address isn't
// allowed / no account exists yet (a valid sign-in that hasn't been provisioned
// is a 401, not a silent all-tenants view).
export async function resolveUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || !env.AUTH_SECRET) return null;
  const payload = await verifyJWT(auth.slice(7), env.AUTH_SECRET);
  if (!payload) return null;
  // Access is by being *provisioned* now, not by an allow-list: the users-row
  // lookup below IS the gate. A verified token with no account resolves to null
  // (a 401 that routes to signup), never to a silent all-tenants view.
  // Match the account's primary email, or any alias in user_emails, so all of a
  // person's addresses sign into the one account.
  const user = await env.DB.prepare(
    `SELECT id, email, name, subdomain, plan, status, ai_anthropic_enc, ai_gemini_enc FROM users
      WHERE email = ? OR id = (SELECT user_id FROM user_emails WHERE email = ? AND verified = 1)`,
  ).bind(payload.sub, payload.sub).first().catch(() => null);
  if (!user || user.status === 'suspended') return null;
  return user;
}

// ── POST /auth/request-code ───────────────────────────────────────────

export async function requestCode(request, env, json, err) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid request', 400); }

  const email = String(body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return err('That does not look like an email address', 400);
  // 'sms' texts the code to ALERT_PHONE instead of emailing it. This is the
  // fix for the Catch-22 once Robski Life *is* the mailbox: if email breaks or
  // is locked behind this very sign-in, the phone still gets you in.
  const channel = body.channel === 'sms' ? 'sms' : 'email';

  // Open registration: any valid email can request a code and sign up. The
  // kill-switch env.SIGNUP_CLOSED='1' reverts to admin-only (allow-listed emails
  // still get in; everyone else gets the same silent ok, so the list can't be
  // probed). Rate limiting below still applies to every request.
  if (env.SIGNUP_CLOSED === '1' && !isAllowed(email, env)) return json({ ok: true });

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

  if (channel === 'sms') {
    const sms = await sendSms(env, `${code} is your Daybook sign-in code. It expires in 10 minutes.`);
    // Only report SMS if it actually left: a not-configured or rejected send
    // silently falls through to email, so the user is never stranded without a
    // code just because SMS credit ran out.
    if (sms && sms.ok) return json({ ok: true, channel: 'sms' });
    console.error('sms login send failed, falling back to email:', sms && (sms.skipped || sms.status));
  }

  const res = await sendCodeMail(env, email, code, 'signin');

  if (!res.ok) {
    // The code is already in D1 at this point, so this is recoverable:
    //   npx wrangler d1 execute today-robski --remote --command "SELECT code FROM otp_codes"
    console.error('resend:', res.status, await res.text());
    return err('Could not send the code. Try again shortly.', 502);
  }

  return json({ ok: true, channel: 'email' });
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

// Deliver a 6-digit code, worded for either sign-in or confirming a newly added
// alias. Returns something with `.ok` and `.text()` so the caller reacts to a
// non-ok send the same way whichever transport ran. ASCII subjects only: a
// non-ASCII subject needs RFC 2047 encoding.
export async function sendCodeMail(env, email, code, kind) {
  const alias = kind === 'alias';
  const subject = alias ? `${code} - confirm your email for Daybook` : `${code} - your Daybook sign-in code`;
  const html = codeEmail(code, kind);
  const text = alias
    ? `Enter ${code} in Daybook to add this address to your account. It expires in 10 minutes.`
    : `Your Daybook sign-in code is ${code}. It expires in 10 minutes.`;

  // Primary path: Purelymail SMTP as contact@daybook.fyi - a real mailbox on a
  // fully-aligned domain (SPF+DKIM+DMARC), so the code lands in the inbox and
  // carries the Daybook address. Same transport and secret as the invite and the
  // morning brief. Falls back to Resend only if no SMTP secret is set.
  if (env.BRIEF_SMTP_PASS) {
    const acct = {
      email: env.BRIEF_FROM || 'contact@daybook.fyi', name: 'Daybook',
      username: env.BRIEF_SMTP_USER || 'contact@daybook.fyi',
      smtp_host: 'smtp.purelymail.com', smtp_port: 465, pass: env.BRIEF_SMTP_PASS,
    };
    try {
      await smtpSend(env, acct, { rcpts: [email], raw: buildMessage(acct, { to: email, subject, html, text }) });
      return { ok: true };
    } catch (e) {
      // Don't strand the sign-in on an SMTP hiccup: log and fall through to
      // Resend so the code still goes out (from the fallback address).
      console.error('smtp code send failed, falling back to Resend:', String((e && e.message) || e));
    }
  }

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [email], subject, html, text }),
  });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Daybook branding: warm paper and rust, matching the app and the homepage.
//
// Table layout and inline styles throughout: Gmail strips <style> blocks, and
// Outlook's renderer is Word. No flexbox, no CSS variables, no SVG.
export function codeEmail(code, kind) {
  const alias = kind === 'alias';
  const eyebrow = alias ? 'Confirm email' : 'Sign in';
  const line = alias
    ? `Enter this code in Daybook to add this address to your account. It expires in <strong style="color:#211c17">10 minutes</strong>.`
    : `Your sign-in code. It expires in <strong style="color:#211c17">10 minutes</strong>.`;
  const pre = alias ? `${code} confirms this email for your Daybook account.` : `${code} is your Daybook sign-in code. It expires in 10 minutes.`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#efeae0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <!-- Preheader: what the inbox shows before you open it. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efeae0;padding:40px 16px">
    <tr><td align="center">
      <!-- Fluid card: width:100% up to a 440px cap, so it shrinks to fit a phone
           instead of a fixed 440px that runs off a narrow screen. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;background:#fbf9f4;border-radius:18px;overflow:hidden;border:1px solid #e4ddcf">

        <!-- Wordmark: a rust sunrise dot + Daybook in a warm serif. -->
        <tr><td style="padding:34px 38px 0" align="center">
          <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#c4412e;vertical-align:middle"></span>
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:27px;font-weight:700;letter-spacing:-0.01em;color:#211c17;vertical-align:middle;padding-left:9px">Daybook</span>
        </td></tr>

        <!-- A warm keyline. Solid cells: gradients are the first thing Outlook drops. -->
        <tr><td style="padding:22px 38px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#c4412e;height:3px;line-height:3px;font-size:0">&nbsp;</td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:26px 38px 0" align="center">
          <p style="margin:0;font-size:13px;letter-spacing:0.24em;text-transform:uppercase;color:#8b7f72">${eyebrow}</p>
        </td></tr>

        <tr><td style="padding:12px 38px 0">
          <p style="margin:0;font-size:15px;color:#574e44;line-height:1.6;text-align:center">${line}</p>
        </td></tr>

        <tr><td style="padding:24px 38px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="background:#f4f1ea;border:1px solid #e4ddcf;border-radius:12px;padding:24px">
              <span style="font-size:38px;font-weight:700;letter-spacing:0.2em;color:#c4412e;font-family:'Courier New',Courier,monospace">${code}</span>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 38px 30px">
          <p style="margin:0;font-size:12px;color:#8b7f72;line-height:1.6;text-align:center">Didn't ask for this? Ignore it, and nothing happens.</p>
        </td></tr>

        <tr><td style="padding:16px 38px;border-top:1px solid #e4ddcf">
          <p style="margin:0;font-size:11px;color:#8b7f72;text-align:center">
            <a href="https://daybook.fyi" style="color:#c4412e;text-decoration:none">daybook.fyi</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}
