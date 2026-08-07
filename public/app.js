// Robski Life — one surface. Sidebar + a single pane that renders any block,
// and a ⌘K palette to jump anywhere. No page reloads.

const $ = (s, r = document) => r.querySelector(s);
const KEY = 'today.token';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const token = () => localStorage.getItem(KEY) || '';

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (res.status === 401) { localStorage.removeItem(KEY); if (!$('#gate2')) showGate('Your session expired. Sign in again.'); throw new Error('unauthorized'); }
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.status === 204 ? null : res.json();
}
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

const state = {
  view: { type: 'home' },
  noteTops: [], tables: [],
  areas: [], tasks: [], taskFilter: null,
  taskSort: { col: 'created', dir: 'desc' },
  note: null, tables_open: null,
  home: { favs: [], events: [] },
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
    <button class="nav-item ${v.type === 'home' ? 'on' : ''}" data-view-home><span>⌂</span> Home</button>
    <button class="nav-item ${v.type === 'tasks' ? 'on' : ''}" data-view-tasks><span>✓</span> Tasks</button>
    <button class="nav-item ${v.type === 'tables' ? 'on' : ''}" data-open-tables><span>▦</span> Tables</button>
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
      <button data-theme-toggle title="Light / dark">Theme</button>
      <a href="/api/export" title="Download a full backup">Backup</a>
    </div>`;
}

// ── router ───────────────────────────────────────────
async function openTasks(filter) {
  state.view = { type: 'tasks' };
  if (filter !== undefined) state.taskFilter = filter;
  // Always refetch tasks (they change); reuse cached areas.
  const [areas, tasks] = await Promise.all([
    state.areas.length ? state.areas : api('/api/blocks?kind=area'),
    api('/api/blocks?kind=task'),
  ]);
  state.areas = areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  state.tasks = tasks;
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

// ── view: home ───────────────────────────────────────
const hhmm = (m) => `${String((m / 60) | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const KIND_IC = { note: '▸', table: '▦', task: '✓', row: '▦' };

async function openHome() {
  state.view = { type: 'home' };
  const [favs, day] = await Promise.all([
    api('/api/favorites').catch(() => []),
    api('/api/day').catch(() => ({ events: [] })),
  ]);
  state.home = { favs, events: day.events || [] };
  renderNav(); renderHome();
}
function renderHome() {
  const favs = state.home.favs || [];
  const ev = (state.home.events || []).slice().sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start_min ?? 0) - (b.start_min ?? 0));
  const favRows = favs.map((f) => `<div class="fav" draggable="true" data-fav-id="${f.id}">
    <button class="fav-open" data-fav-open="${f.kind}:${f.id}"><span class="fav-ic">${KIND_IC[f.kind] || '•'}</span><span class="fav-t">${esc(f.title || 'Untitled')}</span></button>
    <button class="fav-x" data-unfav="${f.id}" title="Remove from favourites">×</button></div>`).join('');
  const evRows = ev.map((e) => `<div class="ev-row"><span class="ev-time">${e.allDay ? 'all day' : hhmm(e.start_min)}</span><span class="ev-t">${esc(e.title)}</span>${e.location ? `<span class="ev-loc">${esc(e.location)}</span>` : ''}</div>`).join('');
  $('#pane').innerHTML = `
    <div class="home">
      <div class="home-head">
        <h1>${greeting()}</h1>
        <div class="home-actions"><button class="add-btn wide" data-new-note>+ Note</button><button class="add-btn wide" data-quick-task>+ Task</button></div>
      </div>
      <div id="qt-wrap"></div>
      <section class="home-sec">
        <div class="home-sec-h">Favourites ${favs.length ? '<span class="muted">drag to reorder</span>' : ''}</div>
        <div class="favs" id="favs">${favRows || '<div class="home-empty">Star a task, note or table (the ☆ on it) to pin it here.</div>'}</div>
      </section>
      <section class="home-sec">
        <div class="home-sec-h">Today</div>
        <div class="today-cal">${evRows || '<div class="home-empty">Nothing in your calendar today.</div>'}</div>
      </section>
      <div class="home-links"><button class="home-link" data-view-tasks>All tasks →</button><button class="home-link" data-open-tables>Tables →</button></div>
    </div>`;
}
function openTablesList() {
  state.view = { type: 'tables' };
  renderNav();
  const favTables = state.tables.filter((t) => t.props && t.props.fav);
  const cards = (list) => list.map((t) => `<button class="tbl-card" data-open-table="${t.id}"><span class="tc-ic">▦</span>${esc(t.title || 'Untitled')}</button>`).join('');
  $('#pane').innerHTML = `
    <div class="pane-head home-head"><h1>Tables</h1><button class="add-btn wide" data-new-table>+ New table</button></div>
    ${favTables.length ? `<section class="home-sec"><div class="home-sec-h">Favourites</div><div class="tbl-cards">${cards(favTables)}</div></section>` : ''}
    <section class="home-sec"><div class="home-sec-h">All tables · ${state.tables.length}</div><div class="tbl-cards">${cards(state.tables) || '<div class="empty">No tables yet.</div>'}</div></section>`;
}

function showQuickTask() {
  $('#qt-wrap').innerHTML = `<form id="qt-form" class="add-task" style="margin-bottom:22px">
    <input id="qt-title" placeholder="Add a task…" autocomplete="off" required>
    <select id="qt-prio" class="sel"><option value="">—</option><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option></select>
    <button class="add-btn wide" type="submit">Add</button></form>`;
  $('#qt-title').focus();
}
async function homeAddTask(title, priority) {
  try { await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title, props: { priority: priority || null, done: false } }) }); toast('Task added'); }
  catch (e) { toast(e.message); }
}

