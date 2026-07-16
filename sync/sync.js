#!/usr/bin/env node
/**
 * Tana <-> today.robski.uk sync agent. Runs on Robin's Mac.
 *
 * Why this exists: Tana's API is write-only (https://tana.inc/docs/input-api),
 * so nothing in Cloudflare can read the #Task graph. The only read path is the
 * tana-local MCP bridge, which talks to the Tana desktop app over localhost.
 * So the Mac is the only place this sync can run.
 *
 * Each pass:
 *   1. pull open #Task nodes out of Tana, with their fields
 *   2. push them to the worker, which mirrors them into D1
 *   3. pull back any completions made in the web app and apply them in Tana
 *
 * Usage:  node sync/sync.js [--dry-run] [--verbose]
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { laneForArea } from '../shared/lanes.js';

const TASK_TAG_ID = '-ESIZpZjQpNx';      // #Task supertag
const LIFE_AREA_TAG_ID = 'xDNFnP8E93AG'; // #Life Area supertag

// Priority is an options field, so its values are fixed nodes rather than
// something searchable. Straight off the tag schema.
const PRIORITIES = [
  { node_id: '_oxDPBzb59Zy', kind: 'priority', name: 'P1' },
  { node_id: 'dKfdZMCnBNGe', kind: 'priority', name: 'P2' },
  { node_id: 'jUaTC8QrebSg', kind: 'priority', name: 'P3' },
  { node_id: 'Rso83bdTANFF', kind: 'priority', name: 'P4' },
];

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const API_BASE = process.env.TODAY_API || 'https://today.robski.uk';
const SYNC_KEY = process.env.SYNC_KEY;

const log = (...a) => console.log(...a);
const vlog = (...a) => VERBOSE && console.log('  ', ...a);

// ── Tana MCP transport ────────────────────────────────────────────────

// Read the tana-local endpoint straight out of the Claude config so there's
// one place to update if the token is ever rotated.
function tanaConfig() {
  if (process.env.TANA_MCP_URL && process.env.TANA_MCP_TOKEN) {
    return { url: process.env.TANA_MCP_URL, token: process.env.TANA_MCP_TOKEN };
  }
  const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
  const server = cfg.mcpServers?.['tana-local'];
  if (!server?.url) throw new Error('tana-local MCP not found in ~/.claude.json');
  const token = (server.headers?.Authorization || '').replace(/^Bearer\s+/, '');
  return { url: server.url, token };
}

const TANA = tanaConfig();
let rpcId = 0;

async function tana(tool, args) {
  const res = await fetch(TANA.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TANA.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: ++rpcId,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`tana ${tool}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`tana ${tool}: ${body.error.message}`);

  const text = body.result?.content?.[0]?.text ?? '';
  if (body.result?.isError) throw new Error(`tana ${tool}: ${text}`);
  return text;
}

async function tanaJSON(tool, args) {
  const text = await tana(tool, args);
  try { return JSON.parse(text); } catch { return null; }
}

// ── parsing read_node markdown ────────────────────────────────────────

// A node comes back looking like:
//   - [ ] Do 2x paintings #Task <!-- node-id: a-9uvcjK_9Xi -->
//     - **Priority**: [P3](tana:jUaTC8QrebSg)
//     - **Area**: [Body / Health #Life_Area](tana:vuO-ZdpQXcSn)
//     - **Duration**: 90 <!-- node-id: 27iVx7_GUJv_ -->
const FIELD_RE = /^\s*-\s+\*\*(.+?)\*\*:\s*(.*)$/;
const REF_RE = /^\[(.+?)\]\(tana:([\w-]+)\)/;
const COMMENT_RE = /<!--.*?-->/g;

function parseNode(md) {
  const out = { done: false, fields: {} };
  const lines = md.split('\n');

  const first = lines.find((l) => l.trim().startsWith('- ['));
  if (first) out.done = /^\s*-\s+\[x\]/i.test(first);

  for (const line of lines) {
    const m = line.match(FIELD_RE);
    if (!m) continue;
    const name = m[1].trim();
    let raw = m[2].replace(COMMENT_RE, '').trim();

    const ref = raw.match(REF_RE);
    if (ref) {
      // "Body / Health #Life_Area" -> "Body / Health"
      out.fields[name] = ref[1].replace(/\s*#[\w-]+\s*$/, '').trim();
    } else {
      out.fields[name] = raw;
    }
  }
  return out;
}

// ── pull ──────────────────────────────────────────────────────────────

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let failures = 0;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          results[i] = await fn(items[i], i);
        } catch (e) {
          console.error(`   ! ${items[i]?.id}: ${e.message}`);
          results[i] = null;
          failures++;
        }
      }
    }),
  );
  return { results: results.filter(Boolean), failures };
}

async function pullTasks() {
  log('Reading #Task nodes from Tana...');

  const nodes = await tanaJSON('search_nodes', {
    query: { and: [{ hasType: TASK_TAG_ID }, { not: { is: 'done' } }] },
    limit: 1000,
  });
  if (!Array.isArray(nodes)) throw new Error('unexpected search_nodes response');

  // Trashed nodes still come back from search; drop them and the demo content.
  const live = nodes.filter(
    (n) => !n.inTrash && !(n.breadcrumb || []).includes('Demo content') && (n.name || '').trim(),
  );
  log(`  ${nodes.length} matched, ${live.length} live`);

  // search_nodes gives names but no field values, so each node needs a read.
  // These are localhost calls, so 8 at a time is plenty and stays polite.
  const { results: tasks, failures } = await mapWithConcurrency(live, 8, async (n) => {
    const md = await tana('read_node', { nodeId: n.id });
    const parsed = parseNode(md);
    const area = parsed.fields['Area'] || null;
    const durationRaw = parsed.fields['Duration'];
    const duration = durationRaw && /^\d+$/.test(durationRaw) ? Number(durationRaw) : null;

    vlog(`${n.name.slice(0, 48)} [${area || 'no area'}] ${duration ? duration + 'm' : ''}`);

    return {
      tana_id: n.id,
      title: n.name.trim(),
      area,
      lane: laneForArea(area),
      priority: parsed.fields['Priority'] || null,
      status: parsed.fields['Task status'] || null,
      duration,
      done: parsed.done,
      breadcrumb: (n.breadcrumb || []).join(' / '),
      created: n.created || null,
    };
  });

  return { tasks, failures };
}

// The +New form needs real node ids to reference, and the worker can't read
// Tana, so the Life Areas come up with the tasks.
async function pullOptions() {
  const nodes = await tanaJSON('search_nodes', {
    query: { hasType: LIFE_AREA_TAG_ID }, limit: 200,
  });
  if (!Array.isArray(nodes)) throw new Error('unexpected search_nodes response');

  const areas = nodes
    .filter((n) => !n.inTrash && (n.name || '').trim())
    .map((n) => ({ node_id: n.id, kind: 'area', name: n.name.trim() }));

  return [...areas, ...PRIORITIES];
}

// ── push ──────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${SYNC_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// ── write-back ────────────────────────────────────────────────────────

async function applyPending() {
  const { pending } = await api('/api/sync/pending');
  if (!pending.length) return 0;

  log(`Applying ${pending.length} completion(s) back into Tana...`);
  const acked = [];
  const failed = [];

  for (const p of pending) {
    try {
      await tana(p.op === 'complete' ? 'check_node' : 'uncheck_node', { nodeId: p.tana_id });
      acked.push(p.id);
      vlog(`${p.op} ${p.tana_id}`);
    } catch (e) {
      console.error(`   ! ${p.tana_id}: ${e.message}`);
      failed.push({ id: p.id, error: e.message });
    }
  }

  if (acked.length || failed.length) {
    await api('/api/sync/ack', { method: 'POST', body: JSON.stringify({ ids: acked, failed }) });
  }
  return acked.length;
}

// ── main ──────────────────────────────────────────────────────────────

async function main() {
  const started = Date.now();

  if (!SYNC_KEY && !DRY_RUN) {
    console.error('SYNC_KEY is not set. Export it, or run with --dry-run.');
    process.exit(1);
  }

  // Write-back first: otherwise a completion made in the app gets clobbered by
  // the pull, which would still see the task as open in Tana.
  if (!DRY_RUN) {
    try {
      const n = await applyPending();
      if (n) log(`  applied ${n}`);
    } catch (e) {
      console.error(`  write-back failed: ${e.message}`);
    }
  }

  const { tasks, failures } = await pullTasks();

  const byLane = tasks.reduce((a, t) => (a[t.lane] = (a[t.lane] || 0) + 1, a), {});
  log('  by lane:', Object.entries(byLane).map(([k, v]) => `${k} ${v}`).join(', '));
  const noDuration = tasks.filter((t) => !t.duration).length;
  log(`  ${tasks.length - noDuration}/${tasks.length} have a Duration set`);

  if (DRY_RUN) {
    log('\n--dry-run, nothing pushed. Sample:');
    console.log(JSON.stringify(tasks.slice(0, 3), null, 2));
    return;
  }

  // The prune deletes anything this push didn't mention. A node we simply failed
  // to read looks identical to a deleted one, so a partial read must never prune
  // or a Tana hiccup would silently empty the mirror.
  const full = failures === 0;
  if (!full) log(`  ${failures} node(s) unreadable, skipping the prune this pass`);

  const res = await api('/api/sync/tasks', {
    method: 'POST',
    body: JSON.stringify({ tasks, full }),
  });

  // Non-fatal: the tasks are the point, the pickers are a convenience.
  try {
    const options = await pullOptions();
    await api('/api/sync/options', { method: 'POST', body: JSON.stringify({ options }) });
    log(`  ${options.length} areas + priorities for the +New form`);
  } catch (e) {
    console.error(`  options sync failed: ${e.message}`);
  }

  log(`Pushed ${res.count} tasks in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('sync failed:', e.message);
  process.exit(1);
});
