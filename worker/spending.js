/**
 * Spending: import bank transactions (CSV for now; an Open Banking auto-sync can
 * feed the same shape later), auto-categorise them, and let the page slice them
 * into income vs outgoings by category and over time.
 *
 * Each transaction is a block: kind='txn', props={date, amount (signed:
 * negative = money out, positive = in), currency, description, category, hash}.
 * `hash` dedupes re-imports of the same statement. Aggregation is done in the
 * page from the raw txns, so this module is just import + (re)categorise.
 */

import { aiKey, aiNeedsKey, logAiUsage } from './ai.js';

// The category set. `income:true` marks the money-in buckets.
export const SPEND_CATEGORIES = [
  'Groceries', 'Eating out', 'Transport', 'Housing', 'Utilities', 'Health',
  'Shopping', 'Entertainment', 'Travel', 'Subscriptions', 'Fees & charges',
  'Cash', 'Transfers', 'Salary', 'Other income', 'Uncategorised',
];

// Keyword → category. First match wins; matched case-insensitively as a regex
// against the description. Kept deliberately broad; the user fixes the rest by
// hand on the page.
const SEED_RULES = [
  ['salary|payroll|wage|sal[aá]rio|ordenado|vencimento', 'Salary'],
  ['tesco|lidl|aldi|sainsbury|asda|waitrose|continente|pingo\\s?doce|mercadona|auchan|grocer|supermarket|minipre[çc]o', 'Groceries'],
  ['restaurant|restaurante|caf[eé]|coffee|starbucks|mcdonald|burger|pizza|uber\\s?eats|deliveroo|glovo|bolt\\s?food|takeaway|padaria|tasca', 'Eating out'],
  ['uber|bolt|taxi|cp\\b|comboios|metro|carris|train|fuel|gas\\s?station|galp|\\bbp\\b|repsol|cepsa|parking|via\\s?verde|toll|portagem', 'Transport'],
  ['rent|landlord|mortgage|renda|condom[ií]nio', 'Housing'],
  ['edp|electric|endesa|\\bwater\\b|\\bgas\\b|\\bepal\\b|internet|vodafone|\\bmeo\\b|\\bnos\\b|nowo|utility|broadband', 'Utilities'],
  ['pharmacy|farm[aá]cia|doctor|dental|dentist|clinic|cl[ií]nica|hospital|\\bhealth\\b|m[eé]dico', 'Health'],
  ['amazon|\\bzara\\b|aliexpress|ikea|worten|fnac|decathlon|primark|\\bh&m\\b|clothing|shop\\b', 'Shopping'],
  ['netflix|spotify|youtube\\s?premium|patreon|icloud|google\\s?(storage|one)|disney|\\bhbo\\b|subscription|prime\\b|substack|notion|openai|anthropic|claude', 'Subscriptions'],
  ['cinema|nos\\s?cinemas|ticket|bilhete|concert|festival|theatre|teatro|museum', 'Entertainment'],
  ['flight|ryanair|easyjet|\\btap\\b|lufthansa|hotel|airbnb|booking\\.com|hostel|expedia', 'Travel'],
  ['\\bfee\\b|charge|comiss[aã]o|commission|imposto|\\btax\\b|juro', 'Fees & charges'],
  ['\\batm\\b|cash\\s?withdrawal|levantamento|multibanco', 'Cash'],
  ['transfer|transfer[eê]ncia|sent\\s?money|received\\s?money|to\\s?your|revolut|wise|paypal', 'Transfers'],
];
const COMPILED = SEED_RULES.map(([re, cat]) => [new RegExp(re, 'i'), cat]);

export function categorise(description, amount) {
  const d = String(description || '');
  for (const [re, cat] of COMPILED) if (re.test(d)) return cat;
  return (Number(amount) > 0) ? 'Other income' : 'Uncategorised';
}