// favourites: pin any block; cross-kind; ordered by fav_rank.
function findBlock(id) {
  return state.tasks.find((b) => b.id === id) || state.tables.find((b) => b.id === id)
    || state.noteTops.find((b) => b.id === id)
    || (state.note && state.note.current.id === id ? state.note.current : null)
    || (state.tables_open && state.tables_open.id === id ? state.tables_open : null)
    || (state.home.favs || []).find((b) => b.id === id);
}
function isFav(id) { const b = findBlock(id); return !!(b && b.props && b.props.fav); }
async function toggleFav(id) {
  const b = findBlock(id); if (!b) return;
  b.props = b.props || {};
  const fav = !b.props.fav;
  b.props.fav = fav; if (fav) b.props.fav_rank = Date.now();
  rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { fav, fav_rank: b.props.fav_rank } }) }); } catch (e) { toast(e.message); }
}
async function unfav(id) {
  const b = findBlock(id); if (b) { b.props = b.props || {}; b.props.fav = false; }
  state.home.favs = (state.home.favs || []).filter((f) => f.id !== id);
  renderHome();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { fav: false } }) }); } catch (e) { toast(e.message); }
}
function rerenderCurrent() {
  const v = state.view.type;
  if (v === 'tasks') renderTasks(); else if (v === 'note') renderNote();
  else if (v === 'table') renderTable(); else if (v === 'tables') openTablesList(); else openHome();
}
async function reorderFavs(draggedId, beforeId) {
  const favs = state.home.favs;
  const from = favs.findIndex((f) => f.id === draggedId); if (from < 0) return;
  const [moved] = favs.splice(from, 1);
  let to = beforeId ? favs.findIndex((f) => f.id === beforeId) : favs.length;
  if (to < 0) to = favs.length;
  favs.splice(to, 0, moved);
  renderHome();
  favs.forEach((f, i) => { f.props = f.props || {}; f.props.fav_rank = i; api(`/api/blocks/${f.id}`, { method: 'PATCH', body: JSON.stringify({ props: { fav_rank: i } }) }).catch(() => {}); });
}
function openFav(ref) {
  const i = ref.indexOf(':'); const kind = ref.slice(0, i); const id = ref.slice(i + 1);
  if (kind === 'note') return openNote(id);
  if (kind === 'table') return openTable(id);
  return openTasks();
}

