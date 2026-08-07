// Robski Life — one surface. Sidebar + a single pane that renders any block,
// and a ⌘K palette to jump anywhere. No page reloads.

const $ = (s, r = document) => r.querySelector(s);
const KEY = 'today.token';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const token = () => localStorage.getItem(KEY) || '';

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (res.status === 401) { localStorage.removeItem(KEY); location.replace('/'); throw new Error('unauthorized'); }
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.status === 204 ? null : res.json();
}
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

const state = {
  view: { type: 'tasks' },
  noteTops: [], tables: [],
  areas: [], tasks: [], taskFilter: null,
  note: null, tables_open: null,
  pal: { open: false, q: '', items: [], sel: 0 },
};

// ── Markdown (prose, no bullet lists) ────────────────
function mdToHtml(md) {
  let s = esc(md || '');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = []; let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
  for (const ln of s.split('\n')) {
    const h = ln.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); const l = h[1].length + 1; out.push(`<h${l}>${h[2]}</h${l}>`); continue; }
    if (/^>\s?/.test(ln)) { flush(); out.push(`<blockquote>${ln.replace(/^>\s?/, '')}</blockquote>`); continue; }
    if (/^(-{3,}|_{3,})$/.test(ln.trim())) { flush(); out.push('<hr>'); continue; }
    if (ln.trim() === '') { flush(); continue; }
    para.push(ln);
  }
  flush();
  return out.join('') || '<p class="note-empty">Nothing here yet. Click to write…</p>';
}

// ── sidebar ──────────────────────────────────────────
function renderNav() {
  const v = state.view;
  const noteRows = state.noteTops.map((n) => `<button class="nav-sub ${v.type === 'note' && state.note && state.note.path[0] && state.note.path[0].id === n.id ? 'on' : ''}" data-open-note="${n.id}"><span class="i">▸</span><span class="t">${esc(n.title || 'Untitled')}</span></button>`).join('');
  const tableRows = state.tables.map((t) => `<button class="nav-sub ${v.type === 'table' && state.tables_open && state.tables_open.id === t.id ? 'on' : ''}" data-open-table="${t.id}"><span class="i">▦</span><span class="t">${esc(t.title || 'Untitled')}</span></button>`).join('');
  $('#nav').innerHTML = `
    <div class="nav-brand"><em>Life</em><span class="dot">·</span>Robski</div>
    <button class="nav-k" data-palette><span>Search or jump…</span><kbd>⌘K</kbd></button>
    <button class="nav-item ${v.type === 'tasks' ? 'on' : ''}" data-view-tasks><span>✓</span> Tasks</button>
    <div class="nav-sec">
      <div class="nav-sec-h">Notes <button data-new-note title="New note">+</button></div>
      ${noteRows || '<div class="nav-sub" style="color:var(--ink-3)">No notes yet</div>'}
    </div>
    <div class="nav-sec">
      <div class="nav-sec-h">Tables <button data-new-table title="New table">+</button></div>
      ${tableRows || '<div class="nav-sub" style="color:var(--ink-3)">No tables yet</div>'}
    </div>
    <div class="nav-spacer"></div>
    <div class="nav-foot">
      <a href="/" title="Your day">Today</a>
      <button data-theme title="Light / dark">Theme</button>
      <a href="/api/export" title="Download a full backup">Backup</a>
    </div>`;
}

// ── router ───────────────────────────────────────────
async function openTasks(filter) {
  state.view = { type: 'tasks' };
  if (filter !== undefined) state.taskFilter = filter;
  if (!state.areas.length) [state.areas, state.tasks] = await Promise.all([api('/api/blocks?kind=area'), api('/api/blocks?kind=task')]);
  state.areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  renderNav(); renderTasks();
}
async function openNote(id) {
  const note = await api(`/api/blocks/${id}`);
  const path = [note]; let p = note;
  while (p.parent_id) { p = await api(`/api/blocks/${p.parent_id}`); path.unshift(p); }
  const children = await api(`/api/blocks?kind=note&parent_id=${id}`);
  state.note = { current: note, path, children, editingBody: false };
  state.view = { type: 'note', id };
  renderNav(); renderNote();
}
async function openTable(id) {
  const table = await api(`/api/blocks/${id}`);
  const rows = await api(`/api/blocks?kind=row&parent_id=${id}`);
  state.tables_open = table; state.tables_rows = rows; state.tables_view = { openRow: null, addingCol: false };
  state.view = { type: 'table', id };
  renderNav(); renderTable();
}

