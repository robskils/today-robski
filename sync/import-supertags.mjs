#!/usr/bin/env node
/**
 * One-time import: every Tana supertag -> a Robski Life table.
 *
 * Each supertag becomes a table; its fields become typed columns; each tagged
 * node becomes a row. Idempotent: a table records its tana_tag and rows record
 * their tana_id, so re-running skips whatever already came across.
 *
 * Usage:  TODAY_TOKEN=<jwt> node sync/import-supertags.mjs [--dry-run]
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const WS = 'TVDXzgpASvxx';
const API = process.env.TODAY_API || 'https://today.robski.uk';
const TOKEN = process.env.TODAY_TOKEN;
const DRY = process.argv.includes('--dry-run');

// Tana's own scaffolding and what Robski already owns natively.
const SKIP = new Set([
  '-ESIZpZjQpNx', // Task  (already native)
  'xDNFnP8E93AG', // Life Area (already native as areas)
  'tveZ1IKpLi_0', // Day
  'HUmeUfqBgQic', // Week
  '2A4OiGhVCKL6', // Image generation – Slides extension
]);

if (!TOKEN) { console.error('Set TODAY_TOKEN (a Life session JWT).'); process.exit(1); }

// ── Tana bridge (same transport as sync.js) ───────────────────────────
function tanaConfig() {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
  const s = cfg.mcpServers?.['tana-local'];
  if (!s?.url) throw new Error('tana-local MCP not in ~/.claude.json');
  return { url: s.url, token: (s.headers?.Authorization || '').replace(/^Bearer\s+/, '') };
}
const T = tanaConfig();
let rid = 0;
async function tana(tool, args) {
  const res = await fetch(T.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  if (!res.ok) throw new Error(`tana ${tool}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`tana ${tool}: ${body.error.message}`);
  return body.result?.content?.[0]?.text ?? '';
}
const tanaJSON = async (tool, args) => { try { return JSON.parse(await tana(tool, args)); } catch { return null; } };

async function api(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ── parse a tag schema into typed columns ─────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);

function columnsFromSchema(md) {
  const cols = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \*\*(.+?)\*\*\s*\(id:([\w-]+)\)::\s*(.*)$/);
    if (!m) continue;
    const [, name, , rest] = m;
    let type = 'text';
    const opts = [];
    if (/^Options/.test(rest)) {
      type = 'select';
      for (let j = i + 1; j < lines.length && /^\s+- /.test(lines[j]); j++) {
        const o = lines[j].match(/^\s+-\s+(.+?)\s*\(id:/); if (o) opts.push(o[1].trim());
      }
    } else if (/Instance of #Number/.test(rest)) type = 'number';
    else if (/^Date\b/.test(rest) || /Instance of #Date/.test(rest)) type = 'date';
    else if (/Instance of #Checkbox/.test(rest) || /^Checkbox/.test(rest)) type = 'checkbox';
    // A required field shows a trailing '*' in Tana; strip it so the column
    // name matches the field name parsed out of each node.
    const col = { id: uid(), name: name.replace(/\*+$/, '').trim(), type };
    if (type === 'select' && opts.length) col.options = opts;
    cols.push(col);
  }
  return cols;
}

// ── parse a node's field values (same shape as sync.js parseNode) ─────
const FIELD_RE = /^\s*-\s+\*\*(.+?)\*\*:\s*(.*)$/;
const REF_RE = /^\[(.+?)\]\(tana:([\w-]+)\)/;
const COMMENT_RE = /<!--.*?-->/g;
function parseFields(md) {
  const fields = {};
  for (const line of md.split('\n')) {
    const m = line.match(FIELD_RE); if (!m) continue;
    let raw = m[2].replace(COMMENT_RE, '').trim();
    const ref = raw.match(REF_RE);
    // Strip the required-field '*' so names match the schema's column names.
    const name = m[1].replace(/\*+$/, '').trim();
    fields[name] = ref ? ref[1].replace(/\s*#[\w-]+\s*$/, '').trim() : raw;
  }
  return fields;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const THIS_YEAR = new Date().getFullYear();

// Tana renders a date field two ways: a plain ISO date (2026-06-07), or a
// localized display like "Thu, 2 Apr, 09:45 → 10:45" (Google events), which
// omits the year when it's the current one and may be a range. Reduce both to
// a bare YYYY-MM-DD (the start, for a range) for the HTML date input.
function toISODate(raw) {
  const s = String(raw);
  const iso = s.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})(?:,?\s*(\d{4}))?/); // "2 Apr" / "2 Apr 2025" / "25 Dec, 2024"
  if (m) {
    const day = +m[1], mon = MONTHS[m[2].slice(0, 3).toLowerCase()], year = m[3] ? +m[3] : THIS_YEAR;
    if (mon && day >= 1 && day <= 31) return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

const coerce = (raw, type) => {
  if (raw == null || raw === '') return null;
  if (type === 'number') { const n = Number(String(raw).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; }
  if (type === 'checkbox') return /^(true|yes|x|\[x\]|done)$/i.test(String(raw).trim());
  if (type === 'date') return toISODate(raw);
  return String(raw);
};

async function pool(items, limit, fn) {
  const out = new Array(items.length); let n = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (n < items.length) { const i = n++; try { out[i] = await fn(items[i]); } catch { out[i] = null; } }
  }));
  return out;
}

// ── run ───────────────────────────────────────────────────────────────
const tags = await tanaJSON('list_tags', { workspaceId: WS, limit: 200 });
const existing = await api('/api/blocks?kind=table');
// Fully-imported tables (marked done); partial ones get cleaned and redone.
const done = new Set(existing.filter((t) => t.props?.imported).map((t) => t.props.tana_tag));
const partial = new Map(existing.filter((t) => t.props?.tana_tag && !t.props?.imported).map((t) => [t.props.tana_tag, t.id]));

let madeTables = 0, madeRows = 0;
const skipped = [];

for (const tag of tags) {
  if (SKIP.has(tag.id)) continue;
  if (done.has(tag.id)) { skipped.push(`${tag.name} (already imported)`); continue; }

  // Clean up a half-finished table from an interrupted run before redoing it.
  if (!DRY && partial.has(tag.id)) {
    const tid = partial.get(tag.id);
    for (const r of await api(`/api/blocks?kind=row&parent_id=${tid}`)) await api(`/api/blocks/${r.id}`, { method: 'DELETE' });
    await api(`/api/blocks/${tid}`, { method: 'DELETE' });
  }

  const schema = await tana('get_tag_schema', { tagId: tag.id });
  const fieldCols = columnsFromSchema(schema);
  const nodes = (await tanaJSON('search_nodes', { query: { hasType: tag.id }, limit: 1000 })) || [];
  const instances = nodes.filter((n) => !n.inTrash && !/_TRASH$/.test(n.id));

  if (!instances.length) { skipped.push(`${tag.name} (0 items)`); continue; }

  // Name column first, then the tag's own fields.
  const columns = [{ id: uid(), name: 'Name', type: 'text' }, ...fieldCols];
  console.log(`${tag.name}: ${instances.length} items, ${fieldCols.length} fields`);
  if (DRY) { madeTables++; madeRows += instances.length; continue; }

  const table = await api('/api/blocks', {
    method: 'POST',
    body: JSON.stringify({ kind: 'table', title: tag.name, props: { columns, tana_tag: tag.id } }),
  });

  const rows = await pool(instances, 8, async (n) => {
    const fields = parseFields(await tana('read_node', { nodeId: n.id, maxDepth: 1 }));
    const values = { [columns[0].id]: n.name };
    for (const c of fieldCols) values[c.id] = coerce(fields[c.name], c.type);
    return { kind: 'row', parent_id: table.id, props: { values, tana_id: n.id } };
  });

  const clean = rows.filter(Boolean);
  for (let j = 0; j < clean.length; j += 100) {
    await api('/api/blocks/bulk', { method: 'POST', body: JSON.stringify({ blocks: clean.slice(j, j + 100) }) });
  }
  // Mark complete only now - a re-run treats an unmarked table as partial.
  await api(`/api/blocks/${table.id}`, { method: 'PATCH', body: JSON.stringify({ props: { imported: true } }) });
  madeTables++; madeRows += clean.length;
  console.log(`  ✓ ${tag.name}: ${clean.length} rows`);
}

console.log(`\nDone. ${madeTables} tables, ${madeRows} rows.`);
if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
