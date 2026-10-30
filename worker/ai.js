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

// Per-feature switches, under the master one: a user can leave AI on but turn off
// a particular use of Claude (e.g. keep Email Scribe, switch off horoscopes). The
// map is { featureKey: false } where false means off; absent means on. Settings →
// Plan writes it; `aiKey` reads it, so one disabled feature routes through the same
// "no AI available" path as the master switch with no per-endpoint wiring.
export async function aiFeaturesMap(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'ai_features'").bind(env.uid).first().catch(() => null);
  if (!row || !row.value) return {};
  try { return JSON.parse(row.value) || {}; } catch { return {}; }
}
export async function aiFeatureOff(env, feature) {
  if (!feature) return false;
  const m = await aiFeaturesMap(env);
  return m[feature] === false || m[feature] === 0;
}
// The key to use for this user + provider, or null if they must add their own
// (or if they've switched AI off entirely, or off for this feature). Returning
// null routes every caller through its existing "no AI available" path, so the
// switches need gating in exactly one place. `feature` is the capability group
// (wellbeing / divination / reviews / mail / money / import).
// The three providers a member can bring. One encrypted key column + one shared
// env key each; add a provider by adding a row here and a branch in callAI.
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'];
const AI_COLS = { anthropic: 'ai_anthropic_enc', openai: 'ai_openai_enc', gemini: 'ai_gemini_enc' };
const AI_ENVKEY = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
export async function aiKey(env, provider, feature) {
  if (await aiIsOff(env)) return null;
  if (feature && await aiFeatureOff(env, feature)) return null;
  const col = AI_COLS[provider] || AI_COLS.anthropic;
  const enc = env.user && env.user[col];
  if (enc) { try { return await decryptSecret(env, enc); } catch {} }
  // Our own key is the Premium Plus arrangement: the owner, and any member on the
  // managed tier, run on it because we supply the AI for them. Everyone else
  // brings their own. This MUST go through isManaged: 'premium' is now the label
  // of the tier that does NOT get our keys, and a bare string test here would be
  // us paying Anthropic for every customer on the cheaper plan.
  if (env.uid === 1 || isManaged(env.user && env.user.plan)) return env[AI_ENVKEY[provider] || AI_ENVKEY.anthropic] || null;
  return null;
}
// Which provider a pasted key belongs to, so onboarding can take one key and route
// it without the member telling us. Anthropic keys are sk-ant-…, Gemini AIza…,
// OpenAI sk-… (tested last, since sk-ant- also begins sk-).
export function detectProvider(key) {
  const k = String(key || '').trim();
  if (/^sk-ant-/i.test(k)) return 'anthropic';
  if (/^AIza/.test(k)) return 'gemini';
  if (/^sk-/i.test(k)) return 'openai';
  return null;
}
// The provider to use for this member's AI calls: their explicit pick when its key
// is set (or they're owner/managed), else whichever key they have, else Anthropic.
export async function activeProvider(env) {
  const u = env.user || {};
  const has = { anthropic: !!u.ai_anthropic_enc, openai: !!u.ai_openai_enc, gemini: !!u.ai_gemini_enc };
  const row = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'ai_provider'").bind(env.uid).first().catch(() => null);
  const pick = row && row.value;
  if (AI_PROVIDERS.includes(pick) && (has[pick] || env.uid === 1 || isManaged(u.plan))) return pick;
  if (has.openai) return 'openai';
  if (has.anthropic) return 'anthropic';
  if (has.gemini) return 'gemini';
  return 'anthropic';
}
// The one place a text/vision AI request is made, so every feature runs on whichever
// provider the member connected. Returns the text; null when AI is off, the feature
// is off, or they have no key for their provider (route that through the caller's
// existing "no AI" path); throws on an API error. `images`: optional [{ media_type,
// data }] base64 (no data: prefix). `provider` overrides the active one (voice uses it).
export async function callAI(env, feature, opts = {}) {
  const provider = opts.provider || await activeProvider(env);
  const key = await aiKey(env, provider, feature);
  if (!key) return null;
  if (provider === 'openai') return openaiCall(env, feature, key, opts);
  if (provider === 'gemini') return geminiCall(env, feature, key, opts);
  return anthropicCall(env, feature, key, opts);
}
async function anthropicCall(env, feature, key, { system, user, max_tokens = 500, images }) {
  const content = (images && images.length)
    ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })), { type: 'text', text: user }]
    : user;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.CLAUDIUS_MODEL || 'claude-opus-5', max_tokens, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`AI error ${res.status}: ${t.slice(0, 160)}`); }
  const data = await res.json();
  logAiUsage(env, 'anthropic', feature, data.model, data.usage && data.usage.input_tokens, data.usage && data.usage.output_tokens);
  if (data.stop_reason === 'refusal') throw new Error('The AI held back on this one.');
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}
async function openaiCall(env, feature, key, { system, user, max_tokens = 500, images }) {
  const userContent = (images && images.length)
    ? [{ type: 'text', text: user }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` } }))]
    : user;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: userContent });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o', max_tokens, messages }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`AI error ${res.status}: ${t.slice(0, 160)}`); }
  const data = await res.json();
  const u = data.usage || {};
  logAiUsage(env, 'openai', feature, data.model, u.prompt_tokens, u.completion_tokens);
  return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
}
async function geminiCall(env, feature, key, { system, user, max_tokens = 500, images }) {
  const parts = [{ text: user }, ...((images || []).map((im) => ({ inlineData: { mimeType: im.media_type, data: im.data } })))];
  const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: max_tokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`AI error ${res.status}: ${t.slice(0, 160)}`); }
  const data = await res.json();
  const cand = (data.candidates || [])[0] || {};
  const txt = ((cand.content || {}).parts || []).map((p) => p.text || '').join('').trim();
  const um = data.usageMetadata || {};
  logAiUsage(env, 'gemini', feature, model, um.promptTokenCount, um.candidatesTokenCount);
  return txt;
}
// Warm, not scolding: this is what a member sees when they open an AI feature with
// AI off. It should invite, not block - AI is an optional extra. (Robin, 2026-10-16.)
export const aiNeedsKey = (provider) => 'This one uses AI, which is switched off right now - an optional extra, so the rest of Koyeba works just as well without it. Turn it on anytime in Settings → Plan.';

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
  const col = AI_COLS[provider] || AI_COLS.anthropic;
  const v = String(value || '').trim();
  const enc = v ? await encryptSecret(env, v) : null;
  await env.DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(enc, env.uid).run();
}
// The member's chosen provider (what powers their AI). Stored in settings so it
// survives even if they later clear and re-add keys; '' clears it (auto-pick).
export async function setAiProvider(env, provider) {
  const p = AI_PROVIDERS.includes(provider) ? provider : '';
  await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'ai_provider', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, p).run();
}
