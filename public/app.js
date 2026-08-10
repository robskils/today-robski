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
  areas: [], tasks: [], taskFilter: null, taskAdding: false, showCompleted: false, completedQuery: '',
  // Phones default to priority order (P1 first); desktop to most-recently added.
  taskSort: (typeof window !== 'undefined' && window.innerWidth <= 820) ? { col: 'priority', dir: 'asc' } : { col: 'created', dir: 'desc' },
  note: null, tables_open: null,
  favs: [], home: { events: [] }, cal: null, mail: null,
  tabs: [], activeTab: null,
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
// Turn any bare http(s) URL into a clickable link, without touching URLs that
// are already inside an <a> (or a <code> span). Works on rendered HTML.
const BARE_URL = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/gi;
function linkifyHtml(html) {
  if (!html || !/https?:\/\//i.test(html)) return html || '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach((c) => {
      if (c.nodeType === 1) { const tn = c.tagName; if (tn !== 'A' && tn !== 'CODE') walk(c); return; }
      if (c.nodeType !== 3 || !/https?:\/\//i.test(c.nodeValue)) return;
      const text = c.nodeValue; const frag = doc.createDocumentFragment(); let last = 0; let m;
      BARE_URL.lastIndex = 0;
      while ((m = BARE_URL.exec(text))) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        const a = doc.createElement('a');
        a.setAttribute('href', m[0]); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
        a.textContent = m[0]; frag.appendChild(a); last = m.index + m[0].length;
      }
      if (!frag.childNodes.length) return;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      c.replaceWith(frag);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
// Existing notes were imported as Markdown; new ones are saved as clean HTML.
// Render either: if it already looks like HTML, trust it; else convert once.
function bodyToHtml(body) {
  const s = (body || '').trim();
  if (!s) return '';
  // Only the rich editor's own output (block-wrapped) is treated as HTML.
  // Imported bodies are Markdown that may contain an inline <a>, so keying on
  // block tags avoids mis-rendering a whole note as raw HTML.
  const html = /<(p|h[1-3]|blockquote|div|ul|ol)[\s>]/i.test(s) ? s : mdToHtml(body);
  return linkifyHtml(html);
}
// An always-on inline editor. No modes, no markup - you just write, and the
// selection bubble (or ⌘B/⌘I) formats in place. `key` says which block it saves.
function proseEditor(body, key) {
  return `<div class="prose" contenteditable="true" spellcheck="true" data-prose="${key}" data-ph="Write something here…">${bodyToHtml(body)}</div>`;
}
// Keep saved HTML clean: a small whitelist, unwrap everything else, drop all
// attributes but a link's href. Content is Robin's own, so this is about
// tidiness (stray pasted styles) more than security.
const PROSE_OK = { P: 1, H1: 1, H2: 1, H3: 1, STRONG: 1, EM: 1, A: 1, BLOCKQUOTE: 1, BR: 1, CODE: 1, UL: 1, OL: 1, LI: 1 };
function sanitizeProse(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1) { c.remove(); return; }
      walk(c);
      let tag = c.tagName;
      if (tag === 'B') tag = 'STRONG'; else if (tag === 'I') tag = 'EM';
      else if (tag === 'DIV') tag = 'P';
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

// ── tabs ─────────────────────────────────────────────
// A tab is a saved destination (view + label), not a whole live instance.
// Switching re-opens that view; the active tab tracks wherever you navigate.
const TAB_IC = { home: '⌂', tasks: '✓', taskcard: '✓', calendar: '◑', mail: '✉', today: '☀', note: '▤', notes: '▤', table: '▦', tables: '▦', area: '◈', areas: '◈' };
function labelForView(v) {
  switch (v.type) {
    case 'tasks': return 'Tasks';
    case 'taskcard': return (state.task_open && state.task_open.task.title) || 'Task';
    case 'calendar': return 'Calendar'; case 'mail': return 'Mail'; case 'today': return 'Today';
    case 'note': return (state.note && state.note.current.title) || 'Note'; case 'notes': return 'Notes';
    case 'table': return (state.tables_open && state.tables_open.title) || 'Table'; case 'tables': return 'Tables';
    case 'area': return (state.area_open && state.area_open.area.title) || 'Area'; case 'areas': return 'Life areas';
    default: return 'Home';
  }
}
function openView(v) {
  switch (v.type) {
    case 'tasks': return openTasks(); case 'taskcard': return openTaskCard(v.id);
    case 'calendar': return openCalendar(); case 'mail': return openMail(); case 'today': return openToday();
    case 'note': return openNote(v.id); case 'notes': return openNotesList();
    case 'table': return openTable(v.id); case 'tables': return openTablesList();
    case 'area': return openArea(v.id); case 'areas': return openAreasList();
    default: return openHome();
  }
}
function saveTabs() { try { localStorage.setItem('life.tabs', JSON.stringify({ tabs: state.tabs.map((t) => ({ view: t.view, label: t.label })), active: state.tabs.findIndex((t) => t.id === state.activeTab) })); } catch {} }
function syncActiveTab() {
  const tab = state.tabs.find((t) => t.id === state.activeTab); if (!tab) return;
  tab.view = { ...state.view }; tab.label = labelForView(state.view); saveTabs();
}
function renderTabs() {
  const el = $('#tabstrip'); if (!el) return;
  el.innerHTML = state.tabs.map((t) => `<button class="tab ${t.id === state.activeTab ? 'on' : ''}" data-tab="${t.id}">
    <span class="tab-ic">${TAB_IC[t.view.type] || '•'}</span><span class="tab-t">${esc(t.label || 'Tab')}</span>${state.tabs.length > 1 ? `<span class="tab-x" data-tab-close="${t.id}" title="Close">×</span>` : ''}</button>`).join('')
    + `<button class="tab-new" data-tab-new title="New tab  ⌥⌘T">+</button>`;
}
function newTab() { const id = uid(); state.tabs.push({ id, view: { type: 'home' }, label: 'Home' }); state.activeTab = id; openHome(); }
function switchTab(id) { if (id === state.activeTab) return; const tab = state.tabs.find((t) => t.id === id); if (!tab) return; state.activeTab = id; Promise.resolve(openView(tab.view)).catch(() => openHome()); }
function closeTab(id) {
  if (state.tabs.length <= 1) return;
  const i = state.tabs.findIndex((t) => t.id === id); if (i < 0) return;
  const wasActive = state.activeTab === id; state.tabs.splice(i, 1);
  if (wasActive) { const next = state.tabs[Math.min(i, state.tabs.length - 1)]; state.activeTab = next.id; Promise.resolve(openView(next.view)).catch(() => openHome()); }
  else { renderTabs(); saveTabs(); }
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
// ── theme: automatic by local sunrise/sunset, overridable by the button ──
// Mode lives in life.theme.mode ('auto'|'light'|'dark'); the resolved light/dark
// is mirrored to today.theme so the first-paint inline script and the embedded
// Today planner match.
function themeMode() { const m = localStorage.getItem('life.theme.mode'); return m === 'light' || m === 'dark' ? m : 'auto'; }
function themeLabel() { const m = themeMode(); return m === 'light' ? '☀ Day' : m === 'dark' ? '☾ Night' : `${autoIsDark() ? '☾' : '☀'} Auto`; }
let themeTimer;
function applyTheme(rerender) {
  const m = themeMode();
  const dark = m === 'dark' ? true : m === 'light' ? false : autoIsDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('today.theme', dark ? 'dark' : 'light'); } catch {}
  if (rerender) { renderNav(); if (state.view && state.view.type === 'today') renderToday(); }
  else { const b = document.querySelector('[data-theme-toggle]'); if (b) b.textContent = themeLabel(); }
  clearTimeout(themeTimer);
  // In auto mode, re-check every few minutes so it flips at sunrise/sunset.
  if (m === 'auto') themeTimer = setTimeout(() => applyTheme(false), 5 * 60 * 1000);
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(themeMode()) + 1) % 3];
  try { localStorage.setItem('life.theme.mode', next); } catch {}
  applyTheme(true);
  if (next === 'auto') ensureLoc();
}
function initTheme() { applyTheme(false); if (themeMode() === 'auto') ensureLoc(); }
function cachedLoc() { try { const l = JSON.parse(localStorage.getItem('life.loc')); return l && Number.isFinite(l.lat) ? l : null; } catch { return null; } }
function ensureLoc() {
  if (cachedLoc() || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => { try { localStorage.setItem('life.loc', JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude })); } catch {} applyTheme(false); },
    () => {}, { maximumAge: 6 * 3600 * 1000, timeout: 8000 });
}
function autoIsDark() {
  const loc = cachedLoc();
  if (!loc) return matchMedia('(prefers-color-scheme: dark)').matches;   // until we know where you are
  const now = new Date();
  const s = sunTimes(now, loc.lat, loc.lng);
  if (!s.sunrise || !s.sunset) return matchMedia('(prefers-color-scheme: dark)').matches;  // polar day/night
  const t = now.getTime();
  return t < s.sunrise.getTime() || t >= s.sunset.getTime();
}
// Sunrise/sunset for a date + lat/lng (standard sunrise-equation), returning UTC
// Date objects. Good to ~a minute, which is plenty for a theme switch.
function sunTimes(date, lat, lng) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const y = date.getUTCFullYear(), mo = date.getUTCMonth(), d = date.getUTCDate();
  const day = Math.floor((Date.UTC(y, mo, d) - Date.UTC(y, 0, 0)) / 86400000);
  const zenith = 90.833 * rad, lngHour = lng / 15;
  const calc = (rise) => {
    const t = day + ((rise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634; L = ((L % 360) + 360) % 360;
    let RA = deg * Math.atan(0.91764 * Math.tan(L * rad)); RA = ((RA % 360) + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90; RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(zenith) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    let H = rise ? 360 - deg * Math.acos(cosH) : deg * Math.acos(cosH); H /= 15;
    let UT = H + RA - 0.06571 * t - 6.622 - lngHour; UT = ((UT % 24) + 24) % 24;
    return UT;
  };
  const mk = (ut) => (ut == null ? null : new Date(Date.UTC(y, mo, d) + ut * 3600000));
  return { sunrise: mk(calc(true)), sunset: mk(calc(false)) };
}

function renderNav() {
  const v = state.view;
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#nav').innerHTML = `
    <div class="nav-brand" data-view-home title="Home"><em>Life</em><span class="dot">·</span>Robski</div>
    <div class="nav-foot">
      <button class="foot-search" data-palette title="Search">⌕</button>
    </div>
    <button class="nav-k" data-palette><span>Search or jump…</span><kbd>⌘K</kbd></button>
    <button class="nav-item ${v.type === 'home' ? 'on' : ''}" data-view-home><span>⌂</span> Home</button>
    <button class="nav-item ${v.type === 'today' ? 'on' : ''}" data-open-today><span>☀</span> Today</button>
    <button class="nav-item ${v.type === 'tasks' || v.type === 'taskcard' ? 'on' : ''}" data-view-tasks><span>✓</span> Tasks</button>
    <button class="nav-item ${v.type === 'calendar' ? 'on' : ''}" data-open-calendar><span>◑</span> Calendar</button>
    <button class="nav-item ${v.type === 'mail' ? 'on' : ''}" data-open-mail><span>✉</span> Mail</button>
    <button class="nav-item ${v.type === 'notes' ? 'on' : ''}" data-open-notes><span>▤</span> Notes</button>
    <button class="nav-item ${v.type === 'tables' ? 'on' : ''}" data-open-tables><span>▦</span> Tables</button>
    <button class="nav-item ${v.type === 'areas' || v.type === 'area' ? 'on' : ''}" data-open-areas><span>◈</span> Life areas</button>
    <div class="nav-secs" id="nav-secs">${state.nav.order.map((k) => navSection(k, v)).join('')}</div>
    <div class="nav-bottom">
      <button class="nav-theme" data-theme-toggle title="Theme — Auto follows local sunrise &amp; sunset; press to override">${themeLabel()}</button>
    </div>`;
  renderTabbar(v);
  syncActiveTab(); renderTabs();
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
    + tab(v.type === 'note' || v.type === 'notes', 'data-open-notes', '▤', 'Notes');
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
const KIND_IC = { note: '▤', table: '▦', task: '✓', row: '▦', area: '◈' };
const KIND_LABEL = { task: 'Tasks', note: 'Notes', table: 'Tables', area: 'Life areas' };

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
  // Compact cards, grouped by kind (Tasks, Notes, Tables, Life areas).
  const favGroups = ['task', 'note', 'table', 'area'].map((k) => {
    const list = favs.filter((f) => f.kind === k); if (!list.length) return '';
    return `<div class="fav-group"><div class="fav-group-h">${KIND_LABEL[k]}</div><div class="fav-cards">${list.map((f) => `<div class="fav-card"><button class="fav-card-open" data-fav-open="${f.kind}:${f.id}"><span class="fav-ic">${KIND_IC[f.kind] || '•'}</span><span class="fav-t">${esc(f.title || 'Untitled')}</span></button><button class="fav-x" data-unfav="${f.id}" title="Remove">×</button></div>`).join('')}</div></div>`;
  }).join('');
  const evRows = ev.map((e) => `<div class="ev-row"><span class="ev-time">${e.allDay ? 'all day' : hhmm(e.start_min)}</span><span class="ev-t">${esc(e.title)}</span>${e.location ? `<span class="ev-loc">${esc(e.location)}</span>` : ''}</div>`).join('');
  $('#pane').innerHTML = `
    <div class="home">
      <div class="home-head">
        <h1>${greeting()}, <span class="hi-name">Robski</span></h1>
        <div class="home-actions"><button class="add-btn wide" data-new-note>+ Note</button><button class="add-btn wide" data-quick-task>+ Task</button><button class="add-btn wide" data-quick-event>+ Event</button></div>
      </div>
      <div id="qt-wrap"></div>
      <nav class="home-nav">
        <button class="hn-btn" data-open-today><span class="hn-ic">☀</span>Today</button>
        <button class="hn-btn" data-view-tasks><span class="hn-ic">✓</span>Tasks</button>
        <button class="hn-btn" data-open-calendar><span class="hn-ic">◑</span>Calendar</button>
        <button class="hn-btn" data-open-mail><span class="hn-ic">✉</span>Mail</button>
        <span class="hn-group"><button class="hn-btn" data-open-notes><span class="hn-ic">▤</span>Notes</button><button class="hn-plus" data-new-note title="New note">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-tables><span class="hn-ic">▦</span>Tables</button><button class="hn-plus" data-new-table title="New table">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-areas><span class="hn-ic">◈</span>Life areas</button><button class="hn-plus" data-new-area title="New life area">+</button></span>
      </nav>
      <section class="home-sec">
        <div class="home-sec-h">Today</div>
        <div class="today-cal">${evRows || '<div class="home-empty">Nothing in your calendar today.</div>'}</div>
      </section>
      <section class="home-sec">
        <div class="home-sec-h">Favourites</div>
        ${favs.length ? favGroups : '<div class="home-empty">Star a task, note, table or area (the ☆ on it) to pin it here.</div>'}
      </section>
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
    <div class="pane-head home-head"><h1>Life areas</h1><button class="add-btn wide" data-new-area>+ New area</button></div>
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
  const tblCards = tables.map((t) => `<button class="tbl-card" data-open-table="${t.id}"><span class="tc-ic">▦</span>${esc(t.title || 'Untitled')}</button>`).join('');
  const noteCards = notes.map((n) => `<button class="tbl-card" data-open-note="${n.id}"><span class="tc-ic">▤</span>${esc(n.title || 'Untitled')}</button>`).join('');
  const sec = (label, n, inner) => n ? `<section class="home-sec"><div class="home-sec-h">${label} · ${n}</div>${inner}</section>` : '';
  $('#pane').innerHTML = `
    <div class="area-hero" style="--h:${h}">
      <div class="area-hero-top"><button class="crumb" data-open-areas>Life areas</button>
        <button class="star ${area.props && area.props.fav ? 'on' : ''}" data-fav="${area.id}" title="Favourite">${area.props && area.props.fav ? '★' : '☆'}</button></div>
      <h1><span class="ac-dot"></span>${esc(area.title)}</h1>
      <p class="area-meta">${notes.length} note${notes.length === 1 ? '' : 's'} · ${tables.length} table${tables.length === 1 ? '' : 's'} · ${openTs.length} open task${openTs.length === 1 ? '' : 's'}</p>
    </div>
    ${sec('Notes', notes.length, `<div class="tbl-cards">${noteCards}</div>`)}
    ${sec('Tables', tables.length, `<div class="tbl-cards">${tblCards}</div>`)}
    ${sec('Tasks', openTs.length, taskTableHtml(openTs, 'No open tasks here.'))}
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
function weekDays(iso) {
  const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // Monday = 0
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(y, m - 1, d - dow + i); const di = ymd(x.getFullYear(), x.getMonth(), x.getDate()); return { iso: di, day: x.getDate(), mon: x.getMonth(), dow: WEEKDAYS[i], today: di === todayISO() }; });
}
async function openCalendar(dateStr) {
  const base = dateStr || (state.cal && state.cal.selected) || todayISO();
  const [y, m] = base.split('-').map(Number);
  state.cal = { y, m: m - 1, selected: base, mode: localStorage.getItem('life.calMode') === 'week' ? 'week' : 'month', events: [], error: null, editing: null, adding: false };
  state.view = { type: 'calendar' };
  renderNav(); renderCalendar();
  await loadCalendar();
}
async function loadCalendar() {
  let from, to;
  if (state.cal.mode === 'week') { const wk = weekDays(state.cal.selected); from = wk[0].iso; to = wk[6].iso; }
  else { const weeks = monthWeeks(state.cal.y, state.cal.m); from = weeks[0][0].iso; to = weeks[5][6].iso; }
  try {
    const r = await api(`/api/calendar?from=${from}&to=${to}`);
    state.cal.events = r.events || []; state.cal.error = r.error || null;
  } catch (e) { state.cal.error = e.message; }
  if (state.view.type === 'calendar') renderCalendar();
}
function setCalMode(mode) { state.cal.mode = mode; localStorage.setItem('life.calMode', mode); state.cal.adding = false; state.cal.editing = null; renderCalendar(); loadCalendar(); }
function stepCal(delta) {
  if (state.cal.mode === 'week') { state.cal.selected = addDayISO(state.cal.selected, delta * 7); const [y, m] = state.cal.selected.split('-').map(Number); state.cal.y = y; state.cal.m = m - 1; }
  else { let m = state.cal.m + delta, y = state.cal.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } state.cal.y = y; state.cal.m = m; }
  state.cal.adding = false; state.cal.editing = null; renderCalendar(); loadCalendar();
}
function renderCalendar() {
  const c = state.cal, byDay = eventsByDay();
  let title, body;
  if (c.mode === 'week') {
    const wk = weekDays(c.selected), a = wk[0], b = wk[6];
    title = `${a.day} ${MONTHS_LONG[a.mon].slice(0, 3)} – ${b.day} ${MONTHS_LONG[b.mon].slice(0, 3)}`;
    body = `<div class="cal-week">${wk.map((d) => {
      const evs = byDay[d.iso] || [];
      return `<div class="cw-day ${d.today ? 'today' : ''} ${d.iso === c.selected ? 'csel' : ''}" data-cal-day="${d.iso}">
        <div class="cw-head"><span class="cw-dow">${d.dow}</span><span class="cw-num">${d.day}</span></div>
        <div class="cw-evs">${evs.map((e) => `<button class="cw-ev ${e.allDay ? 'allday' : ''}" data-cal-ev="${e.id}">${e.allDay ? '' : `<b>${minToLabel(e.start_min)}</b> `}${esc(e.title)}</button>`).join('')}</div></div>`;
    }).join('')}</div>`;
  } else {
    title = `${MONTHS_LONG[c.m]} <span class="cal-yr">${c.y}</span>`;
    const cell = (d) => {
      const evs = byDay[d.iso] || [];
      const shown = evs.slice(0, 3).map((e) => `<span class="cal-chip ${e.allDay ? 'allday' : ''}" data-cal-ev="${e.id}" title="${esc(e.title)}">${e.allDay ? '' : `<b>${minToLabel(e.start_min)}</b> `}${esc(e.title)}</span>`).join('');
      const more = evs.length > 3 ? `<span class="cal-more">+${evs.length - 3}</span>` : '';
      const dots = evs.slice(0, 5).map((e) => `<span class="cal-dot ${e.allDay ? 'allday' : ''}"></span>`).join('');
      return `<div class="cal-cell ${d.inMonth ? '' : 'dim'} ${d.today ? 'today' : ''} ${d.iso === c.selected ? 'csel' : ''}" data-cal-day="${d.iso}">
        <div class="cal-daynum">${d.day}</div><div class="cal-evs">${shown}${more}</div><div class="cal-dots">${dots}</div></div>`;
    };
    body = `<div class="cal-grid">${WEEKDAYS.map((w) => `<div class="cal-dow">${w}</div>`).join('')}${monthWeeks(c.y, c.m).map((w) => w.map(cell).join('')).join('')}</div>`;
  }
  const dayEvents = (byDay[c.selected] || []);
  const agTime = (e) => e.allDay ? 'all day'
    : (e.end_min != null && e.end_min !== e.start_min ? `${minToLabel(e.start_min)}-${minToLabel(e.end_min)}` : minToLabel(e.start_min));
  const agendaRows = dayEvents.length ? dayEvents.map((e) => `<button class="cal-ag-row" data-cal-ev="${e.id}">
      <span class="cal-ag-time">${agTime(e)}</span>
      <span class="cal-ag-t">${esc(e.title)}</span>${e.location ? `<span class="cal-ag-loc">${esc(e.location)}</span>` : ''}</button>`).join('')
    : '<div class="home-empty">Nothing on this day.</div>';
  $('#pane').innerHTML = `
    <div class="cal-head">
      <h1>${title}</h1>
      <div class="cal-nav">
        <div class="cal-modes"><button class="cal-mode ${c.mode === 'month' ? 'on' : ''}" data-cal-mode="month">Month</button><button class="cal-mode ${c.mode === 'week' ? 'on' : ''}" data-cal-mode="week">Week</button></div>
        <button class="cal-btn" data-cal-today>Today</button>
        <button class="cal-btn ic" data-cal-prev title="Previous">‹</button>
        <button class="cal-btn ic" data-cal-next title="Next">›</button>
      </div>
    </div>
    ${c.error && c.error !== null ? `<div class="cal-warn">Calendar: ${esc(String(c.error))}</div>` : ''}
    <section class="cal-agenda cal-agenda-top">
      <div class="cal-ag-head"><h2>${prettyDate(c.selected)}</h2><button class="add-btn wide" data-cal-add>+ Event</button></div>
      <div id="cal-form"></div>
      <div class="cal-ag-list">${agendaRows}</div>
    </section>
    ${body}`;
  if (c.adding) showCalForm();
  else if (c.editing) showCalForm(c.editing);
}
function showCalForm(ev) {
  const c = state.cal;
  const title = ev ? ev.title : '';
  const allDay = ev ? !!ev.allDay : false;
  const time = ev && !ev.allDay ? minToLabel(ev.start_min) : '09:00';
  const dur = ev && !ev.allDay ? Math.max(15, (ev.end_min ?? ev.start_min + 60) - ev.start_min) : 60;
  const loc = ev ? (ev.location || '') : '';
  $('#cal-form').innerHTML = `<form id="cal-ev-form" class="add-task add-event" data-ev="${ev ? ev.id : ''}">
    <input id="ce-title" placeholder="Event title…" autocomplete="off" required value="${esc(title)}">
    <label class="ce-allday"><input type="checkbox" id="ce-allday" ${allDay ? 'checked' : ''}> All day</label>
    <span id="ce-timerow" class="ce-timerow" ${allDay ? 'hidden' : ''}>
      <input id="ce-time" type="time" class="sel" value="${time}">
      <select id="ce-dur" class="sel">${durationOptions(dur)}</select></span>
    <input id="ce-loc" class="sel" placeholder="Location (optional)" autocomplete="off" value="${esc(loc)}">
    <button class="add-btn wide" type="submit">${ev ? 'Save' : 'Add to calendar'}</button>
    ${ev ? '<button type="button" class="ghost cal-del" data-cal-del>Delete</button>' : ''}</form>`;
  $('#ce-title').focus();
}
async function calSaveEvent(id, title, time, duration, location, allDay) {
  const body = JSON.stringify(allDay
    ? { title, day: state.cal.selected, allDay: true, location: location || undefined }
    : { title, day: state.cal.selected, start_min: isoToMin(time), duration: Number(duration), location: location || undefined });
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

// ── view: today (the real day planner, embedded) ─────
// The planner is the actual today app (index.html/today.js), embedded in a
// same-origin iframe so it stays one codebase - no reimplementation, no drift -
// while living inside the Life shell. ?embed hides its own header chrome.
function openToday() { state.view = { type: 'today' }; renderNav(); renderToday(); return Promise.resolve(); }
function renderToday() {
  $('#pane').innerHTML = `<iframe class="today-frame" src="/today?embed=1" title="Today - your day"></iframe>`;
}

// ── view: mail ───────────────────────────────────────
// Mail runs on the same Worker (IMAP/SMTP over Cloudflare's TCP sockets), so it's
// just same-origin /api/mail/* with the Life token - no separate backend.
const mailApi = (path, opts) => api('/api/mail' + path, opts);
const mailFrom = (m) => m.from ? (m.from.name || m.from.address || '') : '';
const mailDate = (iso) => { if (!iso) return ''; const d = new Date(iso), now = new Date(); const sameDay = d.toDateString() === now.toDateString(); return sameDay ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : `${d.getDate()} ${MONTHS_LONG[d.getMonth()].slice(0, 3)}`; };

async function openMail() {
  state.view = { type: 'mail' };
  if (!state.mail) state.mail = { account: null, mailbox: 'INBOX', messages: [], open: null, composing: false };
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
async function mailSend(to, cc, subject, body, inReplyTo) {
  const acct = (state.mail.accounts || []).find((a) => a.id === state.mail.account);
  const sig = acct && acct.signature;
  const payload = { account: state.mail.account, to, cc, subject, text: body + (sig ? `\n\n${sigToText(sig)}` : ''), inReplyTo };
  // With a signature, send HTML too so it renders; plain text stays the fallback.
  if (sig) payload.html = `${composeHtml(body)}<br>${sig}`;
  try { await mailApi('/send', { method: 'POST', body: JSON.stringify(payload) }); toast('Sent'); state.mail.composing = false; renderMail(); }
  catch (e) { toast(e.message); }
}
async function openMailAccounts() {
  state.view = { type: 'mail' }; renderNav();
  try { state.mail = state.mail || { account: null, mailbox: 'INBOX' }; state.mail.accounts = await mailApi('/accounts'); renderMailAccounts(state.mail.accounts.length ? null : 'Add a mailbox to get started.'); }
  catch (e) { toast(e.message); }
}
async function addMailAccount(fields) {
  try { const a = await mailApi('/accounts', { method: 'POST', body: JSON.stringify(fields) }); toast(a.warning || 'Mailbox added'); state.mail.accounts = state.mail.accounts || []; state.mail.accounts.push(a); state.mail.account = a.id; await openMail(); }
  catch (e) { toast(e.message); }
}
async function delMailAccount(id) {
  if (!confirm('Remove this account?')) return;
  try { await mailApi(`/accounts/${id}`, { method: 'DELETE' }); state.mail.accounts = (state.mail.accounts || []).filter((a) => a.id !== id); if (state.mail.account === id) state.mail.account = null; renderMailAccounts(state.mail.accounts.length ? null : 'Add a mailbox to get started.'); }
  catch (e) { toast(e.message); }
}
function mailReplyStart(all) {
  const o = state.mail.open; if (!o) return;
  const me = (((state.mail.accounts || []).find((a) => a.id === state.mail.account) || {}).email || '').toLowerCase();
  const to = o.from ? o.from.address : '';
  let cc = '';
  if (all) {
    const seen = new Set([to.toLowerCase(), me]);
    const others = [...(o.to || []), ...(o.cc || [])].map((a) => a.address).filter(Boolean).filter((a) => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    cc = others.join(', ');
  }
  const quote = (o.text || '').split('\n').map((l) => `> ${l}`).join('\n');
  state.mail.composing = { to, cc, subject: /^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`, body: `\n\n---\nOn ${new Date(o.date).toLocaleString()}, ${o.from ? o.from.address : ''} wrote:\n${quote}`, inReplyTo: o.messageId };
  renderMail();
  setTimeout(() => $('#mc-body') && $('#mc-body').focus(), 0);
}

// A tasteful default signature so a new account starts with something real to
// edit rather than a blank box.
function defaultSignature(a) {
  const name = a.name && a.name !== a.email ? a.name : 'Robin Lumley-Savile';
  const accent = a.color || '#c4412e';
  return `<table cellpadding="0" cellspacing="0" style="font-family:-apple-system,Segoe UI,Inter,sans-serif"><tr><td style="border-left:3px solid ${accent};padding:2px 0 2px 12px"><div style="font-size:15px;font-weight:600;color:#1b1820">${esc(name)}</div><div style="font-size:13px;color:#8a8580;margin-top:2px"><a href="mailto:${esc(a.email)}" style="color:#8a8580;text-decoration:none">${esc(a.email)}</a></div></td></tr></table>`;
}
function renderMailAccounts(note) {
  const rows = (state.mail.accounts || []).map((a) => `<div class="mail-acct-card">
    <div class="mail-acct"><span class="ma-dot" style="background:${a.color || 'var(--accent)'}"></span><span class="ma-e">${esc(a.email)}</span>
      <button class="ghost sig-btn" data-sig-toggle="${a.id}">Signature</button>
      <button class="x" data-mail-del-acct="${a.id}" title="Remove">×</button></div>
    <div class="mail-sig" data-sig-panel="${a.id}" hidden>
      <div class="mail-sig-ed prose" contenteditable="true" data-sig-acct="${a.id}" data-ph="Your signature…">${a.signature || defaultSignature(a)}</div>
      <div class="mail-sig-act"><button class="add-btn" data-sig-save="${a.id}">Save signature</button><span class="sig-hint">Added to the bottom of messages you send from this address.</span></div>
    </div></div>`).join('');
  $('#pane').innerHTML = `<div class="pane-head home-head"><h1>Mail</h1><button class="add-btn wide" data-mail-add-acct>+ Add mailbox</button></div>
    <p class="scope">${note ? esc(note) + ' ' : ''}Connect as many mailboxes as you like - adding one never removes another.</p>
    <div class="mail-acct-list">${rows}</div>
    <div id="mail-acct-form"></div>
    ${(state.mail.accounts || []).length ? `<button class="mail-add-more" data-mail-add-acct>+ Add another mailbox</button>` : ''}`;
}
async function saveSignature(id) {
  const ed = document.querySelector(`[data-sig-acct="${id}"]`); if (!ed) return;
  const html = sanitizeEmailHtml(ed.innerHTML);
  try {
    const a = await mailApi(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ signature: html }) });
    const i = (state.mail.accounts || []).findIndex((x) => x.id === id); if (i >= 0) state.mail.accounts[i] = a;
    toast('Signature saved');
  } catch (e) { toast(e.message); }
}
const sigToText = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };
const composeHtml = (text) => `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;font-size:15px;line-height:1.55;color:#1b1820;white-space:pre-wrap">${esc(text || '')}</div>`;
function showMailAccountForm() {
  $('#mail-acct-form').innerHTML = `<form id="mail-acct-form-el" class="add-task" style="flex-direction:column;align-items:stretch;gap:10px;max-width:520px;margin-top:16px">
    <input id="ma-email" type="email" placeholder="Email address" required>
    <div style="display:flex;gap:8px"><input id="ma-imaphost" placeholder="IMAP host" value="imap.purelymail.com" required style="flex:1"><input id="ma-imapport" value="993" style="width:80px"></div>
    <div style="display:flex;gap:8px"><input id="ma-smtphost" placeholder="SMTP host" value="smtp.purelymail.com" required style="flex:1"><input id="ma-smtpport" value="465" style="width:80px"></div>
    <input id="ma-user" placeholder="Username (usually your email)">
    <input id="ma-pass" type="password" placeholder="Password / app password" required>
    <button class="add-btn wide" type="submit">Add account</button></form>`;
  $('#ma-email').focus();
}
const initial = (s) => (String(s || '?').trim().charAt(0) || '?').toUpperCase();
// Strip anything executable from an email's own markup before it goes in the
// frame: no <script>, no inline on* handlers, no javascript: URLs, no <base>.
// Its <style> is kept (that's what makes the mail look right) and the frame's
// own sandbox isolates those styles from the app.
function sanitizeEmailHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script, base, link[rel="import"], meta[http-equiv]').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return doc.head.innerHTML + doc.body.innerHTML;
}
// Render the (now script-free) email in a sandboxed frame and have it report its
// content height, so the frame grows to fit and the whole reading pane - header
// and body together - scrolls as one. allow-scripts runs only our reporter; the
// email's own scripts were stripped above, and there is no allow-same-origin.
function wrapEmailHtml(html) {
  return `<!doctype html><html><head><base target="_blank"><meta name="color-scheme" content="light">
    <style>html,body{margin:0}body{padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:15px;line-height:1.5;color:#1b1820;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#c4412e}table{max-width:100%}</style>
    </head><body>${sanitizeEmailHtml(html)}<script>(function(){function h(){parent.postMessage({__mailHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)},'*');}window.addEventListener('load',h);document.addEventListener('load',h,true);try{new ResizeObserver(h).observe(document.documentElement);}catch(e){}setTimeout(h,60);setTimeout(h,500);})();<\/script></body></html>`;
}
// Grow #mail-body-frame to whatever height it reports (installed once).
if (typeof window !== 'undefined' && !window.__mailFrameSizer) {
  window.__mailFrameSizer = true;
  window.addEventListener('message', (ev) => {
    if (!ev.data || typeof ev.data.__mailHeight !== 'number') return;
    const f = document.getElementById('mail-body-frame');
    if (f) f.style.height = `${Math.max(200, Math.min(ev.data.__mailHeight + 6, 40000))}px`;
  });
}
function renderMail(loading) {
  const m = state.mail;
  if (m.accounts && !m.accounts.length) return renderMailAccounts('Add a mailbox to get started.');
  const accTabs = (m.accounts || []).map((a) => `<button class="mail-atab ${a.id === m.account ? 'on' : ''}" data-mail-acct="${a.id}">${esc(a.name || a.email)}</button>`).join('');
  const rows = (m.messages || []).map((x) => `<button class="mail-row ${x.seen ? '' : 'unread'} ${m.open && m.open.uid === x.uid ? 'csel' : ''}" data-mail-open="${x.uid}">
    <span class="mail-avatar">${esc(initial(mailFrom(x)))}</span>
    <span class="mail-row-main"><span class="mail-row-top"><span class="mail-from">${esc(mailFrom(x) || '(unknown)')}</span><span class="mail-date">${mailDate(x.date)}</span></span>
    <span class="mail-subject">${esc(x.subject)}</span></span></button>`).join('');
  const list = `<div class="mail-list">${loading ? '<div class="home-empty">Loading…</div>' : (rows || '<div class="home-empty">No messages.</div>')}</div>`;
  let reader;
  if (m.composing) {
    reader = `<form id="mail-compose-form" class="mail-compose">
      <div class="mail-reader-head"><button type="button" class="ghost mail-back" data-mail-cancel>← Back</button><span class="mail-reader-title">New message</span></div>
      <input id="mc-to" placeholder="To" value="${esc(m.composing.to || '')}" required>
      <input id="mc-cc" placeholder="Cc" value="${esc(m.composing.cc || '')}">
      <input id="mc-subject" placeholder="Subject" value="${esc(m.composing.subject || '')}">
      <textarea id="mc-body" placeholder="Write your message…">${esc(m.composing.body || '')}</textarea>
      ${(() => { const a = (m.accounts || []).find((x) => x.id === m.account); return a && a.signature ? `<div class="mail-sig-note">✓ Signature for <b>${esc(a.email)}</b> will be added</div>` : ''; })()}
      <div class="mail-compose-act"><button class="add-btn wide" type="submit">Send</button><button type="button" class="ghost" data-mail-cancel>Cancel</button></div></form>`;
  } else if (m.open) {
    const o = m.open;
    reader = `<div class="mail-msg">
      <div class="mail-reader-head"><button class="ghost mail-back" data-mail-back>← Inbox</button>
        <span class="mail-msg-act"><button class="ghost" data-mail-reply title="Reply to sender  ·  R">Reply</button><button class="ghost" data-mail-reply-all title="Reply all  ·  A">Reply all</button><button class="ghost" data-mail-del="${o.uid}">Delete</button></span></div>
      <h1 class="mail-subj">${esc(o.subject)}</h1>
      <div class="mail-meta"><span class="mail-avatar big">${esc(initial(o.from ? (o.from.name || o.from.address) : '?'))}</span>
        <span class="mail-meta-lines"><b>${esc(o.from ? (o.from.name || o.from.address) : '')}</b><span class="mail-addr">${esc(o.from ? o.from.address : '')}</span></span>
        <span class="mail-when">${o.date ? new Date(o.date).toLocaleString() : ''}</span></div>
      ${o.attachments && o.attachments.length ? `<div class="mail-att">${o.attachments.map((a) => `<span class="mail-att-chip">📎 ${esc(a.filename || 'attachment')}</span>`).join('')}</div>` : ''}
      ${o.html ? `<iframe class="mail-body-frame" id="mail-body-frame" sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts" title="Message"></iframe>` : `<pre class="mail-text">${esc(o.text || '')}</pre>`}</div>`;
  } else {
    reader = `<div class="mail-empty">${loading ? '' : 'Select a message to read.'}</div>`;
  }
  $('#pane').innerHTML = `
    <div class="pane-head home-head"><h1>Mail</h1>
      <div class="mail-head-act"><button class="ghost" data-mail-accounts title="Accounts">Accounts</button><button class="add-btn wide" data-mail-compose>+ Compose</button></div></div>
    ${accTabs ? `<div class="mail-atabs">${accTabs}</div>` : ''}
    ${m.error ? `<div class="cal-warn">${esc(m.error)}</div>` : ''}
    <div class="mail-layout ${m.open || m.composing ? 'reading' : ''}">
      <div class="mail-list-col">${list}</div>
      <div class="mail-reader">${reader}</div>
    </div>`;
  if (m.open && m.open.html) { const f = document.getElementById('mail-body-frame'); if (f) f.srcdoc = wrapEmailHtml(m.open.html); }
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
// Event lengths, from 15 minutes up to a full day. Shared by both event forms.
const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480, 600, 720, 1440];
const durLabel = (n) => n === 1440 ? 'All day (24h)' : n < 60 ? `${n} min` : n % 60 === 0 ? `${n / 60} hour${n === 60 ? '' : 's'}` : `${Math.floor(n / 60)}½ hours`;
const durationOptions = (sel) => DURATIONS.map((n) => `<option value="${n}" ${n === sel ? 'selected' : ''}>${durLabel(n)}</option>`).join('');
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
    <select id="qe-dur" class="sel">${durationOptions(60)}</select>
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
  else if (v === 'calendar') renderCalendar(); else if (v === 'mail') renderMail();
  else if (v === 'today') renderToday(); else openHome();
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
// The sortable tasks table, for a given list. Shared by the Tasks page and a
// life-area page. Sorting/inline-edit run off the global handlers + state.taskSort.
function taskTableHtml(list, emptyMsg) {
  const arrow = (c) => state.taskSort.col === c ? `<span class="sarrow">${state.taskSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
  const th = (c, label, cls) => `<th class="${cls || ''} sortable" data-sort="${c}">${label}${arrow(c)}</th>`;
  const rows = sortTasks(list.slice()).map((t) => {
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
  return `<div class="tbl-scroll tasks-scroll"><table class="ttable">
      <thead><tr><th class="tc-done"></th>${th('title', 'Task', 'tc-title')}${th('priority', 'Priority', 'tc-prio')}${th('area', 'Area', 'tc-area')}${th('created', 'Added', 'tc-date')}<th class="tc-act"></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty" style="padding:40px">${emptyMsg || 'No tasks here yet.'}</td></tr>`}</tbody>
    </table></div>`;
}
function renderTasks() {
  const openCount = (aid) => state.tasks.filter((t) => !t.props.done && (aid ? t.props.area === aid : true)).length;
  const chips = `<button class="area-chip ${state.taskFilter === null ? 'on' : ''}" data-filter="">All <b>${openCount(null)}</b></button>` +
    state.areas.filter((a) => openCount(a.id)).map((a) => `<button class="area-chip ${state.taskFilter === a.id ? 'on' : ''}" style="--h:${hueOf(a)}" data-filter="${a.id}"><span class="cd"></span>${esc(a.title)} <b>${openCount(a.id)}</b></button>`).join('');
  const opts = `<option value="">No area</option>` + state.areas.map((a) => `<option value="${a.id}" ${state.taskFilter === a.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('');
  // Same filter as the chips, but a compact dropdown - shown on mobile instead.
  const filterSel = `<select class="area-filter sel" data-task-filter><option value="" ${state.taskFilter === null ? 'selected' : ''}>All tasks · ${openCount(null)}</option>${state.areas.filter((a) => openCount(a.id)).map((a) => `<option value="${a.id}" ${state.taskFilter === a.id ? 'selected' : ''}>${esc(a.title)} · ${openCount(a.id)}</option>`).join('')}</select>`;
  const inFilter = (t) => !state.taskFilter || t.props.area === state.taskFilter;
  const open = state.tasks.filter((t) => !t.props.done && inFilter(t));       // ticked tasks vanish from view
  const completed = state.tasks.filter((t) => t.props.done && inFilter(t));
  const cq = (state.completedQuery || '').trim().toLowerCase();
  const completedShown = completed.filter((t) => !cq || (t.title || '').toLowerCase().includes(cq));
  const completedSection = state.showCompleted
    ? `<section class="completed-sec">
        <div class="completed-head"><h2>Completed · ${completed.length}</h2><button class="ghost" data-hide-completed>Hide</button></div>
        <input class="completed-q sel" data-completed-q placeholder="Search completed…" value="${esc(state.completedQuery || '')}" autocomplete="off">
        ${taskTableHtml(completedShown, cq ? 'No completed tasks match.' : 'Nothing completed yet.')}</section>`
    : (completed.length ? `<button class="ghost show-completed" data-show-completed>Show completed · ${completed.length}</button>` : '');
  $('#pane').innerHTML = `
    <div class="pane-head"><h1>Tasks</h1></div>
    ${state.taskAdding
      ? `<form id="task-form" class="add-task">
      <input id="task-title" type="text" placeholder="Add a task…" autocomplete="off" required>
      <select id="task-area" class="sel">${opts}</select>
      <select id="task-prio" class="sel"><option value="">—</option><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option></select>
      <button class="add-btn wide" type="submit">Add</button>
      <button type="button" class="ghost" data-task-add-close>Done</button>
    </form>`
      : `<button class="add-btn wide" data-task-add>+ Add task</button>`}
    <div class="area-chips">${chips}</div>
    ${filterSel}
    ${taskTableHtml(open, 'No open tasks here.')}
    ${completedSection}`;
}

// ── view: note ───────────────────────────────────────
// Title fields are textareas so a long title wraps instead of cropping; grow
// them to fit their content. Measuring right after innerHTML can catch a
// pre-layout width (wrapping one line into many), so size on the next frame.
function autoGrow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
function autoGrowSoon(el) { if (!el) return; requestAnimationFrame(() => autoGrow(el)); }
function renderNote() {
  const n = state.note.current;
  const sep = '<span class="crumb-sep">›</span>';
  const crumbs = state.note.path.map((a, i) => i === state.note.path.length - 1
    ? `<span class="crumb cur">${esc(a.title || 'Untitled')}</span>`
    : `<button class="crumb" data-open-note="${a.id}">${esc(a.title || 'Untitled')}</button>`).join(sep);
  const kids = state.note.children.map((c) => `<button class="subpage" data-open-note="${c.id}"><span class="sp-ico">▸</span><span class="sp-t">${esc(c.title || 'Untitled')}</span></button>`).join('');
  $('#pane').innerHTML = `
    <div class="note-crumbs"><button class="crumb" data-view-home>Home</button>${sep}<button class="crumb" data-open-notes>Notes</button>${sep}${crumbs}
      <span class="crumb-tools">${areaSelect(n.props && n.props.area, 'data-note-area')}
      <button class="star ${n.props && n.props.fav ? 'on' : ''}" data-fav="${n.id}" title="Favourite">${n.props && n.props.fav ? '★' : '☆'}</button>
      <button class="note-move ghost" data-move-note title="Move this note inside another">Move</button>
      <button class="note-del ghost" data-del-note title="Delete this note">Delete</button></span></div>
    <textarea class="note-title" id="note-title" rows="1" placeholder="Untitled">${esc(n.title || '')}</textarea>
    <div class="note-body">${proseEditor(n.body, 'note')}</div>
    ${attachSection(n)}
    <div class="subpages"><div class="sub-h">Notes inside${state.note.children.length ? ` · ${state.note.children.length}` : ''}</div>
      ${kids}<button class="subpage add" data-new-sub><span class="sp-ico">+</span><span class="sp-t">New note inside</span></button></div>`;
  autoGrowSoon($('#note-title')); loadThumbs();
}

// ── move a note inside another (re-parent) ───────────
function openMoveNote() {
  const cur = state.note && state.note.current; if (!cur) return;
  api('/api/blocks?kind=note').then((all) => {
    // Can't move a note into itself or any of its own descendants.
    const kids = {}; all.forEach((n) => { const p = n.parent_id || ''; (kids[p] = kids[p] || []).push(n.id); });
    const bad = new Set([cur.id]); const st = [cur.id];
    while (st.length) { const p = st.pop(); (kids[p] || []).forEach((c) => { if (!bad.has(c)) { bad.add(c); st.push(c); } }); }
    const opts = all.filter((n) => !bad.has(n.id)).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    state.move = { cur: cur.id, curParent: cur.parent_id || null, opts, q: '' };
    renderMove();
  }).catch((e) => toast(e.message));
}
function renderMove() {
  let el = document.getElementById('move-overlay');
  if (!el) { el = document.createElement('div'); el.id = 'move-overlay'; document.body.appendChild(el); }
  el.innerHTML = `<div class="pal-bg" data-move-bg><div class="pal">
    <input id="move-input" placeholder="Move into which note…" value="${esc(state.move.q)}" autocomplete="off">
    <div class="pal-list" id="move-list"></div></div></div>`;
  renderMoveList();
  $('#move-input').focus();
}
function renderMoveList() {
  const el = $('#move-list'); if (!el) return;
  const q = state.move.q.trim().toLowerCase();
  const opts = state.move.opts.filter((n) => (n.title || '').toLowerCase().includes(q));
  const top = !q || 'top level'.includes(q)
    ? `<button class="pal-item ${state.move.curParent ? '' : 'muted-cur'}" data-move-to=""><span class="pal-kind muted">top</span><span class="pal-t">Top level (not inside any note)</span></button>` : '';
  el.innerHTML = top + (opts.map((n) => `<button class="pal-item" data-move-to="${n.id}"><span class="pal-kind muted">note</span><span class="pal-t">${esc(n.title || 'Untitled')}</span></button>`).join('') || (top ? '' : '<div class="pal-empty">No notes.</div>'));
}
function closeMove() { const el = document.getElementById('move-overlay'); if (el) el.innerHTML = ''; state.move = null; }
async function moveNote(targetId) {
  if (!state.move) return;
  const cur = state.move.cur; closeMove();
  try {
    await api(`/api/blocks/${cur}`, { method: 'PATCH', body: JSON.stringify({ parent_id: targetId || null }) });
    state.noteTops = await api('/api/blocks?kind=note&parent_id=');   // top-level list may have changed
    await openNote(cur);                                              // rebuild path/crumbs from the new home
    renderNav();
    toast('Note moved');
  } catch (e) { toast(e.message); }
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
  // A text cell holding a URL gets a small open-link button (still editable).
  const url = /^\s*https?:\/\/\S+\s*$/i.test(String(v ?? '')) ? String(v).trim() : null;
  return `<span class="cellwrap${url ? ' has-link' : ''}"><input type="text" class="cell" data-cell="${k}" value="${esc(v ?? '')}">${url ? `<a class="cell-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open link" tabindex="-1">↗</a>` : ''}</span>`;
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
        ${notesSection(r.body, 'row')}
        ${attachSection(r)}</div>`;
      loadThumbs();
      return;
    }
  }
  const colWidth = (col, first) => col.width || (first ? 230 : 170);
  const colgroup = `<colgroup><col style="width:46px">${c.map((col, i) => `<col data-cw="${col.id}" style="width:${colWidth(col, i === 0)}px">`).join('')}<col style="width:46px"></colgroup>`;
  const addCol = vw.addingCol
    ? `<th class="th-add" style="text-align:left"><form class="colnew" id="colnew"><input id="cn-name" placeholder="Column" autocomplete="off"><select id="cn-type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="add-btn" type="submit">Add</button></form></th>`
    : `<th class="th-add"><button data-add-col title="Add column">+</button></th>`;
  const sortOf = (id) => vw.sort && vw.sort.colId === id ? vw.sort.dir : null;
  const head = c.map((col) => { const sd = sortOf(col.id); return `<th><div class="thh"><button class="th-name" data-sort-col="${col.id}" title="Sort by ${esc(col.name)}">${esc(col.name)}${col.type === 'select' ? '<span class="th-type">select</span>' : ''}${sd ? `<span class="sarrow">${sd === 'asc' ? '↑' : '↓'}</span>` : ''}</button><button class="th-menu" data-col-menu="${col.id}" title="Column options — rename, type, options, sort, delete">▾</button></div><span class="resizer" data-resize="${col.id}"></span></th>`; }).join('');
  const body = sortRows(state.tables_rows).map((r) => `<tr><td class="row-open" data-open-row="${r.id}" title="Open this row"><span class="ro-ic">⤢</span></td>${c.map((col) => `<td class="${col.type === 'checkbox' ? 'check' : col.type === 'number' ? 'num' : ''}">${cellInput(r, col)}</td>`).join('')}<td class="row-del"><button data-del-row="${r.id}">×</button></td></tr>`).join('');
  $('#pane').innerHTML = `
    <div class="tbl-head"><input class="rename" value="${esc(t.title || '')}" data-rename>
      ${areaSelect(t.props && t.props.area, 'data-table-area')}
      <button class="star ${t.props && t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props && t.props.fav ? '★' : '☆'}</button>
      <button class="ghost" data-del-cur>Delete</button></div>
    <div class="tbl-scroll"><table class="recs fixed">${colgroup}
      <thead><tr><th class="th-open"></th>${head}${addCol}</tr></thead>
      <tbody>${body}<tr class="row-add"><td colspan="${c.length + 2}"><button data-add-row>+ Row</button></td></tr></tbody></table></div>
    ${vw.colMenu ? colMenuHtml(vw.colMenu) : ''}`;
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
function openPalette() { state.pal = { open: true, q: '', items: [], sel: 0 }; renderPalette(); buildPalette(); setTimeout(() => $('#pal-input')?.focus(), 0); }
function closePalette() { state.pal.open = false; $('#palette').innerHTML = ''; }
const ACTIONS = [
  { kind: 'action', title: 'New note', run: () => newNote(null) },
  { kind: 'action', title: 'New table', run: () => newTable() },
  { kind: 'action', title: 'Go to Tasks', run: () => openTasks() },
  { kind: 'action', title: 'Go to Calendar', run: () => openCalendar() },
  { kind: 'action', title: 'Go to Mail', run: () => openMail() },
  { kind: 'action', title: 'Go to Today', run: () => openToday() },
];
let palT;
function buildPalette() {
  const q = state.pal.q.trim();
  if (!q) {
    state.pal.items = [...ACTIONS,
      ...state.noteTops.slice(0, 5).map((n) => ({ kind: 'note', id: n.id, title: n.title || 'Untitled' })),
      ...state.tables.slice(0, 5).map((t) => ({ kind: 'table', id: t.id, title: t.title || 'Untitled' })),
      ...state.areas.slice(0, 6).map((a) => ({ kind: 'area', id: a.id, title: a.title || 'Untitled' }))];
    state.pal.sel = 0; renderPalItems(); return;
  }
  const acts = ACTIONS.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()));
  clearTimeout(palT);
  palT = setTimeout(async () => {
    try {
      const hits = await api(`/api/search?q=${encodeURIComponent(q)}`);
      // A slower earlier search must not overwrite the current query's results.
      if (state.pal.q.trim() !== q) return;
      state.pal.items = [...acts, ...hits.map((b) => ({ kind: b.kind, id: b.id, parent: b.parent_id || null, title: b.title || (b.kind === 'row' ? rowLabel(b) : '(untitled)') }))];
      state.pal.sel = 0; renderPalItems();
    } catch (e) { toast(e.message); }
  }, 150);
}
// The palette shell (with its <input>) is rendered once. Every keystroke updates
// only the results list, so the input element - and the caret in it - is never
// torn down mid-typing.
function renderPalette() {
  if (!state.pal.open) return;
  $('#palette').innerHTML = `<div class="pal-bg" data-pal-bg><div class="pal">
    <input id="pal-input" placeholder="Search notes, tables, tasks — or type a command…" value="${esc(state.pal.q)}" autocomplete="off">
    <div class="pal-list" id="pal-list"></div></div></div>`;
  renderPalItems();
  $('#pal-input').focus();
}
function renderPalItems() {
  const el = $('#pal-list'); if (!el) return;
  const items = state.pal.items;
  el.innerHTML = items.length ? items.map((it, i) => `<div class="pal-item ${i === state.pal.sel ? 'sel' : ''}" data-pal-i="${i}">
      <span class="pal-kind ${it.kind === 'action' ? '' : 'muted'}">${it.kind === 'action' ? '↵' : esc(it.kind)}</span>
      <span class="pal-t">${esc(it.title)}</span>${it.kind === 'action' ? '' : '<span class="pal-hint">open</span>'}</div>`).join('') : '<div class="pal-empty">No matches.</div>';
}
function execItem(it) {
  closePalette();
  if (!it) return;
  if (it.kind === 'action') return it.run().catch((e) => toast(e.message));
  if (it.kind === 'note') return openNote(it.id).catch((e) => toast(e.message));
  if (it.kind === 'table') return openTable(it.id).catch((e) => toast(e.message));
  if (it.kind === 'area') return openArea(it.id).catch((e) => toast(e.message));
  if (it.kind === 'task') return openTaskCard(it.id).catch((e) => toast(e.message));
  if (it.kind === 'row') return openRowResult(it.parent, it.id).catch((e) => toast(e.message));
}
// A search hit's display label for a table row: its first filled cell value.
function rowLabel(b) {
  const vals = (b.props && b.props.values) || {};
  const first = Object.values(vals).find((v) => v != null && v !== '' && v !== true && v !== false);
  return (first != null ? String(first) : '') || 'Row';
}
// Open a table row found in search: open its table, then focus the row card.
async function openRowResult(tableId, rowId) {
  if (!tableId) return;
  await openTable(tableId);
  if (state.tables_view) { state.tables_view.openRow = rowId; renderTable(); window.scrollTo(0, 0); }
}

