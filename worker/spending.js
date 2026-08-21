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
  const { results } = await env.DB.prepare("SELECT props FROM blocks WHERE kind = 'txn' AND archived = 0").all();
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
  const ins = env.DB.prepare('INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived) VALUES (?, ?, NULL, 0, ?, NULL, ?, ?, ?, 0)');
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
    stmts.push(ins.bind(crypto.randomUUID(), 'txn', desc || date, JSON.stringify(props), now, now));
    added++;
  }
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return { added, skipped };
}

// Wipe every imported transaction (the page's "clear all" - it asks first).
export async function clearTxns(env) {
  await env.DB.prepare("DELETE FROM blocks WHERE kind = 'txn'").run();
  return { ok: true };
}
