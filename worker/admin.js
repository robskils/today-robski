// The business admin dashboard (owner = user 1 only). Everything you need to run
// Daybook as a product: who's signed up, what they're on, how active they are,
// what the AI is costing, the invite/referral picture, and the switches that
// control the business (signup mode). Read-only queries + a few guarded writes.

// Rough USD per 1M tokens, for an at-a-glance "am I out of pocket" estimate.
const COST = { anthropic: { in: 15, out: 75 }, gemini: { in: 0.15, out: 0.6 } };
const estCost = (prov, inTok, outTok) => { const c = COST[prov] || { in: 0, out: 0 }; return (inTok / 1e6) * c.in + (outTok / 1e6) * c.out; };
const daysAgo = (n) => new Date(Date.now() - n * 86400 * 1000).toISOString();
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };

const one = async (env, sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first().catch(() => null)) || {};
const many = async (env, sql, ...binds) => ((await env.DB.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }))).results) || [];

// Business settings live in the owner's settings rows so they can be flipped from
// the dashboard without a redeploy. `admin_public_signup` = '1' opens signup.
export async function isPublicSignup(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE user_id = 1 AND key = 'admin_public_signup'").first().catch(() => null);
  if (row && row.value != null) return row.value === '1';
  return env.PUBLIC_SIGNUP === '1';
}
export async function getAdminSettings(env) {
  return { publicSignup: await isPublicSignup(env) };
}
export async function setAdminSettings(env, body) {
  if (typeof body.publicSignup === 'boolean') {
    await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (1, 'admin_public_signup', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value")
      .bind(body.publicSignup ? '1' : '0').run();
  }
  return getAdminSettings(env);
}

export async function adminOverview(env) {
  const total = (await one(env, 'SELECT COUNT(*) AS n FROM users')).n || 0;
  const new7 = (await one(env, 'SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', daysAgo(7))).n || 0;
  const new30 = (await one(env, 'SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', daysAgo(30))).n || 0;
  const active7 = (await one(env, 'SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?', daysAgo(7))).n || 0;
  const plans = await many(env, 'SELECT plan, COUNT(*) AS n FROM users GROUP BY plan');
  const statuses = await many(env, 'SELECT status, COUNT(*) AS n FROM users GROUP BY status');
  const invTotal = (await one(env, 'SELECT COUNT(*) AS n FROM invites')).n || 0;
  const invUnused = (await one(env, 'SELECT COUNT(*) AS n FROM invites WHERE used_by IS NULL')).n || 0;
  // AI cost this month, by provider.
  const aiRows = await many(env, 'SELECT provider, SUM(in_tokens) AS inT, SUM(out_tokens) AS outT, COUNT(*) AS calls FROM ai_usage WHERE ts >= ? GROUP BY provider', monthStart());
  let aiCost = 0, aiCalls = 0; const ai = aiRows.map((r) => { const cost = estCost(r.provider, r.inT || 0, r.outT || 0); aiCost += cost; aiCalls += r.calls || 0; return { provider: r.provider, inTokens: r.inT || 0, outTokens: r.outT || 0, calls: r.calls || 0, cost }; });
  return {
    users: { total, new7, new30, active7 },
    plans: plans.reduce((o, r) => { o[r.plan || 'free'] = r.n; return o; }, {}),
    statuses: statuses.reduce((o, r) => { o[r.status || 'active'] = r.n; return o; }, {}),
    invites: { total: invTotal, unused: invUnused },
    ai: { byProvider: ai, totalCost: aiCost, calls: aiCalls, month: monthStart().slice(0, 7) },
    publicSignup: await isPublicSignup(env),
  };
}

// Users with the fields the dashboard needs, plus this-month AI token totals.
export async function adminUsers(env) {
  const users = await many(env, 'SELECT id, email, name, subdomain, plan, status, created_at, last_seen, invited_by, voucher FROM users ORDER BY id');
  const usage = await many(env, 'SELECT user_id, SUM(in_tokens) AS inT, SUM(out_tokens) AS outT, COUNT(*) AS calls FROM ai_usage WHERE ts >= ? GROUP BY user_id', monthStart());
  const uMap = {}; for (const r of usage) uMap[r.user_id] = r;
  return users.map((u) => {
    const g = uMap[u.id] || {};
    return { ...u, aiCalls: g.calls || 0, aiInTokens: g.inT || 0, aiOutTokens: g.outT || 0 };
  });
}

// Change a user's plan and/or status. The owner (1) can't be suspended or moved.
const PLANS = new Set(['free', 'standard', 'premium', 'power']);
const STATUSES = new Set(['active', 'suspended']);
export async function updateUser(env, id, body) {
  id = Number(id);
  if (!id) throw new Error('No such user.');
  if (id === 1) throw new Error('The owner account cannot be changed here.');
  const sets = [], binds = [];
  if (body.plan !== undefined) { if (!PLANS.has(body.plan)) throw new Error('Unknown plan.'); sets.push('plan = ?'); binds.push(body.plan); }
  if (body.status !== undefined) { if (!STATUSES.has(body.status)) throw new Error('Unknown status.'); sets.push('status = ?'); binds.push(body.status); }
  if (!sets.length) throw new Error('Nothing to change.');
  binds.push(id);
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return adminUsers(env);
}

// AI usage per user this month, ranked by estimated cost.
export async function adminAiUsage(env) {
  const rows = await many(env, 'SELECT u.user_id, us.subdomain, us.email, u.provider, SUM(u.in_tokens) AS inT, SUM(u.out_tokens) AS outT, COUNT(*) AS calls FROM ai_usage u LEFT JOIN users us ON us.id = u.user_id WHERE u.ts >= ? GROUP BY u.user_id, u.provider', monthStart());
  const byUser = {};
  for (const r of rows) {
    const k = r.user_id; byUser[k] = byUser[k] || { userId: k, subdomain: r.subdomain, email: r.email, calls: 0, inTokens: 0, outTokens: 0, cost: 0 };
    byUser[k].calls += r.calls || 0; byUser[k].inTokens += r.inT || 0; byUser[k].outTokens += r.outT || 0;
    byUser[k].cost += estCost(r.provider, r.inT || 0, r.outT || 0);
  }
  return Object.values(byUser).sort((a, b) => b.cost - a.cost);
}
