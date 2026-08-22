// Portfolio valuation + history, moved across from the portfolio.robski.uk
// worker. Uses env.PORTFOLIO_DB (the existing portfolio-tracker D1, shared
// with that site) so no data was copied. See CLAUDE notes: silver-backed
// holdings are valued at SPOT, never the KAG token quote.

/**
 * Price fetching and portfolio valuation.
 *
 * All parsing happens in code, deliberately. An earlier design had a scheduled
 * Claude routine read prices through WebFetch, which extracts values from
 * converted page content using a small model - handed a large JSON document it
 * picked the wrong field and published a total EUR 9,700 too high.
 *
 * Positions live in D1 and are added, edited and deleted from the page. Each
 * one carries a `kind` saying how to price it, because a London ETF quoted in
 * pence, a kilo of vaulted silver and a token representing one troy ounce are
 * three different calculations.
 *
 * SILVER-BACKED HOLDINGS ARE VALUED AT SPOT, NOT AT THE TOKEN QUOTE. One KAG
 * represents one troy ounce. That token trades on ~$150k a day and its price is
 * frequently stale or divergent - two feeds were seen 15% apart with both
 * timestamps fresh. Robin settled this: value the metal, not the thin market on
 * it. Anything priced `silver_oz` or `silver_kg` therefore shares one silver
 * price and those legs must always move together.
 */

const OZ_PER_KG = 32.1507;

/** How a position gets priced. `symbol` applies only to the yahoo_* kinds. */
export const KINDS = {
  lse_gbp:   { label: "London listing, priced in GBP",        needsSymbol: true,  unit: "units" },
  lse_gbx:   { label: "London listing, priced in pence (GBp)", needsSymbol: true,  unit: "units" },
  usd_stock: { label: "Listing priced in USD",                 needsSymbol: true,  unit: "units" },
  silver_oz: { label: "Silver, per troy ounce",                needsSymbol: false, unit: "oz" },
  silver_kg: { label: "Silver, per kilogram",                  needsSymbol: false, unit: "kg" },
  gold_oz:   { label: "Gold, per troy ounce",                  needsSymbol: false, unit: "oz" },
  gold_kg:   { label: "Gold, per kilogram",                    needsSymbol: false, unit: "kg" },
  eur_cash:  { label: "Cash or fixed value in EUR",            needsSymbol: false, unit: "EUR" },
};

const SWATCHES = ["var(--ag2)", "var(--vault)", "var(--ag)", "var(--brass)", "var(--gold)", "var(--slate)"];

/** Seeds the table the first time. After that the database is the truth. */
const DEFAULT_POSITIONS = [
  { code: "KAG",  name: "Kinesis Silver",             venue: "BitMart",      qty: 1717.7,    kind: "silver_oz", symbol: null,      sort: 1 },
  { code: "BullionVault", name: "Silver, Zurich custody", venue: "BullionVault", qty: 15.501, kind: "silver_kg", symbol: null,      sort: 2 },
  { code: "PHSP", name: "WisdomTree Physical Silver", venue: "Trading 212",  qty: 256.314,   kind: "lse_gbx",   symbol: "PHSP.L",  sort: 3 },
  { code: "NUCG", name: "VanEck Uranium & Nuclear",   venue: "Trading 212",  qty: 111.01137, kind: "lse_gbp",   symbol: "NUCG.L",  sort: 4 },
];