// ── view: tasks ──────────────────────────────────────
const hueOf = (a) => (a && a.props && Number.isFinite(a.props.hue) ? a.props.hue : 220);
const areaById = (id) => state.areas.find((a) => a.id === id);
const PRIO_ORDER = { P1: 1, P2: 2, P3: 3, P4: 4, '': 5 };
const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`; };
function sortTasks(ts) {
  const { col, dir } = state.taskSort; const s = dir === 'asc' ? 1 : -1;
  const val = (t) => col === 'title' ? (t.title || '').toLowerCase()
    : col === 'priority' ? (PRIO_ORDER[t.props.priority || ''] || 5)
    : col === 'area' ? ((areaById(t.props.area) || {}).title || '~~').toLowerCase()
    : col === 'done' ? (t.props.done ? 1 : 0)
    : (t.created_at || '');
  return ts.sort((a, b) => { const x = val(a), y = val(b); return x < y ? -s : x > y ? s : 0; });
}
function renderTasks() {
  const openCount = (aid) => state.tasks.filter((t) => !t.props.done && (aid ? t.props.area === aid : true)).length;
  const chips = `<button class="area-chip ${state.taskFilter === null ? 'on' : ''}" data-filter="">All <b>${openCount(null)}</b></button>` +
    state.areas.filter((a) => openCount(a.id)).map((a) => `<button class="area-chip ${state.taskFilter === a.id ? 'on' : ''}" style="--h:${hueOf(a)}" data-filter="${a.id}"><span class="cd"></span>${esc(a.title)} <b>${openCount(a.id)}</b></button>`).join('');
  const opts = `<option value="">No area</option>` + state.areas.map((a) => `<option value="${a.id}" ${state.taskFilter === a.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('');
  let ts = state.tasks.slice();
  if (state.taskFilter) ts = ts.filter((t) => t.props.area === state.taskFilter);
  ts = sortTasks(ts);
  const arrow = (c) => state.taskSort.col === c ? `<span class="sarrow">${state.taskSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
  const th = (c, label, cls) => `<th class="${cls || ''} sortable" data-sort="${c}">${label}${arrow(c)}</th>`;
  const rows = ts.map((t) => {
    const a = areaById(t.props.area); const p = t.props.priority;
    return `<tr class="tr-task ${t.props.done ? 'done' : ''}" style="--h:${hueOf(a)}">
      <td class="tc-done"><button class="check" data-check="${t.id}">✓</button></td>
      <td class="tc-title"><span class="t" data-edit-task="${t.id}">${esc(t.title)}</span></td>
      <td>${p ? `<span class="prio ${p}">${p}</span>` : ''}</td>
      <td>${a ? `<span class="tag">${esc(a.title)}</span>` : ''}</td>
      <td class="tc-date">${fmtDate(t.created_at)}</td>
      <td class="tc-act"><button class="star ${t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props.fav ? '★' : '☆'}</button><button class="x" data-del-task="${t.id}">×</button></td>
    </tr>`;
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
    <div class="tbl-scroll"><table class="ttable">
      <thead><tr><th class="tc-done"></th>${th('title', 'Task', 'tc-title')}${th('priority', 'Priority')}${th('area', 'Area')}${th('created', 'Added', 'tc-date')}<th class="tc-act"></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty" style="padding:40px">No tasks here yet.</td></tr>`}</tbody>
    </table></div>`;
}

// ── view: note ───────────────────────────────────────
function renderNote() {
  const n = state.note.current;
  const crumbs = state.note.path.map((a, i) => i === state.note.path.length - 1
    ? `<span class="crumb cur">${esc(a.title || 'Untitled')}</span>`
    : `<button class="crumb" data-open-note="${a.id}">${esc(a.title || 'Untitled')}</button>`).join('<span class="crumb-sep">/</span>');
  const kids = state.note.children.map((c) => `<button class="subpage" data-open-note="${c.id}"><span class="sp-ico">▸</span><span class="sp-t">${esc(c.title || 'Untitled')}</span></button>`).join('');
  $('#pane').innerHTML = `
    <div class="note-crumbs"><button class="crumb" data-view-home>Home</button><span class="crumb-sep">/</span>${crumbs}
      <button class="star ${n.props && n.props.fav ? 'on' : ''}" data-fav="${n.id}" title="Favourite">${n.props && n.props.fav ? '★' : '☆'}</button>
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
    <div class="tbl-head"><input class="rename" value="${esc(t.title || '')}" data-rename>
      <button class="star ${t.props && t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props && t.props.fav ? '★' : '☆'}</button>
      <button class="ghost" data-del-cur>Delete</button></div>
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
  if (t.closest('[data-theme-toggle]')) { const d = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = d ? 'dark' : 'light'; localStorage.setItem('today.theme', d ? 'dark' : 'light'); return; }

  const on = t.closest('[data-open-note]'); if (on) { openNote(on.dataset.openNote).catch((x) => toast(x.message)); return; }
  const ot = t.closest('[data-open-table]'); if (ot) { openTable(ot.dataset.openTable).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-view-home]')) { openHome().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-tables]')) { openTablesList(); return; }
  if (t.closest('[data-view-tasks]')) { openTasks().catch((x) => toast(x.message)); return; }
  const fo = t.closest('[data-fav-open]'); if (fo) { openFav(fo.dataset.favOpen).catch((x) => toast(x.message)); return; }
  const fv = t.closest('[data-fav]'); if (fv) { toggleFav(fv.dataset.fav); return; }
  const uf = t.closest('[data-unfav]'); if (uf) { unfav(uf.dataset.unfav); return; }
  if (t.closest('[data-quick-task]')) { showQuickTask(); return; }
  if (t.closest('[data-new-note]')) { newNote(null).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-table]')) { newTable().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-sub]')) { newNote(state.note.current.id).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-note]')) { delNote(); return; }

  // tasks
  const sh = t.closest('[data-sort]');
  if (sh) { const c = sh.dataset.sort; if (state.taskSort.col === c) state.taskSort.dir = state.taskSort.dir === 'asc' ? 'desc' : 'asc'; else state.taskSort = { col: c, dir: c === 'created' ? 'desc' : 'asc' }; renderTasks(); return; }
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
  if (e.target.id === 'qt-form') { const i = $('#qt-title'); const v = i.value.trim(); if (v) { homeAddTask(v, $('#qt-prio').value); i.value = ''; i.focus(); } }
  if (e.target.id === 'colnew') { const name = $('#cn-name').value.trim(); const type = $('#cn-type').value; addColumn(name, type); }
});
// drag to reorder favourites on the home
let dragFav = null;
document.addEventListener('dragstart', (e) => { const f = e.target.closest('[data-fav-id]'); if (f) { dragFav = f.dataset.favId; e.dataTransfer.effectAllowed = 'move'; } });
document.addEventListener('dragover', (e) => { if (dragFav && e.target.closest('#favs')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!dragFav) return; e.preventDefault();
  const over = e.target.closest('[data-fav-id]');
  const beforeId = over && over.dataset.favId !== dragFav ? over.dataset.favId : null;
  reorderFavs(dragFav, beforeId); dragFav = null;
});
document.addEventListener('dragend', () => { dragFav = null; });

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

