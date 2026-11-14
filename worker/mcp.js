// worker/mcp.js - a tiny Model Context Protocol (MCP) server so Claude (and any
// MCP client) can capture into Kaya and read from it, straight from a chat.
//
// Transport: Streamable HTTP, stateless, one POST endpoint at /mcp. Each request
// carries everything needed, so there are no sessions to keep. Auth is a single
// static bearer token (env.MCP_TOKEN), and every tool is scoped to the owner
// (user 1) - this is a personal connector, not a multi-tenant one. It sits BEFORE
// the normal JWT auth gate (its own token, not the 7-day session JWT) and is
// completely inert until MCP_TOKEN is set, like the other optional integrations.
// (Robin, 2026-11-14: "capture into Kaya straight from Claude".)
//
// The tools delegate to the SAME handlers the app's API uses (createTask,
// createBlock, handleDay, searchBlocks), passed in as `deps`, so there is no
// second copy of that logic to drift.

const PROTOCOL_VERSION = '2025-06-18';           // echoed back unless the client asks for another
const SERVER_INFO = { name: 'Kaya', version: '1.0.0' };

// Priority is shown to people as First / Soon / Whenever, never P1-P4.
const PRIO_IN = { first: 'P1', soon: 'P2', whenever: 'P3' };
const PRIO_LABEL = { P1: 'First', P2: 'Soon', P3: 'Whenever' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const TOOLS = [
  {
    name: 'kaya_add_task',
    description: 'Add a task to Kaya (Robin\'s life app). Use when Robin wants to remember to do something. You parse the wording yourself and pass a clean title.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The task, as a short imperative line, e.g. "Call the dentist".' },
        priority: { type: 'string', enum: ['first', 'soon', 'whenever'], description: 'How urgent: first (do first), soon, or whenever. Omit if unsure.' },
        space: { type: 'string', description: 'Optional Life Space (life area) to file it under, by name, e.g. "Health". Ignored if no Space matches.' },
        duration: { type: 'number', description: 'Optional rough length in minutes.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'kaya_add_note',
    description: 'Save a note to Kaya - a title and optional longer body. Use for a thought, a snippet, or anything Robin wants to keep and find later.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short title for the note.' },
        body: { type: 'string', description: 'Optional note body (plain text; line breaks are kept).' },
        space: { type: 'string', description: 'Optional Life Space (life area) to file it under, by name. Ignored if no Space matches.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'kaya_today',
    description: 'Robin\'s day at a glance from Kaya: the calendar for a day plus his open priority (First) tasks. Use for "what\'s on today", planning, or a morning catch-up.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Optional day as YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'kaya_search',
    description: 'Search everything in Kaya - notes, tables, people, Spaces, goals, tasks - by keyword, and get back what matches.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, e.g. "Lisbon" or "tax".' },
      },
      required: ['query'],
    },
  },
];

