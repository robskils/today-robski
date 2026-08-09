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

const readLS = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch { return fb; } };
const state = {
  view: { type: 'home' },
  noteTops: [], tables: [],
  areas: [], tasks: [], taskFilter: null,
  taskSort: { col: 'created', dir: 'desc' },
  note: null, tables_open: null,
  favs: [], home: { events: [] }, cal: null, mail: null,
  nav: {
    order: (() => { const o = readLS('life.nav.order', null); return Array.isArray(o) && o.length === 3 && o.includes('favs') && o.includes('notes') && o.includes('tables') ? o : ['favs', 'notes', 'tables']; })(),
    collapsed: readLS('life.nav.collapsed', {}),
  },
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
  return out.join('');
}
// Existing notes were imported as Markdown; new ones are saved as clean HTML.
// Render either: if it already looks like HTML, trust it; else convert once.
function bodyToHtml(body) {
  const s = (body || '').trim();
  if (!s) return '';
  // Only the rich editor's own output (block-wrapped) is treated as HTML.
  // Imported bodies are Markdown that may contain an inline <a>, so keying on
  // block tags avoids mis-rendering a whole note as raw HTML.
  return /<(p|h[1-3]|blockquote|div|ul|ol)[\s>]/i.test(s) ? s : mdToHtml(body);
}
// An always-on inline editor. No modes, no markup - you just write, and the
// selection bubble (or ⌘B/⌘I) formats in place. `key` says which block it saves.
function proseEditor(body, key) {
  return `<div class="prose" contenteditable="true" spellcheck="true" data-prose="${key}" data-ph="Write something here…">${bodyToHtml(body)}</div>`;
}
// Keep saved HTML clean: a small whitelist, unwrap everything else, drop all
// attributes but a link's href. Content is Robin's own, so this is about
// tidiness (stray pasted styles) more than security.
const PROSE_OK = { P: 1, H1: 1, H2: 1, H3: 1, STRONG: 1, EM: 1, A: 1, BLOCKQUOTE: 1, BR: 1, CODE: 1 };
function sanitizeProse(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1) { c.remove(); return; }
      walk(c);
      let tag = c.tagName;
      if (tag === 'B') tag = 'STRONG'; else if (tag === 'I') tag = 'EM';
      else if (tag === 'DIV') tag = 'P'; else if (tag === 'LI') tag = 'P';
      if (!PROSE_OK[tag]) { const p = c.parentNode; while (c.firstChild) p.insertBefore(c.firstChild, c); c.remove(); return; }
      const el = c.tagName === tag ? c : (() => { const n = doc.createElement(tag); while (c.firstChild) n.appendChild(c.firstChild); c.replaceWith(n); return n; })();
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (href && /^(https?:|mailto:)/i.test(href)) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    });
  };
  walk(doc.body);
  return doc.body.innerHTML.trim();
}

