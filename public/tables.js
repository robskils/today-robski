// Robski Life — Tables. Structured records on the block core: a table is a
// block with typed columns; each row is a child block holding cell values.

const $ = (s, r = document) => r.querySelector(s);
const KEY = 'today.token';
const uid = () => crypto.randomUUID().slice(0, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['checkbox', 'Checkbox'], ['select', 'Select']];
const state = { tables: [], current: null, rows: [], addingCol: false };
const token = () => localStorage.getItem(KEY) || '';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (res.status === 401) { localStorage.removeItem(KEY); location.replace('/'); throw new Error('unauthorized'); }
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.status === 204 ? null : res.json();
}
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

const cols = () => (state.current && state.current.props.columns) || [];

// ── load ─────────────────────────────────────────────
async function load() {
  state.tables = (await api('/api/blocks?kind=table')).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  if (state.tables.length && !state.current) await select(state.tables[0].id);
  else { renderList(); renderMain(); }
}

async function select(id) {
  state.current = state.tables.find((t) => t.id === id) || null;
  state.addingCol = false;
  state.rows = state.current ? await api(`/api/blocks?kind=row&parent_id=${id}`) : [];
  renderList(); renderMain();
}

// ── tables list ──────────────────────────────────────
function renderList() {
  $('#tables').innerHTML = state.tables.map((t) => `
    <button class="tbl-item ${state.current && state.current.id === t.id ? 'on' : ''}" data-tid="${t.id}">
      <span class="n">${esc(t.title || 'Untitled')}</span>
      <span class="x" data-del-table="${t.id}" title="Delete table">×</span>
    </button>`).join('');
}

// ── the grid ─────────────────────────────────────────
function cellTd(r, col) {
  const v = (r.props.values || {})[col.id];
  const k = `${r.id}:${col.id}`;
  if (col.type === 'checkbox') return `<td class="check"><input type="checkbox" data-cell="${k}" ${v ? 'checked' : ''}></td>`;
  if (col.type === 'number') return `<td class="num"><input type="number" class="cell" data-cell="${k}" value="${esc(v ?? '')}"></td>`;
  if (col.type === 'date') return `<td><input type="date" class="cell" data-cell="${k}" value="${esc(v ?? '')}"></td>`;
  if (col.type === 'select') return `<td><select class="cell" data-cell="${k}"><option value=""></option>${(col.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>`;
  return `<td><input type="text" class="cell" data-cell="${k}" value="${esc(v ?? '')}"></td>`;
}

function colHead(col) {
  return `<th><div class="thh">
    <input value="${esc(col.name)}" data-colname="${col.id}" aria-label="Column name">
    <span class="ty">${esc(col.type)}</span>
    <button class="x" data-del-col="${col.id}" title="Delete column">×</button>
  </div></th>`;
}

function addColCell() {
  if (!state.addingCol) return `<th class="th-add"><button data-add-col title="Add column">+</button></th>`;
  return `<th class="th-add" style="text-align:left"><form class="colnew" id="colnew">
    <input id="cn-name" placeholder="Column" autocomplete="off">
    <select id="cn-type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <input id="cn-opts" placeholder="option, option" hidden>
    <button class="add-btn" type="submit">Add</button>
  </form></th>`;
}

function renderMain() {
  const m = $('#main');
  if (!state.current) {
    m.innerHTML = `<div class="tbl-empty">${state.tables.length ? 'Pick a table on the left.' : 'No tables yet. Name one on the left to begin.'}</div>`;
    return;
  }
  const c = cols();
  const head = `<div class="tbl-head">
    <input class="rename" value="${esc(state.current.title || '')}" data-rename aria-label="Table name">
    <button class="ghost" data-del-cur title="Delete this table">Delete</button>
  </div>`;

  const body = `<div class="tbl-scroll"><table class="recs">
    <thead><tr>${c.map(colHead).join('')}${addColCell()}</tr></thead>
    <tbody>
      ${state.rows.map((r) => `<tr data-row="${r.id}">${c.map((col) => cellTd(r, col)).join('')}<td class="row-del"><button data-del-row="${r.id}" title="Delete row">×</button></td></tr>`).join('')}
      <tr class="row-add"><td colspan="${c.length + 1}"><button data-add-row>+ Row</button></td></tr>
    </tbody>
  </table></div>`;

  m.innerHTML = head + (c.length ? body : `<div class="tbl-empty">Add a column to start — the “+” is top-right of the grid.</div>${body}`);
  if (state.addingCol) { const n = $('#cn-name'); if (n) n.focus(); }
}