const safeJSON = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
async function txnHashes(env) {
  const { results } = await env.DB.prepare("SELECT props FROM blocks WHERE user_id = ? AND kind = 'txn' AND archived = 0").bind(env.uid).all();
  const set = new Set();
  for (const r of (results || [])) { const h = safeJSON(r.props).hash; if (h) set.add(h); }
  return set;
}
// A small stable hash so the same statement row imported twice is skipped.
function txnHash(date, amount, desc, currency) {
  const s = `${date}|${amount}|${(desc || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${currency || ''}`;
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// rows: [{date:'YYYY-MM-DD', amount:Number(signed), currency?, description?}]
export async function importTxns(env, rows) {
  if (!Array.isArray(rows) || !rows.length) return { added: 0, skipped: 0 };
  const seen = await txnHashes(env);
  const now = new Date().toISOString();
  const stmts = [];
  let added = 0, skipped = 0;
  const ins = env.DB.prepare('INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived, user_id) VALUES (?, ?, NULL, 0, ?, NULL, ?, ?, ?, 0, ?)');
  for (const r of rows.slice(0, 5000)) {
    const date = String(r.date || '').slice(0, 10);
    const amount = Number(r.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) { skipped++; continue; }
    const desc = String(r.description || '').trim().slice(0, 300);
    const currency = (String(r.currency || '').trim().toUpperCase().slice(0, 4)) || null;
    const hash = txnHash(date, amount, desc, currency);
    if (seen.has(hash)) { skipped++; continue; }
    seen.add(hash);
    const props = { date, amount, currency, description: desc, category: categorise(desc, amount), hash };
    stmts.push(ins.bind(crypto.randomUUID(), 'txn', desc || date, JSON.stringify(props), now, now, env.uid));
    added++;
  }
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return { added, skipped };
}

// Parse a bank-statement PDF into transaction rows with Gemini (reads the PDF
// natively - text + table layout - and returns structured rows). Rows then go
// through the normal importTxns path (dedupe + categorise).
const STMT_BASE = `This is a bank or account statement PDF, often several pages long. Extract EVERY individual transaction from EVERY page - a monthly statement usually has dozens, sometimes hundreds. Do not stop early, do not summarise, and do not skip small, zero or repeated lines. Include card purchases, transfers, direct debits, standing orders, ATM withdrawals, deposits, salary, interest, fees and currency conversions - every dated line that has an amount.
For each transaction return:
- date: the transaction date as YYYY-MM-DD (infer the year from the statement).
- amount: a NUMBER with its exact decimals (e.g. -3.47, 12.50) - NEVER round to a whole number. Signed so money OUT (debits, payments, purchases, withdrawals, fees) is NEGATIVE and money IN (credits, deposits, salary) is POSITIVE.
- description: the payee / merchant / reference text.
- currency: the 3-letter currency code if shown, else "".
Only skip the opening/closing balance, the running-balance column, page headers/footers and adverts. If unsure whether a line is a transaction, include it. Do not invent transactions. Return JSON: {"rows":[{"date","amount","currency","description"}]}.`;

// One Gemini pass over the PDF, retrying a couple of times when the model is busy
// (503/429) rather than failing the whole import on a transient overload.
async function statementPass(env, key, model, dataB64, prompt) {
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: dataB64 } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string' }, description: { type: 'string' } }, required: ['date', 'amount'] } } }, required: ['rows'] },
    },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const data = await res.json();
      await logAiUsage(env, 'gemini', 'statement-pdf', model, data.usageMetadata && data.usageMetadata.promptTokenCount, data.usageMetadata && data.usageMetadata.candidatesTokenCount);
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('');
      let out; try { out = JSON.parse(text); } catch { out = { rows: [] }; }
      return Array.isArray(out.rows) ? out.rows.filter((r) => r && r.date && r.amount != null) : [];
    }
    if ((res.status === 503 || res.status === 429) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const t = await res.text().catch(() => '');
    if (res.status === 503 || res.status === 429) throw new Error('The statement reader is very busy right now. Nothing was imported - please try again in a minute.');
    if (res.status === 400 || res.status === 415) throw new Error("Couldn't read that PDF - it may be an unusual format. Try exporting a fresh copy.");
    if (res.status === 401 || res.status === 403) throw new Error('Your Gemini key was refused - check it in Settings → Plan.');
    throw new Error(`Couldn't read the statement (reader error ${res.status}). ${t.slice(0, 120)}`);
  }
  return [];
}

// Parse a statement into rows. A single pass often misses most of a long or
// densely-laid-out statement (Robin only got 5 of dozens), so we go round a few
// times: each pass is told exactly what we already have and asked only for what
// it MISSED, and we stop as soon as a pass turns up nothing new. Everything is
// de-duplicated, so overlap between passes is harmless. (Robin, 2026-11-11.)
export async function parseStatementPdf(env, dataB64, name) {
  const key = await aiKey(env, 'gemini', 'money');
  if (!key) throw new Error(aiNeedsKey('gemini'));
  if (!dataB64) throw new Error('No PDF data');
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const seen = new Set();
  const all = [];
  const keyOf = (r) => `${r.date}|${r.amount}|${(r.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
  const absorb = (rows) => { let n = 0; for (const r of rows) { const k = keyOf(r); if (seen.has(k)) continue; seen.add(k); all.push(r); n++; } return n; };
  for (let pass = 0; pass < 6; pass++) {
    const already = all.length
      ? `\n\nYou have ALREADY captured these ${all.length} transactions - do NOT list any of them again. List ONLY the transactions in the statement that are MISSING from this list:\n${all.map((r) => `${r.date} ${r.amount} ${(r.description || '').slice(0, 28)}`).join('\n').slice(0, 7000)}\nIf every transaction in the statement is now in that list, return {"rows":[]}.`
      : '';
    let rows;
    try { rows = await statementPass(env, key, model, dataB64, STMT_BASE + already); }
    catch (e) { if (pass === 0) throw e; break; }   // a later pass hiccup: keep what we already have
    const added = absorb(rows);
    if (pass === 0 && !rows.length) break;           // nothing at all
    if (pass > 0 && added === 0) break;              // caught everything
  }
  return { rows: all, count: all.length };
}

// Wipe every imported transaction (the page's "clear all" - it asks first).
export async function clearTxns(env) {
  await env.DB.prepare("DELETE FROM blocks WHERE user_id = ? AND kind = 'txn'").bind(env.uid).run();
  return { ok: true };
}