// ── sidebar ──────────────────────────────────────────
// The three lower sections - Favourites, Notes, Tables - are collapsible and
// can be dragged into any order; both preferences persist in localStorage.
function navSection(key, v) {
  const collapsed = !!state.nav.collapsed[key];
  const chev = collapsed ? '▸' : '▾';
  const sub = (on, attr, ic, title) => `<button class="nav-sub ${on ? 'on' : ''}" ${attr}><span class="i">${ic}</span><span class="t">${esc(title || 'Untitled')}</span></button>`;
  // The whole header (chevron + word) toggles the section. Index pages live on
  // the top-level nav items instead, so the word here is purely expand/collapse.
  let title, add = '', rows;
  if (key === 'favs') {
    title = 'Favourites';
    rows = state.favs.map((f) => sub(false, `data-fav-open="${f.kind}:${f.id}"`, KIND_IC[f.kind] || '•', f.title)).join('') || '<div class="nav-sub muted">Star anything to pin it here</div>';
  } else if (key === 'notes') {
    title = 'Notes'; add = '<button class="nav-add" data-new-note title="New note">+</button>';
    rows = state.noteTops.map((n) => sub(v.type === 'note' && state.note && state.note.path[0] && state.note.path[0].id === n.id, `data-open-note="${n.id}"`, '▸', n.title)).join('') || '<div class="nav-sub muted">No notes yet</div>';
  } else {
    title = 'Tables'; add = '<button class="nav-add" data-new-table title="New table">+</button>';
    rows = state.tables.map((t) => sub(v.type === 'table' && state.tables_open && state.tables_open.id === t.id, `data-open-table="${t.id}"`, '▦', t.title)).join('') || '<div class="nav-sub muted">No tables yet</div>';
  }
  return `<div class="nav-sec" data-nav-sec="${key}">
    <div class="nav-sec-h" draggable="true" data-sec-toggle="${key}" title="${collapsed ? 'Expand' : 'Collapse'}">
      <span class="nav-chev">${chev}</span>
      <span class="nav-sec-title">${title}</span>
      ${add}<span class="nav-grip" title="Drag to reorder">⠿</span>
    </div>
    ${collapsed ? '' : `<div class="nav-sec-body">${rows}</div>`}
  </div>`;
}
function renderNav() {
  const v = state.view;
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#nav').innerHTML = `
    <div class="nav-brand" data-view-home title="Home"><em>Life</em><span class="dot">·</span>Robski</div>
    <div class="nav-foot">
      <button class="foot-search" data-palette title="Search">⌕</button>
      <a href="https://today.robski.uk" title="Your day planner">Today</a>
      <button data-theme-toggle title="Switch to ${dark ? 'daytime' : 'night'}">${dark ? '☀ Day' : '☾ Night'}</button>
      <a href="/api/export" title="Download a full backup">Backup</a>
    </div>
    <button class="nav-k" data-palette><span>Search or jump…</span><kbd>⌘K</kbd></button>
    <button class="nav-item ${v.type === 'home' ? 'on' : ''}" data-view-home><span>⌂</span> Home</button>
    <button class="nav-item ${v.type === 'tasks' || v.type === 'taskcard' ? 'on' : ''}" data-view-tasks><span>✓</span> Tasks</button>
    <button class="nav-item ${v.type === 'calendar' ? 'on' : ''}" data-open-calendar><span>◑</span> Calendar</button>
    <button class="nav-item ${v.type === 'mail' ? 'on' : ''}" data-open-mail><span>✉</span> Mail</button>
    <button class="nav-item ${v.type === 'notes' ? 'on' : ''}" data-open-notes><span>▸</span> Notes</button>
    <button class="nav-item ${v.type === 'tables' ? 'on' : ''}" data-open-tables><span>▦</span> Tables</button>
    <button class="nav-item ${v.type === 'areas' || v.type === 'area' ? 'on' : ''}" data-open-areas><span>◈</span> Life areas</button>
    <div class="nav-secs" id="nav-secs">${state.nav.order.map((k) => navSection(k, v)).join('')}</div>`;
  renderTabbar(v);
}
// The mobile bottom tab bar lives at body level, NOT inside .nav: .nav has a
// backdrop-filter, which would make it the containing block for a fixed child
// and pin the bar to the nav instead of the viewport.
function renderTabbar(v) {
  let el = document.getElementById('tabbar');
  if (!el) { el = document.createElement('nav'); el.id = 'tabbar'; el.className = 'tabbar'; document.body.appendChild(el); }
  const tab = (on, attr, ic, label) => `<button class="tab-b ${on ? 'on' : ''}" ${attr}><span>${ic}</span>${label}</button>`;
  el.innerHTML = tab(v.type === 'home', 'data-view-home', '⌂', 'Home')
    + tab(v.type === 'mail', 'data-open-mail', '✉', 'Mail')
    + tab(v.type === 'calendar', 'data-open-calendar', '◑', 'Calendar')
    + tab(v.type === 'tasks' || v.type === 'taskcard', 'data-view-tasks', '✓', 'Tasks')
    + tab(v.type === 'note' || v.type === 'notes', 'data-open-notes', '▸', 'Notes');
}
function toggleSec(key) { state.nav.collapsed[key] = !state.nav.collapsed[key]; localStorage.setItem('life.nav.collapsed', JSON.stringify(state.nav.collapsed)); renderNav(); }
function reorderSecs(draggedKey, beforeKey) {
  if (draggedKey === beforeKey) return;
  const o = state.nav.order.filter((k) => k !== draggedKey);
  let i = beforeKey ? o.indexOf(beforeKey) : o.length; if (i < 0) i = o.length;
  o.splice(i, 0, draggedKey); state.nav.order = o;
  localStorage.setItem('life.nav.order', JSON.stringify(o)); renderNav();
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
  state.note = { current: note, path, children };
  state.view = { type: 'note', id };
  renderNav(); renderNote();
}
async function openTable(id) {
  const table = await api(`/api/blocks/${id}`);
  const rows = await api(`/api/blocks?kind=row&parent_id=${id}`);
  state.tables_open = table; state.tables_rows = rows; state.tables_view = { openRow: null, addingCol: false, sort: null };
  state.view = { type: 'table', id };
  renderNav(); renderTable();
}

// ── view: home ───────────────────────────────────────
const hhmm = (m) => `${String((m / 60) | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const KIND_IC = { note: '▸', table: '▦', task: '✓', row: '▦', area: '◈' };

async function openHome() {
  state.view = { type: 'home' };
  const [favs, day] = await Promise.all([
    api('/api/favorites').catch(() => state.favs),
    api('/api/day').catch(() => ({ events: [] })),
  ]);
  state.favs = favs; state.home = { events: day.events || [] };
  renderNav(); renderHome();
}
function renderHome() {
  const favs = state.favs || [];
  const ev = (state.home.events || []).slice().sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start_min ?? 0) - (b.start_min ?? 0));
  const favRows = favs.map((f) => `<div class="fav" draggable="true" data-fav-id="${f.id}">
    <button class="fav-open" data-fav-open="${f.kind}:${f.id}"><span class="fav-ic">${KIND_IC[f.kind] || '•'}</span><span class="fav-t">${esc(f.title || 'Untitled')}</span></button>
    <button class="fav-x" data-unfav="${f.id}" title="Remove from favourites">×</button></div>`).join('');
  const evRows = ev.map((e) => `<div class="ev-row"><span class="ev-time">${e.allDay ? 'all day' : hhmm(e.start_min)}</span><span class="ev-t">${esc(e.title)}</span>${e.location ? `<span class="ev-loc">${esc(e.location)}</span>` : ''}</div>`).join('');
  $('#pane').innerHTML = `
    <div class="home">
      <div class="home-head">
        <h1>${greeting()}, <span class="hi-name">Robski</span></h1>
        <div class="home-actions"><button class="add-btn wide" data-new-note>+ Note</button><button class="add-btn wide" data-quick-task>+ Task</button><button class="add-btn wide" data-quick-event>+ Event</button></div>
      </div>
      <div id="qt-wrap"></div>
      <nav class="home-nav">
        <button class="hn-btn" data-view-tasks><span class="hn-ic">✓</span>Tasks</button>
        <button class="hn-btn" data-open-calendar><span class="hn-ic">◑</span>Calendar</button>
        <button class="hn-btn" data-open-mail><span class="hn-ic">✉</span>Mail</button>
        <span class="hn-group"><button class="hn-btn" data-open-notes><span class="hn-ic">▸</span>Notes</button><button class="hn-plus" data-new-note title="New note">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-tables><span class="hn-ic">▦</span>Tables</button><button class="hn-plus" data-new-table title="New table">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-areas><span class="hn-ic">◈</span>Life areas</button><button class="hn-plus" data-new-area title="New life area">+</button></span>
      </nav>
      <section class="home-sec">
        <div class="home-sec-h">Favourites ${favs.length ? '<span class="muted">drag to reorder</span>' : ''}</div>
        <div class="favs" id="favs">${favRows || '<div class="home-empty">Star a task, note or table (the ☆ on it) to pin it here.</div>'}</div>
      </section>
      <section class="home-sec">
        <div class="home-sec-h">Today</div>
        <div class="today-cal">${evRows || '<div class="home-empty">Nothing in your calendar today.</div>'}</div>
      </section>
      ${favGroup('Favourite areas', favs.filter((f) => f.kind === 'area'))}
      ${favGroup('Favourite notes', favs.filter((f) => f.kind === 'note'))}
      ${favGroup('Favourite tables', favs.filter((f) => f.kind === 'table'))}
    </div>`;
}
// A type-grouped strip of favourite cards for the home page, shown only when
// that type has any favourites.
function favGroup(label, list) {
  if (!list.length) return '';
  const cards = list.map((f) => `<button class="tbl-card" data-fav-open="${f.kind}:${f.id}"><span class="tc-ic">${KIND_IC[f.kind] || '•'}</span>${esc(f.title || 'Untitled')}</button>`).join('');
  return `<section class="home-sec"><div class="home-sec-h">${label}</div><div class="tbl-cards">${cards}</div></section>`;
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

function openNotesList() {
  state.view = { type: 'notes' };
  renderNav();
  const favNotes = state.noteTops.filter((n) => n.props && n.props.fav);
  const cards = (list) => list.map((n) => `<button class="tbl-card" data-open-note="${n.id}"><span class="tc-ic">▸</span>${esc(n.title || 'Untitled')}${areaTag(n)}</button>`).join('');
  $('#pane').innerHTML = `
    <div class="pane-head home-head"><h1>Notes</h1><button class="add-btn wide" data-new-note>+ New note</button></div>
    ${favNotes.length ? `<section class="home-sec"><div class="home-sec-h">Favourites</div><div class="tbl-cards">${cards(favNotes)}</div></section>` : ''}
    <section class="home-sec"><div class="home-sec-h">All notes · ${state.noteTops.length}</div><div class="tbl-cards">${cards(state.noteTops) || '<div class="empty">No notes yet.</div>'}</div></section>`;
}

// ── view: life areas ─────────────────────────────────
// A small coloured tag showing a block's life area, if it has one.
function areaTag(b) {
  const a = b.props && b.props.area && areaById(b.props.area);
  return a ? `<span class="area-tag" style="--h:${hueOf(a)}"><span class="cd"></span>${esc(a.title)}</span>` : '';
}
// A picker to set a block's life area, used on note and table pages.
function areaSelect(cur, attr) {
  return `<span class="area-pick"><select class="area-sel" ${attr}><option value="">+ Life area</option>${
    state.areas.map((a) => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${esc(a.title)}</option>`).join('')
  }</select></span>`;
}
function openAreasList() {
  state.view = { type: 'areas' };
  renderNav();
  const favAreas = state.areas.filter((a) => a.props && a.props.fav);
  const card = (a) => `<div class="area-card" style="--h:${hueOf(a)}">
    <button class="ac-open" data-open-area="${a.id}"><span class="ac-dot"></span><span class="ac-t">${esc(a.title)}</span></button>
    <button class="star ${a.props && a.props.fav ? 'on' : ''}" data-fav="${a.id}" title="Favourite">${a.props && a.props.fav ? '★' : '☆'}</button></div>`;
  $('#pane').innerHTML = `
    <div class="pane-head home-head"><h1>Life areas</h1></div>
    ${favAreas.length ? `<section class="home-sec"><div class="home-sec-h">Favourites</div><div class="area-cards">${favAreas.map(card).join('')}</div></section>` : ''}
    <section class="home-sec"><div class="home-sec-h">All areas · ${state.areas.length}</div>
      <div class="area-cards">${state.areas.map(card).join('') || '<div class="empty">No life areas yet.</div>'}</div></section>`;
}
async function openArea(id) {
  state.view = { type: 'area', id };
  const [area, blocks] = await Promise.all([api(`/api/blocks/${id}`), api(`/api/blocks?area=${id}`)]);
  state.area_open = { area, blocks };
  renderNav(); renderArea();
}
function renderArea() {
  const { area, blocks } = state.area_open;
  const tasks = blocks.filter((b) => b.kind === 'task');
  const openTs = tasks.filter((t) => !t.props.done).sort((a, b) => (PRIO_ORDER[a.props.priority || ''] || 5) - (PRIO_ORDER[b.props.priority || ''] || 5));
  const doneN = tasks.length - openTs.length;
  const tables = blocks.filter((b) => b.kind === 'table');
  const notes = blocks.filter((b) => b.kind === 'note');
  const h = hueOf(area);
  const taskRows = openTs.map((t) => `<div class="area-task"><button class="check" data-check="${t.id}">✓</button>
    <span class="t">${esc(t.title)}</span>${t.props.priority ? `<span class="prio ${t.props.priority}">${t.props.priority}</span>` : ''}</div>`).join('');
  const tblCards = tables.map((t) => `<button class="tbl-card" data-open-table="${t.id}"><span class="tc-ic">▦</span>${esc(t.title || 'Untitled')}</button>`).join('');
  const noteCards = notes.map((n) => `<button class="tbl-card" data-open-note="${n.id}"><span class="tc-ic">▸</span>${esc(n.title || 'Untitled')}</button>`).join('');
  const sec = (label, n, inner) => n ? `<section class="home-sec"><div class="home-sec-h">${label} · ${n}</div>${inner}</section>` : '';
  $('#pane').innerHTML = `
    <div class="area-hero" style="--h:${h}">
      <div class="area-hero-top"><button class="crumb" data-open-areas>Life areas</button>
        <button class="star ${area.props && area.props.fav ? 'on' : ''}" data-fav="${area.id}" title="Favourite">${area.props && area.props.fav ? '★' : '☆'}</button></div>
      <h1><span class="ac-dot"></span>${esc(area.title)}</h1>
      <p class="area-meta">${openTs.length} open task${openTs.length === 1 ? '' : 's'}${doneN ? ` · ${doneN} done` : ''} · ${tables.length} table${tables.length === 1 ? '' : 's'} · ${notes.length} note${notes.length === 1 ? '' : 's'}</p>
    </div>
    ${sec('Tasks', openTs.length, `<div class="area-tasks">${taskRows}</div>`)}
    ${sec('Tables', tables.length, `<div class="tbl-cards">${tblCards}</div>`)}
    ${sec('Notes', notes.length, `<div class="tbl-cards">${noteCards}</div>`)}
    ${!openTs.length && !tables.length && !notes.length ? '<div class="empty" style="padding:50px">Nothing tagged with this life area yet. Add it to a task, note or table.</div>' : ''}`;
}
async function setBlockArea(kind, id, areaId) {
  try {
    await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { area: areaId || null } }) });
    const bump = (b) => { if (b) { b.props = b.props || {}; b.props.area = areaId || null; } };
    if (kind === 'note') { bump(state.note && state.note.current); bump(state.noteTops.find((n) => n.id === id)); }
    if (kind === 'table') { bump(state.tables_open); bump(state.tables.find((t) => t.id === id)); }
    toast(areaId ? 'Life area set' : 'Life area cleared');
  } catch (e) { toast(e.message); }
}

// ── view: calendar ───────────────────────────────────
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`; // m is 0-based
const todayISO = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth(), d.getDate()); };
const addDayISO = (iso, n = 1) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
const isoToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minToLabel = (m) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const prettyDate = (iso) => { const [y, mo, d] = iso.split('-').map(Number); const dt = new Date(y, mo - 1, d); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${d} ${MONTHS_LONG[mo - 1]}`; };

function monthWeeks(y, m) {
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(y, m, 1 - startDow);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(gridStart); dt.setDate(gridStart.getDate() + w * 7 + i);
      const iso = ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
      days.push({ iso, day: dt.getDate(), inMonth: dt.getMonth() === m, today: iso === todayISO() });
    }
    weeks.push(days);
  }
  return weeks;
}
function eventsByDay() {
  const map = {};
  for (const e of state.cal.events) {
    const days = [];
    if (e.allDay) {
      const end = e.end_date && e.end_date > e.date ? e.end_date : addDayISO(e.date);
      for (let d = e.date; d < end; d = addDayISO(d)) days.push(d);
    } else {
      days.push(e.date);
      if (e.end_date && e.end_date !== e.date) days.push(e.end_date);
    }
    for (const d of (days.length ? days : [e.date])) (map[d] = map[d] || []).push(e);
  }
  for (const d in map) map[d].sort((a, b) => (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.start_min || 0) - (b.start_min || 0));
  return map;
}
async function openCalendar(dateStr) {
  const base = dateStr || (state.cal && state.cal.selected) || todayISO();
  const [y, m] = base.split('-').map(Number);
  state.cal = { y, m: m - 1, selected: dateStr || (state.cal && state.cal.selected) || todayISO(), events: [], error: null, editing: null, adding: false };
  state.view = { type: 'calendar' };
  renderNav(); renderCalendar();
  await loadCalendar();
}
async function loadCalendar() {
  const weeks = monthWeeks(state.cal.y, state.cal.m);
  const from = weeks[0][0].iso, to = weeks[5][6].iso;
  try {
    const r = await api(`/api/calendar?from=${from}&to=${to}`);
    state.cal.events = r.events || []; state.cal.error = r.error || null;
  } catch (e) { state.cal.error = e.message; }
  if (state.view.type === 'calendar') renderCalendar();
}
function stepMonth(delta) {
  let m = state.cal.m + delta, y = state.cal.y;
  if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
  state.cal.y = y; state.cal.m = m; state.cal.adding = false; state.cal.editing = null;
  renderCalendar(); loadCalendar();
}
function renderCalendar() {
  const c = state.cal, byDay = eventsByDay();
  const chip = (e) => `<span class="cal-chip ${e.allDay ? 'allday' : ''}" data-cal-ev="${e.id}" title="${esc(e.title)}">${e.allDay ? '' : `<b>${minToLabel(e.start_min)}</b> `}${esc(e.title)}</span>`;
  const cell = (d) => {
    const evs = byDay[d.iso] || [];
    const shown = evs.slice(0, 3).map(chip).join('');
    const more = evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} more</span>` : '';
    return `<div class="cal-cell ${d.inMonth ? '' : 'dim'} ${d.today ? 'today' : ''} ${d.iso === c.selected ? 'sel' : ''}" data-cal-day="${d.iso}">
      <div class="cal-daynum">${d.day}</div><div class="cal-evs">${shown}${more}</div></div>`;
  };
  const grid = monthWeeks(c.y, c.m).map((w) => w.map(cell).join('')).join('');
  const dayEvents = (byDay[c.selected] || []);
  const agendaRows = dayEvents.length ? dayEvents.map((e) => `<button class="cal-ag-row" data-cal-ev="${e.id}">
      <span class="cal-ag-time">${e.allDay ? 'all day' : minToLabel(e.start_min)}</span>
      <span class="cal-ag-t">${esc(e.title)}</span>${e.location ? `<span class="cal-ag-loc">${esc(e.location)}</span>` : ''}</button>`).join('')
    : '<div class="home-empty">Nothing on this day.</div>';
  $('#pane').innerHTML = `
    <div class="cal-head">
      <h1>${MONTHS_LONG[c.m]} <span class="cal-yr">${c.y}</span></h1>
      <div class="cal-nav">
        <button class="cal-btn" data-cal-today>Today</button>
        <button class="cal-btn ic" data-cal-prev title="Previous month">‹</button>
        <button class="cal-btn ic" data-cal-next title="Next month">›</button>
      </div>
    </div>
    ${c.error && c.error !== null ? `<div class="cal-warn">Calendar: ${esc(String(c.error))}</div>` : ''}
    <div class="cal-grid">
      ${WEEKDAYS.map((w) => `<div class="cal-dow">${w}</div>`).join('')}
      ${grid}
    </div>
    <section class="cal-agenda">
      <div class="cal-ag-head"><h2>${prettyDate(c.selected)}</h2><button class="add-btn wide" data-cal-add>+ Event</button></div>
      <div id="cal-form"></div>
      <div class="cal-ag-list">${agendaRows}</div>
    </section>`;
  if (c.adding) showCalForm();
  else if (c.editing) showCalForm(c.editing);
}
function showCalForm(ev) {
  const c = state.cal;
  const title = ev ? ev.title : '';
  const time = ev && !ev.allDay ? minToLabel(ev.start_min) : '09:00';
  const dur = ev && !ev.allDay ? Math.max(15, (ev.end_min ?? ev.start_min + 60) - ev.start_min) : 60;
  const loc = ev ? (ev.location || '') : '';
  $('#cal-form').innerHTML = `<form id="cal-ev-form" class="add-task add-event" data-ev="${ev ? ev.id : ''}">
    <input id="ce-title" placeholder="Event title…" autocomplete="off" required value="${esc(title)}">
    <input id="ce-time" type="time" class="sel" value="${time}" required>
    <select id="ce-dur" class="sel">${[15, 30, 45, 60, 90, 120, 180, 240].map((n) => `<option value="${n}" ${n === dur ? 'selected' : ''}>${n < 60 ? n + ' min' : (n / 60) + (n === 60 ? ' hour' : ' hours')}</option>`).join('')}</select>
    <input id="ce-loc" class="sel" placeholder="Location (optional)" autocomplete="off" value="${esc(loc)}">
    <button class="add-btn wide" type="submit">${ev ? 'Save' : 'Add to calendar'}</button>
    ${ev ? '<button type="button" class="ghost cal-del" data-cal-del>Delete</button>' : ''}</form>`;
  $('#ce-title').focus();
}
async function calSaveEvent(id, title, time, duration, location) {
  const body = JSON.stringify({ title, day: state.cal.selected, start_min: isoToMin(time), duration: Number(duration), location: location || undefined });
  try {
    if (id) await api(`/api/events/${id}`, { method: 'PATCH', body });
    else await api('/api/events', { method: 'POST', body });
    toast(id ? 'Event updated' : 'Added to your calendar');
    state.cal.adding = false; state.cal.editing = null;
    await loadCalendar();
  } catch (e) { toast(e.message); }
}
async function calDeleteEvent(id) {
  if (!confirm('Delete this event from your Google calendar?')) return;
  try { await api(`/api/events/${id}`, { method: 'DELETE' }); toast('Event deleted'); state.cal.editing = null; await loadCalendar(); }
  catch (e) { toast(e.message); }
}