// ── sign-in gate (self-contained; life.robski.uk is its own origin) ──
let gateStep = 'email', gateEmail = '';
function showGate(sub) {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="gate2" id="gate2"><form class="gate2-card" id="gate-form">
      <div class="gate2-mark"><em>Life</em><span class="dot">·</span>Robski</div>
      <p class="gate2-sub" id="gate-sub">${sub || 'Sign in with your email to continue.'}</p>
      <input class="input" id="gate-email" type="email" placeholder="you@example.com" autocomplete="email" required>
      <input class="input gate2-code" id="gate-code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" hidden>
      <button class="add-btn wide" id="gate-btn" type="submit" style="width:100%">Send code</button>
      <p class="gate2-err" id="gate-err" hidden></p>
    </form></div>`);
  $('#gate-email').focus();
}
async function gateSubmit(e) {
  e.preventDefault();
  const err = $('#gate-err'), btn = $('#gate-btn');
  err.hidden = true; btn.disabled = true;
  try {
    if (gateStep === 'email') {
      gateEmail = $('#gate-email').value.trim();
      const r = await fetch('/auth/request-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: gateEmail }) });
      if (!r.ok) throw new Error('Could not send a code. Try again.');
      gateStep = 'code';
      $('#gate-sub').textContent = `Code sent to ${gateEmail}.`;
      $('#gate-email').hidden = true; $('#gate-code').hidden = false; $('#gate-code').focus();
      btn.textContent = 'Sign in';
    } else {
      const r = await fetch('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: gateEmail, code: $('#gate-code').value.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error(d.error || 'That code did not work.');
      localStorage.setItem(KEY, d.token); location.reload();
    }
  } catch (e2) { err.textContent = e2.message; err.hidden = false; }
  btn.disabled = false;
}
document.addEventListener('submit', (e) => { if (e.target.id === 'gate-form') gateSubmit(e); });

// ── boot ─────────────────────────────────────────────
(async function boot() {
  if (!token()) { showGate(); return; }
  try {
    [state.noteTops, state.tables] = await Promise.all([api('/api/blocks?kind=note&parent_id='), api('/api/blocks?kind=table')]);
    state.tables.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    await openHome();
  } catch (e) { toast(e.message); renderNav(); }
})();
