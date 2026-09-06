// Optional TOTP two-factor auth (RFC 6238, HMAC-SHA1, 30s, 6 digits) - the kind
// Google Authenticator, 1Password, Authy etc. produce. The shared secret is
// stored AES-256-GCM encrypted (see ai.js encryptSecret); only its base32 form
// ever leaves the server, and only during enrolment. Recovery codes are stored
// as SHA-256 hashes, never in the clear.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

// A fresh 160-bit secret, base32-encoded for the authenticator app.
export function randomSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

async function hotp(secretBytes, counter) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8); const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const off = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

// True if `code` is a valid TOTP for the secret now (±`window` 30s steps, so a
// slightly fast/slow clock still works).
export async function totpVerify(secretB32, code, window = 1) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  const secret = base32Decode(secretB32);
  if (!secret.length) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (timingSafeEqual(await hotp(secret, step + w), c)) return true;
  }
  return false;
}

export function otpauthURI(secretB32, label, issuer = 'Daybook') {
  return `otpauth://totp/${encodeURIComponent(issuer + ':' + label)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// One-time recovery codes (shown once at enrolment), formatted xxxx-xxxx.
export function makeRecoveryCodes(n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = base32Encode(crypto.getRandomValues(new Uint8Array(5))).slice(0, 8).toLowerCase();
    out.push(s.slice(0, 4) + '-' + s.slice(4, 8));
  }
  return out;
}
export async function hashRecovery(code) {
  const norm = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('rc:' + norm));
  return btoa(String.fromCharCode(...new Uint8Array(h)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
