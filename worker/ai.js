import { isManaged } from './plans.js';
// BYO AI keys + usage metering. A member stores their own Anthropic / Gemini key
// (AES-256-GCM at rest, the same scheme mail passwords use). When set, it's used
// for that member's AI calls; only the owner (user 1) falls back to the shared
// env key - so no member ever spends the owner's quota. Every call logs a row in
// ai_usage for visibility.

async function aiCryptoKey(env) {
  const raw = new TextEncoder().encode(`ai:${env.AUTH_SECRET || ''}`);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(env, text) {
  const key = await aiCryptoKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const out = new Uint8Array(iv.length + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...out));
}
export async function decryptSecret(env, b64) {
  const key = await aiCryptoKey(env);
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
  return new TextDecoder().decode(pt);
}

// A per-user master switch. When on, every AI feature is disabled for that
// tenant - this reads the same 'ai_off' setting the Settings → AI toggle writes.
export async function aiIsOff(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'ai_off'").bind(env.uid).first().catch(() => null);
  return !!(row && row.value === '1');
}

// The key to use for this user + provider, or null if they must add their own
// (or if they've switched AI off entirely). Returning null routes every caller
// through its existing "no AI available" path, so the switch needs gating in
// exactly one place.
export async function aiKey(env, provider) {
  if (await aiIsOff(env)) return null;
  const col = provider === 'gemini' ? 'ai_gemini_enc' : 'ai_anthropic_enc';
  const enc = env.user && env.user[col];
  if (enc) { try { return await decryptSecret(env, enc); } catch {} }
  // Our own key is the Premium Plus arrangement: the owner, and any member on the
  // managed tier, run on it because we supply the AI for them. Everyone else
  // brings their own. This MUST go through isManaged: 'premium' is now the label
  // of the tier that does NOT get our keys, and a bare string test here would be
  // us paying Anthropic for every customer on the cheaper plan.
  if (env.uid === 1 || isManaged(env.user && env.user.plan)) return provider === 'gemini' ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY;
  return null;
}
export const aiNeedsKey = (provider) => `AI is switched off, or no ${provider === 'gemini' ? 'Google Gemini' : 'Anthropic'} key is set. Check Settings → Plan.`;

// One ledger row per call. Best-effort: logging must never break the feature.
export async function logAiUsage(env, provider, feature, model, inTok, outTok) {
  try {
    await env.DB.prepare('INSERT INTO ai_usage (user_id, ts, provider, model, feature, in_tokens, out_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(env.uid, new Date().toISOString(), provider, model || null, feature || null, inTok || 0, outTok || 0).run();
  } catch {}
}

// Store or clear a user's own key. Returns nothing; the caller re-reads the
// account. Empty string clears it.
export async function setAiKey(env, provider, value) {
  const col = provider === 'gemini' ? 'ai_gemini_enc' : 'ai_anthropic_enc';
  const v = String(value || '').trim();
  const enc = v ? await encryptSecret(env, v) : null;
  await env.DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(enc, env.uid).run();
}
