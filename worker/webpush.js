// Web Push, hand-rolled on WebCrypto so it runs in the Worker with no deps.
//
// Two specs meet here:
//   - RFC 8292 (VAPID): a signed JWT proves the push is from us, so the push
//     service (Apple/Google/Mozilla) accepts it.
//   - RFC 8291 + 8188 (aes128gcm): the payload is encrypted end-to-end to the
//     subscriber's keys, so only the device can read it.
//
// The result is a POST to the subscription's endpoint. The device's service
// worker decrypts the payload and sets the app-icon badge.

const enc = new TextEncoder();

const b64urlToBytes = (s) => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64url = (buf) => {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

// HKDF (extract+expand) via WebCrypto, returning `length` bytes.
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8,
  );
  return new Uint8Array(bits);
}

// ── VAPID: the Authorization header ──────────────────────────────────────
export async function vapidAuth(endpoint, vapidJwk, publicKeyB64url, subject) {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud, exp: now + 12 * 60 * 60, sub: subject };
  const seg = (o) => bytesToB64url(enc.encode(JSON.stringify(o)));
  const signingInput = `${seg(header)}.${seg(claims)}`;

  const key = await crypto.subtle.importKey(
    'jwk', { ...vapidJwk, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${publicKeyB64url}`;
}

// ── aes128gcm: encrypt the payload to the subscriber's keys ───────────────
export async function encryptPayload(payload, uaPublicB64, authB64) {
  const uaPublic = b64urlToBytes(uaPublicB64);   // 65 bytes
  const authSecret = b64urlToBytes(authB64);     // 16 bytes

  // Our ephemeral ECDH keypair for this one message.
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65 bytes
  const uaPubKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asKeys.privateKey, 256));

  // RFC 8291: mix the shared secret with the auth secret and both public keys.
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  // RFC 8188: derive the content key + nonce from a random salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // A single record: payload followed by the 0x02 last-record delimiter.
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  // Header: salt(16) | record-size(4) | keyid-len(1)=65 | as_public(65), then ciphertext.
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ct);
}

// Send one push. Returns { ok, status }. A 404/410 means the subscription is
// dead and the caller should delete it.
export async function sendPush(subscription, payloadObj, opts) {
  const body = await encryptPayload(
    JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth,
  );
  const auth = await vapidAuth(subscription.endpoint, opts.vapidJwk, opts.publicKey, opts.subject);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl || 86400),
    },
    body,
  });
  return { ok: res.ok, status: res.status };
}