// ── events ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); state.pal.open ? closePalette() : openPalette(); return; }
  // ⌥⌘T / ⌥⌘W - the browser owns ⌘T/⌘W, so tabs use the Option variant.
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyT') { e.preventDefault(); newTab(); return; }
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyW') { e.preventDefault(); closeTab(state.activeTab); return; }
  // Mail: R replies to sender, A replies to all - while reading, not while typing.
  if (!e.metaKey && !e.ctrlKey && !e.altKey && state.view.type === 'mail' && state.mail && state.mail.open && !state.mail.composing) {
    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (!editing && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); mailReplyStart(false); return; }
    if (!editing && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); mailReplyStart(true); return; }
  }
  if (state.move && e.key === 'Escape') { closeMove(); return; }
  if (!state.pal.open) return;
  if (e.key === 'Escape') { closePalette(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); state.pal.sel = Math.min(state.pal.items.length - 1, state.pal.sel + 1); renderPalItems(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); state.pal.sel = Math.max(0, state.pal.sel - 1); renderPalItems(); }
  if (e.key === 'Enter') { e.preventDefault(); execItem(state.pal.items[state.pal.sel]); }
});
document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('note-title')) autoGrow(e.target);
  if (e.target.id === 'pal-input') { state.pal.q = e.target.value; buildPalette(); }
  if (e.target.id === 'move-input') { state.move.q = e.target.value; renderMoveList(); }
  if (e.target.matches('[data-completed-q]')) { const pos = e.target.selectionStart; state.completedQuery = e.target.value; renderTasks(); const i = $('[data-completed-q]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch {} } }
  if (e.target.dataset && e.target.dataset.prose) { clearTimeout(proseT); proseT = setTimeout(() => saveProse(e.target.dataset.prose, e.target.innerHTML), 800); }
});
let proseT;
document.addEventListener('click', (e) => {
  const t = e.target;
  // Any http(s) link opens in a new tab / the default browser, even from inside
  // an always-editable prose region (where a plain click would just set the caret).
  const alink = t.closest('a[href]');
  if (alink && /^https?:/i.test(alink.getAttribute('href') || '')) {
    e.preventDefault();
    // Synthesise a real anchor click rather than window.open: an installed PWA
    // hands this to the OS default browser, and it isn't caught by popup blockers.
    const a = document.createElement('a'); a.href = alink.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  const mbg = t.closest('[data-move-bg]'); if (mbg && !t.closest('.pal')) { closeMove(); return; }
  const mvt = t.closest('[data-move-to]'); if (mvt) { moveNote(mvt.dataset.moveTo || null); return; }
  if (t.closest('[data-move-note]')) { openMoveNote(); return; }
  if (t.closest('[data-pal-bg]') === t.closest('.pal-bg') && t.closest('[data-pal-bg]') && !t.closest('.pal')) { closePalette(); return; }
  const pi = t.closest('[data-pal-i]'); if (pi) { execItem(state.pal.items[+pi.dataset.palI]); return; }
  if (t.closest('[data-palette]')) { openPalette(); return; }
  const tclose = t.closest('[data-tab-close]'); if (tclose) { closeTab(tclose.dataset.tabClose); return; }
  const tsw = t.closest('[data-tab]'); if (tsw) { switchTab(tsw.dataset.tab); return; }
  if (t.closest('[data-tab-new]')) { newTab(); return; }
  if (t.closest('[data-theme-toggle]')) { cycleTheme(); return; }
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
  if (t.closest('[data-open-today]')) { openToday(); return; }
  if (t.closest('[data-open-mail]')) { openMail().catch((x) => toast(x.message)); return; }
  // attachments (delete wins over open since the × sits inside the tile)
  const adel = t.closest('[data-att-del]'); if (adel) { e.preventDefault(); e.stopPropagation(); const z = adel.closest('[data-att-zone]'); deleteAttachment(z.dataset.attZone, adel.dataset.attDel); return; }
  const aop = t.closest('[data-att-open]'); if (aop) { const z = aop.closest('[data-att-zone]'); openAttachment(z.dataset.attZone, aop.dataset.attOpen); return; }
  // mail interactions
  const macc = t.closest('[data-mail-acct]'); if (macc) { state.mail.account = macc.dataset.mailAcct; loadMessages(); return; }
  const mo = t.closest('[data-mail-open]'); if (mo) { openMessage(Number(mo.dataset.mailOpen)); return; }
  if (t.closest('[data-mail-back]')) { state.mail.open = null; renderMail(); return; }
  if (t.closest('[data-mail-compose]')) { state.mail.composing = {}; renderMail(); return; }
  if (t.closest('[data-mail-cancel]')) { state.mail.composing = false; renderMail(); return; }
  if (t.closest('[data-mail-reply]')) { mailReplyStart(false); return; }
  if (t.closest('[data-mail-reply-all]')) { mailReplyStart(true); return; }
  const mdl = t.closest('[data-mail-del]'); if (mdl) { mailDelete(Number(mdl.dataset.mailDel)); return; }
  if (t.closest('[data-mail-accounts]')) { openMailAccounts().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-mail-add-acct]')) { showMailAccountForm(); return; }
  const mda = t.closest('[data-mail-del-acct]'); if (mda) { delMailAccount(mda.dataset.mailDelAcct); return; }
  const sigt = t.closest('[data-sig-toggle]'); if (sigt) { const p = document.querySelector(`[data-sig-panel="${sigt.dataset.sigToggle}"]`); if (p) p.hidden = !p.hidden; return; }
  const sigs = t.closest('[data-sig-save]'); if (sigs) { saveSignature(sigs.dataset.sigSave); return; }
  // calendar interactions
  // A chip sits inside a day cell, so match the event before the day.
  const cev = t.closest('[data-cal-ev]'); if (cev) { const e = state.cal.events.find((x) => x.id === cev.dataset.calEv); if (e) { state.cal.selected = e.date; state.cal.editing = e; state.cal.adding = false; renderCalendar(); } return; }
  const cday = t.closest('[data-cal-day]'); if (cday) { state.cal.selected = cday.dataset.calDay; state.cal.adding = false; state.cal.editing = null; renderCalendar(); return; }
  if (t.closest('[data-cal-add]')) { state.cal.adding = true; state.cal.editing = null; renderCalendar(); return; }
  if (t.closest('[data-cal-del]')) { const f = $('#cal-ev-form'); if (f && f.dataset.ev) calDeleteEvent(f.dataset.ev); return; }
  const cmode = t.closest('[data-cal-mode]'); if (cmode) { setCalMode(cmode.dataset.calMode); return; }
  if (t.closest('[data-cal-today]')) { state.cal.selected = todayISO(); const d = new Date(); state.cal.y = d.getFullYear(); state.cal.m = d.getMonth(); state.cal.adding = false; state.cal.editing = null; renderCalendar(); loadCalendar(); return; }
  if (t.closest('[data-cal-prev]')) { stepCal(-1); return; }
  if (t.closest('[data-cal-next]')) { stepCal(1); return; }
  const fo = t.closest('[data-fav-open]'); if (fo) { openFav(fo.dataset.favOpen).catch((x) => toast(x.message)); return; }
  const fv = t.closest('[data-fav]'); if (fv) { toggleFav(fv.dataset.fav); return; }
  const uf = t.closest('[data-unfav]'); if (uf) { unfav(uf.dataset.unfav); return; }
  if (t.closest('[data-task-add]')) { state.taskAdding = true; renderTasks(); $('#task-title')?.focus(); return; }
  if (t.closest('[data-task-add-close]')) { state.taskAdding = false; renderTasks(); return; }
  if (t.closest('[data-quick-task]')) { showQuickTask(); return; }
  if (t.closest('[data-quick-event]')) { showQuickEvent(); return; }
  if (t.closest('[data-new-note]')) { newNote(null).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-table]')) { newTable().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-area]')) { newArea().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-sub]')) { newNote(state.note.current.id).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-note]')) { delNote(); return; }

  // tasks
  const sh = t.closest('[data-sort]');
  if (sh) { const c = sh.dataset.sort; if (state.taskSort.col === c) state.taskSort.dir = state.taskSort.dir === 'asc' ? 'desc' : 'asc'; else state.taskSort = { col: c, dir: c === 'created' ? 'desc' : 'asc' }; rerenderCurrent(); return; }
  if (t.closest('[data-show-completed]')) { state.showCompleted = true; renderTasks(); return; }
  if (t.closest('[data-hide-completed]')) { state.showCompleted = false; state.completedQuery = ''; renderTasks(); return; }
  const fc = t.closest('[data-filter]'); if (fc) { state.taskFilter = fc.dataset.filter || null; renderTasks(); return; }
  const ck = t.closest('[data-check]'); if (ck) { toggleTask(ck.dataset.check); return; }
  const dt = t.closest('[data-del-task]'); if (dt) { delTask(dt.dataset.delTask); return; }
  const et = t.closest('[data-edit-task]'); if (et) { editTaskTitle(et); return; }
  const ep = t.closest('[data-edit-prio]'); if (ep) { editPrio(ep); return; }
  const ea = t.closest('[data-edit-area]'); if (ea) { editArea(ea); return; }
  const ota = t.closest('[data-open-task]'); if (ota) { openTaskCard(ota.dataset.openTask).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-task-cur]')) { delTaskCard().catch((x) => toast(x.message)); return; }

  // The ▾ on a column header opens the same menu as right-click (toggles it).
  const cmb = t.closest('[data-col-menu]');
  if (cmb && state.tables_view) {
    const id = cmb.dataset.colMenu, open = state.tables_view.colMenu;
    if (open && open.colId === id) state.tables_view.colMenu = null;
    else { const r = cmb.getBoundingClientRect(); state.tables_view.colMenu = { colId: id, x: Math.min(r.left, window.innerWidth - 232), y: r.bottom + 4 }; }
    renderTable(); return;
  }
  // table column menu (right-click) actions
  if (state.tables_view && state.tables_view.colMenu) {
    const cmId = state.tables_view.colMenu.colId;
    if (t.closest('[data-cm-rename]')) { state.tables_view.colMenu = null; renderTable(); editColName(cmId); return; }
    const ctp = t.closest('[data-cm-type]'); if (ctp) { setColType(cmId, ctp.dataset.cmType); return; }
    const rmo = t.closest('[data-cm-rmopt]'); if (rmo) { removeColOption(cmId, rmo.dataset.cmRmopt); return; }
    const cms = t.closest('[data-cm-sort]'); if (cms) { state.tables_view.sort = { colId: cmId, dir: cms.dataset.cmSort }; state.tables_view.colMenu = null; renderTable(); return; }
    if (t.closest('[data-cm-del]')) { state.tables_view.colMenu = null; if (confirm('Delete this column?')) saveTableColumns(tcols().filter((c) => c.id !== cmId)).then(renderTable); else renderTable(); return; }
    if (!t.closest('[data-colmenu]')) { state.tables_view.colMenu = null; renderTable(); } // click outside closes; fall through
  }
  // table
  if (t.closest('[data-back-table]')) { state.tables_view.openRow = null; renderTable(); return; }
  const or = t.closest('[data-open-row]'); if (or) { state.tables_view.openRow = or.dataset.openRow; renderTable(); window.scrollTo(0, 0); return; }
  const ec = t.closest('[data-edit-col]'); if (ec) { editColName(ec.dataset.editCol); return; }
  const sc = t.closest('[data-sort-col]');
  if (sc) { const id = sc.dataset.sortCol; const s = state.tables_view.sort; state.tables_view.sort = s && s.colId === id ? { colId: id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { colId: id, dir: 'asc' }; renderTable(); return; }
  if (t.closest('[data-add-col]')) { state.tables_view.addingCol = true; renderTable(); return; }
  const dcol = t.closest('[data-del-col]'); if (dcol) { if (confirm('Delete this column?')) saveTableColumns(tcols().filter((c) => c.id !== dcol.dataset.delCol)).then(renderTable).catch((x) => toast(x.message)); return; }
  const drow = t.closest('[data-del-row]'); if (drow) { const id = drow.dataset.delRow; state.tables_rows = state.tables_rows.filter((r) => r.id !== id); renderTable(); api(`/api/blocks/${id}`, { method: 'DELETE' }).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-add-row]')) { addRow(); return; }
  if (t.closest('[data-del-cur]')) { delTable(); return; }
});
// right-click a column header for its menu (rename / type / options / sort / delete)
document.addEventListener('contextmenu', (e) => {
  const th = e.target.closest('[data-sort-col]');
  if (th && state.view.type === 'table' && state.tables_view && !state.tables_view.openRow) {
    e.preventDefault();
    state.tables_view.colMenu = { colId: th.dataset.sortCol, x: Math.min(e.clientX, window.innerWidth - 232), y: e.clientY };
    renderTable();
  }
});
// change: cells + selects
document.addEventListener('change', (e) => {
  const c = e.target.closest('[data-cell]'); if (c) { const [rid, cid] = c.dataset.cell.split(':'); setCell(rid, cid, e.target.type === 'checkbox' ? e.target.checked : e.target.value); }
  if (e.target.matches('[data-note-area]')) setBlockArea('note', state.note.current.id, e.target.value);
  if (e.target.matches('[data-table-area]')) setBlockArea('table', state.tables_open.id, e.target.value);
  if (e.target.matches('[data-task-filter]')) { state.taskFilter = e.target.value || null; renderTasks(); }
  if (e.target.matches('[data-prio-task]')) patchTaskProps(e.target.dataset.prioTask, { priority: e.target.value || null });
  if (e.target.matches('[data-area-task]')) patchTaskProps(e.target.dataset.areaTask, { area: e.target.value || null });
  const fi = e.target.closest('[data-att-input]'); if (fi && fi.files && fi.files.length) { uploadFiles(fi.dataset.attInput, fi.files); fi.value = ''; }
  if (e.target.classList && e.target.classList.contains('note-title')) autoGrow(e.target);
  if (e.target.id === 'ce-allday') { const r = $('#ce-timerow'); if (r) r.hidden = e.target.checked; }
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
  if ((e.target.id === 'note-title' || e.target.id === 'taskcard-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'task-form') { const v = $('#task-title').value.trim(); if (v) addTask(v, $('#task-area').value, $('#task-prio').value); }
  if (e.target.id === 'qt-form') { const i = $('#qt-title'); const v = i.value.trim(); if (v) { homeAddTask(v, $('#qt-area').value, $('#qt-prio').value); i.value = ''; i.focus(); } }
  if (e.target.id === 'qe-form') { const v = $('#qe-title').value.trim(); if (v) homeAddEvent(v, $('#qe-date').value, $('#qe-time').value, $('#qe-dur').value, $('#qe-loc').value.trim()); }
  if (e.target.id === 'cal-ev-form') { const v = $('#ce-title').value.trim(); if (v) calSaveEvent(e.target.dataset.ev || null, v, $('#ce-time').value, $('#ce-dur').value, $('#ce-loc').value.trim(), $('#ce-allday').checked); }
  if (e.target.id === 'mail-acct-form-el') { addMailAccount({ email: $('#ma-email').value.trim(), imapHost: $('#ma-imaphost').value.trim(), imapPort: $('#ma-imapport').value.trim(), smtpHost: $('#ma-smtphost').value.trim(), smtpPort: $('#ma-smtpport').value.trim(), user: $('#ma-user').value.trim(), pass: $('#ma-pass').value }); }
  if (e.target.id === 'mail-compose-form') { const to = $('#mc-to').value.trim(); if (to) mailSend(to, $('#mc-cc').value.trim(), $('#mc-subject').value.trim(), $('#mc-body').value, state.mail.composing && state.mail.composing.inReplyTo); }
  if (e.target.id === 'colnew') { const name = $('#cn-name').value.trim(); const type = $('#cn-type').value; addColumn(name, type); }
  if (e.target.matches('[data-cm-addopt]')) { const i = $('#cm-opt-input'); if (i && state.tables_view && state.tables_view.colMenu) addColOption(state.tables_view.colMenu.colId, i.value); }
});
// drag to reorder favourites on the home, and to reorder the sidebar sections.
// A dragged item dims; the item it would land next to shows an accent insertion
// line (above or below, following the pointer) so the drop target is obvious.
let dragFav = null, dragSec = null;
function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}
function markDrop(over, e, axis) {
  clearDropMarks();
  if (!over) return;
  const r = over.getBoundingClientRect();
  // Sidebar sections always stack vertically (even a collapsed, wide one), so the
  // axis is passed explicitly rather than guessed from the element's shape.
  const after = axis === 'h' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  over.classList.add(after ? 'drop-after' : 'drop-before');
}
// The key/id of the sibling to insert BEFORE, given the marked drop target.
function dropBefore(over, list, idOf) {
  if (!over) return null;
  const key = idOf(over);
  if (over.classList.contains('drop-after')) { const i = list.indexOf(key); return i >= 0 && i + 1 < list.length ? list[i + 1] : null; }
  return key;
}
document.addEventListener('dragstart', (e) => {
  const f = e.target.closest('[data-fav-id]'); if (f) { dragFav = f.dataset.favId; f.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const s = e.target.closest('.nav-sec-h'); if (s) { const sec = s.closest('[data-nav-sec]'); dragSec = sec.dataset.navSec; sec.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
});
document.addEventListener('dragover', (e) => {
  if (dragFav && e.target.closest('#favs')) { e.preventDefault(); markDrop(e.target.closest('[data-fav-id]'), e, 'h'); return; }
  if (dragSec && e.target.closest('#nav-secs')) { e.preventDefault(); const o = e.target.closest('[data-nav-sec]'); markDrop(o && o.dataset.navSec !== dragSec ? o : null, e, 'v'); return; }
  const z = e.target.closest('[data-att-zone]');
  if (z && !dragFav && !dragSec && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); z.classList.add('att-drag'); }
});
document.addEventListener('dragleave', (e) => {
  const z = e.target.closest('[data-att-zone]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('att-drag');
});
document.addEventListener('drop', (e) => {
  const z = e.target.closest('[data-att-zone]');
  if (z && !dragFav && !dragSec && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    e.preventDefault(); z.classList.remove('att-drag'); uploadFiles(z.dataset.attZone, e.dataTransfer.files); return;
  }
  if (dragFav) {
    e.preventDefault(); const over = e.target.closest('[data-fav-id]');
    const before = over && over.dataset.favId !== dragFav ? dropBefore(over, state.favs.map((x) => `${x.kind}:${x.id}`), (el) => el.dataset.favId) : null;
    clearDropMarks(); reorderFavs(dragFav, before); dragFav = null; return;
  }
  if (dragSec) {
    e.preventDefault(); const over = e.target.closest('[data-nav-sec]');
    const before = over && over.dataset.navSec !== dragSec ? dropBefore(over, state.nav.order, (el) => el.dataset.navSec) : null;
    clearDropMarks(); reorderSecs(dragSec, before); dragSec = null;
  }
});
document.addEventListener('dragend', () => { clearDropMarks(); document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging')); dragFav = null; dragSec = null; });

// column resize (pointer)
let resizing = null;
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-resize]'); if (!h) return; e.preventDefault();
  const th = h.closest('th'); resizing = { colId: h.dataset.resize, colEl: $(`col[data-cw="${h.dataset.resize}"]`), startX: e.clientX, startW: th.getBoundingClientRect().width };
  try { h.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', (e) => { if (!resizing) return; const w = Math.max(64, Math.round(resizing.startW + (e.clientX - resizing.startX))); if (resizing.colEl) resizing.colEl.style.width = `${w}px`; });
document.addEventListener('pointerup', () => { if (!resizing) return; const w = resizing.colEl ? parseInt(resizing.colEl.style.width, 10) : null; const id = resizing.colId; resizing = null; if (w) saveTableColumns(tcols().map((c) => c.id === id ? { ...c, width: w } : c)).catch((x) => toast(x.message)); });

// Drag a bullet/numbered list item up or down to reorder it. Grabbing happens
// in the marker gutter (left edge) so clicking the text still edits normally.
let liDrag = null;
document.addEventListener('pointerdown', (e) => {
  const li = e.target.closest && e.target.closest('.prose li');
  if (!li) return;
  const rect = li.getBoundingClientRect();
  if (e.clientX > rect.left + 4) return;               // only from the handle/marker gutter
  e.preventDefault();
  liDrag = { li, list: li.parentElement };
  li.classList.add('li-dragging');
}, true);
document.addEventListener('pointermove', (e) => {
  if (!liDrag) return;
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const overLi = over && over.closest && over.closest('.prose li');
  if (!overLi || overLi === liDrag.li || overLi.parentElement !== liDrag.list) return;
  const r = overLi.getBoundingClientRect();
  liDrag.list.insertBefore(liDrag.li, e.clientY > r.top + r.height / 2 ? overLi.nextSibling : overLi);
});
document.addEventListener('pointerup', () => {
  if (!liDrag) return;
  const prose = liDrag.li.closest('.prose');
  liDrag.li.classList.remove('li-dragging');
  liDrag = null;
  if (prose && prose.dataset.prose) saveProse(prose.dataset.prose, prose.innerHTML);
});

// ── task/note/table helpers ──────────────────────────
async function addTask(title, area, priority) {
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title, props: { area: area || null, priority: priority || null, done: false } }) });
  state.tasks.push(b); renderTasks();
  // Keep the form open for adding several in a row.
  if (state.taskAdding) { const i = $('#task-title'); if (i) i.focus(); }
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
      <textarea class="note-title ${t.props.done ? 'struck' : ''}" id="taskcard-title" rows="1" placeholder="Untitled task">${esc(t.title || '')}</textarea>
    </div>
    <div class="tf-meta">
      <label class="tf-field"><span class="tf-label">Priority</span>
        <select class="sel" data-prio-task="${t.id}"><option value="">—</option>${['P1', 'P2', 'P3', 'P4'].map((x) => `<option ${p === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="tf-field"><span class="tf-label">Life area</span>
        <select class="sel" data-area-task="${t.id}"><option value="">No area</option>${state.areas.map((x) => `<option value="${x.id}" ${t.props.area === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
    </div>
    ${notesSection(t.body, 'task')}
    ${attachSection(t)}`;
  autoGrowSoon($('#taskcard-title')); loadThumbs();
}

// A prose Notes section, reused by the task card and the row card. Backed by
// the block's `body`, edited inline via the shared rich-text editor.
function notesSection(body, key) {
  return `<section class="focus-notes"><div class="fn-h">Notes</div>${proseEditor(body, key)}</section>`;
}

// ── attachments (R2-backed files on a block) ─────────
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const isImgType = (t) => /^image\//.test(t || '');
const attIcon = (t) => (t === 'application/pdf' ? '📄' : isImgType(t) ? '🖼' : /^audio\//.test(t) ? '🎵' : /^video\//.test(t) ? '🎬' : '📎');

// The block whose props.attachments the current view is showing.
function attHost() {
  if (state.view.type === 'note') return state.note && state.note.current;
  if (state.view.type === 'taskcard') return state.task_open && state.task_open.task;
  if (state.view.type === 'table' && state.tables_view && state.tables_view.openRow) {
    return state.tables_rows && state.tables_rows.find((x) => x.id === state.tables_view.openRow);
  }
  return null;
}
function rerenderHost() {
  if (state.view.type === 'note') renderNote();
  else if (state.view.type === 'taskcard') renderTaskCard();
  else if (state.view.type === 'table') renderTable();
}
function attachSection(block) {
  const list = (block && block.props && block.props.attachments) || [];
  const tiles = list.map((a) => (isImgType(a.type)
    ? `<div class="att att-img" data-att-open="${a.id}" data-att-type="${esc(a.type)}" data-att-name="${esc(a.name)}" title="${esc(a.name)}"><img data-att-thumb="${a.id}" alt="${esc(a.name)}"><button class="att-x" data-att-del="${a.id}" title="Remove">×</button></div>`
    : `<div class="att att-file" data-att-open="${a.id}" data-att-type="${esc(a.type)}" data-att-name="${esc(a.name)}" title="${esc(a.name)}"><span class="att-ic">${attIcon(a.type)}</span><span class="att-info"><span class="att-name">${esc(a.name)}</span><span class="att-size">${fmtBytes(a.size)}</span></span><button class="att-x" data-att-del="${a.id}" title="Remove">×</button></div>`)).join('');
  return `<section class="attachments" data-att-zone="${block.id}">
    <div class="att-h">Attachments${list.length ? ` · ${list.length}` : ''}</div>
    <div class="att-grid">${tiles}<label class="att-add"><input type="file" multiple hidden data-att-input="${block.id}"><span class="att-add-ic">+</span><span>Add file</span></label></div></section>`;
}
// blob: URLs, so a thumbnail or preview is fetched once and the Bearer token
// never lands in a URL.
const attUrls = new Map();
async function attUrl(blockId, att) {
  if (attUrls.has(att.id)) return attUrls.get(att.id);
  const res = await fetch(`/api/attachments/${blockId}/${att.id}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  attUrls.set(att.id, url);
  return url;
}
async function loadThumbs() {
  const host = attHost(); if (!host) return;
  for (const a of (host.props && host.props.attachments) || []) {
    if (!isImgType(a.type)) continue;
    const img = document.querySelector(`img[data-att-thumb="${a.id}"]`);
    if (!img || img.dataset.loaded) continue;
    try { img.src = await attUrl(host.id, a); img.dataset.loaded = '1'; } catch {}
  }
}
async function openAttachment(blockId, attId) {
  try {
    const host = attHost();
    const att = host && (host.props.attachments || []).find((a) => a.id === attId);
    window.open(await attUrl(blockId, att || { id: attId }), '_blank', 'noopener');
  } catch (e) { toast('Could not open: ' + e.message); }
}
async function uploadFiles(blockId, files) {
  const host = attHost(); if (!host || host.id !== blockId) return;
  let ok = 0;
  for (const f of Array.from(files)) {
    try {
      const res = await fetch(`/api/blocks/${blockId}/attachments?name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || 'application/octet-stream')}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: f });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
      const att = await res.json();
      host.props = host.props || {};
      host.props.attachments = [...(host.props.attachments || []), att];
      ok++;
    } catch (e) { toast('Upload failed: ' + e.message); }
  }
  if (ok) { rerenderHost(); loadThumbs(); }
}
async function deleteAttachment(blockId, attId) {
  const host = attHost(); if (!host) return;
  try { await api(`/api/attachments/${blockId}/${attId}`, { method: 'DELETE' }); } catch (e) { toast(e.message); return; }
  host.props.attachments = (host.props.attachments || []).filter((a) => a.id !== attId);
  const u = attUrls.get(attId); if (u) { URL.revokeObjectURL(u); attUrls.delete(attId); }
  rerenderHost();
}
// Save a rich-text region back to whichever block it belongs to.
async function saveProse(key, rawHtml) {
  const html = linkifyHtml(sanitizeProse(rawHtml));
  let id;
  if (key === 'note') { const n = state.note && state.note.current; if (!n) return; n.body = html; id = n.id; }
  else if (key === 'task') { const t = state.task_open && state.task_open.task; if (!t) return; t.body = html; id = t.id; }
  else if (key === 'row') { const r = state.tables_rows && state.tables_rows.find((x) => x.id === (state.tables_view && state.tables_view.openRow)); if (!r) return; r.body = html; id = r.id; }
  if (!id) return;
  // Reflect the linkified/sanitised HTML back into the editor once it's blurred,
  // so a freshly typed URL becomes a link. Never while focused - that would move
  // the caret and eat what's being typed.
  const el = document.querySelector(`.prose[data-prose="${key}"]`);
  if (el && document.activeElement !== el && el.innerHTML !== html) el.innerHTML = html;
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
async function setColType(id, type) {
  let seed = {};
  if (type === 'select') {
    const existing = tcols().find((c) => c.id === id);
    if (!existing.options || !existing.options.length) {
      // Seed options from the column's existing distinct values so converting a
      // free-form column to Select doesn't blank out the data already there.
      seed = { options: [...new Set(state.tables_rows.map((r) => (r.props.values || {})[id]).filter((x) => x != null && x !== '').map(String))] };
    }
  }
  const cols = tcols().map((c) => c.id === id ? { ...c, type, ...seed } : c);
  await saveTableColumns(cols); renderTable();
}
async function addColOption(id, opt) {
  opt = (opt || '').trim(); if (!opt) return;
  const cols = tcols().map((c) => c.id === id ? { ...c, options: [...(c.options || []), opt].filter((o, i, a) => a.indexOf(o) === i) } : c);
  await saveTableColumns(cols); renderTable(); const i = $('#cm-opt-input'); if (i) i.focus();
}
async function removeColOption(id, opt) {
  const cols = tcols().map((c) => c.id === id ? { ...c, options: (c.options || []).filter((o) => o !== opt) } : c);
  await saveTableColumns(cols); renderTable();
}
// A right-click menu on a column header: rename, change type (incl. Select and
// its options), sort, delete.
function colMenuHtml(cm) {
  const col = tcols().find((c) => c.id === cm.colId); if (!col) return '';
  return `<div class="colmenu" data-colmenu style="top:${cm.y}px;left:${cm.x}px">
    <button class="cm-item" data-cm-rename>Rename column</button>
    <div class="cm-sep"></div><div class="cm-label">Type</div>
    ${TYPES.map(([v, l]) => `<button class="cm-item cm-type ${col.type === v ? 'on' : ''}" data-cm-type="${v}">${l}${col.type === v ? ' ✓' : ''}</button>`).join('')}
    ${col.type === 'select' ? `<div class="cm-sep"></div><div class="cm-label">Options</div>
      ${(col.options || []).map((o) => `<div class="cm-opt"><span>${esc(o)}</span><button data-cm-rmopt="${esc(o)}" title="Remove">×</button></div>`).join('') || '<div class="cm-empty">None yet</div>'}
      <form class="cm-addopt" data-cm-addopt><input id="cm-opt-input" placeholder="Add option…" autocomplete="off"><button type="submit">Add</button></form>` : ''}
    <div class="cm-sep"></div>
    <button class="cm-item" data-cm-sort="asc">Sort A → Z</button>
    <button class="cm-item" data-cm-sort="desc">Sort Z → A</button>
    <div class="cm-sep"></div>
    <button class="cm-item cm-del" data-cm-del>Delete column</button>
  </div>`;
}
// Click ✎ to rename: the column-name button becomes an input in place.
function editColName(id) {
  const btn = $(`.th-name[data-sort-col="${id}"]`); const col = tcols().find((c) => c.id === id); if (!btn || !col) return;
  const input = document.createElement('input'); input.className = 'th-rename'; input.value = col.name;
  btn.replaceWith(input); input.focus(); input.select(); let d = false;
  const save = async () => { if (d) return; d = true; const v = input.value.trim(); if (v && v !== col.name) { await renameColumn(id, v); } renderTable(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { d = true; renderTable(); } });
  input.addEventListener('blur', save);
}
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
    <button data-fmt="ul" title="Bulleted list">&#8226;</button>
    <button data-fmt="ol" title="Numbered list" style="font-size:12px">1.</button>
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
  else if (cmd === 'ul') document.execCommand('insertUnorderedList');
  else if (cmd === 'ol') document.execCommand('insertOrderedList');
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
  initTheme();
  if (!token()) { showGate(); return; }
  try {
    [state.noteTops, state.tables, state.areas, state.favs] = await Promise.all([
      api('/api/blocks?kind=note&parent_id='), api('/api/blocks?kind=table'), api('/api/blocks?kind=area'),
      api('/api/favorites').catch(() => []),
    ]);
    state.tables.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    state.areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    // Deep link: a home-screen icon pinned to /calendar opens straight there.
    const savedTabs = readLS('life.tabs', null);
    if (savedTabs && Array.isArray(savedTabs.tabs) && savedTabs.tabs.length) {
      state.tabs = savedTabs.tabs.map((t) => ({ id: uid(), view: t.view || { type: 'home' }, label: t.label || 'Home' }));
      state.activeTab = (state.tabs[savedTabs.active] || state.tabs[0]).id;
    } else { state.tabs = [{ id: uid(), view: { type: 'home' }, label: 'Home' }]; state.activeTab = state.tabs[0].id; }
    const route = location.pathname.replace(/\/$/, '');
    if (route === '/calendar') await openCalendar();
    else if (route === '/mail') await openMail();
    else await Promise.resolve(openView(state.tabs.find((t) => t.id === state.activeTab).view)).catch(() => openHome());
  } catch (e) { toast(e.message); renderNav(); }
})();