// ── view: tasks ──────────────────────────────────────
const hueOf = (a) => (a && a.props && Number.isFinite(a.props.hue) ? a.props.hue : 220);
const areaById = (id) => state.areas.find((a) => a.id === id);
function renderTasks() {
  const openCount = (aid) => state.tasks.filter((t) => !t.props.done && (aid ? t.props.area === aid : true)).length;
  const chips = `<button class="area-chip ${state.taskFilter === null ? 'on' : ''}" data-filter="">All <b>${openCount(null)}</b></button>` +
    state.areas.filter((a) => openCount(a.id)).map((a) => `<button class="area-chip ${state.taskFilter === a.id ? 'on' : ''}" style="--h:${hueOf(a)}" data-filter="${a.id}"><span class="cd"></span>${esc(a.title)} <b>${openCount(a.id)}</b></button>`).join('');
  const opts = `<option value="">No area</option>` + state.areas.map((a) => `<option value="${a.id}" ${state.taskFilter === a.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('');
  let ts = state.tasks.slice();
  if (state.taskFilter) ts = ts.filter((t) => t.props.area === state.taskFilter);
  ts.sort((a, b) => (a.props.done ? 1 : 0) - (b.props.done ? 1 : 0) || (b.created_at || '').localeCompare(a.created_at || ''));
  const rows = ts.map((t) => {
    const a = areaById(t.props.area); const p = t.props.priority;
    return `<div class="task ${t.props.done ? 'done' : ''}" style="--h:${hueOf(a)}" data-task="${t.id}">
      <button class="check" data-check="${t.id}">✓</button>
      <span class="t" data-edit-task="${t.id}">${esc(t.title)}</span>
      ${p && p !== 'P3' ? `<span class="prio ${p}">${p}</span>` : ''}
      ${a ? `<span class="tag">${esc(a.title)}</span>` : ''}
      <button class="x" data-del-task="${t.id}">×</button></div>`;
  }).join('');
  $('#pane').innerHTML = `
    <div class="pane-head"><h1>Tasks</h1></div>
    <form id="task-form" class="add-task">
      <input id="task-title" type="text" placeholder="Add a task…" autocomplete="off" required>
      <select id="task-area" class="sel">${opts}</select>
      <select id="task-prio" class="sel"><option value="">—</option><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option></select>
      <button class="add-btn wide" type="submit">Add</button>
    </form>
    <div class="area-chips">${chips}</div>
    <div class="list">${rows || '<div class="empty">No tasks here yet.</div>'}</div>`;
}

// ── view: note ───────────────────────────────────────
function renderNote() {
  const n = state.note.current;
  const crumbs = state.note.path.map((a, i) => i === state.note.path.length - 1
    ? `<span class="crumb cur">${esc(a.title || 'Untitled')}</span>`
    : `<button class="crumb" data-open-note="${a.id}">${esc(a.title || 'Untitled')}</button>`).join('<span class="crumb-sep">/</span>');
  const kids = state.note.children.map((c) => `<button class="subpage" data-open-note="${c.id}"><span class="sp-ico">▸</span><span class="sp-t">${esc(c.title || 'Untitled')}</span></button>`).join('');
  $('#pane').innerHTML = `
    <div class="note-crumbs"><button class="crumb" data-view-tasks>Home</button><span class="crumb-sep">/</span>${crumbs}
      <button class="note-del ghost" data-del-note title="Delete this note">Delete</button></div>
    <input class="note-title" id="note-title" value="${esc(n.title || '')}" placeholder="Untitled">
    <div class="note-body" id="note-body">${state.note.editingBody
      ? `<textarea id="body-edit" placeholder="Write in Markdown…"># heading, **bold**, *italic*, [link](https://…)">${esc(n.body || '')}</textarea>`
      : mdToHtml(n.body)}</div>
    <div class="subpages"><div class="sub-h">Pages inside${state.note.children.length ? ` · ${state.note.children.length}` : ''}</div>
      ${kids}<button class="subpage add" data-new-sub><span class="sp-ico">+</span><span class="sp-t">New page inside</span></button></div>`;
  if (state.note.editingBody) { const t = $('#body-edit'); t.focus(); autoGrow(t); }
}
function autoGrow(t) { t.style.height = 'auto'; t.style.height = `${Math.max(160, t.scrollHeight)}px`; }

// ── view: table ──────────────────────────────────────
const TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['checkbox', 'Check'], ['select', 'Select']];
const tcols = () => (state.tables_open.props.columns || []);
function cellInput(r, col) {
  const v = (r.props.values || {})[col.id]; const k = `${r.id}:${col.id}`;
  if (col.type === 'checkbox') return `<input type="checkbox" data-cell="${k}" ${v ? 'checked' : ''}>`;
  if (col.type === 'number') return `<input type="number" class="cell" data-cell="${k}" value="${esc(v ?? '')}">`;
  if (col.type === 'date') return `<input type="date" class="cell" data-cell="${k}" value="${esc(v ?? '')}">`;
  if (col.type === 'select') return `<select class="cell" data-cell="${k}"><option value=""></option>${(col.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return `<input type="text" class="cell" data-cell="${k}" value="${esc(v ?? '')}">`;
}
function renderTable() {
  const t = state.tables_open, c = tcols(), vw = state.tables_view;
  if (vw.openRow) {
    const r = state.tables_rows.find((x) => x.id === vw.openRow) || (vw.openRow = null);
    if (r) {
      const title = (r.props.values || {})[c[0] && c[0].id] || 'Untitled';
      $('#pane').innerHTML = `<div class="card"><button class="ghost" data-back-table>← ${esc(t.title || 'table')}</button>
        <h1 class="card-title">${esc(title)}</h1><div class="card-fields">${c.map((col) => `<label class="crow"><span class="clabel">${esc(col.name)}<em>${esc(col.type)}</em></span><span class="cval">${cellInput(r, col)}</span></label>`).join('')}</div></div>`;
      return;
    }
  }
  const colWidth = (col, first) => col.width || (first ? 230 : 170);
  const colgroup = `<colgroup><col style="width:38px">${c.map((col, i) => `<col data-cw="${col.id}" style="width:${colWidth(col, i === 0)}px">`).join('')}<col style="width:46px"></colgroup>`;
  const addCol = vw.addingCol
    ? `<th class="th-add" style="text-align:left"><form class="colnew" id="colnew"><input id="cn-name" placeholder="Column" autocomplete="off"><select id="cn-type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="add-btn" type="submit">Add</button></form></th>`
    : `<th class="th-add"><button data-add-col title="Add column">+</button></th>`;
  const head = c.map((col) => `<th><div class="thh"><input value="${esc(col.name)}" data-colname="${col.id}"><span class="ty">${esc(col.type)}</span><button class="x" data-del-col="${col.id}">×</button></div><span class="resizer" data-resize="${col.id}"></span></th>`).join('');
  const body = state.tables_rows.map((r) => `<tr><td class="row-open"><button data-open-row="${r.id}" title="Open">⤢</button></td>${c.map((col) => `<td class="${col.type === 'checkbox' ? 'check' : col.type === 'number' ? 'num' : ''}">${cellInput(r, col)}</td>`).join('')}<td class="row-del"><button data-del-row="${r.id}">×</button></td></tr>`).join('');
  $('#pane').innerHTML = `
    <div class="tbl-head"><input class="rename" value="${esc(t.title || '')}" data-rename><button class="ghost" data-del-cur>Delete</button></div>
    <div class="tbl-scroll"><table class="recs fixed">${colgroup}
      <thead><tr><th class="th-open"></th>${head}${addCol}</tr></thead>
      <tbody>${body}<tr class="row-add"><td colspan="${c.length + 2}"><button data-add-row>+ Row</button></td></tr></tbody></table></div>`;
  if (vw.addingCol) { const n = $('#cn-name'); if (n) n.focus(); }
}

// ── mutations ────────────────────────────────────────
async function newNote(parentId) {
  const note = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title: 'Untitled', body: '', parent_id: parentId || null }) });
  if (!parentId) { state.noteTops.push(note); }
  await openNote(note.id);
  const ti = $('#note-title'); if (ti) { ti.focus(); ti.select(); }
}
async function newTable() {
  const t = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'table', title: 'Untitled table', props: { columns: [{ id: uid(), name: 'Name', type: 'text' }] } }) });
  state.tables.push(t); state.tables.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  await openTable(t.id);
}
async function saveTableColumns(columns) { state.tables_open.props.columns = columns; await api(`/api/blocks/${state.tables_open.id}`, { method: 'PATCH', body: JSON.stringify({ props: { columns } }) }); }
async function setCell(rowId, colId, value) {
  const r = state.tables_rows.find((x) => x.id === rowId); if (!r) return;
  r.props.values = { ...(r.props.values || {}), [colId]: value };
  try { await api(`/api/blocks/${rowId}`, { method: 'PATCH', body: JSON.stringify({ props: { values: r.props.values } }) }); } catch (e) { toast(e.message); }
}