export const POSITIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS positions (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  code   TEXT NOT NULL,
  name   TEXT NOT NULL,
  venue  TEXT,
  qty    REAL NOT NULL,
  kind   TEXT NOT NULL,
  symbol TEXT,
  sort   INTEGER NOT NULL DEFAULT 0
);`;

async function fetchJSON(url, headers) {
  let status;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: headers || {} });
    if (res.ok) return res.json();
    status = res.status;
    if (status !== 429 && status < 500) break; // only transient failures deserve a retry
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw new Error(`HTTP ${status}`);
}

const YAHOO = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;

const num = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);

// ── positions CRUD ────────────────────────────────────────────────────

export async function loadPositions(env) {
  const { results } = await env.PORTFOLIO_DB.prepare(
    "SELECT id, code, name, venue, qty, kind, symbol, cost, sort FROM positions ORDER BY sort, id"
  ).all();
  if (results && results.length) return results;

  const stmt = env.PORTFOLIO_DB.prepare(
    "INSERT INTO positions (code, name, venue, qty, kind, symbol, sort) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  await env.PORTFOLIO_DB.batch(
    DEFAULT_POSITIONS.map((p) => stmt.bind(p.code, p.name, p.venue, p.qty, p.kind, p.symbol, p.sort))
  );
  const seeded = await env.PORTFOLIO_DB.prepare(
    "SELECT id, code, name, venue, qty, kind, symbol, cost, sort FROM positions ORDER BY sort, id"
  ).all();
  return seeded.results;
}

function validate(p) {
  const code = String(p.code || "").trim();
  const name = String(p.name || "").trim();
  const kind = String(p.kind || "").trim();
  const qty = Number(p.qty);
  if (!code) throw new Error("Give the holding a short code");
  if (!name) throw new Error("Give the holding a name");
  if (!KINDS[kind]) throw new Error("Choose how the holding is priced");
  if (!Number.isFinite(qty) || qty < 0) throw new Error("Quantity must be zero or more");
  const symbol = String(p.symbol || "").trim() || null;
  if (KINDS[kind].needsSymbol && !symbol) throw new Error("That price type needs a ticker, e.g. NUCG.L");
  // cost = total EUR paid for the units currently held (optional; enables
  // realised/unrealised gain). Blank/0 means "not tracked".
  const cost = (p.cost === "" || p.cost == null) ? null : Number(p.cost);
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) throw new Error("Cost must be a number");
  return { code, name, venue: String(p.venue || "").trim() || null, qty, kind, symbol, cost };
}

export async function addPosition(env, p) {
  const v = validate(p);
  const row = await env.PORTFOLIO_DB.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM positions").first();
  const res = await env.PORTFOLIO_DB.prepare(
    "INSERT INTO positions (code, name, venue, qty, kind, symbol, cost, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(v.code, v.name, v.venue, v.qty, v.kind, v.symbol, v.cost, row.s).run();
  return { id: res.meta.last_row_id, ...v };
}

export async function updatePosition(env, id, p) {
  const v = validate(p);
  const res = await env.PORTFOLIO_DB.prepare(
    "UPDATE positions SET code = ?, name = ?, venue = ?, qty = ?, kind = ?, symbol = ?, cost = ? WHERE id = ?"
  ).bind(v.code, v.name, v.venue, v.qty, v.kind, v.symbol, v.cost, Number(id)).run();
  if (!res.meta.changes) throw new Error("No such holding");
  return { id: Number(id), ...v };
}

export async function deletePosition(env, id) {
  const res = await env.PORTFOLIO_DB.prepare("DELETE FROM positions WHERE id = ?").bind(Number(id)).run();
  if (!res.meta.changes) throw new Error("No such holding");
  return true;
}

// Record a sale: reduce units (and cost basis, pro-rata by average cost), log a
// realised-P&L row. proceeds = EUR actually received. Selling the lot removes it.
export async function sellPosition(env, id, unitsSold, proceeds) {
  const pos = await env.PORTFOLIO_DB.prepare("SELECT id, code, name, qty, cost FROM positions WHERE id = ?").bind(Number(id)).first();
  if (!pos) throw new Error("No such holding");
  const units = Number(unitsSold);
  if (!Number.isFinite(units) || units <= 0) throw new Error("Enter how many units you sold");
  const got = Number(proceeds);
  if (!Number.isFinite(got) || got < 0) throw new Error("Enter what you got for the sale");
  const sellAll = units >= pos.qty - 1e-9;
  const soldQty = sellAll ? pos.qty : units;
  const costOut = (pos.cost != null && pos.qty > 0) ? (pos.cost * (soldQty / pos.qty)) : null;
  const realised = costOut != null ? (got - costOut) : null;
  await env.PORTFOLIO_DB.prepare(
    "INSERT INTO sales (ts, code, name, units, proceeds, cost_out, realised, currency) VALUES (?, ?, ?, ?, ?, ?, ?, 'EUR')"
  ).bind(new Date().toISOString(), pos.code, pos.name, soldQty, got, costOut, realised).run();
  if (sellAll) {
    await env.PORTFOLIO_DB.prepare("DELETE FROM positions WHERE id = ?").bind(Number(id)).run();
  } else {
    const newQty = pos.qty - soldQty;
    const newCost = pos.cost != null ? Math.max(0, pos.cost - costOut) : null;
    await env.PORTFOLIO_DB.prepare("UPDATE positions SET qty = ?, cost = ? WHERE id = ?").bind(newQty, newCost, Number(id)).run();
  }
  return { soldQty, proceeds: got, costOut, realised, sellAll };
}

export async function listSales(env, limit = 100) {
  const { results } = await env.PORTFOLIO_DB.prepare(
    "SELECT id, ts, code, name, units, proceeds, cost_out, realised, currency FROM sales ORDER BY ts DESC LIMIT ?"
  ).bind(limit).all().catch(() => ({ results: [] }));
  return results || [];
}

// ── valuation ─────────────────────────────────────────────────────────

export async function getPortfolio(env) {
  const positions = await loadPositions(env);

  // Only fetch what the current positions actually need.
  const kinds = new Set(positions.map((p) => p.kind));
  const symbols = [...new Set(positions.filter((p) => KINDS[p.kind]?.needsSymbol && p.symbol).map((p) => p.symbol))];
  const needsSilver = kinds.has("silver_oz") || kinds.has("silver_kg");
  const needsGold = kinds.has("gold_oz") || kinds.has("gold_kg");
  const needsGbp = kinds.has("lse_gbp") || kinds.has("lse_gbx");
  const needsUsd = needsSilver || needsGold || kinds.has("usd_stock");

  const jobs = {};
  if (needsSilver) jobs.xag = fetchJSON("https://api.gold-api.com/price/XAG").then((d) => num(d.price));
  if (needsGold) jobs.xau = fetchJSON("https://api.gold-api.com/price/XAU").then((d) => num(d.price));
  if (needsGbp) jobs.gbp = fetchJSON("https://api.frankfurter.dev/v1/latest?from=GBP&to=EUR").then((d) => num(d.rates.EUR));
  if (needsUsd) jobs.usd = fetchJSON("https://api.frankfurter.dev/v1/latest?from=USD&to=EUR").then((d) => num(d.rates.EUR));
  for (const s of symbols) {
    jobs["sym:" + s] = fetchJSON(YAHOO(s), { "User-Agent": "Mozilla/5.0" })
      .then((d) => num(d.chart.result[0].meta.regularMarketPrice));
  }

  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(keys.map((k) => jobs[k]));
  const px = {};
  const errors = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value !== null) px[keys[i]] = r.value;
    else errors[keys[i]] = r.status === "rejected" ? String(r.reason.message || r.reason) : "no price";
  });

  const missing = keys.filter((k) => !(k in px));
  if (missing.length) {
    // No fallback, no last-known-good. A wrong number is worse than none.
    const e = new Error(`price feed degraded: ${missing.join(", ")} unavailable`);
    e.detail = errors;
    throw e;
  }

  const silverEurOz = needsSilver ? px.xag * px.usd : null;
  const goldEurOz = needsGold ? px.xau * px.usd : null;

  const valueOf = (p) => {
    switch (p.kind) {
      case "lse_gbp":   return p.qty * px["sym:" + p.symbol] * px.gbp;
      case "lse_gbx":   return p.qty * (px["sym:" + p.symbol] / 100) * px.gbp;
      case "usd_stock": return p.qty * px["sym:" + p.symbol] * px.usd;
      case "silver_oz": return p.qty * silverEurOz;
      case "silver_kg": return p.qty * silverEurOz * OZ_PER_KG;
      case "gold_oz":   return p.qty * goldEurOz;
      case "gold_kg":   return p.qty * goldEurOz * OZ_PER_KG;
      case "eur_cash":  return p.qty;
      default:          return 0;
    }
  };

  const holdings = positions.map((p, i) => {
    const value = Math.round(valueOf(p));
    const cost = (p.cost == null) ? null : Math.round(p.cost);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      venue: p.venue || "",
      qty: p.qty,
      kind: p.kind,
      symbol: p.symbol,
      unit: KINDS[p.kind]?.unit || "",
      swatch: SWATCHES[i % SWATCHES.length],
      value,
      cost,
      gain: cost != null ? value - cost : null,   // unrealised
    };
  });

  const eur2 = (n) => n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rates = [];
  if (needsSilver) {
    rates.push(["Silver spot", `€${eur2(silverEurOz)} / oz`]);
    rates.push(["Silver spot", `€${eur2(silverEurOz * OZ_PER_KG)} / kg`]);
  }
  if (needsGold) rates.push(["Gold spot", `€${eur2(goldEurOz)} / oz`]);
  for (const s of symbols) {
    const gbx = positions.some((p) => p.symbol === s && p.kind === "lse_gbx");
    rates.push([s, gbx ? `${px["sym:" + s].toLocaleString("en-GB", { minimumFractionDigits: 2 })}p`
                       : `£${px["sym:" + s].toFixed(2)}`]);
  }
  if (needsGbp) rates.push(["GBP → EUR", px.gbp.toFixed(4)]);
  if (needsUsd) rates.push(["USD → EUR", px.usd.toFixed(4)]);

  // Realised P&L to date, and unrealised across holdings that have a cost set.
  const sales = await listSales(env, 200);
  const realisedTotal = sales.reduce((s, r) => s + (r.realised || 0), 0);
  const tracked = holdings.filter((h) => h.cost != null);
  const investedTracked = tracked.reduce((s, h) => s + h.cost, 0);
  const valueTracked = tracked.reduce((s, h) => s + h.value, 0);
  const unrealisedTotal = tracked.length ? valueTracked - investedTracked : null;

  return {
    ts: new Date().toISOString(),
    holdings,
    total: Math.round(holdings.reduce((s, h) => s + h.value, 0)),
    rates,
    realisedTotal: Math.round(realisedTotal),
    unrealisedTotal: unrealisedTotal == null ? null : Math.round(unrealisedTotal),
    investedTracked: Math.round(investedTracked),
    sales: sales.slice(0, 60).map((r) => ({ ts: r.ts, name: r.name, code: r.code, units: r.units, proceeds: Math.round(r.proceeds), realised: r.realised == null ? null : Math.round(r.realised) })),
    kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, needsSymbol: v.needsSymbol }])),
  };
}

// ── history (snapshots + performance) ─────────────────────────────────

const HOUR = 3600;

export const SNAPSHOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  ts    INTEGER PRIMARY KEY,   -- unix seconds
  total REAL NOT NULL          -- EUR
);`;

