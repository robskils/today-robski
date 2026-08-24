/**
 * Tracker: a market watchlist (crypto, shares, ETFs). Unlike the Portfolio,
 * there are no quantities - each item shows its current price and its 24h / 7d /
 * 30d change.
 *
 * Everything is priced through Yahoo Finance, including crypto (Yahoo lists
 * pairs like BTC-EUR, XRP-EUR). Keyless crypto APIs (CoinGecko, Coinpaprika)
 * rate-limit Cloudflare's shared Worker egress IPs almost immediately; Yahoo
 * does not, and the Portfolio already relies on it. The windowed changes are
 * computed from the daily closes.
 *
 * Each watch item is a block: kind='tracker', props={type:'crypto'|'stock',
 * name, symbol, ySym, currency}.
 */

const YQ = (s) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=3mo`;
const UA = { 'User-Agent': 'Mozilla/5.0' };
const safeJSON = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

async function yahoo(sym) {
  const r = await fetch(YQ(sym), { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if (!res || !res.meta || res.meta.regularMarketPrice == null) throw new Error('not found');
  return res;
}
// Crypto tickers become Yahoo pairs (BTC -> BTC-EUR); a listed ticker is used
// as-is (AAPL, NUCG.L).
function ySymbol(input, type) {
  const s = String(input || '').trim().toUpperCase();
  if (type === 'crypto') return /-/.test(s) ? s : `${s}-EUR`;
  return s;
}

export async function resolveTrackerItem(input, type) {
  const q = String(input || '').trim();
  if (!q) throw new Error('Enter a symbol or name');
  const sym = ySymbol(q, type);
  let res;
  try { res = await yahoo(sym); }
  catch {
    throw new Error(type === 'crypto'
      ? `Couldn't find crypto "${q}" - try its ticker, e.g. BTC, XRP, ETH, SOL`
      : `Couldn't find "${q}" - use the exact ticker, e.g. AAPL or NUCG.L`);
  }
  const m = res.meta;
  let name = m.shortName || m.longName || sym;
  if (type === 'crypto') name = name.replace(/\s+EUR$/i, '');
  return { type, name, symbol: q.toUpperCase().replace(/-EUR$/i, ''), ySym: sym, currency: m.currency || '' };
}

async function loadTrackerBlocks(env) {
  const { results } = await env.DB.prepare("SELECT id, props FROM blocks WHERE user_id = ? AND kind = 'tracker' AND archived = 0 ORDER BY created_at").bind(env.uid).all();
  return (results || []).map((r) => ({ id: r.id, ...safeJSON(r.props) }));
}

export async function addTrackerItem(env, input, type, category) {
  const meta = await resolveTrackerItem(input, type);
  meta.category = String(category || '').trim();
  const existing = await loadTrackerBlocks(env);
  if (existing.some((p) => p.ySym && p.ySym.toUpperCase() === meta.ySym.toUpperCase())) {
    throw new Error(`${meta.symbol} is already tracked`);
  }
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived, user_id) VALUES (?, ?, NULL, 0, ?, NULL, ?, ?, ?, 0, ?)')
    .bind(id, 'tracker', meta.name, JSON.stringify(meta), now, now, env.uid).run();
  return { id, ...meta };
}
export async function trackerCategories(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'kv_tracker_categories'").bind(env.uid).first().catch(() => null);
  try { return row && row.value ? JSON.parse(row.value) : []; } catch { return []; }
}

function nearestClose(ts, closes, target) {
  let best = null, gap = Infinity;
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] == null) continue;
    const g = Math.abs(ts[i] - target);
    if (g < gap) { gap = g; best = closes[i]; }
  }
  return best;
}
const pct = (cur, past) => (cur != null && past != null && past !== 0) ? (cur - past) / past * 100 : null;

// The watchlist, priced live. One bad symbol returns nulls, never sinks the list.
export async function getTracker(env) {
  const items = await loadTrackerBlocks(env);
  const now = Math.floor(Date.now() / 1000);
  const priced = await Promise.all(items.map(async (it) => {
    const base = { id: it.id, name: it.name, symbol: it.symbol, type: it.type, category: it.category || '' };
    try {
      const res = await yahoo(it.ySym);
      const m = res.meta; const ts = res.timestamp || []; const closes = (res.indicators.quote[0] || {}).close || [];
      const cur = m.regularMarketPrice != null ? m.regularMarketPrice : nearestClose(ts, closes, now);
      const c24 = m.chartPreviousClose != null ? m.chartPreviousClose : nearestClose(ts, closes, now - 86400);
      return { ...base, price: cur, currency: m.currency || it.currency || '', ch24: pct(cur, c24), ch7: pct(cur, nearestClose(ts, closes, now - 7 * 86400)), ch30: pct(cur, nearestClose(ts, closes, now - 30 * 86400)) };
    } catch { return { ...base, price: null, currency: it.currency || '', ch24: null, ch7: null, ch30: null }; }
  }));
  return { ts: new Date().toISOString(), items: priced, categories: await trackerCategories(env) };
}