// ── palette (⌘K) ─────────────────────────────────────
function openPalette() { state.pal = { open: true, q: '', items: [], sel: 0 }; buildPalette(); renderPalette(); setTimeout(() => $('#pal-input')?.focus(), 0); }
function closePalette() { state.pal.open = false; $('#palette').innerHTML = ''; }
const ACTIONS = [
  { kind: 'action', title: 'New note', run: () => newNote(null) },
  { kind: 'action', title: 'New table', run: () => newTable() },
  { kind: 'action', title: 'Go to Tasks', run: () => openTasks() },
];
let palT;
function buildPalette() {
  const q = state.pal.q.trim();
  if (!q) {
    state.pal.items = [...ACTIONS,
      ...state.noteTops.slice(0, 5).map((n) => ({ kind: 'note', id: n.id, title: n.title || 'Untitled' })),
      ...state.tables.slice(0, 5).map((t) => ({ kind: 'table', id: t.id, title: t.title || 'Untitled' }))];
    renderPalette(); return;
  }
  const acts = ACTIONS.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()));
  clearTimeout(palT);
  palT = setTimeout(async () => {
    try {
      const hits = await api(`/api/search?q=${encodeURIComponent(q)}`);
      state.pal.items = [...acts, ...hits.map((b) => ({ kind: b.kind, id: b.id, title: b.title || '(untitled)' }))];
      state.pal.sel = 0; renderPalette();
    } catch (e) { toast(e.message); }
  }, 150);
}
function renderPalette() {
  if (!state.pal.open) return;
  const items = state.pal.items;
  $('#palette').innerHTML = `<div class="pal-bg" data-pal-bg><div class="pal">
    <input id="pal-input" placeholder="Search notes, tables, tasks — or type a command…" value="${esc(state.pal.q)}" autocomplete="off">
    <div class="pal-list">${items.length ? items.map((it, i) => `<div class="pal-item ${i === state.pal.sel ? 'sel' : ''}" data-pal-i="${i}">
      <span class="pal-kind ${it.kind === 'action' ? '' : 'muted'}">${it.kind === 'action' ? '↵' : esc(it.kind)}</span>
      <span class="pal-t">${esc(it.title)}</span>${it.kind === 'action' ? '' : '<span class="pal-hint">open</span>'}</div>`).join('') : '<div class="pal-empty">No matches.</div>'}</div></div></div>`;
  $('#pal-input').focus();
}
function execItem(it) {
  closePalette();
  if (!it) return;
  if (it.kind === 'action') return it.run().catch((e) => toast(e.message));
  if (it.kind === 'note') return openNote(it.id).catch((e) => toast(e.message));
  if (it.kind === 'table') return openTable(it.id).catch((e) => toast(e.message));
  if (it.kind === 'area') return openTasks(it.id).catch((e) => toast(e.message));
  if (it.kind === 'task') return openTasks().catch((e) => toast(e.message));
}

