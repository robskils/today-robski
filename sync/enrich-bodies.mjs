#!/usr/bin/env node
/**
 * One-off: pull each note's and each table row's free "notes" content out of
 * Tana and into its block body, as clean Markdown (Tana's inline <a>/images
 * become [text](url); field lines and sub-note branches are dropped).
 *
 * Reads a blocks.json ([{id, kind, tid}]) exported from D1, reads every node
 * from the Tana bridge, and writes UPDATE statements to enrich.sql for
 * `wrangler d1 execute --file`. No API token needed.
 *
 * Usage: node sync/enrich-bodies.mjs <blocks.json> <out.sql>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [, , BLOCKS_PATH, OUT_PATH] = process.argv;
if (!BLOCKS_PATH || !OUT_PATH) { console.error('Usage: node enrich-bodies.mjs <blocks.json> <out.sql>'); process.exit(1); }

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

// Turn a read_node subtree (markdown) into clean prose. Drops the node's own
// first line, field lines, and any subtree whose node-id is in `stopIds` (those
// live in their own note). Converts Tana's HTML links/images to Markdown.
function clean(md, stopIds) {
  const lines = md.split('\n');
  const kept = [];
  let skipIndent = null;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    const im = l.match(/^(\s*)-\s?(.*)$/);
    const indent = im ? im[1].length : 0;
    if (skipIndent !== null) { if (indent > skipIndent) continue; skipIndent = null; }
    const idm = l.match(/<!--\s*node-id:\s*([\w-]+)\s*-->/);
    if (idm && stopIds && stopIds.has(idm[1])) { skipIndent = indent; continue; }
    let text = (im ? im[2] : l).replace(/<!--.*?-->/g, '').trim();
    if (!text) continue;
    if (/^\*\*.+\*\*:/.test(text)) continue;                 // field line
    if (/^\[.+\]\(tana:[\w-]+\)\s*$/.test(text)) continue;    // bare reference row
    text = text
      .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1]($2)')
      .replace(/\[([^\]]+)\]\(tana:[\w-]+\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text) kept.push({ indent, text });
  }
  const out = [];
  for (let i = 0; i < kept.length; i++) {
    const r = kept[i], next = kept[i + 1];
    if (next && next.indent > r.indent) out.push(`${'#'.repeat(Math.min(3, Math.floor(r.indent / 2) + 2))} ${r.text}`);
    else out.push(r.text);
  }
  return out.join('\n\n').trim();
}

async function pool(items, limit, fn) {
  const results = []; let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  }));
  return results;
}

const blocks = JSON.parse(readFileSync(BLOCKS_PATH, 'utf8'));
const noteTids = new Set(blocks.filter((b) => b.kind === 'note').map((b) => b.tid));
const now = new Date().toISOString();
const esc = (s) => s.replace(/'/g, "''");

let done = 0, updated = 0, empty = 0, failed = 0;
const stmts = [];
await pool(blocks, 6, async (b) => {
  try {
    const md = await tana('read_node', { nodeId: b.tid, maxDepth: b.kind === 'note' ? 10 : 5 });
    // A note excludes its sub-notes' subtrees; a row keeps everything non-field.
    const body = clean(md, b.kind === 'note' ? noteTids : null).slice(0, 60000);
    if (body) { stmts.push(`UPDATE blocks SET body='${esc(body)}', updated_at='${now}' WHERE id='${b.id}';`); updated++; }
    else empty++;
  } catch (e) { failed++; }
  if (++done % 200 === 0) console.error(`  ${done}/${blocks.length} (updated ${updated}, empty ${empty}, failed ${failed})`);
});

writeFileSync(OUT_PATH, stmts.join('\n') + '\n');
console.error(`Done: ${done} read, ${updated} to update, ${empty} empty, ${failed} failed -> ${OUT_PATH}`);
