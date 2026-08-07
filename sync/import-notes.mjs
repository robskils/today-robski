#!/usr/bin/env node
/**
 * Import Tana's free-form topic outline into Robski Life Notes.
 *
 * Each outline node becomes a Note. A node's leaf children (bullets with no
 * children of their own) become that note's Markdown body; branch children
 * (that have children) become nested sub-pages, recursively. So the outline
 * lands as real nested notes, not a bullet dump.
 *
 * Scope ("topic notes only"): top-level content folders that are NOT Life
 * Areas, supertag definitions, daily notes, or the slides system tag. Tasks
 * (already in Robski) are skipped wherever they appear.
 *
 * Usage:  TODAY_TOKEN=<jwt> node sync/import-notes.mjs [--dry-run]
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = 'Hx5cabusXU1A';
const LIFE_AREA_TAG = 'xDNFnP8E93AG';
const TASK_TAG = '-ESIZpZjQpNx';
const API = process.env.TODAY_API || 'https://today.robski.uk';
const TOKEN = process.env.TODAY_TOKEN;
const DRY = process.argv.includes('--dry-run');
// Levels of nested *pages*: a top folder (0) and its direct sub-sections (1).
// Anything deeper folds into the page body as headed prose, so a giant outline
// becomes a handful of readable pages rather than thousands.
const MAXPAGE = 1;

if (!TOKEN) { console.error('Set TODAY_TOKEN.'); process.exit(1); }

// ── Tana bridge ───────────────────────────────────────
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

// All children of a node, paginated.
async function children(nodeId) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await tanaJSON('get_children', { nodeId, limit: 100, offset });
    if (!r || !r.children) break;
    out.push(...r.children);
    if (!r.hasMore) break;
  }
  return out.filter((c) => !c.inTrash && !(c.tagIds || []).includes(TASK_TAG) && c.docType !== 'field');
}

let notes = 0;
// Turn one read_node subtree (markdown) into headed prose - no bullet lists.
// A node with children becomes a heading; leaf lines become paragraphs.
function cleanOutline(md) {
  const rows = md.split('\n').slice(1) // drop the node's own first line
    .map((l) => l.replace(/<!--.*?-->/g, '').replace(/\[([^\]]+)\]\(tana:[\w-]+\)/g, '$1'))
    .map((l) => { const m = l.match(/^(\s*)-\s?(.*)$/); return m ? { indent: m[1].length, text: m[2].trim() } : { indent: 0, text: l.trim() }; })
    .filter((r) => r.text && !/^\*\*.+\*\*:/.test(r.text)); // drop field lines
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], next = rows[i + 1];
    if (next && next.indent > r.indent) out.push(`${'#'.repeat(Math.min(3, Math.floor(r.indent / 2) + 2))} ${r.text}`);
    else out.push(r.text);
  }
  return out.join('\n\n');
}

// A page (depth < MAXPAGE) creates sub-pages for its branch children. A leaf
// page (depth >= MAXPAGE) pulls its whole subtree in one read_node call.
async function importNode(node, parentId, depth) {
  notes++;
  if (depth < MAXPAGE) {
    const kids = await children(node.id);
    const branches = kids.filter((c) => (c.childCount || 0) > 0);
    let pid = parentId;
    if (!DRY) {
      const body = kids.filter((c) => (c.childCount || 0) === 0).map((l) => (l.name || '').trim()).filter(Boolean).join('\n\n');
      const note = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title: (node.name || 'Untitled').trim(), body, parent_id: parentId, props: { tana_id: node.id, source: 'tana' } }) });
      pid = note.id;
    }
    for (const b of branches) await importNode(b, pid, depth + 1);
  } else if (!DRY) {
    const body = cleanOutline(await tana('read_node', { nodeId: node.id, maxDepth: 10 }));
    await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title: (node.name || 'Untitled').trim(), body, parent_id: parentId, props: { tana_id: node.id, source: 'tana' } }) });
  }
}

// ── run ───────────────────────────────────────────────
const home = await tanaJSON('get_children', { nodeId: HOME, limit: 200 });
const tops = (home?.children || []).filter((c) =>
  !c.inTrash && c.docType === 'content'
  && !(c.tagIds || []).includes(LIFE_AREA_TAG)
  && !/^Image generation/i.test(c.name || ''));

const existing = await api('/api/blocks?kind=note&parent_id=');
const doneTana = new Set(existing.map((n) => n.props?.tana_id).filter(Boolean));

console.log(`${tops.length} topic folders to import:\n  ${tops.map((t) => t.name).join(', ')}\n`);

for (const top of tops) {
  if (doneTana.has(top.id)) { console.log(`- ${top.name}: already imported, skipping`); continue; }
  const before = notes;
  await importNode(top, null, 0);
  console.log(`${DRY ? '(dry) ' : '✓ '}${top.name}: ${notes - before} pages`);
}
console.log(`\nDone. ${notes} notes${DRY ? ' (dry run, nothing written)' : ''}.`);