/**
 * Writes a snapshot. `minGap` skips the write if one was taken recently, so
 * page views do not flood the table - pass 0 from the cron to always record.
 */
export async function recordSnapshot(env, total, minGap = HOUR) {
  const now = Math.floor(Date.now() / 1000);
  try {
    if (minGap > 0) {
      const last = await env.PORTFOLIO_DB.prepare(
        "SELECT ts FROM snapshots ORDER BY ts DESC LIMIT 1"
      ).first();
      if (last && now - last.ts < minGap) return;
    }
    await env.PORTFOLIO_DB.prepare(
      "INSERT INTO snapshots (ts, total) VALUES (?, ?) ON CONFLICT(ts) DO NOTHING"
    ).bind(now, total).run();
  } catch {
    /* history is a nicety; never fail a page load over it */
  }
}

const WINDOWS = [
  { label: "24 hours", days: 1 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
];

/**
 * Change over each window, measured against the snapshot nearest that point in
 * time. A window with no snapshot reasonably near it reports null rather than
 * reaching for the oldest row available - comparing against whatever happens to
 * exist is how you end up reporting a "monthly change" from two days of data.
 */
export async function performance(env, total) {
  let rows = [];
  try {
    const res = await env.PORTFOLIO_DB.prepare(
      "SELECT ts, total FROM snapshots WHERE ts >= ? ORDER BY ts"
    ).bind(Math.floor(Date.now() / 1000) - 40 * 24 * HOUR).all();
    rows = res.results || [];
  } catch {
    return WINDOWS.map((w) => ({ label: w.label, pct: null, abs: null }));
  }

  const now = Math.floor(Date.now() / 1000);
  return WINDOWS.map((w) => {
    const target = now - w.days * 24 * HOUR;
    const tolerance = Math.max(0.25 * w.days * 24 * HOUR, 12 * HOUR);

    let best = null;
    let gap = Infinity;
    for (const r of rows) {
      if (r.ts >= now) continue;
      const d = Math.abs(r.ts - target);
      if (d < gap) { gap = d; best = r; }
    }

    if (!best || gap > tolerance || !best.total) {
      return { label: w.label, pct: null, abs: null };
    }
    return {
      label: w.label,
      pct: (total - best.total) / best.total * 100,
      abs: total - best.total,
    };
  });
}