// ── actions ──────────────────────────────────────────
async function createTable(title) {
  const t = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'table', title, props: { columns: [{ id: uid(), name: 'Name', type: 'text' }] } }) });
  state.tables.push(t); state.tables.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  await select(t.id);
}

async function saveColumns(columns) {
  state.current.props.columns = columns;
  await api(`/api/blocks/${state.current.id}`, { method: 'PATCH', body: JSON.stringify({ props: { columns } }) });
}

async function addColumn(name, type, options) {
  const col = { id: uid(), name: name || 'Column', type };
  if (type === 'select') col.options = options;
  state.addingCol = false;
  await saveColumns([...cols(), col]); renderMain();
}

async function setCell(rowId, colId, value) {
  const r = state.rows.find((x) => x.id === rowId); if (!r) return;
  const values = { ...(r.props.values || {}), [colId]: value };
  r.props.values = values;
  try { await api(`/api/blocks/${rowId}`, { method: 'PATCH', body: JSON.stringify({ props: { values } }) }); }
  catch (e) { toast(e.message); }
}

async function addRow() {
  const r = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'row', parent_id: state.current.id, props: { values: {} } }) });
  state.rows.push(r); renderMain();
}

async function deleteTable(id) {
  const t = state.tables.find((x) => x.id === id); if (!t) return;
  if (!confirm(`Delete the table “${t.title}” and its rows?`)) return;
  const rows = await api(`/api/blocks?kind=row&parent_id=${id}`);
  for (const r of rows) await api(`/api/blocks/${r.id}`, { method: 'DELETE' });
  await api(`/api/blocks/${id}`, { method: 'DELETE' });
  state.tables = state.tables.filter((x) => x.id !== id);
  if (state.current && state.current.id === id) { state.current = null; state.rows = []; }
  renderList(); renderMain();
}

// ── events ───────────────────────────────────────────
$('#tables').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del-table]');
  if (del) { e.stopPropagation(); deleteTable(del.dataset.delTable).catch((x) => toast(x.message)); return; }
  const it = e.target.closest('[data-tid]');
  if (it) select(it.dataset.tid).catch((x) => toast(x.message));
});

$('#main').addEventListener('click', (e) => {
  if (e.target.closest('[data-add-col]')) { state.addingCol = true; renderMain(); return; }
  const dc = e.target.closest('[data-del-col]');
  if (dc) { if (confirm('Delete this column?')) saveColumns(cols().filter((c) => c.id !== dc.dataset.delCol)).then(renderMain).catch((x) => toast(x.message)); return; }
  const dr = e.target.closest('[data-del-row]');
  if (dr) { const id = dr.dataset.delRow; state.rows = state.rows.filter((r) => r.id !== id); renderMain(); api(`/api/blocks/${id}`, { method: 'DELETE' }).catch((x) => toast(x.message)); return; }
  if (e.target.closest('[data-add-row]')) { addRow().catch((x) => toast(x.message)); return; }
  if (e.target.closest('[data-del-cur]')) deleteTable(state.current.id).catch((x) => toast(x.message));
});

$('#main').addEventListener('change', (e) => {
  const cell = e.target.closest('[data-cell]');
  if (cell) {
    const [rowId, colId] = cell.dataset.cell.split(':');
    const val = cell.type === 'checkbox' ? cell.checked
      : cell.type === 'number' ? (cell.value === '' ? null : Number(cell.value)) : cell.value;
    return setCell(rowId, colId, val);
  }
  const cn = e.target.closest('[data-colname]');
  if (cn) { const c = cols().map((x) => x.id === cn.dataset.colname ? { ...x, name: cn.value } : x); saveColumns(c).catch((x) => toast(x.message)); return; }
  const rn = e.target.closest('[data-rename]');
  if (rn) { state.current.title = rn.value; api(`/api/blocks/${state.current.id}`, { method: 'PATCH', body: JSON.stringify({ title: rn.value }) }).then(renderList).catch((x) => toast(x.message)); }
});

// Show the options box only for a Select column being created.
$('#main').addEventListener('input', (e) => {
  if (e.target.id === 'cn-type') $('#cn-opts').hidden = e.target.value !== 'select';
});
$('#main').addEventListener('submit', (e) => {
  if (e.target.id !== 'colnew') return;
  e.preventDefault();
  const type = $('#cn-type').value;
  const opts = ($('#cn-opts').value || '').split(',').map((s) => s.trim()).filter(Boolean);
  addColumn($('#cn-name').value.trim(), type, opts).catch((x) => toast(x.message));
});

$('#new-table').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#new-name'); const v = inp.value.trim();
  if (v) { createTable(v).catch((x) => toast(x.message)); inp.value = ''; }
});

$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('today.theme', dark ? 'dark' : 'light');
});

load().catch((e) => toast(e.message));