// ── view: mail ───────────────────────────────────────
// The mail backend is a separate always-on service (IMAP/SMTP can't run on the
// Worker). Its URL is stored per-browser; the same Life token authenticates it.
const mailApiUrl = () => (localStorage.getItem('life.mailApi') || '').replace(/\/$/, '');
async function mailApi(path, opts = {}) {
  const base = mailApiUrl(); if (!base) throw new Error('Mail backend not set up yet.');
  const res = await fetch(base + path, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.status === 204 ? null : res.json();
}
const mailFrom = (m) => m.from ? (m.from.name || m.from.address || '') : '';
const mailDate = (iso) => { if (!iso) return ''; const d = new Date(iso), now = new Date(); const sameDay = d.toDateString() === now.toDateString(); return sameDay ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : `${d.getDate()} ${MONTHS_LONG[d.getMonth()].slice(0, 3)}`; };

async function openMail() {
  state.view = { type: 'mail' };
  if (!mailApiUrl()) { state.mail = { setup: true }; renderNav(); renderMailSetup(); return; }
  if (!state.mail || state.mail.setup) state.mail = { account: null, mailbox: 'INBOX', messages: [], open: null, composing: false };
  renderNav(); renderMail(true);
  try {
    state.mail.accounts = await mailApi('/accounts');
    if (!state.mail.accounts.length) { renderMailAccounts('Add a mailbox to get started.'); return; }
    if (!state.mail.account) state.mail.account = state.mail.accounts[0].id;
    await loadMessages();
  } catch (e) { state.mail.error = e.message; renderMail(); }
}
async function loadMessages() {
  state.mail.open = null; state.mail.composing = false; renderMail(true);
  try {
    const r = await mailApi(`/messages?account=${state.mail.account}&mailbox=${encodeURIComponent(state.mail.mailbox)}&limit=40`);
    state.mail.messages = r.messages || []; state.mail.error = null;
  } catch (e) { state.mail.error = e.message; }
  renderMail();
}
async function openMessage(uid) {
  renderMail(true);
  try {
    const m = await mailApi(`/message?account=${state.mail.account}&mailbox=${encodeURIComponent(state.mail.mailbox)}&uid=${uid}`);
    state.mail.open = m;
    const row = state.mail.messages.find((x) => x.uid === uid); if (row && !row.seen) { row.seen = true; mailApi('/flag', { method: 'POST', body: JSON.stringify({ account: state.mail.account, mailbox: state.mail.mailbox, uid, seen: true }) }).catch(() => {}); }
  } catch (e) { toast(e.message); }
  renderMail();
}
async function mailDelete(uid) {
  if (!confirm('Move this message to Trash?')) return;
  try { await mailApi('/move', { method: 'POST', body: JSON.stringify({ account: state.mail.account, mailbox: state.mail.mailbox, uid, target: 'Trash' }) }); toast('Moved to Trash'); state.mail.messages = state.mail.messages.filter((m) => m.uid !== uid); state.mail.open = null; renderMail(); }
  catch (e) { toast(e.message); }
}
async function mailSend(to, subject, body, inReplyTo) {
  try { await mailApi('/send', { method: 'POST', body: JSON.stringify({ account: state.mail.account, to, subject, text: body, inReplyTo }) }); toast('Sent'); state.mail.composing = false; renderMail(); }
  catch (e) { toast(e.message); }
}
async function openMailAccounts() {
  state.view = { type: 'mail' }; renderNav();
  try { state.mail = (state.mail && !state.mail.setup) ? state.mail : { account: null, mailbox: 'INBOX' }; state.mail.accounts = await mailApi('/accounts'); renderMailAccounts(state.mail.accounts.length ? null : 'Add a mailbox to get started.'); }
  catch (e) { toast(e.message); }
}
async function addMailAccount(fields) {
  try { const a = await mailApi('/accounts', { method: 'POST', body: JSON.stringify(fields) }); toast('Account added'); state.mail.accounts = state.mail.accounts || []; state.mail.accounts.push(a); state.mail.account = a.id; await openMail(); }
  catch (e) { toast(e.message); }
}
async function delMailAccount(id) {
  if (!confirm('Remove this account?')) return;
  try { await mailApi(`/accounts/${id}`, { method: 'DELETE' }); state.mail.accounts = (state.mail.accounts || []).filter((a) => a.id !== id); if (state.mail.account === id) state.mail.account = null; renderMailAccounts(state.mail.accounts.length ? null : 'Add a mailbox to get started.'); }
  catch (e) { toast(e.message); }
}
function mailReplyStart() {
  const o = state.mail.open; if (!o) return;
  const quote = (o.text || '').split('\n').map((l) => `> ${l}`).join('\n');
  state.mail.composing = { to: o.from ? o.from.address : '', subject: /^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`, body: `\n\n---\nOn ${new Date(o.date).toLocaleString()}, ${o.from ? o.from.address : ''} wrote:\n${quote}`, inReplyTo: o.messageId };
  renderMail();
}

function renderMailSetup() {
  $('#pane').innerHTML = `<div class="pane-head"><h1>Mail</h1></div>
    <div class="card" style="max-width:520px">
      <p class="scope">Point the app at your mail backend (see mail-backend/SETUP.md). You only do this once per device.</p>
      <form id="mail-setup-form" class="add-task">
        <input id="mail-api" type="url" placeholder="https://mail-api.robski.uk" autocomplete="off" required style="flex:1;min-width:240px">
        <button class="add-btn wide" type="submit">Connect</button>
      </form></div>`;
  $('#mail-api').focus();
}
function renderMailAccounts(note) {
  const rows = (state.mail.accounts || []).map((a) => `<div class="mail-acct"><span class="ma-dot" style="background:${a.color || 'var(--accent)'}"></span><span class="ma-e">${esc(a.email)}</span><button class="x" data-mail-del-acct="${a.id}" title="Remove">×</button></div>`).join('');
  $('#pane').innerHTML = `<div class="pane-head home-head"><h1>Mail</h1><button class="add-btn wide" data-mail-add-acct>+ Account</button></div>
    ${note ? `<p class="scope">${esc(note)}</p>` : ''}
    <div class="mail-acct-list">${rows}</div>
    <div id="mail-acct-form"></div>`;
}
function showMailAccountForm() {
  $('#mail-acct-form').innerHTML = `<form id="mail-acct-form-el" class="add-task" style="flex-direction:column;align-items:stretch;gap:10px;max-width:520px;margin-top:16px">
    <input id="ma-email" type="email" placeholder="Email address" required>
    <div style="display:flex;gap:8px"><input id="ma-imaphost" placeholder="IMAP host (imap.gmail.com)" required style="flex:1"><input id="ma-imapport" value="993" style="width:80px"></div>
    <div style="display:flex;gap:8px"><input id="ma-smtphost" placeholder="SMTP host (smtp.gmail.com)" required style="flex:1"><input id="ma-smtpport" value="465" style="width:80px"></div>
    <input id="ma-user" placeholder="Username (usually your email)">
    <input id="ma-pass" type="password" placeholder="Password / app password" required>
    <button class="add-btn wide" type="submit">Add account</button></form>`;
  $('#ma-email').focus();
}
function renderMail(loading) {
  const m = state.mail;
  if (m.setup) return renderMailSetup();
  if (m.accounts && !m.accounts.length) return renderMailAccounts('Add a mailbox to get started.');
  const accTabs = (m.accounts || []).map((a) => `<button class="mail-atab ${a.id === m.account ? 'on' : ''}" data-mail-acct="${a.id}">${esc(a.name || a.email)}</button>`).join('');
  let main;
  if (m.composing) {
    const re = m.composing.reply;
    main = `<form id="mail-compose-form" class="mail-compose">
      <input id="mc-to" placeholder="To" value="${esc(m.composing.to || '')}" required>
      <input id="mc-subject" placeholder="Subject" value="${esc(m.composing.subject || '')}">
      <textarea id="mc-body" placeholder="Write your message…">${esc(m.composing.body || '')}</textarea>
      <div class="mail-compose-act"><button class="add-btn wide" type="submit">Send</button><button type="button" class="ghost" data-mail-cancel>Cancel</button></div></form>`;
  } else if (m.open) {
    const o = m.open;
    const bodyHtml = o.text ? `<pre class="mail-text">${esc(o.text)}</pre>` : `<div class="mail-text">${esc((o.html || '').replace(/<[^>]+>/g, ' ')).slice(0, 8000)}</div>`;
    main = `<div class="mail-msg">
      <button class="ghost" data-mail-back>← Inbox</button>
      <h1 class="mail-subj">${esc(o.subject)}</h1>
      <div class="mail-meta"><b>${esc(o.from ? (o.from.name || o.from.address) : '')}</b> <span>${esc(o.from ? o.from.address : '')}</span><span class="mail-when">${new Date(o.date).toLocaleString()}</span></div>
      ${o.attachments && o.attachments.length ? `<div class="mail-att">📎 ${o.attachments.map((a) => esc(a.filename || 'attachment')).join(', ')}</div>` : ''}
      ${bodyHtml}
      <div class="mail-msg-act"><button class="add-btn wide" data-mail-reply>Reply</button><button class="ghost" data-mail-del="${o.uid}">Delete</button></div></div>`;
  } else {
    const rows = (m.messages || []).map((x) => `<button class="mail-row ${x.seen ? '' : 'unread'}" data-mail-open="${x.uid}">
      <span class="mail-from">${esc(mailFrom(x) || '(unknown)')}</span>
      <span class="mail-subject">${esc(x.subject)}</span>
      <span class="mail-date">${mailDate(x.date)}</span></button>`).join('');
    main = `<div class="mail-list">${loading ? '<div class="home-empty">Loading…</div>' : (rows || '<div class="home-empty">No messages.</div>')}</div>`;
  }
  $('#pane').innerHTML = `
    <div class="pane-head home-head"><h1>Mail</h1>
      <div class="mail-head-act"><button class="ghost" data-mail-accounts title="Accounts">Accounts</button><button class="add-btn wide" data-mail-compose>+ Compose</button></div></div>
    ${accTabs ? `<div class="mail-atabs">${accTabs}</div>` : ''}
    ${m.error ? `<div class="cal-warn">${esc(m.error)}</div>` : ''}
    ${main}`;
}

function showQuickTask() {
  const opts = `<option value="">No area</option>` + state.areas.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
  $('#qt-wrap').innerHTML = `<form id="qt-form" class="add-task" style="margin-bottom:22px">
    <input id="qt-title" placeholder="Add a task…" autocomplete="off" required>
    <select id="qt-area" class="sel">${opts}</select>
    <select id="qt-prio" class="sel"><option value="">—</option><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option></select>
    <button class="add-btn wide" type="submit">Add</button></form>`;
  $('#qt-title').focus();
}
async function homeAddTask(title, area, priority) {
  try { await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title, props: { area: area || null, priority: priority || null, done: false } }) }); toast('Task added'); }
  catch (e) { toast(e.message); }
}
const pad2 = (n) => String(n).padStart(2, '0');
function showQuickEvent() {
  const d = new Date();
  const today = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // Default to the next quarter-hour, a sensible starting point.
  const mins = Math.ceil((d.getHours() * 60 + d.getMinutes() + 5) / 15) * 15;
  const start = `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`;
  $('#qt-wrap').innerHTML = `<form id="qe-form" class="add-task add-event" style="margin-bottom:22px">
    <input id="qe-title" placeholder="Event title…" autocomplete="off" required>
    <input id="qe-date" type="date" class="sel" value="${today}" required>
    <input id="qe-time" type="time" class="sel" value="${start}" required>
    <select id="qe-dur" class="sel"><option value="15">15 min</option><option value="30">30 min</option><option value="60" selected>1 hour</option><option value="90">1½ hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select>
    <input id="qe-loc" class="sel" placeholder="Location (optional)" autocomplete="off">
    <button class="add-btn wide" type="submit">Add to calendar</button></form>`;
  $('#qe-title').focus();
}
async function homeAddEvent(title, day, time, duration, location) {
  const [h, m] = time.split(':').map(Number);
  try {
    await api('/api/events', { method: 'POST', body: JSON.stringify({ title, day, start_min: h * 60 + m, duration: Number(duration), location: location || undefined }) });
    toast('Added to your Google calendar');
    $('#qt-wrap').innerHTML = '';
    // If it's for today, pull it straight into the Today panel.
    const dres = await api('/api/day').catch(() => null);
    if (dres && state.view.type === 'home') { state.home.events = dres.events || []; renderHome(); }
  } catch (e) { toast(e.message); }
}

// favourites: pin any block; cross-kind; ordered by fav_rank.
function findBlock(id) {
  return state.tasks.find((b) => b.id === id) || state.tables.find((b) => b.id === id)
    || state.noteTops.find((b) => b.id === id) || state.areas.find((b) => b.id === id)
    || (state.note && state.note.current.id === id ? state.note.current : null)
    || (state.tables_open && state.tables_open.id === id ? state.tables_open : null)
    || (state.task_open && state.task_open.task.id === id ? state.task_open.task : null)
    || (state.area_open && state.area_open.area.id === id ? state.area_open.area : null)
    || (state.favs || []).find((b) => b.id === id);
}
function isFav(id) { const b = findBlock(id); return !!(b && b.props && b.props.fav); }
async function toggleFav(id) {
  const b = findBlock(id); if (!b) return;
  b.props = b.props || {};
  const fav = !b.props.fav;
  b.props.fav = fav; if (fav) b.props.fav_rank = Date.now();
  if (fav) { if (!state.favs.find((f) => f.id === id)) state.favs.push({ id, kind: b.kind, title: b.title, props: { ...b.props } }); }
  else { state.favs = state.favs.filter((f) => f.id !== id); }
  renderNav(); rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { fav, fav_rank: b.props.fav_rank } }) }); } catch (e) { toast(e.message); }
}
async function unfav(id) {
  const b = findBlock(id); if (b) { b.props = b.props || {}; b.props.fav = false; }
  state.favs = state.favs.filter((f) => f.id !== id);
  renderNav(); rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { fav: false } }) }); } catch (e) { toast(e.message); }
}
function rerenderCurrent() {
  const v = state.view.type;
  if (v === 'tasks') renderTasks(); else if (v === 'note') renderNote();
  else if (v === 'table') renderTable(); else if (v === 'tables') openTablesList();
  else if (v === 'notes') openNotesList(); else if (v === 'areas') openAreasList();
  else if (v === 'area') renderArea(); else if (v === 'taskcard') renderTaskCard();
  else if (v === 'calendar') renderCalendar(); else if (v === 'mail') renderMail(); else openHome();
}
async function reorderFavs(draggedId, beforeId) {
  const favs = state.favs;
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
  if (kind === 'area') return openArea(id);
  if (kind === 'task') return openTaskCard(id);
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
  // Same filter as the chips, but a compact dropdown - shown on mobile instead.
  const filterSel = `<select class="area-filter sel" data-task-filter><option value="" ${state.taskFilter === null ? 'selected' : ''}>All tasks · ${openCount(null)}</option>${state.areas.filter((a) => openCount(a.id)).map((a) => `<option value="${a.id}" ${state.taskFilter === a.id ? 'selected' : ''}>${esc(a.title)} · ${openCount(a.id)}</option>`).join('')}</select>`;
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
      <td class="tc-prio"><span class="ie" data-edit-prio="${t.id}">${p ? `<span class="prio ${p}">${p}</span>` : '<span class="ie-add">+</span>'}</span></td>
      <td class="tc-area"><span class="ie" data-edit-area="${t.id}">${a ? `<span class="tag">${esc(a.title)}</span>` : '<span class="ie-add">+</span>'}</span></td>
      <td class="tc-date">${fmtDate(t.created_at)}</td>
      <td class="tc-act"><button class="row-open-btn" data-open-task="${t.id}" title="Open in focus">⤢</button><button class="star ${t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props.fav ? '★' : '☆'}</button><button class="x" data-del-task="${t.id}">×</button></td>
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
    ${filterSel}
    <div class="tbl-scroll"><table class="ttable">
      <thead><tr><th class="tc-done"></th>${th('title', 'Task', 'tc-title')}${th('priority', 'Priority', 'tc-prio')}${th('area', 'Area', 'tc-area')}${th('created', 'Added', 'tc-date')}<th class="tc-act"></th></tr></thead>
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
      <span class="crumb-tools">${areaSelect(n.props && n.props.area, 'data-note-area')}
      <button class="star ${n.props && n.props.fav ? 'on' : ''}" data-fav="${n.id}" title="Favourite">${n.props && n.props.fav ? '★' : '☆'}</button>
      <button class="note-del ghost" data-del-note title="Delete this note">Delete</button></span></div>
    <input class="note-title" id="note-title" value="${esc(n.title || '')}" placeholder="Untitled">
    <div class="note-body">${proseEditor(n.body, 'note')}</div>
    <div class="subpages"><div class="sub-h">Notes inside${state.note.children.length ? ` · ${state.note.children.length}` : ''}</div>
      ${kids}<button class="subpage add" data-new-sub><span class="sp-ico">+</span><span class="sp-t">New note inside</span></button></div>`;
}

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
// View-only sort by a column (like the Tasks table). Type-aware; empty cells
// always sink to the bottom whichever way you sort.
function sortRows(rows) {
  const s = state.tables_view.sort; if (!s) return rows;
  const col = tcols().find((x) => x.id === s.colId); if (!col) return rows;
  const dir = s.dir === 'asc' ? 1 : -1;
  const raw = (r) => (r.props.values || {})[s.colId];
  const norm = (v) => col.type === 'number' ? Number(v) : col.type === 'checkbox' ? (v ? 1 : 0) : col.type === 'date' ? String(v) : String(v).toLowerCase();
  return rows.slice().sort((a, b) => {
    const va = raw(a), vb = raw(b);
    if (col.type !== 'checkbox') {
      const ea = va == null || va === '', eb = vb == null || vb === '';
      if (ea && eb) return 0; if (ea) return 1; if (eb) return -1;
    }
    const na = norm(va), nb = norm(vb);
    return na < nb ? -dir : na > nb ? dir : 0;
  });
}
function renderTable() {
  const t = state.tables_open, c = tcols(), vw = state.tables_view;
  if (vw.openRow) {
    const r = state.tables_rows.find((x) => x.id === vw.openRow) || (vw.openRow = null);
    if (r) {
      const title = (r.props.values || {})[c[0] && c[0].id] || 'Untitled';
      $('#pane').innerHTML = `<div class="card"><button class="ghost" data-back-table>← ${esc(t.title || 'table')}</button>
        <h1 class="card-title">${esc(title)}</h1><div class="card-fields">${c.map((col) => `<label class="crow"><span class="clabel">${esc(col.name)}<em>${esc(col.type)}</em></span><span class="cval">${cellInput(r, col)}</span></label>`).join('')}</div>
        ${notesSection(r.body, 'row')}</div>`;
      return;
    }
  }
  const colWidth = (col, first) => col.width || (first ? 230 : 170);
  const colgroup = `<colgroup><col style="width:46px">${c.map((col, i) => `<col data-cw="${col.id}" style="width:${colWidth(col, i === 0)}px">`).join('')}<col style="width:46px"></colgroup>`;
  const addCol = vw.addingCol
    ? `<th class="th-add" style="text-align:left"><form class="colnew" id="colnew"><input id="cn-name" placeholder="Column" autocomplete="off"><select id="cn-type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="add-btn" type="submit">Add</button></form></th>`
    : `<th class="th-add"><button data-add-col title="Add column">+</button></th>`;
  const sortOf = (id) => vw.sort && vw.sort.colId === id ? vw.sort.dir : null;
  const head = c.map((col) => { const sd = sortOf(col.id); return `<th><div class="thh"><input value="${esc(col.name)}" data-colname="${col.id}"><button class="th-sort ${sd ? 'on' : ''}" data-sort-col="${col.id}" title="Sort by ${esc(col.name)}">${sd === 'asc' ? '↑' : sd === 'desc' ? '↓' : '↕'}</button><button class="x" data-del-col="${col.id}">×</button></div><span class="resizer" data-resize="${col.id}"></span></th>`; }).join('');
  const body = sortRows(state.tables_rows).map((r) => `<tr><td class="row-open" data-open-row="${r.id}" title="Open this row"><span class="ro-ic">⤢</span></td>${c.map((col) => `<td class="${col.type === 'checkbox' ? 'check' : col.type === 'number' ? 'num' : ''}">${cellInput(r, col)}</td>`).join('')}<td class="row-del"><button data-del-row="${r.id}">×</button></td></tr>`).join('');
  $('#pane').innerHTML = `
    <div class="tbl-head"><input class="rename" value="${esc(t.title || '')}" data-rename>
      ${areaSelect(t.props && t.props.area, 'data-table-area')}
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
async function newArea() {
  const name = (prompt('New life area name:') || '').trim(); if (!name) return;
  // Spread hues by the golden angle so a new area reads distinct from its neighbours.
  const hue = Math.round((state.areas.length * 137.5) % 360);
  const a = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'area', title: name, props: { hue } }) });
  state.areas.push(a); state.areas.sort((x, y) => (x.title || '').localeCompare(y.title || ''));
  openAreasList();
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
  { kind: 'action', title: 'Go to Calendar', run: () => openCalendar() },
  { kind: 'action', title: 'Go to Mail', run: () => openMail() },
];
let palT;
function buildPalette() {
  const q = state.pal.q.trim();
  if (!q) {
    state.pal.items = [...ACTIONS,
      ...state.noteTops.slice(0, 5).map((n) => ({ kind: 'note', id: n.id, title: n.title || 'Untitled' })),
      ...state.tables.slice(0, 5).map((t) => ({ kind: 'table', id: t.id, title: t.title || 'Untitled' })),
      ...state.areas.slice(0, 6).map((a) => ({ kind: 'area', id: a.id, title: a.title || 'Untitled' }))];
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
  if (it.kind === 'area') return openArea(it.id).catch((e) => toast(e.message));
  if (it.kind === 'task') return openTaskCard(it.id).catch((e) => toast(e.message));
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
  if (e.target.dataset && e.target.dataset.prose) { clearTimeout(proseT); proseT = setTimeout(() => saveProse(e.target.dataset.prose, e.target.innerHTML), 800); }
});
let proseT;
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-pal-bg]') === t.closest('.pal-bg') && t.closest('[data-pal-bg]') && !t.closest('.pal')) { closePalette(); return; }
  const pi = t.closest('[data-pal-i]'); if (pi) { execItem(state.pal.items[+pi.dataset.palI]); return; }
  if (t.closest('[data-palette]')) { openPalette(); return; }
  if (t.closest('[data-theme-toggle]')) { const d = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = d ? 'dark' : 'light'; localStorage.setItem('today.theme', d ? 'dark' : 'light'); renderNav(); return; }
  const st = t.closest('[data-sec-toggle]'); if (st && !t.closest('.nav-add')) { toggleSec(st.dataset.secToggle); return; }

  const on = t.closest('[data-open-note]'); if (on) { openNote(on.dataset.openNote).catch((x) => toast(x.message)); return; }
  const ot = t.closest('[data-open-table]'); if (ot) { openTable(ot.dataset.openTable).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-view-home]')) { openHome().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-tables]')) { openTablesList(); return; }
  if (t.closest('[data-open-notes]')) { openNotesList(); return; }
  if (t.closest('[data-open-areas]')) { openAreasList(); return; }
  const oa = t.closest('[data-open-area]'); if (oa) { openArea(oa.dataset.openArea).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-view-tasks]')) { openTasks().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-calendar]')) { openCalendar().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-mail]')) { openMail().catch((x) => toast(x.message)); return; }
  // mail interactions
  const macc = t.closest('[data-mail-acct]'); if (macc) { state.mail.account = macc.dataset.mailAcct; loadMessages(); return; }
  const mo = t.closest('[data-mail-open]'); if (mo) { openMessage(Number(mo.dataset.mailOpen)); return; }
  if (t.closest('[data-mail-back]')) { state.mail.open = null; renderMail(); return; }
  if (t.closest('[data-mail-compose]')) { state.mail.composing = {}; renderMail(); return; }
  if (t.closest('[data-mail-cancel]')) { state.mail.composing = false; renderMail(); return; }
  if (t.closest('[data-mail-reply]')) { mailReplyStart(); return; }
  const mdl = t.closest('[data-mail-del]'); if (mdl) { mailDelete(Number(mdl.dataset.mailDel)); return; }
  if (t.closest('[data-mail-accounts]')) { openMailAccounts().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-mail-add-acct]')) { showMailAccountForm(); return; }
  const mda = t.closest('[data-mail-del-acct]'); if (mda) { delMailAccount(mda.dataset.mailDelAcct); return; }
  // calendar interactions
  // A chip sits inside a day cell, so match the event before the day.
  const cev = t.closest('[data-cal-ev]'); if (cev) { const e = state.cal.events.find((x) => x.id === cev.dataset.calEv); if (e) { state.cal.selected = e.date; state.cal.editing = e; state.cal.adding = false; renderCalendar(); } return; }
  const cday = t.closest('[data-cal-day]'); if (cday) { state.cal.selected = cday.dataset.calDay; state.cal.adding = false; state.cal.editing = null; renderCalendar(); return; }
  if (t.closest('[data-cal-add]')) { state.cal.adding = true; state.cal.editing = null; renderCalendar(); return; }
  if (t.closest('[data-cal-del]')) { const f = $('#cal-ev-form'); if (f && f.dataset.ev) calDeleteEvent(f.dataset.ev); return; }
  if (t.closest('[data-cal-today]')) { state.cal.selected = todayISO(); const d = new Date(); state.cal.y = d.getFullYear(); state.cal.m = d.getMonth(); state.cal.adding = false; state.cal.editing = null; renderCalendar(); loadCalendar(); return; }
  if (t.closest('[data-cal-prev]')) { stepMonth(-1); return; }
  if (t.closest('[data-cal-next]')) { stepMonth(1); return; }
  const fo = t.closest('[data-fav-open]'); if (fo) { openFav(fo.dataset.favOpen).catch((x) => toast(x.message)); return; }
  const fv = t.closest('[data-fav]'); if (fv) { toggleFav(fv.dataset.fav); return; }
  const uf = t.closest('[data-unfav]'); if (uf) { unfav(uf.dataset.unfav); return; }
  if (t.closest('[data-quick-task]')) { showQuickTask(); return; }
  if (t.closest('[data-quick-event]')) { showQuickEvent(); return; }
  if (t.closest('[data-new-note]')) { newNote(null).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-table]')) { newTable().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-area]')) { newArea().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-sub]')) { newNote(state.note.current.id).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-note]')) { delNote(); return; }

  // tasks
  const sh = t.closest('[data-sort]');
  if (sh) { const c = sh.dataset.sort; if (state.taskSort.col === c) state.taskSort.dir = state.taskSort.dir === 'asc' ? 'desc' : 'asc'; else state.taskSort = { col: c, dir: c === 'created' ? 'desc' : 'asc' }; renderTasks(); return; }
  const fc = t.closest('[data-filter]'); if (fc) { state.taskFilter = fc.dataset.filter || null; renderTasks(); return; }
  const ck = t.closest('[data-check]'); if (ck) { toggleTask(ck.dataset.check); return; }
  const dt = t.closest('[data-del-task]'); if (dt) { delTask(dt.dataset.delTask); return; }
  const et = t.closest('[data-edit-task]'); if (et) { editTaskTitle(et); return; }
  const ep = t.closest('[data-edit-prio]'); if (ep) { editPrio(ep); return; }
  const ea = t.closest('[data-edit-area]'); if (ea) { editArea(ea); return; }
  const ota = t.closest('[data-open-task]'); if (ota) { openTaskCard(ota.dataset.openTask).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-task-cur]')) { delTaskCard().catch((x) => toast(x.message)); return; }

  // table
  if (t.closest('[data-back-table]')) { state.tables_view.openRow = null; renderTable(); return; }
  const or = t.closest('[data-open-row]'); if (or) { state.tables_view.openRow = or.dataset.openRow; renderTable(); window.scrollTo(0, 0); return; }
  const sc = t.closest('[data-sort-col]');
  if (sc) { const id = sc.dataset.sortCol; const s = state.tables_view.sort; state.tables_view.sort = s && s.colId === id ? { colId: id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { colId: id, dir: 'asc' }; renderTable(); return; }
  if (t.closest('[data-add-col]')) { state.tables_view.addingCol = true; renderTable(); return; }
  const dcol = t.closest('[data-del-col]'); if (dcol) { if (confirm('Delete this column?')) saveTableColumns(tcols().filter((c) => c.id !== dcol.dataset.delCol)).then(renderTable).catch((x) => toast(x.message)); return; }
  const drow = t.closest('[data-del-row]'); if (drow) { const id = drow.dataset.delRow; state.tables_rows = state.tables_rows.filter((r) => r.id !== id); renderTable(); api(`/api/blocks/${id}`, { method: 'DELETE' }).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-add-row]')) { addRow(); return; }
  if (t.closest('[data-del-cur]')) { delTable(); return; }
});
// change: cells + selects
document.addEventListener('change', (e) => {
  const c = e.target.closest('[data-cell]'); if (c) { const [rid, cid] = c.dataset.cell.split(':'); setCell(rid, cid, e.target.type === 'checkbox' ? e.target.checked : e.target.value); }
  if (e.target.matches('[data-note-area]')) setBlockArea('note', state.note.current.id, e.target.value);
  if (e.target.matches('[data-table-area]')) setBlockArea('table', state.tables_open.id, e.target.value);
  if (e.target.matches('[data-task-filter]')) { state.taskFilter = e.target.value || null; renderTasks(); }
  if (e.target.matches('[data-prio-task]')) patchTaskProps(e.target.dataset.prioTask, { priority: e.target.value || null });
  if (e.target.matches('[data-area-task]')) patchTaskProps(e.target.dataset.areaTask, { area: e.target.value || null });
});
// blur saves for titles/bodies
document.addEventListener('blur', (e) => {
  if (e.target.id === 'note-title') saveNoteTitle(e.target.value.trim());
  if (e.target.id === 'taskcard-title') patchTaskTitle(state.task_open.task.id, e.target.value.trim());
  if (e.target.dataset && e.target.dataset.prose) saveProse(e.target.dataset.prose, e.target.innerHTML);
  if (e.target.dataset && e.target.dataset.rename !== undefined) renameTable(e.target.value.trim());
  const cn = e.target.dataset && e.target.dataset.colname; if (cn !== undefined && cn) renameColumn(cn, e.target.value.trim());
}, true);
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'note-title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'task-form') { const i = $('#task-title'); const v = i.value.trim(); if (v) addTask(v, $('#task-area').value, $('#task-prio').value); i.value = ''; i.focus(); }
  if (e.target.id === 'qt-form') { const i = $('#qt-title'); const v = i.value.trim(); if (v) { homeAddTask(v, $('#qt-area').value, $('#qt-prio').value); i.value = ''; i.focus(); } }
  if (e.target.id === 'qe-form') { const v = $('#qe-title').value.trim(); if (v) homeAddEvent(v, $('#qe-date').value, $('#qe-time').value, $('#qe-dur').value, $('#qe-loc').value.trim()); }
  if (e.target.id === 'cal-ev-form') { const v = $('#ce-title').value.trim(); if (v) calSaveEvent(e.target.dataset.ev || null, v, $('#ce-time').value, $('#ce-dur').value, $('#ce-loc').value.trim()); }
  if (e.target.id === 'mail-setup-form') { const u = $('#mail-api').value.trim(); if (u) { localStorage.setItem('life.mailApi', u); openMail().catch((x) => toast(x.message)); } }
  if (e.target.id === 'mail-acct-form-el') { addMailAccount({ email: $('#ma-email').value.trim(), imapHost: $('#ma-imaphost').value.trim(), imapPort: $('#ma-imapport').value.trim(), smtpHost: $('#ma-smtphost').value.trim(), smtpPort: $('#ma-smtpport').value.trim(), user: $('#ma-user').value.trim(), pass: $('#ma-pass').value }); }
  if (e.target.id === 'mail-compose-form') { const to = $('#mc-to').value.trim(); if (to) mailSend(to, $('#mc-subject').value.trim(), $('#mc-body').value, state.mail.composing && state.mail.composing.inReplyTo); }
  if (e.target.id === 'colnew') { const name = $('#cn-name').value.trim(); const type = $('#cn-type').value; addColumn(name, type); }
});
// drag to reorder favourites on the home, and to reorder the sidebar sections
let dragFav = null, dragSec = null;
document.addEventListener('dragstart', (e) => {
  const f = e.target.closest('[data-fav-id]'); if (f) { dragFav = f.dataset.favId; e.dataTransfer.effectAllowed = 'move'; return; }
  const s = e.target.closest('.nav-sec-h'); if (s) { dragSec = s.closest('[data-nav-sec]').dataset.navSec; e.dataTransfer.effectAllowed = 'move'; }
});
document.addEventListener('dragover', (e) => {
  if (dragFav && e.target.closest('#favs')) e.preventDefault();
  if (dragSec && e.target.closest('#nav-secs')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (dragFav) {
    e.preventDefault(); const over = e.target.closest('[data-fav-id]');
    reorderFavs(dragFav, over && over.dataset.favId !== dragFav ? over.dataset.favId : null); dragFav = null; return;
  }
  if (dragSec) {
    e.preventDefault(); const over = e.target.closest('[data-nav-sec]');
    reorderSecs(dragSec, over && over.dataset.navSec !== dragSec ? over.dataset.navSec : null); dragSec = null;
  }
});
document.addEventListener('dragend', () => { dragFav = null; dragSec = null; });

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
// A task can be held in more than one place at once - the Tasks list, an open
// area page, the task focus view, the favourites - each a separate object.
// Gather every copy so a change updates the one on screen, not just one of them.
function taskCopies(id) {
  const out = [state.tasks, state.area_open && state.area_open.blocks, state.favs]
    .filter(Boolean).flatMap((arr) => arr.filter((b) => b.id === id));
  if (state.task_open && state.task_open.task.id === id) out.push(state.task_open.task);
  return out;
}
async function patchTaskProps(id, patch) {
  const copies = taskCopies(id); if (!copies.length) return;
  const prev = copies.map((b) => ({ ...b.props }));
  copies.forEach((b) => Object.assign(b.props, patch)); rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: patch }) }); }
  catch (e) { copies.forEach((b, i) => (b.props = prev[i])); rerenderCurrent(); toast(e.message); }
}
async function patchTaskTitle(id, title) {
  const copies = taskCopies(id); if (!copies.length || !title) return;
  copies.forEach((b) => (b.title = title)); rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); } catch (e) { toast(e.message); }
}
function toggleTask(id) { const t = taskCopies(id)[0]; if (t) patchTaskProps(id, { done: !t.props.done }); }
async function delTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (state.area_open) state.area_open.blocks = state.area_open.blocks.filter((t) => t.id !== id);
  rerenderCurrent(); try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); }
}
function editTaskTitle(span) {
  const id = span.dataset.editTask; const t = taskCopies(id)[0]; if (!t) return;
  const input = document.createElement('input'); input.value = t.title; input.className = 'cell'; input.style.cssText = 'flex:1;width:100%;font:inherit;font-size:17px;border:1px solid var(--accent);border-radius:6px;padding:2px 6px;background:var(--card)';
  span.replaceWith(input); input.focus(); input.select(); let d = false;
  const save = () => { if (d) return; d = true; const v = input.value.trim(); if (v && v !== t.title) patchTaskTitle(id, v); else renderTasks(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { d = true; renderTasks(); } });
  input.addEventListener('blur', save);
}
// Inline edit of a constrained field (priority / area): the span becomes a
// select in place, commits on change, and cancels on blur-without-change.
function editInlineSelect(span, cur, options, onPick) {
  const sel = document.createElement('select'); sel.className = 'ie-sel';
  sel.innerHTML = options.map((o) => `<option value="${esc(o.value)}" ${o.value === (cur || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  span.replaceWith(sel); sel.focus(); let d = false;
  sel.addEventListener('change', () => { if (d) return; d = true; onPick(sel.value || null); });
  sel.addEventListener('blur', () => { if (!d) { d = true; renderTasks(); } });
}
function editPrio(span) {
  const id = span.dataset.editPrio; const t = taskCopies(id)[0]; if (!t) return;
  editInlineSelect(span, t.props.priority, [{ value: '', label: '—' }, ...['P1', 'P2', 'P3', 'P4'].map((p) => ({ value: p, label: p }))], (v) => patchTaskProps(id, { priority: v }));
}
function editArea(span) {
  const id = span.dataset.editArea; const t = taskCopies(id)[0]; if (!t) return;
  editInlineSelect(span, t.props.area, [{ value: '', label: 'No area' }, ...state.areas.map((a) => ({ value: a.id, label: a.title }))], (v) => patchTaskProps(id, { area: v }));
}

// ── view: task focus (open card) ─────────────────────
async function openTaskCard(id) {
  const task = await api(`/api/blocks/${id}`);
  state.task_open = { task };
  state.view = { type: 'taskcard', id };
  renderNav(); renderTaskCard();
}
function renderTaskCard() {
  const t = state.task_open.task; const a = areaById(t.props.area); const p = t.props.priority;
  $('#pane').innerHTML = `
    <div class="note-crumbs"><button class="crumb" data-view-home>Home</button><span class="crumb-sep">/</span><button class="crumb" data-view-tasks>Tasks</button><span class="crumb-sep">/</span><span class="crumb cur">${esc(t.title || 'Untitled')}</span>
      <span class="crumb-tools"><button class="star ${t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props.fav ? '★' : '☆'}</button>
      <button class="note-del ghost" data-del-task-cur title="Delete this task">Delete</button></span></div>
    <div class="task-focus">
      <button class="tf-check ${t.props.done ? 'done' : ''}" data-check="${t.id}" title="${t.props.done ? 'Done' : 'Mark done'}">✓</button>
      <input class="note-title ${t.props.done ? 'struck' : ''}" id="taskcard-title" value="${esc(t.title || '')}" placeholder="Untitled task">
    </div>
    <div class="tf-meta">
      <label class="tf-field"><span class="tf-label">Priority</span>
        <select class="sel" data-prio-task="${t.id}"><option value="">—</option>${['P1', 'P2', 'P3', 'P4'].map((x) => `<option ${p === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="tf-field"><span class="tf-label">Life area</span>
        <select class="sel" data-area-task="${t.id}"><option value="">No area</option>${state.areas.map((x) => `<option value="${x.id}" ${t.props.area === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
    </div>
    ${notesSection(t.body, 'task')}`;
}

// A prose Notes section, reused by the task card and the row card. Backed by
// the block's `body`, edited inline via the shared rich-text editor.
function notesSection(body, key) {
  return `<section class="focus-notes"><div class="fn-h">Notes</div>${proseEditor(body, key)}</section>`;
}
// Save a rich-text region back to whichever block it belongs to.
async function saveProse(key, rawHtml) {
  const html = sanitizeProse(rawHtml);
  let id;
  if (key === 'note') { const n = state.note && state.note.current; if (!n) return; n.body = html; id = n.id; }
  else if (key === 'task') { const t = state.task_open && state.task_open.task; if (!t) return; t.body = html; id = t.id; }
  else if (key === 'row') { const r = state.tables_rows && state.tables_rows.find((x) => x.id === (state.tables_view && state.tables_view.openRow)); if (!r) return; r.body = html; id = r.id; }
  if (!id) return;
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ body: html }) }); } catch (e) { toast(e.message); }
}
async function delTaskCard() {
  const t = state.task_open.task; if (!confirm(`Delete “${t.title || 'Untitled'}”?`)) return;
  await delTask(t.id); await openTasks();
}
async function saveNoteTitle(v) {
  const n = state.note.current; if (!n || v === n.title) return; n.title = v;
  const top = state.noteTops.find((t) => t.id === n.id); if (top) top.title = v;
  const cr = $('.note-crumbs .crumb.cur'); if (cr) cr.textContent = v || 'Untitled';
  try { await api(`/api/blocks/${n.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); }
}
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

// ── inline formatting bubble ─────────────────────────
// A small toolbar that floats above a text selection inside any .prose editor.
// execCommand is deprecated but universally supported and exactly right for a
// one-person app - no library, formats in place, saves clean HTML.
function ensureBubble() {
  let b = document.getElementById('bubble'); if (b) return b;
  b = document.createElement('div'); b.id = 'bubble'; b.className = 'bubble'; b.hidden = true;
  b.innerHTML = `<button data-fmt="bold" title="Bold  ⌘B"><b>B</b></button>
    <button data-fmt="italic" title="Italic  ⌘I"><i>I</i></button>
    <span class="bub-sep"></span>
    <button data-fmt="h2" title="Heading">H</button>
    <button data-fmt="quote" title="Quote">&#10077;</button>
    <button data-fmt="link" title="Add link">&#8599;</button>`;
  document.body.appendChild(b); return b;
}
function activeProse() {
  const sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer; n = n.nodeType === 1 ? n : n.parentElement;
  return n && n.closest ? n.closest('.prose') : null;
}
function currentBlockTag() {
  const sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer; n = n.nodeType === 1 ? n : n.parentElement;
  const bl = n && n.closest && n.closest('h1,h2,h3,blockquote,p');
  return bl ? bl.tagName : null;
}
function positionBubble() {
  const b = ensureBubble(); const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed || !activeProse()) { b.hidden = true; return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) { b.hidden = true; return; }
  b.hidden = false;
  b.style.top = `${window.scrollY + rect.top - b.offsetHeight - 9}px`;
  b.style.left = `${Math.max(8, window.scrollX + rect.left + rect.width / 2 - b.offsetWidth / 2)}px`;
}
function applyFmt(cmd) {
  const prose = activeProse(); if (!prose) return; prose.focus();
  if (cmd === 'bold') document.execCommand('bold');
  else if (cmd === 'italic') document.execCommand('italic');
  else if (cmd === 'h2') document.execCommand('formatBlock', false, currentBlockTag() === 'H2' ? '<p>' : '<h2>');
  else if (cmd === 'quote') document.execCommand('formatBlock', false, currentBlockTag() === 'BLOCKQUOTE' ? '<p>' : '<blockquote>');
  else if (cmd === 'link') { const url = prompt('Link to (URL):'); if (url) document.execCommand('createLink', false, url.trim()); }
  positionBubble();
  saveProse(prose.dataset.prose, prose.innerHTML);
}
document.addEventListener('selectionchange', positionBubble);
document.addEventListener('mousedown', (e) => {
  const fb = e.target.closest && e.target.closest('#bubble [data-fmt]');
  if (fb) { e.preventDefault(); applyFmt(fb.dataset.fmt); }
});

// ── sign-in gate (self-contained; life.robski.uk is its own origin) ──
let gateStep = 'email', gateEmail = '';
function showGate(sub) {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="gate2" id="gate2"><form class="gate2-card" id="gate-form">
      <div class="gate2-mark"><em>Life</em><span class="dot">·</span>Robski</div>
      <p class="gate2-sub" id="gate-sub">${sub || 'Sign in with your email to continue.'}</p>
      <input class="gate2-input" id="gate-email" type="email" placeholder="you@example.com" autocomplete="email" required>
      <input class="gate2-input gate2-code" id="gate-code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" hidden>
      <button class="gate2-btn" id="gate-btn" type="submit">Send code</button>
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
    [state.noteTops, state.tables, state.areas, state.favs] = await Promise.all([
      api('/api/blocks?kind=note&parent_id='), api('/api/blocks?kind=table'), api('/api/blocks?kind=area'),
      api('/api/favorites').catch(() => []),
    ]);
    state.tables.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    state.areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    // Deep link: a home-screen icon pinned to /calendar opens straight there.
    const route = location.pathname.replace(/\/$/, '');
    if (route === '/calendar') await openCalendar();
    else if (route === '/mail') await openMail();
    else await openHome();
  } catch (e) { toast(e.message); renderNav(); }
})();