// ---- small helpers ----
function tsEq(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a.length || a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
const jres = (obj, status = 200) => new Response(obj == null ? null : JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
});
const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const hhmm = (min) => { const m = Math.max(0, Math.min(1439, Math.round(Number(min) || 0))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const internalReq = (body) => new Request('https://kaya.internal/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
async function resErr(res) { try { const j = await res.clone().json(); return j.error || j.message || ('HTTP ' + res.status); } catch { return 'HTTP ' + res.status; } }
async function resolveSpace(env, name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  const { results } = await env.DB.prepare("SELECT id, title FROM blocks WHERE kind = 'area' AND user_id = ? AND archived = 0").bind(env.uid).all().catch(() => ({ results: [] }));
  const rows = results || [];
  return rows.find((r) => String(r.title || '').trim().toLowerCase() === n)
      || rows.find((r) => String(r.title || '').trim().toLowerCase().includes(n))
      || null;
}

export async function mcpHandler(request, env, url, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.MCP_TOKEN) return jres({ error: 'MCP is not enabled' }, 404);           // inert until configured
  if (request.method === 'GET') return jres({ error: 'this server has no event stream; POST JSON-RPC' }, 405);
  if (request.method !== 'POST') return jres({ error: 'method not allowed' }, 405);

  const tok = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!tsEq(tok, env.MCP_TOKEN)) return jres(rpcErr(null, -32001, 'unauthorized'), 401);

  let msg; try { msg = await request.json(); } catch { return jres(rpcErr(null, -32700, 'parse error'), 400); }
  if (Array.isArray(msg)) return jres(rpcErr(null, -32600, 'JSON-RPC batches are not supported'), 400);
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  // Everything runs as the owner (user 1), exactly as the auth gate scopes a
  // normal request before calling these same handlers.
  const owner = await env.DB.prepare('SELECT id, name, email, subdomain FROM users WHERE id = 1').first().catch(() => null);
  const uenv = { ...env, uid: 1, user: owner || { id: 1 }, tz: env.tz };

  try {
    // A JSON-RPC message with no id is a notification: accept it, reply nothing.
    // (The only ones a client sends us are notifications/initialized and the like.)
    if (isNotification) return new Response(null, { status: 202, headers: CORS });
    if (method === 'initialize') {
      const pv = (params && typeof params.protocolVersion === 'string') ? params.protocolVersion : PROTOCOL_VERSION;
      return jres(rpcOk(id, { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: SERVER_INFO }));
    }
    if (method === 'ping') return jres(rpcOk(id, {}));
    if (method === 'tools/list') return jres(rpcOk(id, { tools: TOOLS }));
    if (method === 'tools/call') {
      const out = await callTool(params && params.name, (params && params.arguments) || {}, uenv, deps);
      return jres(rpcOk(id, out));
    }
    return jres(rpcErr(id, -32601, `method not found: ${method}`));
  } catch (e) {
    return jres(rpcErr(id, -32603, (e && e.message) ? e.message : 'internal error'));
  }
}

async function callTool(name, args, env, deps) {
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

  if (name === 'kaya_add_task') {
    const title = String(args.title || '').trim();
    if (!title) return fail('A task needs a title.');
    const prio = PRIO_IN[String(args.priority || '').toLowerCase()] || null;
    const dur = Number(args.duration);
    let area = null, spaceNote = '';
    if (args.space) { const s = await resolveSpace(env, args.space); if (s) area = s.id; else spaceNote = ` (no Space called "${args.space}", so it's unfiled)`; }
    const body = { title, priority: prio || undefined, area: area || undefined, duration: (Number.isFinite(dur) && dur > 0) ? Math.round(dur) : undefined };
    const res = await deps.createTask(internalReq(body), env);
    if (!res.ok) return fail('Kaya would not take the task: ' + await resErr(res));
    return text(`Added task "${title}"${prio ? ` - ${PRIO_LABEL[prio]}` : ''}${spaceNote}.`);
  }

  if (name === 'kaya_add_note') {
    const title = String(args.title || '').trim();
    if (!title) return fail('A note needs a title.');
    const noteBody = args.body != null ? String(args.body) : '';
    let props, spaceNote = '';
    if (args.space) { const s = await resolveSpace(env, args.space); if (s) props = { area: s.id }; else spaceNote = ` (no Space called "${args.space}", so it's unfiled)`; }
    const res = await deps.createBlock(internalReq({ kind: 'note', title, body: noteBody, props }), env);
    if (!res.ok) return fail('Kaya would not take the note: ' + await resErr(res));
    return text(`Saved note "${title}"${spaceNote}.`);
  }

  if (name === 'kaya_today') {
    const date = isDay(args.date) ? args.date : undefined;
    const u = new URL('https://kaya.internal/api/day' + (date ? `?date=${date}` : ''));
    const res = await deps.handleDay(internalReq({}), env, u);
    const data = await res.json().catch(() => ({}));
    const day = data.day || date || 'today';
    const events = (data.events || []).slice().sort((a, b) => (Number(a.start_min) || 0) - (Number(b.start_min) || 0))
      .map((e) => `- ${e.allDay ? 'All day' : hhmm(e.start_min)} · ${e.title || '(no title)'}`);
    // Open First (P1) tasks - the morning-brief set: not done, not a keep-in-touch nudge.
    const { results: trows } = await env.DB.prepare("SELECT title, props FROM blocks WHERE kind = 'task' AND user_id = ? AND archived = 0").bind(env.uid).all().catch(() => ({ results: [] }));
    const first = [];
    for (const r of (trows || [])) { let p = {}; try { p = r.props ? JSON.parse(r.props) : {}; } catch {} if (p.done || p.kit || p.priority !== 'P1') continue; first.push('- ' + (r.title || 'Untitled')); }
    const out = [`Kaya - ${day}`, '',
      events.length ? 'Calendar:\n' + events.join('\n') : 'Calendar: nothing scheduled.', '',
      first.length ? `First / priority tasks (${first.length}):\n` + first.join('\n') : 'No open priority tasks.'];
    if (data.calendar_error) out.push('', '(Note: a calendar could not be reached this time.)');
    return text(out.join('\n'));
  }

  if (name === 'kaya_search') {
    const q = String(args.query || '').trim();
    if (!q) return fail('Give me something to search for.');
    const u = new URL('https://kaya.internal/api/search?q=' + encodeURIComponent(q));
    const res = await deps.searchBlocks(internalReq({}), env, u);
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) return text(`No matches in Kaya for "${q}".`);
    const KIND = { area: 'Space', goal: 'Goal', contact: 'Person', table: 'Table', note: 'Note', row: 'Row', task: 'Task' };
    const lines = rows.slice(0, 30).map((b) => {
      const k = KIND[b.kind] || b.kind;
      const label = b.title || (b.kind === 'row' ? (b.parentTitle ? `${b.parentTitle} (row)` : 'Row') : 'Untitled');
      return `- [${k}] ${label}`;
    });
    const more = rows.length > lines.length ? `\n…and ${rows.length - lines.length} more.` : '';
    return text(`${rows.length} match${rows.length === 1 ? '' : 'es'} for "${q}":\n` + lines.join('\n') + more);
  }

  return fail(`Unknown tool: ${name}`);
}