// ── events ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); state.pal.open ? closePalette() : openPalette(); return; }
  if (!state.pal.open) return;
  if (e.key === 'Escape') { closePalette(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); state.pal.sel = Math.min(state.pal.items.length - 1, state.pal.sel + 1); renderPalette(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); state.pal.sel = Math.max(0, state.pal.sel - 1); renderPalette(); }
  if (e.key === 'Enter') { e.preventDefault(); execItem(state.pal.items[state.pal.sel]); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'pal-input') { state.pal.q = e.target.value; buildPalette(); }
  if (e.target.id === 'body-edit') autoGrow(e.target);
});
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-pal-bg]') === t.closest('.pal-bg') && t.closest('[data-pal-bg]') && !t.closest('.pal')) { closePalette(); return; }
  const pi = t.closest('[data-pal-i]'); if (pi) { execItem(state.pal.items[+pi.dataset.palI]); return; }
  if (t.closest('[data-palette]')) { openPalette(); return; }
  if (t.closest('[data-theme]')) { const d = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = d ? 'dark' : 'light'; localStorage.setItem('today.theme', d ? 'dark' : 'light'); return; }

  const on = t.closest('[data-open-note]'); if (on) { openNote(on.dataset.openNote).catch((x) => toast(x.message)); return; }
  const ot = t.closest('[data-open-table]'); if (ot) { openTable(ot.dataset.openTable).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-view-tasks]')) { openTasks().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-note]')) { newNote(null).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-table]')) { newTable().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-sub]')) { newNote(state.note.current.id).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-note]')) { delNote(); return; }

  // tasks
  const fc = t.closest('[data-filter]'); if (fc) { state.taskFilter = fc.dataset.filter || null; renderTasks(); return; }
  const ck = t.closest('[data-check]'); if (ck) { toggleTask(ck.dataset.check); return; }
  const dt = t.closest('[data-del-task]'); if (dt) { delTask(dt.dataset.delTask); return; }
  const et = t.closest('[data-edit-task]'); if (et) { editTaskTitle(et); return; }

  // table
  if (t.closest('[data-back-table]')) { state.tables_view.openRow = null; renderTable(); return; }
  const or = t.closest('[data-open-row]'); if (or) { state.tables_view.openRow = or.dataset.openRow; renderTable(); window.scrollTo(0, 0); return; }
  if (t.closest('[data-add-col]')) { state.tables_view.addingCol = true; renderTable(); return; }
  const dcol = t.closest('[data-del-col]'); if (dcol) { if (confirm('Delete this column?')) saveTableColumns(tcols().filter((c) => c.id !== dcol.dataset.delCol)).then(renderTable).catch((x) => toast(x.message)); return; }
  const drow = t.closest('[data-del-row]'); if (drow) { const id = drow.dataset.delRow; state.tables_rows = state.tables_rows.filter((r) => r.id !== id); renderTable(); api(`/api/blocks/${id}`, { method: 'DELETE' }).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-add-row]')) { addRow(); return; }
  if (t.closest('[data-del-cur]')) { delTable(); return; }
});
// change: cells + selects
document.addEventListener('change', (e) => {
  const c = e.target.closest('[data-cell]'); if (c) { const [rid, cid] = c.dataset.cell.split(':'); setCell(rid, cid, e.target.type === 'checkbox' ? e.target.checked : e.target.value); }
});
// blur saves for titles/bodies
document.addEventListener('blur', (e) => {
  if (e.target.id === 'note-title') saveNoteTitle(e.target.value.trim());
  if (e.target.id === 'body-edit') saveNoteBody(e.target.value);
  if (e.target.dataset && e.target.dataset.rename !== undefined) renameTable(e.target.value.trim());
  const cn = e.target.dataset && e.target.dataset.colname; if (cn !== undefined && cn) renameColumn(cn, e.target.value.trim());
}, true);
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'note-title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.target.id === 'body-edit' && e.key === 'Escape') { state.note.editingBody = false; renderNote(); }
});
// open note body editor / submit forms
document.addEventListener('click', (e) => {
  if (e.target.closest('#note-body') && state.note && !state.note.editingBody) { state.note.editingBody = true; renderNote(); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'task-form') { const i = $('#task-title'); const v = i.value.trim(); if (v) addTask(v, $('#task-area').value, $('#task-prio').value); i.value = ''; i.focus(); }
  if (e.target.id === 'colnew') { const name = $('#cn-name').value.trim(); const type = $('#cn-type').value; addColumn(name, type); }
});
// column resize (pointer)
let resizing = null;
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-resize]'); if (!h) return; e.preventDefault();
  const th = h.closest('th'); resizing = { colId: h.dataset.resize, colEl: $(`col[data-cw="${h.dataset.resize}"]`), startX: e.clientX, startW: th.getBoundingClientRect().width };
  try { h.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', (e) => { if (!resizing) return; const w = Math.max(64, Math.round(resizing.startW + (e.clientX - resizing.startX))); if (resizing.colEl) resizing.colEl.style.width = `${w}px`; });
document.addEventListener('pointerup', () => { if (!resizing) return; const w = resizing.colEl ? parseInt(resizing.colEl.style.width, 10) : null; const id = resizing.colId; resizing = null; if (w) saveTableColumns(tcols().map((c) => c.id === id ? { ...c, width: w } : c)).catch((x) => toast(x.message)); });

// ── task/note/table helpers ──────────────────────────
async function addTask(title, area, priority) {
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title, props: { area: area || null, priority: priority || null, done: false } }) });
  state.tasks.push(b); renderTasks();
}
async function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return; const done = !t.props.done; t.props.done = done; renderTasks();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { done } }) }); } catch (e) { t.props.done = !done; renderTasks(); toast(e.message); }
}
async function delTask(id) { state.tasks = state.tasks.filter((t) => t.id !== id); renderTasks(); try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); } }
function editTaskTitle(span) {
  const id = span.dataset.editTask; const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const input = document.createElement('input'); input.value = t.title; input.className = 'cell'; input.style.cssText = 'flex:1;font:inherit;font-size:17px;border:1px solid var(--accent);border-radius:6px;padding:2px 6px;background:var(--card)';
  span.replaceWith(input); input.focus(); input.select(); let d = false;
  const save = async () => { if (d) return; d = true; const v = input.value.trim(); if (v && v !== t.title) { t.title = v; try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); } catch (e) { toast(e.message); } } renderTasks(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { d = true; renderTasks(); } });
  input.addEventListener('blur', save);
}
async function saveNoteTitle(v) {
  const n = state.note.current; if (!n || v === n.title) return; n.title = v;
  const top = state.noteTops.find((t) => t.id === n.id); if (top) top.title = v;
  const cr = $('.note-crumbs .crumb.cur'); if (cr) cr.textContent = v || 'Untitled';
  try { await api(`/api/blocks/${n.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); }
}
async function saveNoteBody(v) { const n = state.note.current; n.body = v; state.note.editingBody = false; renderNote(); try { await api(`/api/blocks/${n.id}`, { method: 'PATCH', body: JSON.stringify({ body: v }) }); } catch (e) { toast(e.message); } }
async function delNote() {
  const n = state.note.current; if (!confirm(`Delete “${n.title || 'Untitled'}”?`)) return;
  const parent = state.note.path.length > 1 ? state.note.path[state.note.path.length - 2].id : null;
  try { await api(`/api/blocks/${n.id}`, { method: 'DELETE' }); state.noteTops = state.noteTops.filter((t) => t.id !== n.id); if (parent) await openNote(parent); else await openTasks(); } catch (e) { toast(e.message); }
}
async function addRow() { const r = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'row', parent_id: state.tables_open.id, props: { values: {} } }) }); state.tables_rows.push(r); renderTable(); }
async function addColumn(name, type) { const col = { id: uid(), name: name || 'Column', type }; state.tables_view.addingCol = false; await saveTableColumns([...tcols(), col]); renderTable(); }
async function renameTable(v) { const t = state.tables_open; if (!t || v === t.title) return; t.title = v; const s = state.tables.find((x) => x.id === t.id); if (s) s.title = v; try { await api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); } }
async function renameColumn(id, v) { const cols = tcols().map((c) => c.id === id ? { ...c, name: v } : c); await saveTableColumns(cols).catch((x) => toast(x.message)); }
async function delTable() { const t = state.tables_open; if (!confirm(`Delete the table “${t.title}” and its rows?`)) return; for (const r of state.tables_rows) await api(`/api/blocks/${r.id}`, { method: 'DELETE' }); await api(`/api/blocks/${t.id}`, { method: 'DELETE' }); state.tables = state.tables.filter((x) => x.id !== t.id); state.tables_open = null; await openTasks(); }

// ── boot ─────────────────────────────────────────────
(async function boot() {
  try {
    [state.noteTops, state.tables] = await Promise.all([api('/api/blocks?kind=note&parent_id='), api('/api/blocks?kind=table')]);
    state.tables.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    await openTasks();
  } catch (e) { toast(e.message); renderNav(); }
})();
