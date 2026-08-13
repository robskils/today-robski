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
  areas: [], tasks: [], taskFilter: null, taskAdding: false, showCompleted: false, completedQuery: '', taskQuery: '', notesQuery: '', calQuery: '',
  // Phones default to priority order (P1 first); desktop to most-recently added.
  taskSort: readLS('life.taskSort', { col: 'priority', dir: 'asc' }),   // default by priority, and remember the user's choice
  note: null, tables_open: null,
  favs: [], home: { events: [] }, cal: null, mail: null,
  tabs: [], activeTab: null,
  nav: {
    order: (() => { const def = ['favs', 'notes', 'tables', 'areas']; const o = readLS('life.nav.order', null); return Array.isArray(o) && o.length === def.length && def.every((k) => o.includes(k)) ? o : def; })(),
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
const prettyHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
// A long URL is shown as host + a trimmed path so it never sprawls across the note.
function prettyLinkText(u) {
  if (u.length <= 48) return u;
  try { const p = new URL(u); let s = p.hostname.replace(/^www\./, '') + (p.pathname === '/' ? '' : p.pathname) + (p.search || ''); return s.length > 48 ? s.slice(0, 47) + '…' : s; }
  catch { return u.slice(0, 47) + '…'; }
}
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
        a.textContent = prettyLinkText(m[0]); frag.appendChild(a); last = m.index + m[0].length;
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
  const html = /<(p|h[1-3]|blockquote|div|ul|ol|details)[\s>]/i.test(s) ? s : mdToHtml(body);
  return linkifyHtml(html);
}
// YouTube links in a body → embedded players (rendered below the editor, not
// inside the editable prose, so paste/typing stays clean).
function youtubeIds(body) {
  const ids = []; const re = /(?:youtube\.com\/(?:watch\?(?:[^&\s]*&)*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/gi;
  let m; while ((m = re.exec(body || ''))) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}
// The strip below the editor holds YouTube players only; link cards render
// inline, in the prose, where they were pasted (see decorateProse).
function embedsHtml(body) {
  const ids = youtubeIds(body);
  if (!ids.length) return '';
  const yt = ids.map((id) => `<div class="embed-yt" data-yt="${id}"><img class="yt-poster" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy"><span class="yt-play">▶</span></div>`).join('');
  return `<div class="embeds">${yt}</div>`;
}
const ytCache = {};
function ytCacheGet(id) {
  if (ytCache[id]) return ytCache[id];
  try { const s = localStorage.getItem('life.yt.' + id); if (s) return (ytCache[id] = JSON.parse(s)); } catch {}
  return null;
}
function ytCacheSet(id, info) { ytCache[id] = info; try { localStorage.setItem('life.yt.' + id, JSON.stringify(info)); } catch {} }
// Resolve each poster: embeddable -> the player; blocked/unavailable -> a card.
async function hydrateEmbeds() {
  for (const el of [...document.querySelectorAll('.embed-yt[data-yt]:not([data-yt-done])')]) {
    const id = el.dataset.yt; el.dataset.ytDone = '1';
    let info = ytCacheGet(id);
    if (!info) { try { info = await api(`/api/ytinfo?id=${id}`); ytCacheSet(id, info); } catch { info = { embeddable: true }; } }
    if (info.embeddable) {
      el.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(info.title || 'YouTube video')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>`;
    } else {
      el.classList.add('is-card');
      const thumb = info.thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      const sub = info.unavailable ? 'This video is unavailable' : 'Can’t be embedded · watch on YouTube';
      el.innerHTML = `<a class="yt-card" href="https://www.youtube.com/watch?v=${id}" title="Open on YouTube">
        <span class="yt-card-thumb"><img src="${esc(thumb)}" alt="" loading="lazy"><span class="yt-play">▶</span></span>
        <span class="yt-card-meta"><span class="yt-card-title">${esc(info.title || 'YouTube video')}</span><span class="yt-card-src">${esc(sub)}</span></span></a>`;
    }
  }
  // Link cards for standalone non-YouTube URLs (Notion-style bookmark previews).
  for (const el of [...document.querySelectorAll('.link-card[data-linkcard]:not([data-lc-done])')]) {
    const u = el.dataset.linkcard; el.dataset.lcDone = '1';
    let info = lcCacheGet(u);
    // Ignore a cached error-page title (from before the scraper had a fallback)
    // and re-fetch, so old bad cards heal themselves.
    if (info && badLinkTitle(info.title)) info = null;
    if (!info) { try { info = await api(`/api/linkinfo?url=${encodeURIComponent(u)}`); lcCacheSet(u, info); } catch { info = {}; } }
    const host = prettyHost(u);
    const title = info.title || host;
    const icon = info.icon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    el.classList.remove('loading');
    const del = el.classList.contains('lc-inline') ? '<button class="lc-x" data-card-del title="Remove">×</button>' : '';
    el.innerHTML = `${info.image ? `<span class="lc-thumb"><img src="${esc(info.image)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></span>` : ''}<span class="lc-main"><span class="lc-title">${esc(title)}</span>${info.desc ? `<span class="lc-desc">${esc(info.desc)}</span>` : ''}<span class="lc-site"><img class="lc-fav" src="${esc(icon)}" alt="" loading="lazy" onerror="this.remove()">${esc(host)}</span></span>${del}`;
  }
}
// A scraped title that is really an error/challenge page, not the article.
const badLinkTitle = (t) => !t || /^\s*(error|forbidden|40[134]|access denied|attention required|just a moment|are you (a )?human|please wait)/i.test(t);
const lcCache = {};
function lcCacheGet(u) {
  if (lcCache[u]) return lcCache[u];
  try { const s = localStorage.getItem('life.lc.' + u); if (s) return (lcCache[u] = JSON.parse(s)); } catch {}
  return null;
}
function lcCacheSet(u, info) { lcCache[u] = info; try { localStorage.setItem('life.lc.' + u, JSON.stringify(info)); } catch {} }
// A URL sitting alone in its paragraph becomes an inline preview card, right
// where it was pasted (Notion-style). The card is a non-editable block inside
// the editor; sanitizeProse turns it back into a plain URL for storage, so the
// body stays clean text and the card is purely a display layer. YouTube is left
// inline as text (it renders as a player in the strip below).
function decorateProse(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  d.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href) || youtubeIds(href).length) return;
    const p = a.parentElement;
    if (!p || !/^(P|DIV)$/.test(p.tagName) || p.textContent.trim() !== a.textContent.trim()) return;
    const card = document.createElement('div');
    card.className = 'link-card lc-inline loading';
    card.setAttribute('contenteditable', 'false');
    card.setAttribute('data-linkcard', href);
    card.innerHTML = `<span class="lc-main"><span class="lc-title">${esc(prettyHost(href))}</span><span class="lc-site">${esc(prettyHost(href))}</span></span><button class="lc-x" data-card-del title="Remove">×</button>`;
    p.replaceWith(card);
  });
  // A trailing card leaves nowhere to type; add an empty line after it.
  const last = d.lastElementChild;
  if (last && last.classList && last.classList.contains('lc-inline')) {
    const p = document.createElement('p'); p.innerHTML = '<br>'; d.appendChild(p);
  }
  return d.innerHTML;
}
// An always-on inline editor. No modes, no markup - you just write, and the
// selection bubble (or ⌘B/⌘I) formats in place. `key` says which block it saves.
function proseEditor(body, key) {
  return `<div class="prose" contenteditable="true" spellcheck="true" data-prose="${key}" data-ph="Write something here…">${decorateProse(bodyToHtml(body))}</div>`;
}
// Keep saved HTML clean: a small whitelist, unwrap everything else, drop all
// attributes but a link's href. Content is Robin's own, so this is about
// tidiness (stray pasted styles) more than security.
const PROSE_OK = { P: 1, H1: 1, H2: 1, H3: 1, STRONG: 1, EM: 1, A: 1, BLOCKQUOTE: 1, BR: 1, CODE: 1, UL: 1, OL: 1, LI: 1, DETAILS: 1, SUMMARY: 1 };
function sanitizeProse(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // Inline link cards are display-only: store them back as a plain URL paragraph
  // so the body stays clean text, and decorateProse re-inflates the card on render.
  doc.querySelectorAll('[data-linkcard]').forEach((c) => {
    const u = c.getAttribute('data-linkcard') || '';
    const p = doc.createElement('p');
    const a = doc.createElement('a'); a.setAttribute('href', u); a.textContent = u;
    p.appendChild(a); c.replaceWith(p);
  });
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
      const keepOpen = el.tagName === 'DETAILS' && el.hasAttribute('open');   // remember collapse state
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (href && /^(https?:|mailto:)/i.test(href)) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      // Internal links to other Robski Life pages keep their href + a marker class.
      else if (href && /^#rl-(note|table|area)-[\w-]+$/i.test(href)) { el.setAttribute('href', href); el.setAttribute('class', 'rl-link'); }
      if (keepOpen) el.setAttribute('open', '');
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
    case 'journal': return 'Journal'; case 'journalentry': return (state.journal && state.journal.current && journalDateLabel((state.journal.current.props || {}).date)) || 'Journal';
    case 'readwatch': return 'Read & Watch';
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
    case 'journal': return openJournal(); case 'journalentry': return openJournalEntry(v.id);
    case 'readwatch': return openReadwatch();
    case 'table': return openTable(v.id); case 'tables': return openTablesList();
    case 'area': return openArea(v.id); case 'areas': return openAreasList();
    default: return openHome();
  }
}
// ── in-app history (Back) + breadcrumbs ──────────────
let navHist = [], navLastKey = null, navLastView = null;
const viewKey = (v) => `${v.type}:${v.id || ''}`;
// Called from renderNav on every render; pushes the previous view when the view
// actually changes, so Back returns to where you were.
function recordHistory() {
  const key = viewKey(state.view);
  if (key === navLastKey) return;
  if (navLastView) { navHist.push(navLastView); if (navHist.length > 60) navHist.shift(); }
  navLastKey = key; navLastView = { ...state.view };
}
function navBack() {
  if (!navHist.length) return;
  const prev = navHist.pop();
  navLastKey = null; navLastView = null;           // openView re-seeds without re-pushing
  Promise.resolve(openView(prev)).catch(() => openHome());
}
function areaLinkHtml(areaId) {
  if (!areaId) return '';
  const a = areaById(areaId); if (!a) return '';
  return `<button class="crumb-area" data-open-area="${a.id}" title="Go to the ${esc(a.title)} life area"><span class="ca-dot" style="background:hsl(${hueOf(a)} 55% 55%)"></span>${esc(a.title)}</button>`;
}
// A consistent breadcrumb bar: Back + Home › … › current, plus a link to the
// connected life area when there is one.
function crumbNav(trail, areaId) {
  const back = navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : '';
  const sep = '<span class="crumb-sep">›</span>';
  const t = trail.map((c, i) => (i === trail.length - 1
    ? `<span class="crumb cur">${esc(c.label)}</span>`
    : `<button class="crumb" ${c.attr || ''}>${esc(c.label)}</button>`)).join(sep);
  return `<div class="crumbbar">${back}<div class="crumbs">${t}</div>${areaLinkHtml(areaId)}</div>`;
}
// Breadcrumb for a top-level page: Home › <page>.
const pageCrumb = (label) => crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label }]);
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
    rows = state.favs.map((f) => sub(false, `data-fav-open="${f.kind}:${f.id}" draggable="true" data-fav-id="${f.id}"`, KIND_IC[f.kind] || '•', f.title)).join('') || '<div class="nav-sub muted">Star anything to pin it here</div>';
  } else if (key === 'notes') {
    title = 'Notes'; add = '<button class="nav-add" data-new-note title="New note">+</button>';
    rows = state.noteTops.map((n) => sub(v.type === 'note' && state.note && state.note.path[0] && state.note.path[0].id === n.id, `data-open-note="${n.id}"`, '▸', n.title)).join('') || '<div class="nav-sub muted">No notes yet</div>';
  } else if (key === 'tables') {
    title = 'Tables'; add = '<button class="nav-add" data-new-table title="New table">+</button>';
    rows = state.tables.map((t) => sub(v.type === 'table' && state.tables_open && state.tables_open.id === t.id, `data-open-table="${t.id}"`, '▦', t.title)).join('') || '<div class="nav-sub muted">No tables yet</div>';
  } else {
    title = 'Life areas'; add = '<button class="nav-add" data-new-area title="New life area">+</button>';
    rows = state.areas.map((a) => sub(v.type === 'area' && state.area_open && state.area_open.area && state.area_open.area.id === a.id, `data-open-area="${a.id}"`, '◈', a.title)).join('') || '<div class="nav-sub muted">No life areas yet</div>';
  }
  return `<div class="nav-sec" data-nav-sec="${key}">
    <div class="nav-sec-h" draggable="true" data-sec-toggle="${key}" title="${collapsed ? 'Expand' : 'Collapse'}">
      <span class="nav-chev">${chev}</span>
      <span class="nav-sec-title">${title}</span>
      ${add}<span class="nav-grip" title="Drag to reorder">⠿</span>
    </div>
    ${collapsed ? '' : `<div class="nav-sec-body"${key === 'favs' ? ' id="favs"' : ''}>${rows}</div>`}
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
  const m = themeMode();
  // From Auto, flip straight to the OPPOSITE of what's showing (one visible click,
  // no dead Auto→same-colour step). Then dark→auto returns to automatic.
  const next = m === 'auto' ? (autoIsDark() ? 'light' : 'dark') : (m === 'light' ? 'dark' : 'auto');
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
    <div class="nav-brand" data-view-home title="Home">Robski<span class="dot">·</span><em>Life</em></div>
    <div class="nav-foot">
      <button class="foot-search" data-palette title="Search">⌕</button>
    </div>
    <button class="nav-k" data-palette><span>Search or jump…</span><kbd>⌘K</kbd></button>
    <div class="nav-grid">
    <button class="nav-item ${v.type === 'home' ? 'on' : ''}" data-view-home><span>⌂</span><span class="nav-lbl">Home</span></button>
    <button class="nav-item ${v.type === 'today' ? 'on' : ''}" data-open-today><span>☀</span><span class="nav-lbl">Today</span></button>
    <button class="nav-item ${v.type === 'tasks' || v.type === 'taskcard' ? 'on' : ''}" data-view-tasks><span>✓</span><span class="nav-lbl">Tasks</span><span class="nav-quick" data-quick-add="task" title="New task">+</span></button>
    <button class="nav-item ${v.type === 'areas' || v.type === 'area' ? 'on' : ''}" data-open-areas><span>◈</span><span class="nav-lbl">Life areas</span></button>
    <button class="nav-item ${v.type === 'mail' ? 'on' : ''}" data-open-mail><span>✉</span><span class="nav-lbl">Mail</span><span class="nav-quick" data-quick-add="mail" title="New email">+</span></button>
    <button class="nav-item ${v.type === 'notes' ? 'on' : ''}" data-open-notes><span>▤</span><span class="nav-lbl">Notes</span><span class="nav-quick" data-quick-add="note" title="New note">+</span></button>
    <button class="nav-item ${v.type === 'journal' || v.type === 'journalentry' ? 'on' : ''}" data-open-journal><span>✎</span><span class="nav-lbl">Journal</span><span class="nav-quick" data-quick-add="journal" title="New entry">+</span></button>
    <button class="nav-item ${v.type === 'readwatch' ? 'on' : ''}" data-open-readwatch><span>🔖</span><span class="nav-lbl">Saved</span><span class="nav-quick" data-quick-add="save" title="Save a link">+</span></button>
      <button class="nav-item ${v.type === 'tables' ? 'on' : ''}" data-open-tables><span>▦</span><span class="nav-lbl">Tables</span><span class="nav-quick" data-add-table-entry title="Add an entry to a table">+</span></button>
      <button class="nav-item ${v.type === 'calendar' ? 'on' : ''}" data-open-calendar><span>◑</span><span class="nav-lbl">Calendar</span><span class="nav-quick" data-quick-add="event" title="New event">+</span></button>
    </div>
    <div class="nav-secs" id="nav-secs">${state.nav.order.map((k) => navSection(k, v)).join('')}</div>
    <div class="nav-bottom">
      <button class="nav-theme" data-theme-toggle title="Theme — Auto follows local sunrise &amp; sunset; press to override">${themeLabel()}</button>
    </div>`;
  renderTabbar(v);
  syncActiveTab(); renderTabs(); recordHistory();
}
// Sidebar quick-add: jump to the tool and open its "new" affordance directly.
async function quickAdd(kind) {
  try {
    if (kind === 'task') { await openTasks(); state.taskAdding = true; renderTasks(); setTimeout(() => { const i = $('#task-title'); if (i) i.focus(); }, 0); }
    else if (kind === 'event') { await openCalendar(); state.cal.adding = true; state.cal.editing = null; renderCalendar(); setTimeout(() => { const i = $('#ce-title'); if (i) i.focus(); }, 0); }
    else if (kind === 'mail') { await openMail(); startCompose(); }
    else if (kind === 'note') { await newNote(null); }
    else if (kind === 'journal') { await openJournal(); await startJournalEntry(); }
    else if (kind === 'save') { await openReadwatch(); setTimeout(() => { const i = $('#rw-url'); if (i) i.focus(); }, 0); }
  } catch (e) { toast(e.message); }
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
  state.tables_open = table; state.tables_rows = rows; state.tables_view = { openRow: null, addingCol: false, sorts: (table.props && table.props.sorts) || [], sorting: false };
  state.view = { type: 'table', id };
  bumpTableRecent(id);
  renderNav(); renderTable();
}
// Most-recently-opened order, for the "add an entry" picker.
function tableRecents() { try { return JSON.parse(localStorage.getItem('life.tblRecent') || '[]'); } catch { return []; } }
function bumpTableRecent(id) { const r = tableRecents().filter((x) => x !== id); r.unshift(id); try { localStorage.setItem('life.tblRecent', JSON.stringify(r.slice(0, 60))); } catch {} }
function tablesByRecent() {
  const r = tableRecents(); const rank = (id) => { const i = r.indexOf(id); return i < 0 ? Infinity : i; };
  return [...(state.tables || [])].sort((a, b) => (rank(a.id) - rank(b.id)) || (a.title || '').localeCompare(b.title || ''));
}
// Pick a table from a most-recent-first list, then drop a fresh row on top of it.
function openTableEntryPicker() {
  if (!state.tables || !state.tables.length) { toast('No tables yet - make one first.'); return; }
  let el = document.getElementById('tblpick-overlay');
  if (!el) { el = document.createElement('div'); el.id = 'tblpick-overlay'; document.body.appendChild(el); }
  const items = tablesByRecent().map((t) => `<button class="pal-item" data-tblpick="${t.id}"><span class="pal-kind muted">▦</span><span class="pal-t">${esc(t.title || 'Untitled')}</span></button>`).join('');
  el.innerHTML = `<div class="pal-bg" data-tblpick-bg><div class="pal">
    <div class="pal-title">Add an entry to…</div>
    <div class="pal-list">${items}</div></div></div>`;
}
function closeTableEntryPicker() { const el = document.getElementById('tblpick-overlay'); if (el) el.innerHTML = ''; }
async function addTableEntry(id) {
  closeTableEntryPicker();
  try { await openTable(id); await addRow(); } catch (e) { toast(e.message); }
}

// ── view: home ───────────────────────────────────────
const hhmm = (m) => `${String((m / 60) | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const KIND_IC = { note: '▤', table: '▦', task: '✓', row: '▦', area: '◈' };
const KIND_LABEL = { task: 'Tasks', note: 'Notes', table: 'Tables', area: 'Life areas' };

async function openHome() {
  state.view = { type: 'home' };
  const [favs, day, pad] = await Promise.all([
    api('/api/favorites').catch(() => state.favs),
    api('/api/day').catch(() => ({ events: [] })),
    api('/api/kv/home_scratchpad').catch(() => ({ value: '' })),
  ]);
  state.favs = favs; state.home = { events: day.events || [], slots: day.slots || [], lanes: day.lanes || [], notepad: (pad && pad.value) || '' };
  renderNav(); renderHome();
}
// Home "Today" = calendar events + the blocks placed on the Today tool (timed
// practices and task-bearing slots), merged and sorted by time. A slot that
// carries Life tasks lists them; a bare practice shows the block on its own.
// This is the "bits added to Today but not the calendar" Robin wanted surfaced.
function homeTodayItems() {
  const hues = {}; (state.home.lanes || []).forEach((l) => { hues[l.key] = l.hue; });
  const items = (state.home.events || []).map((e) => ({ kind: 'event', allDay: !!e.allDay, start_min: e.allDay ? null : (e.start_min ?? 0), sort: e.allDay ? -1 : (e.start_min ?? 0), title: e.title, location: e.location }));
  for (const s of state.home.slots || []) {
    const hue = hues[s.lane] ?? 0;
    const tasks = (s.tasks || []).filter((t) => t && t.title);
    if (!s.practice && tasks.length) {
      // One row per task the slot carries, so a busy block reads as its tasks.
      tasks.forEach((t) => items.push({ kind: 'slot', start_min: s.start_min ?? null, sort: s.start_min ?? 100000, hue, title: t.title, done: !!t.done }));
    } else {
      items.push({ kind: 'slot', start_min: s.start_min ?? null, sort: s.start_min ?? 100000, hue, title: s.title || 'Block', done: !!s.done, badge: s.practice ? 'practice' : null });
    }
  }
  return items.sort((a, b) => a.sort - b.sort);
}
function renderHome() {
  const favs = state.favs || [];
  const ev = (state.home.events || []).slice().sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start_min ?? 0) - (b.start_min ?? 0));
  const todayItems = homeTodayItems();
  // Compact cards, grouped by kind (Tasks, Notes, Tables, Life areas).
  const favGroups = ['task', 'note', 'table', 'area'].map((k) => {
    const list = favs.filter((f) => f.kind === k); if (!list.length) return '';
    return `<div class="fav-group"><div class="fav-group-h">${KIND_LABEL[k]}</div><div class="fav-cards">${list.map((f) => `<div class="fav-card"><button class="fav-card-open" data-fav-open="${f.kind}:${f.id}"><span class="fav-ic">${KIND_IC[f.kind] || '•'}</span><span class="fav-t">${esc(f.title || 'Untitled')}</span></button><button class="fav-x" data-unfav="${f.id}" title="Remove">×</button></div>`).join('')}</div></div>`;
  }).join('');
  const evRows = todayItems.map((it) => it.kind === 'event'
    ? `<div class="ev-row"><span class="ev-time">${it.allDay ? 'all day' : hhmm(it.start_min)}</span><span class="ev-t">${esc(it.title)}</span>${it.location ? `<span class="ev-loc">${esc(it.location)}</span>` : ''}</div>`
    : `<div class="ev-row ev-slot${it.done ? ' done' : ''}"><span class="ev-time">${it.start_min == null ? 'anytime' : hhmm(it.start_min)}</span><span class="ev-t"><span class="ev-dot" style="--h:${it.hue}"></span>${esc(it.title)}</span>${it.badge ? `<span class="ev-loc">${esc(it.badge)}</span>` : ''}</div>`).join('');
  $('#pane').innerHTML = `
    <div class="home">
      <div class="home-head">
        <h1>${greeting()}, <span class="hi-name">Robski</span></h1>
        <div class="home-actions"><button class="add-btn wide" data-new-note>+ Note</button><button class="add-btn wide" data-quick-task>+ Task</button><button class="add-btn wide" data-quick-event>+ Event</button></div>
      </div>
      <div id="qt-wrap"></div>
      <nav class="home-nav">
        <button class="hn-btn" data-open-today><span class="hn-ic">☀</span>Today</button>
        <span class="hn-group"><button class="hn-btn" data-view-tasks><span class="hn-ic">✓</span>Tasks</button><button class="hn-plus" data-quick-add="task" title="New task">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-calendar><span class="hn-ic">◑</span>Calendar</button><button class="hn-plus" data-quick-add="event" title="New event">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-mail><span class="hn-ic">✉</span>Mail</button><button class="hn-plus" data-quick-add="mail" title="New email">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-notes><span class="hn-ic">▤</span>Notes</button><button class="hn-plus" data-new-note title="New note">+</button></span>
        <span class="hn-group"><button class="hn-btn" data-open-tables><span class="hn-ic">▦</span>Tables</button><button class="hn-plus" data-new-table title="New table">+</button></span>
        <button class="hn-btn" data-open-areas><span class="hn-ic">◈</span>Life areas</button>
      </nav>
      <div class="home-body">
        <div class="home-main">
          <section class="home-sec">
            <div class="home-sec-h">Today</div>
            <div class="today-cal">${evRows || '<div class="home-empty">Nothing planned today. Open Today to add practices and tasks.</div>'}</div>
          </section>
          <section class="home-sec">
            <div class="home-sec-h">Favourites</div>
            ${favs.length ? favGroups : '<div class="home-empty">Star a task, note, table or area (the ☆ on it) to pin it here.</div>'}
          </section>
        </div>
        <aside class="home-side">
          <section class="home-sec">
            <div class="home-sec-h">Notepad</div>
            <textarea class="home-notepad" data-home-notepad placeholder="Jot anything here — it's saved automatically and waiting for you next time.">${esc(state.home.notepad || '')}</textarea>
          </section>
        </aside>
      </div>
    </div>`;
}
function openTablesList() {
  state.view = { type: 'tables' };
  renderNav();
  const favTables = state.tables.filter((t) => t.props && t.props.fav);
  const cards = (list) => list.map((t) => `<button class="tbl-card" data-open-table="${t.id}"><span class="tc-ic">▦</span>${esc(t.title || 'Untitled')}</button>`).join('');
  $('#pane').innerHTML = `
    ${pageCrumb('Tables')}
    <div class="pane-head home-head"><h1>Tables</h1><button class="add-btn wide" data-new-table>+ New table</button></div>
    ${favTables.length ? `<section class="home-sec"><div class="home-sec-h">Favourites</div><div class="tbl-cards">${cards(favTables)}</div></section>` : ''}
    <section class="home-sec"><div class="home-sec-h">All tables · ${state.tables.length}</div><div class="tbl-cards">${cards(state.tables) || '<div class="empty">No tables yet.</div>'}</div></section>`;
}

function openNotesList() {
  state.view = { type: 'notes' };
  renderNav();
  renderNotesList();
}
function renderNotesList() {
  const q = (state.notesQuery || '').trim().toLowerCase();
  const favNotes = state.noteTops.filter((n) => n.props && n.props.fav);
  const all = q ? state.noteTops.filter((n) => (n.title || '').toLowerCase().includes(q)) : state.noteTops;
  const cards = (list) => list.map((n) => `<button class="tbl-card" data-open-note="${n.id}"><span class="tc-ic">▸</span>${esc(n.title || 'Untitled')}${areaTag(n)}</button>`).join('');
  $('#pane').innerHTML = `
    ${pageCrumb('Notes')}
    <div class="pane-head home-head"><h1>Notes</h1><button class="add-btn wide" data-new-note>+ New note</button></div>
    <input class="list-search sel" data-notes-q placeholder="Search notes…" value="${esc(state.notesQuery || '')}" autocomplete="off">
    ${!q && favNotes.length ? `<section class="home-sec"><div class="home-sec-h">Favourites</div><div class="tbl-cards">${cards(favNotes)}</div></section>` : ''}
    <section class="home-sec"><div class="home-sec-h">${q ? `Results · ${all.length}` : `All notes · ${state.noteTops.length}`}</div><div class="tbl-cards">${cards(all) || `<div class="empty">${q ? 'No notes match.' : 'No notes yet.'}</div>`}</div></section>`;
}

// ── Journal ──────────────────────────────────────────
// Entries are top-level blocks (kind 'journal') with props {date, mode, prompt}.
// The prompt and any "Dig deeper" question live in the body as <blockquote>s;
// answers are ordinary paragraphs. Nothing leaves the device unless Dig deeper
// is pressed (see /api/journal/deepen).
const JOURNAL_MODES = [
  { key: 'reflect', label: 'Reflect on the day', icon: '🌙', prompts: [
    'What happened today that I want to remember?',
    'What went well today, and what part did I play in it?',
    'What drained me today, and what is it telling me?',
    'What did I learn today - about the world, or about myself?',
  ] },
  { key: 'gratitude', label: 'Gratitude', icon: '🙏', prompts: [
    'Three things I am grateful for right now, and why each one matters.',
    'Who made my day a little better today, and how?',
    'What ordinary thing would I miss most if it were suddenly gone?',
  ] },
  { key: 'work-through', label: 'Work through something', icon: '🌀', prompts: [
    'What is weighing on me right now? Let me name it plainly.',
    'What am I telling myself about this - and what is the evidence for and against it?',
    'What here is in my control, and what is not?',
    'If a good friend brought me this exact problem, what would I tell them?',
  ] },
  { key: 'intention', label: 'Set an intention', icon: '🎯', prompts: [
    'In one sentence, what do I want tomorrow to be about?',
    'What is the one thing that, done, would make tomorrow a win?',
    'What obstacle is most likely to trip me up - and what is my plan for it?',
  ] },
  { key: 'dreams', label: 'Dream journal', icon: '💭', prompts: [
    'Describe the dream in as much detail as I can remember - people, places, what happened, and how it ended.',
    'What was the strongest feeling in the dream, and did it linger after I woke?',
    'What in the dream felt most strange, vivid, or important?',
  ] },
  { key: 'free', label: 'Free write', icon: '✍️', prompts: [
    'Just start writing, and do not stop to edit. See where it goes.',
  ] },
];
const journalModeOf = (key) => JOURNAL_MODES.find((m) => m.key === key) || null;
function journalDateLabel(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function journalSnippet(n) {
  const d = document.createElement('div'); d.innerHTML = String(n.body || '');
  const p = [...d.querySelectorAll('p')].map((x) => x.textContent.trim()).find(Boolean);
  return (p || d.textContent.trim() || 'Empty entry').slice(0, 120);
}
async function openJournal() {
  state.view = { type: 'journal' };
  renderNav();
  try {
    const entries = await api('/api/blocks?kind=journal&parent_id=');
    entries.sort((a, b) => String((b.props && b.props.date) || b.created_at || '').localeCompare(String((a.props && a.props.date) || a.created_at || '')));
    state.journal = { entries, picking: false };
  } catch (e) { state.journal = { entries: [], picking: false }; toast(e.message); }
  renderJournalList();
}
function renderJournalList() {
  const j = state.journal || { entries: [] };
  const entries = j.entries || [];
  const picker = j.picking ? `<div class="j-picker">
    <div class="j-picker-h">How do you want to start?</div>
    ${JOURNAL_MODES.map((m) => `<div class="j-mode">
      <div class="j-mode-h"><span class="j-mode-ic">${m.icon}</span>${esc(m.label)}</div>
      <div class="j-prompts">${m.prompts.map((p) => `<button class="j-prompt-chip" data-journal-new="${esc(m.key)}" data-journal-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    </div>`).join('')}
    <button class="ghost j-picker-cancel" data-journal-pick-cancel>Cancel</button>
  </div>` : '';
  const cards = entries.map((n) => {
    const mode = journalModeOf(n.props && n.props.mode);
    return `<button class="j-card" data-open-jentry="${n.id}">
      <span class="j-card-date">${esc(journalDateLabel((n.props && n.props.date) || n.created_at))}</span>
      <span class="j-card-snip">${esc(journalSnippet(n))}</span>
      ${mode ? `<span class="j-card-mode">${mode.icon} ${esc(mode.label)}</span>` : ''}</button>`;
  }).join('');
  $('#pane').innerHTML = `
    ${pageCrumb('Journal')}
    <div class="pane-head home-head"><h1>Journal</h1>${j.picking ? '' : '<button class="add-btn wide" data-journal-start>+ New entry</button>'}</div>
    ${picker}
    <div class="j-list">${cards || (j.picking ? '' : '<div class="empty">No entries yet. Start your first one above.</div>')}</div>`;
}
async function startJournalEntry() {
  if (!state.journal) await openJournal();
  state.journal.picking = true; renderJournalList();
}
async function newJournalEntry(modeKey, prompt) {
  const date = new Date().toISOString();
  const body = `<blockquote>${esc(prompt)}</blockquote><p><br></p>`;
  try {
    const entry = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'journal', title: journalDateLabel(date), body, props: { date, mode: modeKey, prompt } }) });
    state.journal = state.journal || { entries: [] };
    state.journal.entries = state.journal.entries || []; state.journal.entries.unshift(entry);
    await openJournalEntry(entry.id);
  } catch (e) { toast(e.message); }
}
async function openJournalEntry(id) {
  const entry = await api(`/api/blocks/${id}`);
  state.journal = state.journal || { entries: [] };
  state.journal.current = entry;
  state.view = { type: 'journalentry', id };
  renderNav(); renderJournalEntry();
}
const journalDeeperLabel = (mode) => (mode === 'dreams' ? '✦ Interpret & explore' : '✦ Dig deeper');
function renderJournalEntry() {
  const n = state.journal.current;
  const mode = journalModeOf(n.props && n.props.mode);
  const isDream = (n.props && n.props.mode) === 'dreams';
  const sep = '<span class="crumb-sep">›</span>';
  const dateLabel = journalDateLabel((n.props && n.props.date) || n.created_at);
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button>${sep}<button class="crumb" data-open-journal>Journal</button>${sep}<span class="crumb cur">${esc(dateLabel)}</span>
      <span class="crumb-tools"><button class="note-del ghost" data-del-journal title="Delete this entry">Delete</button></span></div>
    <div class="j-entry">
      <div class="j-entry-head"><h1 class="j-entry-date">${esc(dateLabel)}</h1>${mode ? `<span class="j-card-mode">${mode.icon} ${esc(mode.label)}</span>` : ''}</div>
      <div class="note-body">${proseEditor(n.body, 'journal')}</div>
      <div class="j-deeper-bar">
        <button class="add-btn j-deeper" data-journal-deeper>${journalDeeperLabel(n.props && n.props.mode)}</button>
        <span class="j-deeper-hint">${isDream ? 'Claude reads your dream, offers a gentle interpretation, then asks a question to explore it further. Use it as often as you like.' : 'Claude reads your entry and asks one question to take it further. Use it as often as you like.'}</span>
      </div>
    </div>`;
}
async function journalDeepen() {
  const n = state.journal && state.journal.current; if (!n) return;
  const ed = document.querySelector('.prose[data-prose="journal"]');
  const text = ed ? (ed.innerText || '').trim() : '';
  const btn = document.querySelector('[data-journal-deeper]');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Thinking…'; }
  try {
    const { question } = await api('/api/journal/deepen', { method: 'POST', body: JSON.stringify({ mode: n.props && n.props.mode, prompt: n.props && n.props.prompt, text }) });
    if (ed && question) {
      ed.insertAdjacentHTML('beforeend', `<blockquote>${esc(question).replace(/\n+/g, '<br>')}</blockquote><p><br></p>`);
      saveProse('journal', ed.innerHTML);
      const p = ed.lastElementChild;
      if (p) { const r = document.createRange(); r.selectNodeContents(p); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); p.scrollIntoView({ block: 'center' }); }
    }
  } catch (e) { toast(e.message); }
  finally { const b = document.querySelector('[data-journal-deeper]'); if (b) { b.disabled = false; b.textContent = journalDeeperLabel(n.props && n.props.mode); } }
}
async function delJournalEntry() {
  const n = state.journal && state.journal.current; if (!n) return;
  if (!(await uiConfirm('Delete this journal entry?', { title: 'Delete entry', okLabel: 'Delete', danger: true }))) return;
  try { await api(`/api/blocks/${n.id}`, { method: 'DELETE' }); if (state.journal.entries) state.journal.entries = state.journal.entries.filter((e) => e.id !== n.id); state.journal.current = null; await openJournal(); } catch (e) { toast(e.message); }
}

// ── Read & Watch (bookmarks) ─────────────────────────
// Saved links: blocks kind 'bookmark', props {url,title,image,site,media,status,added}.
// Captured via the iOS Shortcut / desktop bookmarklet (/api/capture) or pasted here.
const RW_TABS = [['todo', 'Unread'], ['read', 'To read'], ['watch', 'To watch'], ['done', 'Done']];
function rwMatch(b, f) {
  const p = b.props || {}; const done = p.status === 'done';
  if (f === 'done') return done;
  if (f === 'read') return !done && p.media !== 'video';
  if (f === 'watch') return !done && p.media === 'video';
  return !done; // 'todo' = everything unfinished
}
async function openReadwatch() {
  state.view = { type: 'readwatch' };
  renderNav();
  const prev = state.rw || {};
  try { state.rw = { items: await api('/api/blocks?kind=bookmark&parent_id='), filter: prev.filter || 'todo', setup: prev.setup, showSetup: false, saving: false }; }
  catch (e) { state.rw = { items: [], filter: 'todo' }; toast(e.message); }
  state.rw.items.sort((a, b) => String((b.props && b.props.added) || b.created_at || '').localeCompare(String((a.props && a.props.added) || a.created_at || '')));
  renderReadwatch();
}
function renderReadwatch() {
  const rw = state.rw || { items: [], filter: 'todo' };
  const items = rw.items || [];
  const count = (f) => items.filter((b) => rwMatch(b, f)).length;
  const tabs = RW_TABS.map(([k, l]) => `<button class="rw-tab ${rw.filter === k ? 'on' : ''}" data-rw-filter="${k}">${l}<span class="rw-tab-n">${count(k)}</span></button>`).join('');
  const shown = items.filter((b) => rwMatch(b, rw.filter));
  const cards = shown.map((b) => {
    const p = b.props || {}; const done = p.status === 'done'; const vid = p.media === 'video';
    return `<div class="rw-card ${done ? 'done' : ''}">
      <a class="rw-thumb ${vid ? 'vid' : ''}" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="rw-thumb-ic">${vid ? '▶' : '▤'}</span></a>
      <div class="rw-body">
        <a class="rw-title" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title || p.url)}</a>
        <div class="rw-meta"><span class="rw-media">${vid ? '▶ Video' : '▤ Article'}</span>${p.site ? `<span class="rw-site">${esc(p.site)}</span>` : ''}<span class="rw-added">${fmtDate(p.added || b.created_at)}</span></div>
      </div>
      <div class="rw-actions">
        <button class="rw-done ${done ? 'on' : ''}" data-rw-done="${b.id}" title="${done ? 'Mark unread' : 'Mark done'}">✓</button>
        <button class="rw-del" data-rw-del="${b.id}" title="Remove">×</button>
      </div>
    </div>`;
  }).join('');
  $('#pane').innerHTML = `
    ${pageCrumb('Read & Watch')}
    <div class="pane-head home-head"><h1>Read &amp; Watch</h1><button class="ghost rw-setup-btn" data-rw-setup title="Set up one-tap saving">⚙ Quick-save</button></div>
    <form class="rw-add" id="rw-add-form"><input id="rw-url" placeholder="Paste a link to save…" autocomplete="off" inputmode="url" ${rw.saving ? 'disabled' : ''}><button class="add-btn" type="submit" ${rw.saving ? 'disabled' : ''}>${rw.saving ? 'Saving…' : 'Save'}</button></form>
    <div id="rw-setup">${rw.showSetup ? rwSetupHtml() : ''}</div>
    <div class="rw-tabs">${tabs}</div>
    <div class="rw-list">${cards || `<div class="empty">${rw.filter === 'done' ? 'Nothing finished yet.' : 'Nothing here yet. Paste a link above, or set up one-tap saving.'}</div>`}</div>`;
}
function rwSetupHtml() {
  const s = state.rw && state.rw.setup;
  if (!s) return '<div class="rw-setup-panel"><div class="empty" style="padding:20px">Loading your save link…</div></div>';
  const bm = `javascript:(function(){window.open('${s.origin}/api/capture?key=${s.key}&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'robski','width=400,height=320')})()`;
  const capUrl = `${s.origin}/api/capture?key=${s.key}&url=`;
  return `<div class="rw-setup-panel">
    <div class="rw-setup-h">One-tap saving</div>
    <div class="rw-setup-sec"><b>On your Mac</b> — drag this to your bookmarks bar, then click it on any page to save it:
      <div class="rw-bm-row"><a class="rw-bookmarklet" href="${esc(bm)}" data-rw-bm draggable="true">🔖 Save to Robski</a></div></div>
    <div class="rw-setup-sec"><b>On your iPhone</b> — make a Shortcut called “Save to Robski”:
      <ol><li>Shortcuts app → <b>+</b> → add action <b>Get Contents of URL</b>.</li><li>Set its URL to <code class="rw-code">${esc(capUrl)}</code> and then insert the <b>Shortcut Input</b> variable right after <code>url=</code>.</li><li>In the shortcut settings (ⓘ) turn on <b>Show in Share Sheet</b> and accept <b>URLs</b>.</li></ol>
      Then anywhere: <b>Share → Save to Robski</b>.</div>
    <div class="rw-setup-note">This save link is private to you.</div>
  </div>`;
}
async function rwToggleSetup() {
  state.rw = state.rw || { items: [], filter: 'todo' };
  state.rw.showSetup = !state.rw.showSetup;
  if (state.rw.showSetup && !state.rw.setup) { try { state.rw.setup = await api('/api/bookmark/setup'); } catch (e) { toast(e.message); } }
  renderReadwatch();
}
async function rwSave(url) {
  url = (url || '').trim(); if (!url || !state.rw) return;
  state.rw.saving = true; renderReadwatch();
  try { const bm = await api('/api/bookmark', { method: 'POST', body: JSON.stringify({ url }) }); state.rw.items.unshift(bm); state.rw.saving = false; renderReadwatch(); toast('Saved'); }
  catch (e) { state.rw.saving = false; renderReadwatch(); toast(e.message); }
}
async function rwSetDone(id, done) {
  const b = (state.rw.items || []).find((x) => x.id === id); if (!b) return;
  b.props = b.props || {}; b.props.status = done ? 'done' : 'todo';
  renderReadwatch();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { status: b.props.status } }) }); } catch (e) { toast(e.message); }
}
async function rwDelete(id) {
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); state.rw.items = (state.rw.items || []).filter((x) => x.id !== id); renderReadwatch(); } catch (e) { toast(e.message); }
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
    ${pageCrumb('Life areas')}
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
  // Every note that carries this area shows here. The 2026-08-12 cleanup pruned
  // the area off notes nested deeper than first level (they had inherited it from
  // the Tana import), so this stays a readable outline - and any note you now
  // associate with the area appears here, whatever its depth.
  const notes = blocks.filter((b) => b.kind === 'note');
  const h = hueOf(area);
  const tblCards = tables.map((t) => `<button class="tbl-card" data-open-table="${t.id}"><span class="tc-ic">▦</span>${esc(t.title || 'Untitled')}</button>`).join('');
  const noteCards = notes.map((n) => `<button class="tbl-card" data-open-note="${n.id}"><span class="tc-ic">▤</span>${esc(n.title || 'Untitled')}</button>`).join('');
  const sec = (label, n, inner) => n ? `<section class="home-sec"><div class="home-sec-h">${label} · ${n}</div>${inner}</section>` : '';
  $('#pane').innerHTML = `
    <div class="area-hero" style="--h:${h}">
      <div class="area-hero-top">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-areas>Life areas</button>
        <button class="star ${area.props && area.props.fav ? 'on' : ''}" data-fav="${area.id}" title="Favourite">${area.props && area.props.fav ? '★' : '☆'}</button></div>
      <h1><span class="ac-dot"></span><input class="area-title-edit" id="area-title" value="${esc(area.title)}" placeholder="Life area" data-area-rename></h1>
      <p class="area-meta">${notes.length} note${notes.length === 1 ? '' : 's'} · ${tables.length} table${tables.length === 1 ? '' : 's'} · ${openTs.length} open task${openTs.length === 1 ? '' : 's'}</p>
      <div class="area-actions"><button class="add-btn wide" data-area-add-task>+ Add task</button><button class="add-btn wide" data-area-add-note>+ Add note</button></div>
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
// From a life-area page: create a task/note already tagged to this area, then
// open it for naming. It shows up in the Tasks/Notes lists too.
async function areaAddTask() {
  const area = state.area_open && state.area_open.area; if (!area) return;
  try {
    const t = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title: '', props: { area: area.id, area_name: area.title, priority: 'P3', done: false } }) });
    await openTaskCard(t.id); setTimeout(() => $('#taskcard-title') && $('#taskcard-title').focus(), 30);
  } catch (e) { toast(e.message); }
}
async function areaAddNote() {
  const area = state.area_open && state.area_open.area; if (!area) return;
  try {
    const n = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title: '', parent_id: null, props: { area: area.id } }) });
    state.noteTops.unshift(n);
    await openNote(n.id); setTimeout(() => $('#note-title') && $('#note-title').focus(), 30);
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
  const cq = (state.calQuery || '').trim().toLowerCase();
  const matches = cq ? state.cal.events
    .filter((e) => (e.title || '').toLowerCase().includes(cq) || (e.location || '').toLowerCase().includes(cq))
    .sort((a, b) => `${a.date}${a.allDay ? '' : p2(Math.floor((a.start_min || 0) / 60))}`.localeCompare(`${b.date}${b.allDay ? '' : p2(Math.floor((b.start_min || 0) / 60))}`)) : [];
  const searchBlock = `<section class="cal-search">
      <div class="cal-search-h"><h2>Results · ${matches.length}</h2><span class="cal-search-note">in the loaded range</span></div>
      ${matches.length ? matches.map((e) => `<button class="cal-ag-row" data-cal-ev="${e.id}"><span class="cal-ag-time">${esc(prettyDate(e.date))}${e.allDay ? '' : ` · ${minToLabel(e.start_min)}`}</span><span class="cal-ag-t">${esc(e.title)}</span>${e.location ? `<span class="cal-ag-loc">${esc(e.location)}</span>` : ''}</button>`).join('') : '<div class="home-empty">No events match. Move to another month to search it.</div>'}</section>`;
  $('#pane').innerHTML = `
    ${pageCrumb('Calendar')}
    <div class="cal-head">
      <h1>${title}</h1>
      <div class="cal-nav">
        <div class="cal-modes"><button class="cal-mode ${c.mode === 'month' ? 'on' : ''}" data-cal-mode="month">Month</button><button class="cal-mode ${c.mode === 'week' ? 'on' : ''}" data-cal-mode="week">Week</button></div>
        <button class="cal-btn" data-cal-today>Today</button>
        <button class="cal-btn ic" data-cal-prev title="Previous">‹</button>
        <button class="cal-btn ic" data-cal-next title="Next">›</button>
      </div>
    </div>
    <input class="list-search sel" data-cal-q placeholder="Search calendar…" value="${esc(state.calQuery || '')}" autocomplete="off">
    ${c.error && c.error !== null ? `<div class="cal-warn">Calendar: ${esc(String(c.error))}</div>` : ''}
    ${cq ? searchBlock : `<section class="cal-agenda cal-agenda-top">
      <div class="cal-ag-head"><h2>${prettyDate(c.selected)}</h2><button class="add-btn wide" data-cal-add>+ Event</button></div>
      <div id="cal-form"></div>
      <div class="cal-ag-list">${agendaRows}</div>
    </section>
    ${body}`}`;
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
    <input id="ce-date" type="date" class="sel" required value="${ev ? ev.date : (c.selected || todayISO())}" title="Date">
    <label class="ce-allday"><input type="checkbox" id="ce-allday" ${allDay ? 'checked' : ''}> All day</label>
    <span id="ce-timerow" class="ce-timerow" ${allDay ? 'hidden' : ''}>
      <input id="ce-time" type="time" class="sel" value="${time}">
      <select id="ce-dur" class="sel">${durationOptions(dur)}</select></span>
    <input id="ce-loc" class="sel" placeholder="Location (optional)" autocomplete="off" value="${esc(loc)}">
    ${ev ? (ev.recurringId ? '<span class="ce-recur-note">↻ Part of a repeating series</span>' : '') : `<select id="ce-repeat" class="sel" title="Repeat">
      <option value="none">Does not repeat</option>
      <option value="daily">Daily</option>
      <option value="weekdays">Every weekday (Mon-Fri)</option>
      <option value="weekly">Weekly</option>
      <option value="monthly">Monthly</option>
      <option value="yearly">Yearly</option></select>`}
    <button class="add-btn wide" type="submit">${ev ? 'Save' : 'Add to calendar'}</button>
    ${ev ? '<button type="button" class="ghost cal-del" data-cal-del>Delete</button>' : ''}</form>`;
  $('#ce-title').focus();
}
async function calSaveEvent(id, title, day, time, duration, location, allDay, repeat) {
  day = day || state.cal.selected;
  const rep = !id && repeat && repeat !== 'none' ? { repeat } : {};
  const body = JSON.stringify(allDay
    ? { title, day, allDay: true, location: location || undefined, ...rep }
    : { title, day, start_min: isoToMin(time), duration: Number(duration), location: location || undefined, ...rep });
  try {
    if (id) await api(`/api/events/${id}`, { method: 'PATCH', body });
    else await api('/api/events', { method: 'POST', body });
    toast(id ? 'Event updated' : 'Added to your calendar');
    state.cal.adding = false; state.cal.editing = null;
    // Jump the view to the event's day so it's visible even if it moved months.
    state.cal.selected = day; const [yy, mm] = day.split('-').map(Number); if (yy && mm) { state.cal.y = yy; state.cal.m = mm - 1; }
    await loadCalendar();
  } catch (e) { toast(e.message); }
}
async function calDeleteEvent(id) {
  const ev = (state.cal.events || []).find((x) => x.id === id) || state.cal.editing;
  let scope = 'single';
  if (ev && ev.recurringId) {
    const choice = await recurDeleteChoice();
    if (!choice) return;
    scope = choice;
  } else if (!(await uiConfirm('Delete this event from your Google calendar?', { title: 'Delete event', okLabel: 'Delete', danger: true }))) return;
  try {
    await api(`/api/events/${id}${scope === 'future' ? '?scope=future' : ''}`, { method: 'DELETE' });
    toast(scope === 'future' ? 'This and following events deleted' : 'Event deleted');
    state.cal.editing = null; state.cal.adding = false; await loadCalendar();
  } catch (e) { toast(e.message); }
}
// A recurring instance can be dropped on its own or trimmed "from here on".
// Resolves to 'single', 'future', or null (cancelled).
function recurDeleteChoice() {
  return new Promise((resolve) => {
    let el = document.getElementById('recur-overlay');
    if (!el) { el = document.createElement('div'); el.id = 'recur-overlay'; document.body.appendChild(el); }
    el.innerHTML = `<div class="pal-bg"><div class="recur-dialog">
      <div class="recur-h">Delete repeating event</div>
      <p class="recur-p">This event is part of a repeating series. What should be removed?</p>
      <button class="recur-opt" data-rc="single">Just this event</button>
      <button class="recur-opt" data-rc="future">This and all following</button>
      <button class="recur-opt cancel" data-rc="">Cancel</button>
    </div></div>`;
    const close = (v) => { el.innerHTML = ''; resolve(v || null); };
    el.querySelector('.pal-bg').addEventListener('click', (e) => { if (e.target.classList.contains('pal-bg')) close(null); });
    el.querySelectorAll('[data-rc]').forEach((b) => b.addEventListener('click', () => close(b.dataset.rc)));
  });
}
// In-app confirm/prompt. Native window.confirm/prompt crash Flotato (the app
// wrapper Robin runs the site in), so every yes/no or text prompt goes through
// these instead. uiConfirm → Promise<bool>; uiPrompt → Promise<string|null>.
function uiDialogHost() {
  let el = document.getElementById('ui-dialog');
  if (!el) { el = document.createElement('div'); el.id = 'ui-dialog'; document.body.appendChild(el); }
  return el;
}
function uiConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const el = uiDialogHost();
    el.innerHTML = `<div class="pal-bg"><div class="recur-dialog ui-dialog-box">
      <div class="recur-h">${esc(opts.title || 'Please confirm')}</div>
      <p class="recur-p">${esc(message)}</p>
      <div class="ui-dialog-btns">
        <button class="ui-btn cancel" data-ud="0">${esc(opts.cancelLabel || 'Cancel')}</button>
        <button class="ui-btn ${opts.danger ? 'danger' : 'primary'}" data-ud="1">${esc(opts.okLabel || 'OK')}</button>
      </div></div></div>`;
    const close = (v) => { el.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } else if (e.key === 'Enter') { e.preventDefault(); close(true); } };
    document.addEventListener('keydown', onKey, true);
    el.querySelector('.pal-bg').addEventListener('click', (e) => { if (e.target.classList.contains('pal-bg')) close(false); });
    el.querySelectorAll('[data-ud]').forEach((b) => b.addEventListener('click', () => close(b.dataset.ud === '1')));
  });
}
function uiPrompt(message, opts = {}) {
  return new Promise((resolve) => {
    const el = uiDialogHost();
    el.innerHTML = `<div class="pal-bg"><div class="recur-dialog ui-dialog-box">
      <div class="recur-h">${esc(opts.title || message)}</div>
      ${opts.title ? `<p class="recur-p">${esc(message)}</p>` : ''}
      <input class="ui-dialog-input" id="ui-dialog-input" value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}" autocomplete="off">
      <div class="ui-dialog-btns">
        <button class="ui-btn cancel" data-ud="0">${esc(opts.cancelLabel || 'Cancel')}</button>
        <button class="ui-btn primary" data-ud="1">${esc(opts.okLabel || 'OK')}</button>
      </div></div></div>`;
    const inp = el.querySelector('#ui-dialog-input');
    const close = (v) => { el.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const submit = () => close(inp.value);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    el.querySelector('.pal-bg').addEventListener('click', (e) => { if (e.target.classList.contains('pal-bg')) close(null); });
    el.querySelectorAll('[data-ud]').forEach((b) => b.addEventListener('click', () => (b.dataset.ud === '1' ? submit() : close(null))));
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  });
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

// Standard folders. Starred is the \Flagged flag surfaced as a view (search),
// not a real mailbox. Purelymail uses INBOX / Archive / Junk / Trash.
const MAIL_FOLDERS = [
  { key: 'inbox', label: 'Inbox', mailbox: 'INBOX' },
  { key: 'starred', label: '★ Starred', mailbox: 'INBOX', flagged: true },
  { key: 'archive', label: 'Archive', mailbox: 'Archive' },
  { key: 'spam', label: 'Spam', mailbox: 'Junk' },
  { key: 'trash', label: 'Trash', mailbox: 'Trash' },
];
const mailFolder = () => MAIL_FOLDERS.find((f) => f.key === (state.mail.folder || 'inbox')) || MAIL_FOLDERS[0];
function setMailFolder(key) { state.mail.folder = key; state.mail.mailbox = mailFolder().mailbox; state.mail.open = null; state.mail.limit = 40; loadMessages(); }
// Every message row is tagged with the account it came from (_acct / _mailbox /
// _acctName) and a composite _key = `${account}:${uid}`. IMAP UIDs are only
// unique within one mailbox, so in the All-accounts view uid alone would clash;
// keying and acting by _key lets every row carry its own account.
const mailRow = (key) => (state.mail.messages || []).find((m) => m._key === key)
  || (state.mail.open && state.mail.open._key === key ? state.mail.open : null);
async function mailStar(key) {
  const target = mailRow(key); if (!target) return;
  const row = (state.mail.messages || []).find((m) => m._key === key);
  const o = state.mail.open;
  const on = !target.flagged;
  if (row) row.flagged = on;
  if (o && o._key === key) o.flagged = on;
  if (!on && state.mail.folder === 'starred') { state.mail.messages = state.mail.messages.filter((m) => m._key !== key); if (o && o._key === key) state.mail.open = null; }
  renderMail();
  try { await mailApi('/flag', { method: 'POST', body: JSON.stringify({ account: target._acct, mailbox: target._mailbox, uid: target.uid, flagged: on }) }); }
  catch (e) { toast(e.message); }
}
async function mailMoveTo(key, target, label) {
  const row = mailRow(key); if (!row) return;
  const msgs = state.mail.messages || []; const idx = msgs.findIndex((m) => m._key === key);
  try {
    await mailApi('/move', { method: 'POST', body: JSON.stringify({ account: row._acct, mailbox: row._mailbox, uid: row.uid, target }) });
    toast(label);
    state.mail.messages = msgs.filter((m) => m._key !== key);
    // Keep keyboard triage flowing: move the highlight to the next row (or the
    // previous one if we removed the last), and drop out of the reader.
    if (state.mail.sel === key) { const n = state.mail.messages[idx] || state.mail.messages[idx - 1]; state.mail.sel = n ? n._key : null; }
    state.mail.open = null; renderMail();
  } catch (e) { toast(e.message); }
}
// Empty the current Spam/Trash folder (for all shown accounts). Confirmed first.
async function mailEmptyFolder() {
  const f = mailFolder(); if (!/junk|trash/i.test(f.mailbox)) return;
  if (!(await uiConfirm(`Permanently delete everything in ${f.label}? This cannot be undone.`, { title: `Empty ${f.label}`, okLabel: 'Empty', danger: true }))) return;
  const accts = state.mail.account === 'all' ? (state.mail.accounts || []) : (state.mail.accounts || []).filter((a) => a.id === state.mail.account);
  try {
    for (const a of accts) await mailApi('/empty', { method: 'POST', body: JSON.stringify({ account: a.id, mailbox: f.mailbox }) });
    toast(`${f.label} emptied`); state.mail.limit = 40; await loadMessages();
  } catch (e) { toast(e.message); }
}
// Move the keyboard highlight through the list; while reading, open as we go.
function mailSelMove(delta) {
  const rows = state.mail.messages || []; if (!rows.length) return;
  let i = rows.findIndex((x) => x._key === state.mail.sel);
  if (i < 0) i = delta > 0 ? -1 : 0;
  i = Math.max(0, Math.min(rows.length - 1, i + delta));
  state.mail.sel = rows[i]._key;
  if (state.mail.open) { openMessage(state.mail.sel); return; }
  renderMail();
  const el = document.querySelector('.mail-row.ksel'); if (el) el.scrollIntoView({ block: 'nearest' });
}
// Mark a message read / unread (U). Updates the row, the unread badge and IMAP.
async function mailSeen(key, seen) {
  const row = mailRow(key); if (!row) return;
  const listRow = (state.mail.messages || []).find((x) => x._key === key);
  if (listRow) listRow.seen = seen;
  if (state.mail.open && state.mail.open._key === key) state.mail.open.seen = seen;
  state.mail.unseen[row._acct] = Math.max(0, (state.mail.unseen[row._acct] || 0) + (seen ? -1 : 1));
  renderMail();
  try { await mailApi('/flag', { method: 'POST', body: JSON.stringify({ account: row._acct, mailbox: row._mailbox, uid: row.uid, seen }) }); }
  catch (e) { toast(e.message); }
}
// ── multi-select triage + move-to-folder ──
function mailToggleSelect(key) { const s = state.mail.selected; if (s.has(key)) s.delete(key); else s.add(key); renderMail(); }
function mailMoveMenuHtml() {
  const mm = state.mail.moveMenu; if (!mm) return '';
  const std = ['Archive', 'Junk', 'Trash', 'INBOX'];
  const found = (state.mail.mailboxes || []).map((b) => b.path).filter(Boolean);
  const seen = new Set(); const cur = (state.mail.mailbox || '').toLowerCase();
  const folders = [...std, ...found].filter((p) => p && p.toLowerCase() !== cur && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  return `<div class="mail-movebg" data-mail-move-close><div class="mail-move" style="top:${mm.y}px;left:${mm.x}px" role="menu">
    <div class="mail-move-h">Move ${mm.keys.length} to…</div>
    ${folders.map((p) => `<button class="mail-move-item" data-mail-move-to="${esc(p)}">${esc(p === 'INBOX' ? 'Inbox' : p)}</button>`).join('')}
  </div></div>`;
}
function openMoveMenu(keys, anchor) {
  const r = anchor ? anchor.getBoundingClientRect() : { left: 240, bottom: 200 };
  state.mail.moveMenu = { keys: [...keys], x: Math.min(r.left, window.innerWidth - 250), y: r.bottom + 6 };
  renderMail();
}
async function mailMoveTargets(keys, target) {
  const list = [...keys]; state.mail.moveMenu = null;
  for (const k of list) { const row = mailRow(k); if (!row) continue; try { await mailApi('/move', { method: 'POST', body: JSON.stringify({ account: row._acct, mailbox: row._mailbox, uid: row.uid, target }) }); } catch (e) { toast(e.message); } }
  state.mail.messages = (state.mail.messages || []).filter((m) => !list.includes(m._key));
  list.forEach((k) => state.mail.selected.delete(k));
  if (state.mail.open && list.includes(state.mail.open._key)) state.mail.open = null;
  toast(`Moved ${list.length} to ${target === 'INBOX' ? 'Inbox' : target}`); renderMail();
}
async function mailBulk(action) {
  if (action === 'clear') { state.mail.selected = new Set(); renderMail(); return; }
  const keys = [...(state.mail.selected || [])]; if (!keys.length) return;
  if (action === 'move') { openMoveMenu(keys, document.querySelector('[data-mail-bulk="move"]')); return; }
  if (action === 'archive') return mailMoveTargets(keys, 'Archive');
  if (action === 'delete') { if (!(await uiConfirm(`Move ${keys.length} message${keys.length === 1 ? '' : 's'} to Trash?`, { title: 'Move to Trash', okLabel: 'Move' }))) return; return mailMoveTargets(keys, 'Trash'); }
  if (action === 'star') { for (const k of keys) { const row = mailRow(k); if (row && !row.flagged) await mailStar(k); } state.mail.selected = new Set(); renderMail(); return; }
  if (action === 'read' || action === 'unread') { for (const k of keys) await mailSeen(k, action === 'read'); state.mail.selected = new Set(); renderMail(); return; }
}
async function mailBlock(key, address) {
  const row = mailRow(key); if (!row) return;
  if (!address) { toast('No sender address to block'); return; }
  if (!(await uiConfirm(`Block ${address}? Their mail will be moved to Junk from now on.`, { title: 'Block sender', okLabel: 'Block', danger: true }))) return;
  try {
    await mailApi('/block', { method: 'POST', body: JSON.stringify({ account: row._acct, address, uid: row.uid, mailbox: row._mailbox }) });
    const acc = (state.mail.accounts || []).find((a) => a.id === row._acct);
    if (acc) acc.blocked = [...new Set([...(acc.blocked || []), address.toLowerCase()])];
    state.mail.messages = state.mail.messages.filter((m) => m._key !== key); state.mail.open = null;
    toast(`Blocked ${address}`); renderMail();
  } catch (e) { toast(e.message); }
}
async function mailUnblock(address, accountId) {
  try {
    await mailApi('/unblock', { method: 'POST', body: JSON.stringify({ account: accountId || state.mail.account, address }) });
    const acc = (state.mail.accounts || []).find((a) => a.id === (accountId || state.mail.account));
    if (acc) acc.blocked = (acc.blocked || []).filter((x) => x !== address);
    toast(`Unblocked ${address}`); await openMailAccounts();
  } catch (e) { toast(e.message); }
}
async function openMail() {
  state.view = { type: 'mail' };
  if (!state.mail) state.mail = { account: null, mailbox: 'INBOX', folder: 'inbox', messages: [], open: null, composing: false, query: '', limit: 40, unseen: {}, hasMore: false, sel: null, shortcuts: false, threaded: localStorage.getItem('life.mail.threaded') !== '0', expanded: {}, selected: new Set(), mailboxes: [], moveMenu: null };
  if (!state.mailTrust) {
    state.mailTrust = new Set();
    api('/api/kv/mail_trusted').then((r) => { try { (JSON.parse(r.value || '[]') || []).forEach((a) => state.mailTrust.add(String(a).toLowerCase())); } catch {} if (state.view.type === 'mail' && state.mail && state.mail.open) renderMail(); }).catch(() => {});
  }
  renderNav(); renderMail(true);
  try {
    state.mail.accounts = await mailApi('/accounts');
    if (!state.mail.accounts.length) { renderMailAccounts('Add a mailbox to get started.'); return; }
    // Default to the unified All-accounts inbox when there's more than one box.
    if (!state.mail.account) state.mail.account = state.mail.accounts.length > 1 ? 'all' : state.mail.accounts[0].id;
    // Cache the folder list (for "Move to folder") from the active/first account.
    const primary = state.mail.account !== 'all' ? state.mail.account : state.mail.accounts[0].id;
    mailApi(`/mailboxes?account=${primary}`).then((mb) => { state.mail.mailboxes = Array.isArray(mb) ? mb : []; }).catch(() => {});
    await loadMessages();
  } catch (e) { state.mail.error = e.message; renderMail(); }
}
async function loadMessages() {
  state.mail.open = null; state.mail.composing = false; state.mail.selected = new Set(); state.mail.moveMenu = null; renderMail(true);
  const f = mailFolder(); state.mail.mailbox = f.mailbox;
  const all = state.mail.account === 'all';
  const accts = all ? (state.mail.accounts || []) : (state.mail.accounts || []).filter((a) => a.id === state.mail.account);
  const q = (state.mail.query || '').trim();
  const limit = state.mail.limit || 40;
  state.mail.unseen = {};
  const acctErrors = [];
  try {
    let more = false;
    const lists = await Promise.all(accts.map(async (a) => {
      try {
        const r = await mailApi(`/messages?account=${a.id}&mailbox=${encodeURIComponent(f.mailbox)}&limit=${limit}${f.flagged ? '&flagged=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
        state.mail.unseen[a.id] = r.unseen || 0;
        const msgs = (r.messages || []).map((x) => ({ ...x, _acct: a.id, _acctName: a.name || a.email, _mailbox: f.mailbox, _key: `${a.id}:${x.uid}` }));
        if ((r.total || 0) > msgs.length) more = true;
        return msgs;
      } catch (e) { acctErrors.push({ name: a.name || a.email, msg: e.message }); return []; }
    }));
    let msgs = lists.flat();
    if (all) msgs = msgs.sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0));
    state.mail.messages = msgs;
    state.mail.hasMore = more && !q && !f.flagged;   // "Load older" only when browsing
    state.mail.error = null;
    state.mail.acctErrors = acctErrors;
  } catch (e) { state.mail.error = e.message; }
  renderMail();
}
async function openMessage(key) {
  const row = (state.mail.messages || []).find((x) => x._key === key); if (!row) return;
  renderMail(true);
  try {
    const m = await mailApi(`/message?account=${row._acct}&mailbox=${encodeURIComponent(row._mailbox)}&uid=${row.uid}`);
    state.mail.open = { ...m, _acct: row._acct, _mailbox: row._mailbox, _acctName: row._acctName, _key: row._key, uid: row.uid };
    if (!row.seen) { row.seen = true; mailApi('/flag', { method: 'POST', body: JSON.stringify({ account: row._acct, mailbox: row._mailbox, uid: row.uid, seen: true }) }).catch(() => {}); }
  } catch (e) { toast(e.message); }
  renderMail();
}
async function mailDelete(key) {
  const row = mailRow(key); if (!row) return;
  if (!(await uiConfirm('Move this message to Trash?', { title: 'Move to Trash', okLabel: 'Move' }))) return;
  try { await mailApi('/move', { method: 'POST', body: JSON.stringify({ account: row._acct, mailbox: row._mailbox, uid: row.uid, target: 'Trash' }) }); toast('Moved to Trash'); state.mail.messages = state.mail.messages.filter((m) => m._key !== key); state.mail.open = null; renderMail(); }
  catch (e) { toast(e.message); }
}
// Which account a compose sends FROM: the reply's originating account, else the
// active tab - but never the 'all' sentinel, which falls back to the first box.
function composeAcctId() {
  const c = state.mail.composing;
  if (c && c._acct) return c._acct;
  if (state.mail.account && state.mail.account !== 'all') return state.mail.account;
  return ((state.mail.accounts || [])[0] || {}).id;
}
// The compose body is now rich text (contenteditable HTML). Send HTML always,
// with a plain-text version alongside as the fallback part.
function htmlToPlain(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n');
  return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
async function mailSend(to, cc, bcc, subject, bodyHtml, inReplyTo) {
  const from = composeAcctId();
  const acct = (state.mail.accounts || []).find((a) => a.id === from);
  const sig = acct && acct.signature;
  const attachments = (state.mail.composing && state.mail.composing.attachments) || [];
  const text = htmlToPlain(bodyHtml) + (sig ? `\n\n${sigToText(sig)}` : '');
  const html = `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;font-size:15px;line-height:1.55;color:#1b1820">${sanitizeEmailHtml(bodyHtml || '')}</div>${sig ? `<br>${sig}` : ''}`;
  const payload = { account: from, to, cc, bcc, subject, text, html, inReplyTo, attachments };
  try { await mailApi('/send', { method: 'POST', body: JSON.stringify(payload) }); toast('Sent'); clearDraft(from); state.mail.composing = false; renderMail(); }
  catch (e) { toast(e.message); }
}
// Upload a File to the mail attachment store; returns {id,name,type,size}.
async function mailUploadAttachment(file) {
  const from = composeAcctId();
  const res = await fetch(`/api/mail/attach?account=${encodeURIComponent(from)}&name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('today.token')}` }, body: file,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`);
  return res.json();
}
async function mailAttachFiles(files) {
  if (!state.mail.composing) return;
  state.mail.composing.attachments = state.mail.composing.attachments || [];
  for (const f of files) {
    try { const a = await mailUploadAttachment(f); state.mail.composing.attachments.push(a); renderMail(); }
    catch (e) { toast(e.message); }
  }
  saveDraft();
}
async function mailRemoveAttachment(id) {
  const c = state.mail.composing; if (!c) return;
  c.attachments = (c.attachments || []).filter((a) => a.id !== id);
  renderMail(); saveDraft();
  mailApi(`/attach/${id}?account=${encodeURIComponent(composeAcctId())}`, { method: 'DELETE' }).catch(() => {});
}
// Drafts: a new (non-reply) compose auto-saves to localStorage per account so it
// survives closing the composer, and resumes when you next hit Compose.
const draftKey = (acct) => `life.mail.draft.${acct || 'default'}`;
function saveDraft() {
  const c = state.mail && state.mail.composing; if (!c || c.inReplyTo) return;   // new composes only
  const acct = composeAcctId();
  const empty = !(c.to || c.cc || c.bcc || c.subject || (c.body && c.body.trim()) || (c.attachments && c.attachments.length));
  try { if (empty) localStorage.removeItem(draftKey(acct)); else localStorage.setItem(draftKey(acct), JSON.stringify({ to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, body: c.body, attachments: c.attachments || [] })); } catch {}
}
function clearDraft(acct) { try { localStorage.removeItem(draftKey(acct || composeAcctId())); } catch {} }
function loadDraft(acct) { try { const s = localStorage.getItem(draftKey(acct)); return s ? JSON.parse(s) : null; } catch { return null; } }
function startCompose() {
  const acct = state.mail.account && state.mail.account !== 'all' ? state.mail.account : ((state.mail.accounts || [])[0] || {}).id;
  const d = loadDraft(acct);
  state.mail.composing = d ? { ...d, _resumed: true } : {};
  renderMail(); setTimeout(() => { const el = $('#mc-to'); if (el) el.focus(); }, 30);
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
// Edit a mailbox's connection settings. The password box is blank and only sent
// when the user types a new one - the stored password is never shown or fetched.
async function saveMailAccount(id, fields) {
  const body = { ...fields }; if (!body.pass) delete body.pass;
  try {
    const a = await mailApi(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    const i = (state.mail.accounts || []).findIndex((x) => x.id === id); if (i >= 0) state.mail.accounts[i] = a;
    toast(a.warning || 'Account updated');
    renderMailAccounts();
  } catch (e) { toast(e.message); }
}
async function delMailAccount(id) {
  if (!(await uiConfirm('Remove this account?', { title: 'Remove account', okLabel: 'Remove', danger: true }))) return;
  try { await mailApi(`/accounts/${id}`, { method: 'DELETE' }); state.mail.accounts = (state.mail.accounts || []).filter((a) => a.id !== id); if (state.mail.account === id) state.mail.account = null; renderMailAccounts(state.mail.accounts.length ? null : 'Add a mailbox to get started.'); }
  catch (e) { toast(e.message); }
}
function mailReplyStart(all) {
  const o = state.mail.open; if (!o) return;
  const me = (((state.mail.accounts || []).find((a) => a.id === o._acct) || {}).email || '').toLowerCase();
  const to = o.from ? o.from.address : '';
  let cc = '';
  if (all) {
    const seen = new Set([to.toLowerCase(), me]);
    const others = [...(o.to || []), ...(o.cc || [])].map((a) => a.address).filter(Boolean).filter((a) => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    cc = others.join(', ');
  }
  const quote = esc(o.text || '').replace(/\n/g, '<br>');
  const lead = `On ${new Date(o.date).toLocaleString()}, ${esc(o.from ? o.from.address : '')} wrote:`;
  state.mail.composing = { _acct: o._acct, to, cc, bcc: '', subject: /^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`, body: `<br><br><div>${lead}</div><blockquote style="margin:0;padding-left:12px;border-left:2px solid #ccc;color:#555">${quote}</blockquote>`, inReplyTo: o.messageId };
  renderMail();
  setTimeout(() => $('#mc-body') && $('#mc-body').focus(), 0);
}
// Forward: quote the original inline and re-attach its attachments for real by
// pulling each part's bytes back through the download route and re-uploading.
function mailForwardStart() {
  const o = state.mail.open; if (!o) return;
  const hdr = [`From: ${esc(o.from ? o.from.address : '')}`, `Date: ${esc(o.date ? new Date(o.date).toLocaleString() : '')}`, `Subject: ${esc(o.subject || '')}`, `To: ${esc((o.to || []).map((a) => a.address).filter(Boolean).join(', '))}`].join('<br>');
  const quote = esc(o.text || '').replace(/\n/g, '<br>');
  state.mail.composing = { _acct: o._acct, to: '', cc: '', bcc: '', subject: /^fwd:/i.test(o.subject || '') ? o.subject : `Fwd: ${o.subject || ''}`, body: `<br><br><div>---------- Forwarded message ----------</div><div>${hdr}</div><br>${quote}`, attachments: [] };
  renderMail();
  if (o.attachments && o.attachments.length) { toast(`Attaching ${o.attachments.length} file${o.attachments.length > 1 ? 's' : ''}…`); forwardAttachments(o); }
  setTimeout(() => { const el = $('#mc-to'); if (el) el.focus(); }, 0);
}
async function forwardAttachments(o) {
  const c = state.mail.composing; if (!c) return;
  c.attachments = c.attachments || [];
  for (const a of (o.attachments || [])) {
    try {
      const res = await fetch(`/api/mail/attachment?account=${encodeURIComponent(o._acct)}&mailbox=${encodeURIComponent(o._mailbox)}&uid=${o.uid}&idx=${a.idx}`, { headers: { Authorization: `Bearer ${localStorage.getItem('today.token')}` } });
      if (!res.ok) continue;
      const blob = await res.blob();
      const file = new File([blob], a.filename || 'attachment', { type: a.type || blob.type || 'application/octet-stream' });
      const up = await mailUploadAttachment(file);
      if (state.mail.composing === c) { c.attachments.push(up); renderMail(); }
    } catch {}
  }
}
// Save an incoming attachment to the user's computer via a blob download.
async function mailSaveAttachment(idx, name) {
  const o = state.mail.open; if (!o) return;
  try {
    const res = await fetch(`/api/mail/attachment?account=${encodeURIComponent(o._acct)}&mailbox=${encodeURIComponent(o._mailbox)}&uid=${o.uid}&idx=${idx}`, { headers: { Authorization: `Bearer ${localStorage.getItem('today.token')}` } });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = name || 'attachment'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast(e.message); }
}
// Claudius drafts a reply, then drops it into a normal reply compose above the
// quoted original. It never sends - Robin reviews and edits like any draft.
async function mailClaudius() {
  const o = state.mail.open; if (!o) return;
  const btn = document.querySelector('[data-mail-claudius]');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Drafting…'; }
  try {
    const { draft } = await mailApi('/draft', { method: 'POST', body: JSON.stringify({
      account: o._acct, from: o.from ? o.from.address : '', subject: o.subject, text: o.text || '',
    }) });
    mailReplyStart(false);
    const c = state.mail.composing;
    if (c) {
      c.body = `${esc(draft).replace(/\n/g, '<br>')}${c.body || ''}`;
      renderMail();
      setTimeout(() => { const el = $('#mc-body'); if (el) { el.focus(); el.scrollTop = 0; } }, 0);
    }
    toast('Claudius drafted a reply - review it before sending');
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.textContent = '✦ Claudius'; }
  }
}

// A tasteful default signature so a new account starts with something real to
// edit rather than a blank box.
function defaultSignature(a) {
  const name = a.name && a.name !== a.email ? a.name : 'Robin Lumley-Savile';
  const accent = a.color || '#c4412e';
  return `<table cellpadding="0" cellspacing="0" style="font-family:-apple-system,Segoe UI,Inter,sans-serif"><tr><td style="border-left:3px solid ${accent};padding:2px 0 2px 12px"><div style="font-size:15px;font-weight:600;color:#1b1820">${esc(name)}</div><div style="font-size:13px;color:#8a8580;margin-top:2px"><a href="mailto:${esc(a.email)}" style="color:#8a8580;text-decoration:none">${esc(a.email)}</a></div></td></tr></table>`;
}
// Normalise any user hex to 6-digit lowercase (#abc → #aabbcc); null if invalid.
function normHex(h) {
  h = String(h || '').trim(); if (h && h[0] !== '#') h = '#' + h;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) return '#' + h.slice(1).split('').map((c) => c + c).join('').toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
  return null;
}
// The signature "bar" is the coloured left border in the template. Recover its
// colour from saved HTML so the picker opens on the current value.
function sigBarColor(a) {
  const m = (a.signature || '').match(/border-left\s*:\s*[^;"']*?(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/i);
  return normHex(m ? m[1] : (a.color || '#c4412e')) || '#c4412e';
}
// Live-recolour the bar as you pick, and keep the swatch and hex box in step.
function applySigColor(id, raw, src) {
  const hex = normHex(raw);
  if (src !== 'sw') { const sw = document.querySelector(`[data-sig-color-sw="${id}"]`); if (sw && hex) sw.value = hex; }
  if (src !== 'hex') { const tx = document.querySelector(`[data-sig-hex="${id}"]`); if (tx && hex) tx.value = hex; }
  if (!hex) return;
  const ed = document.querySelector(`[data-sig-acct="${id}"]`); if (!ed) return;
  ed.querySelectorAll('[style*="border-left"]').forEach((el) => { el.style.borderLeftColor = hex; });
}
// Accounts breadcrumb: gains a "Signatures" step whenever a signature editor is open.
function acctCrumbHtml(sigOpen) {
  const trail = [{ label: 'Home', attr: 'data-view-home' }, { label: 'Mail', attr: 'data-open-mail' }];
  if (sigOpen) { trail.push({ label: 'Accounts', attr: 'data-sig-close-all' }, { label: 'Signatures' }); }
  else trail.push({ label: 'Accounts' });
  return crumbNav(trail);
}
function refreshAcctCrumb() {
  const bar = document.querySelector('#pane .crumbbar'); if (!bar) return;
  const open = !!document.querySelector('[data-sig-panel]:not([hidden])');
  const tmp = document.createElement('div'); tmp.innerHTML = acctCrumbHtml(open);
  bar.replaceWith(tmp.firstElementChild);
}
function renderMailAccounts(note) {
  const rows = (state.mail.accounts || []).map((a) => `<div class="mail-acct-card">
    <div class="mail-acct"><span class="ma-dot" style="background:${a.color || 'var(--accent)'}"></span><span class="ma-e">${esc(a.email)}</span>
      <button class="ghost sig-btn" data-acct-edit-toggle="${a.id}">Edit</button>
      <button class="ghost sig-btn" data-sig-toggle="${a.id}">Signature</button>
      <button class="x" data-mail-del-acct="${a.id}" title="Remove">×</button></div>
    <div class="mail-acct-edit" data-acct-edit="${a.id}" hidden>
      <form class="acct-edit-form" data-acct-edit-form="${a.id}">
        <label class="ae-lbl">Email address<input class="ae-email" type="email" value="${esc(a.email || '')}" required></label>
        <div class="ae-row"><label class="ae-lbl" style="flex:1">IMAP host<input class="ae-imaphost" value="${esc(a.imapHost || '')}" required></label><label class="ae-lbl" style="width:84px">Port<input class="ae-imapport" value="${esc(String(a.imapPort || 993))}"></label></div>
        <div class="ae-row"><label class="ae-lbl" style="flex:1">SMTP host<input class="ae-smtphost" value="${esc(a.smtpHost || '')}" required></label><label class="ae-lbl" style="width:84px">Port<input class="ae-smtpport" value="${esc(String(a.smtpPort || 465))}"></label></div>
        <label class="ae-lbl">Username<input class="ae-user" value="${esc(a.username || '')}" placeholder="Usually your email address"></label>
        <label class="ae-lbl">Password<input class="ae-pass" type="password" autocomplete="off" placeholder="Leave blank to keep the current password"></label>
        <div class="mail-sig-note">🔒 Your saved password is hidden and never shown. Leave the box blank to keep it, or type a new one (for Google, an <b>App Password</b>) to replace it.</div>
        <div class="ae-act"><button class="add-btn" type="submit">Save changes</button><button type="button" class="ghost" data-acct-edit-cancel="${a.id}">Cancel</button></div>
      </form>
    </div>
    <div class="mail-sig" data-sig-panel="${a.id}" hidden>
      <label class="sig-color-row"><span class="sig-color-lbl">Bar colour</span>
        <input type="color" class="sig-color-sw" data-sig-color-sw="${a.id}" value="${sigBarColor(a)}" title="Pick a colour">
        <input type="text" class="sig-hex" data-sig-hex="${a.id}" value="${sigBarColor(a)}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Signature bar hex colour"></label>
      <div class="mail-sig-ed prose" contenteditable="true" data-sig-acct="${a.id}" data-ph="Your signature…">${a.signature || defaultSignature(a)}</div>
      <div class="mail-sig-act"><button class="add-btn" data-sig-save="${a.id}">Save signature</button><span class="sig-hint">Added to the bottom of messages you send from this address.</span></div>
    </div>
    ${(a.blocked && a.blocked.length) ? `<div class="mail-blocked"><span class="mail-blocked-h">Blocked senders · ${a.blocked.length}</span><div class="mail-blocked-chips">${a.blocked.map((addr) => `<span class="mail-blocked-chip">${esc(addr)}<button data-mail-unblock="${esc(addr)}" data-mail-unblock-acct="${a.id}" title="Unblock">×</button></span>`).join('')}</div></div>` : ''}
    </div>`).join('');
  $('#pane').innerHTML = `${acctCrumbHtml(false)}
    <div class="pane-head home-head"><h1>Accounts</h1><button class="add-btn wide" data-mail-add-acct>+ Add mailbox</button></div>
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
// Provider presets fill the IMAP/SMTP host+port so you don't have to look them up.
const MAIL_PRESETS = {
  purelymail: { label: 'Purelymail', imap: 'imap.purelymail.com', imapPort: 993, smtp: 'smtp.purelymail.com', smtpPort: 465 },
  google: { label: 'Google / Workspace', imap: 'imap.gmail.com', imapPort: 993, smtp: 'smtp.gmail.com', smtpPort: 465, note: 'Google needs an <b>App Password</b> (not your normal password): turn on 2-Step Verification, then Google Account → Security → App passwords. Your Workspace admin must also allow IMAP.' },
  icloud: { label: 'iCloud', imap: 'imap.mail.me.com', imapPort: 993, smtp: 'smtp.mail.me.com', smtpPort: 587, note: 'iCloud needs an app-specific password from appleid.apple.com.' },
  outlook: { label: 'Outlook / 365', imap: 'outlook.office365.com', imapPort: 993, smtp: 'smtp.office365.com', smtpPort: 587 },
};
function showMailAccountForm() {
  const chips = Object.entries(MAIL_PRESETS).map(([k, p]) => `<button type="button" class="mail-preset" data-mail-preset="${k}">${esc(p.label)}</button>`).join('');
  $('#mail-acct-form').innerHTML = `<form id="mail-acct-form-el" class="add-task" style="flex-direction:column;align-items:stretch;gap:10px;max-width:520px;margin-top:16px">
    <div class="mail-presets"><span class="mail-presets-l">Provider:</span>${chips}</div>
    <div id="ma-note" class="mail-sig-note" hidden></div>
    <input id="ma-email" type="email" placeholder="Email address" required>
    <div style="display:flex;gap:8px"><input id="ma-imaphost" placeholder="IMAP host" value="imap.purelymail.com" required style="flex:1"><input id="ma-imapport" value="993" style="width:80px"></div>
    <div style="display:flex;gap:8px"><input id="ma-smtphost" placeholder="SMTP host" value="smtp.purelymail.com" required style="flex:1"><input id="ma-smtpport" value="465" style="width:80px"></div>
    <input id="ma-user" placeholder="Username (usually your email)">
    <input id="ma-pass" type="password" placeholder="Password / app password" required>
    <button class="add-btn wide" type="submit">Add account</button></form>`;
  $('#ma-email').focus();
}
function applyMailPreset(key) {
  const p = MAIL_PRESETS[key]; if (!p) return;
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set('#ma-imaphost', p.imap); set('#ma-imapport', p.imapPort); set('#ma-smtphost', p.smtp); set('#ma-smtpport', p.smtpPort);
  const note = $('#ma-note'); if (note) { if (p.note) { note.innerHTML = p.note; note.hidden = false; } else { note.hidden = true; } }
}
const initial = (s) => (String(s || '?').trim().charAt(0) || '?').toUpperCase();
// Strip anything executable from an email's own markup before it goes in the
// frame: no <script>, no inline on* handlers, no javascript: URLs, no <base>.
// Its <style> is kept (that's what makes the mail look right) and the frame's
// own sandbox isolates those styles from the app.
function sanitizeEmailHtml(html, blockRemote) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script, base, link[rel="import"], meta[http-equiv]').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  // Privacy: until the sender is trusted, pull remote images (and CSS background
  // images) so tracking pixels can't phone home just by opening the message.
  if (blockRemote) {
    doc.querySelectorAll('img').forEach((img) => {
      if (/^\s*https?:/i.test(img.getAttribute('src') || '')) img.removeAttribute('src');
      if (img.getAttribute('srcset')) img.removeAttribute('srcset');
    });
    doc.querySelectorAll('[style]').forEach((el) => {
      const st = el.getAttribute('style') || '';
      if (/url\(\s*["']?\s*https?:/i.test(st)) el.setAttribute('style', st.replace(/background(-image)?\s*:[^;]*?url\([^)]*\)[^;]*;?/gi, ''));
    });
  }
  return doc.head.innerHTML + doc.body.innerHTML;
}
// Does the message body pull in any remote image? (Worth a "show images" prompt.)
function hasRemoteImages(html) {
  return /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/i.test(html || '') || /url\(\s*["']?\s*https?:/i.test(html || '');
}
function mailTrusted(addr) { return !!(state.mailTrust && addr && state.mailTrust.has(addr.toLowerCase())); }
// True when a message has remote images we're holding back (not trusted, not yet
// shown for this open message).
function mailImagesBlocked(o) {
  if (!o || !o.html || !hasRemoteImages(o.html)) return false;
  const sender = o.from && o.from.address ? o.from.address.toLowerCase() : '';
  if (mailTrusted(sender)) return false;
  return !(state.mail && state.mail.showImgKey === o._key);
}
async function trustSender(addr) {
  addr = (addr || '').toLowerCase(); if (!addr) return;
  state.mailTrust = state.mailTrust || new Set(); state.mailTrust.add(addr);
  if (state.mail && state.mail.open) state.mail.showImgKey = state.mail.open._key;
  renderMail();
  try { await api('/api/kv/mail_trusted', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify([...state.mailTrust]) }) }); toast(`Images from ${addr} will always show`); }
  catch (e) { toast(e.message); }
}
// Render the (now script-free) email in a sandboxed frame and have it report its
// content height, so the frame grows to fit and the whole reading pane - header
// and body together - scrolls as one. allow-scripts runs only our reporter; the
// email's own scripts were stripped above, and there is no allow-same-origin.
function wrapEmailHtml(html, blockImages) {
  return `<!doctype html><html><head><base target="_blank"><meta name="color-scheme" content="light">
    <style>html,body{margin:0}body{padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:15px;line-height:1.5;color:#1b1820;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#c4412e}table{max-width:100%}</style>
    </head><body>${sanitizeEmailHtml(html, blockImages)}<script>(function(){function h(){parent.postMessage({__mailHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)},'*');}window.addEventListener('load',h);document.addEventListener('load',h,true);try{new ResizeObserver(h).observe(document.documentElement);}catch(e){}setTimeout(h,60);setTimeout(h,500);})();<\/script></body></html>`;
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
const MAIL_SHORTCUTS = [
  ['J / K', 'Next / previous message'], ['Enter / O', 'Open highlighted'], ['Esc', 'Back to the list'],
  ['R', 'Reply'], ['A', 'Reply all'], ['F', 'Forward'], ['E', 'Archive'], ['S', 'Star / unstar'],
  ['U', 'Mark unread'], ['!', 'Mark as spam'], ['⌫ · Del · #', 'Delete (to Trash)'],
  ['C', 'Compose'], ['/', 'Jump to search'], ['⌘ ↵', 'Send (while composing)'], ['?', 'Toggle this panel'],
];
function shortcutsOverlayHtml() {
  return `<div class="mail-sc-bg" data-mail-sc-close><div class="mail-sc" role="dialog" aria-label="Keyboard shortcuts">
    <div class="mail-sc-h"><b>Keyboard shortcuts</b><button class="ghost" data-mail-sc-close title="Close">×</button></div>
    <div class="mail-sc-grid">${MAIL_SHORTCUTS.map(([k, d]) => `<div class="mail-sc-row"><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join('')}</div>
    <div class="mail-sc-note">Active while browsing or reading — not while typing in a field.</div>
  </div></div>`;
}
// ── conversation threading (client-side, over the loaded window) ──
const normSubject = (s) => (s || '').replace(/^\s*((re|fwd|fw|aw|sv|res|enc|encaminhada?)\s*:\s*)+/i, '').trim();
// Group loaded messages into conversations: first by the Message-ID/References
// graph, then by matching subject (only where a reply prefix seeds the group, so
// two unrelated originals sharing a subject don't merge). Union-find, pure.
function buildThreads(msgs) {
  const list = msgs || [];
  const byId = new Map(); list.forEach((m) => { if (m.messageId) byId.set(m.messageId, m); });
  const parent = new Map(); const K = (m) => m._key;
  list.forEach((m) => parent.set(K(m), K(m)));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  list.forEach((m) => { for (const r of [...(m.references || []), m.inReplyTo].filter(Boolean)) { const t = byId.get(r); if (t && t !== m) union(K(m), K(t)); } });
  const seed = new Map(); const gk = (m) => m._acct + '|' + normSubject(m.subject).toLowerCase();
  list.forEach((m) => { if (/^\s*(re|fwd|fw|aw|sv|res|enc)\s*:/i.test(m.subject || '') && normSubject(m.subject)) { const k = gk(m); if (!seed.has(k)) seed.set(k, K(m)); } });
  list.forEach((m) => { if (!normSubject(m.subject)) return; const k = gk(m); if (seed.has(k)) union(K(m), seed.get(k)); });
  const groups = new Map();
  list.forEach((m) => { const r = find(K(m)); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); });
  const threads = [...groups.values()].map((ms) => {
    ms.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return { key: ms[0]._key, messages: ms, latest: ms[0], count: ms.length, unread: ms.some((x) => !x.seen), flagged: ms.some((x) => x.flagged) };
  });
  threads.sort((a, b) => new Date(b.latest.date || 0) - new Date(a.latest.date || 0));
  return threads;
}
const threadFrom = (th) => [...new Set(th.messages.map((x) => mailFrom(x) || '(unknown)'))].slice(0, 3).join(', ');
// One message row (shared by flat view, single-message threads, and expanded children).
const mailRowHtml = (x, child) => `<button class="mail-row ${x.seen ? '' : 'unread'} ${child ? 'mail-child' : ''} ${state.mail.selected && state.mail.selected.has(x._key) ? 'picked' : ''} ${state.mail.open && state.mail.open._key === x._key ? 'csel' : (state.mail.sel === x._key ? 'ksel' : '')}" data-mail-open="${esc(x._key)}">
    <span class="mail-check ${state.mail.selected && state.mail.selected.has(x._key) ? 'on' : ''}" data-mail-check="${esc(x._key)}" title="Select">${state.mail.selected && state.mail.selected.has(x._key) ? '✓' : ''}</span>
    <span class="mail-avatar">${esc(initial(mailFrom(x)))}</span>
    <span class="mail-row-main"><span class="mail-row-top"><span class="mail-from">${esc(mailFrom(x) || '(unknown)')}</span><span class="mail-date">${mailDate(x.date)}</span></span>
    <span class="mail-subject">${state.mail.account === 'all' ? `<span class="mail-acct-chip">${esc(x._acctName || '')}</span>` : ''}${esc(x.subject)}</span>
    ${x.preview ? `<span class="mail-preview">${esc(x.preview)}</span>` : ''}</span>
    <span class="mail-star ${x.flagged ? 'on' : ''}" data-mail-star="${esc(x._key)}" title="${x.flagged ? 'Unstar' : 'Star'}">${x.flagged ? '★' : '☆'}</span></button>`;
// Recognised video-meeting links, so we can float a "Join" button.
const MEETING_RE = /https?:\/\/(?:[\w.-]*\.)?(?:zoom\.us\/(?:j|my|w|wc)\/\S+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/\S+|teams\.live\.com\/meet\/\S+|[\w.-]*webex\.com\/\S+|whereby\.com\/\S+|meet\.jit\.si\/\S+)/i;
function mailMeetingLink(o) {
  const m = `${o.text || ''}\n${o.html || ''}`.match(MEETING_RE);
  return (m ? m[0].replace(/["'&<>]+$/, '') : '') || (o.invite && o.invite.url) || '';
}
// Escape a plain-text body, then turn bare URLs into links (opens in a new tab).
function linkifyText(text) {
  const s = String(text || ''); let out = '', last = 0, m; BARE_URL.lastIndex = 0;
  while ((m = BARE_URL.exec(s))) { out += esc(s.slice(last, m.index)); const u = m[0]; out += `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`; last = m.index + u.length; }
  return out + esc(s.slice(last));
}
// A calendar-invite card in the reader, with a one-tap "Add to Calendar".
function inviteCardHtml(inv) {
  let when = '';
  try {
    if (inv.allDay) when = new Date(inv.startDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + ' · all day';
    else { const s = new Date(inv.start), e = inv.end ? new Date(inv.end) : null; const opt = { hour: '2-digit', minute: '2-digit' };
      when = s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + s.toLocaleTimeString(undefined, opt) + (e ? '–' + e.toLocaleTimeString(undefined, opt) : ''); }
  } catch {}
  return `<div class="mail-invite">
    <div class="mail-invite-h">📅 Calendar invitation</div>
    <div class="mail-invite-title">${esc(inv.summary || '(no title)')}</div>
    <div class="mail-invite-when">${esc(when)}</div>
    ${inv.location ? `<div class="mail-invite-loc">📍 ${esc(inv.location)}</div>` : ''}
    ${inv.organizer ? `<div class="mail-invite-org">from ${esc(inv.organizer)}</div>` : ''}
    <div class="mail-invite-act"><button class="add-btn wide" data-mail-invite-add>Add to Calendar</button>${inv.url ? `<button class="ghost" data-mail-join="${esc(inv.url)}">🎥 Join</button>` : ''}</div>
  </div>`;
}
async function mailInviteAdd() {
  const inv = state.mail.open && state.mail.open.invite; if (!inv) return;
  let body;
  if (inv.allDay) body = { title: inv.summary, allDay: true, day: inv.startDate, location: inv.location || undefined };
  else { let end = inv.end; if (!end && inv.start) { try { end = new Date(new Date(inv.start).getTime() + 3600000).toISOString(); } catch {} }
    body = { title: inv.summary, start: inv.start, end, tz: inv.tz || undefined, location: inv.location || undefined }; }
  try { await api('/api/events', { method: 'POST', body: JSON.stringify(body) }); toast('Added to your calendar'); }
  catch (e) { toast(e.message); }
}
function renderMail(loading) {
  const m = state.mail;
  if (m.accounts && !m.accounts.length) return renderMailAccounts('Add a mailbox to get started.');
  const unseenOf = (id) => (m.unseen && m.unseen[id]) || 0;
  const badge = (n) => n ? `<span class="mail-unread-b">${n}</span>` : '';
  const totalUnseen = Object.values(m.unseen || {}).reduce((a, b) => a + b, 0);
  const allTab = (m.accounts || []).length > 1 ? `<button class="mail-atab ${m.account === 'all' ? 'on' : ''}" data-mail-acct="all">All${badge(totalUnseen)}</button>` : '';
  const accTabs = allTab + (m.accounts || []).map((a) => `<button class="mail-atab ${a.id === m.account ? 'on' : ''}" data-mail-acct="${a.id}">${esc(a.name || a.email)}${badge(unseenOf(a.id))}</button>`).join('');
  const showAcct = m.account === 'all';
  let rows;
  if (m.threaded) {
    rows = buildThreads(m.messages || []).map((th) => {
      if (th.count === 1) return mailRowHtml(th.latest);
      const exp = !!(m.expanded && m.expanded[th.key]);
      const header = `<button class="mail-row mail-thread ${th.unread ? 'unread' : ''} ${exp ? 'exp' : ''}" data-mail-thread="${esc(th.key)}">
        <span class="mail-chevron">${exp ? '▾' : '▸'}</span>
        <span class="mail-row-main"><span class="mail-row-top"><span class="mail-from">${esc(threadFrom(th))}</span><span class="mail-date">${mailDate(th.latest.date)}</span></span>
        <span class="mail-subject">${showAcct ? `<span class="mail-acct-chip">${esc(th.latest._acctName || '')}</span>` : ''}${esc(normSubject(th.latest.subject) || th.latest.subject)}<span class="mail-thread-n">${th.count}</span></span></span>
        <span class="mail-star ${th.flagged ? 'on' : ''}">${th.flagged ? '★' : ''}</span></button>`;
      return header + (exp ? th.messages.map((x) => mailRowHtml(x, true)).join('') : '');
    }).join('');
  } else {
    rows = (m.messages || []).map((x) => mailRowHtml(x)).join('');
  }
  const errBanner = (!loading && (m.acctErrors || []).length)
    ? m.acctErrors.map((e) => `<div class="mail-acct-err">⚠ <b>${esc(e.name)}</b> could not load: ${esc(e.msg)}</div>`).join('')
    : '';
  const list = `<div class="mail-list">${errBanner}${loading ? '<div class="home-empty">Loading…</div>' : (rows || `<div class="home-empty">${m.query ? 'No matches.' : 'No messages.'}</div>`)}${!loading && m.hasMore ? '<button class="mail-loadmore" data-mail-more>Load older</button>' : ''}</div>`;
  let reader;
  if (m.composing) {
    const catts = m.composing.attachments || [];
    reader = `<form id="mail-compose-form" class="mail-compose">
      <div class="mail-reader-head"><button type="button" class="ghost mail-back" data-mail-cancel>← Back</button><span class="mail-reader-title">New message</span>${m.composing._resumed ? '<span class="mail-draft-note">Resumed draft</span>' : ''}</div>
      <input id="mc-to" placeholder="To" value="${esc(m.composing.to || '')}" required>
      <input id="mc-cc" placeholder="Cc" value="${esc(m.composing.cc || '')}">
      <input id="mc-bcc" placeholder="Bcc" value="${esc(m.composing.bcc || '')}">
      <input id="mc-subject" placeholder="Subject" value="${esc(m.composing.subject || '')}">
      <div class="mail-rt-toolbar">
        <button type="button" data-rt="bold" title="Bold  ·  ⌘B"><b>B</b></button>
        <button type="button" data-rt="italic" title="Italic  ·  ⌘I"><i>I</i></button>
        <button type="button" data-rt="underline" title="Underline  ·  ⌘U"><u>U</u></button>
        <button type="button" data-rt="insertUnorderedList" title="Bullet list">•&nbsp;List</button>
        <button type="button" data-rt="link" title="Add link">🔗</button>
      </div>
      <div id="mc-body" class="mail-compose-body prose" contenteditable="true" data-ph="Write your message…">${m.composing.body || ''}</div>
      ${catts.length ? `<div class="mail-att">${catts.map((a) => `<span class="mail-att-chip">📎 ${esc(a.name)}<button type="button" class="mail-att-x" data-mail-att-del="${esc(a.id)}" title="Remove">×</button></span>`).join('')}</div>` : ''}
      ${(() => { const a = (m.accounts || []).find((x) => x.id === composeAcctId()); return a && a.signature ? `<div class="mail-sig-note">✓ Signature for <b>${esc(a.email)}</b> will be added</div>` : ''; })()}
      <input type="file" id="mc-file" multiple hidden>
      <div class="mail-compose-act"><button class="add-btn wide" type="submit">Send</button><button type="button" class="ghost" data-mail-attach title="Attach files">📎 Attach</button><button type="button" class="ghost" data-mail-cancel>Cancel</button><button type="button" class="ghost mail-discard" data-mail-discard title="Discard draft">Discard</button></div></form>`;
  } else if (m.open) {
    const o = m.open;
    reader = `<div class="mail-msg">
      <div class="mail-reader-head"><button class="ghost mail-back" data-mail-back>← Inbox</button>
        <span class="mail-msg-act"><button class="ghost mail-star-btn ${o.flagged ? 'on' : ''}" data-mail-star="${esc(o._key)}" title="Star  ·  S">${o.flagged ? '★' : '☆'}</button><button class="mail-claudius" data-mail-claudius title="Draft a reply with Claudius">✦ Claudius</button><button class="ghost" data-mail-reply title="Reply to sender  ·  R">Reply</button><button class="ghost" data-mail-reply-all title="Reply all  ·  A">Reply all</button><button class="ghost" data-mail-forward title="Forward  ·  F">Forward</button><button class="ghost" data-mail-archive="${esc(o._key)}" title="Archive — remove from inbox, keep it  ·  E">Archive</button><button class="ghost" data-mail-move-one="${esc(o._key)}" title="Move to a folder">Move</button><button class="ghost" data-mail-spam="${esc(o._key)}" title="Mark as spam (move to Junk)">Spam</button><button class="ghost" data-mail-block="${esc(o._key)}" data-mail-from="${esc(o.from ? o.from.address : '')}" title="Block this sender — their mail goes straight to Junk">Block</button><button class="ghost" data-mail-del="${esc(o._key)}">Delete</button></span></div>
      <h1 class="mail-subj">${esc(o.subject)}</h1>
      <div class="mail-meta"><span class="mail-avatar big">${esc(initial(o.from ? (o.from.name || o.from.address) : '?'))}</span>
        <span class="mail-meta-lines"><b>${esc(o.from ? (o.from.name || o.from.address) : '')}</b><span class="mail-addr">${esc(o.from ? o.from.address : '')}</span></span>
        ${showAcct && o._acctName ? `<span class="mail-acct-chip">${esc(o._acctName)}</span>` : ''}<span class="mail-when">${o.date ? new Date(o.date).toLocaleString() : ''}</span></div>
      ${o.attachments && o.attachments.length ? `<div class="mail-att">${o.attachments.map((a) => `<button type="button" class="mail-att-chip mail-att-dl" data-mail-save-att="${a.idx}" data-att-name="${esc(a.filename || 'attachment')}" title="Save to your computer">📎 ${esc(a.filename || 'attachment')} <span class="mail-att-sz">${fmtBytes(a.size)}</span> ↓</button>`).join('')}</div>` : ''}
      ${o.invite ? inviteCardHtml(o.invite) : ''}
      ${(() => { const ml = mailMeetingLink(o); return ml ? `<div class="mail-join-bar"><button class="add-btn wide" data-mail-join="${esc(ml)}">🎥 Join meeting</button><span class="mail-join-url">${esc(ml)}</span></div>` : ''; })()}
      ${mailImagesBlocked(o) ? `<div class="mail-imgbar"><span class="mail-imgbar-t">🖼 Remote images are hidden to protect your privacy.</span><span class="mail-imgbar-act"><button class="ghost" data-mail-show-imgs>Show images</button>${o.from && o.from.address ? `<button class="ghost" data-mail-trust="${esc(o.from.address)}">Always trust sender</button>` : ''}</span></div>` : ''}
      ${o.html ? `<iframe class="mail-body-frame" id="mail-body-frame" sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts" title="Message"></iframe>` : `<div class="mail-text">${linkifyText(o.text || '')}</div>`}</div>`;
  } else {
    reader = `<div class="mail-empty">${loading ? '' : 'Select a message to read.'}</div>`;
  }
  $('#pane').innerHTML = `
    ${pageCrumb('Mail')}
    <div class="pane-head home-head"><h1>Mail</h1>
      <div class="mail-head-act"><button class="ghost" data-mail-shortcuts title="Keyboard shortcuts  ·  ?">⌨</button><button class="ghost" data-mail-accounts title="Accounts">Accounts</button><button class="add-btn wide" data-mail-compose>+ Compose</button></div></div>
    ${(m.open || m.composing) ? '' : `
    ${accTabs ? `<div class="mail-atabs">${accTabs}</div>` : ''}
    <div class="mail-folders">${MAIL_FOLDERS.map((f) => `<button class="mail-folder ${(m.folder || 'inbox') === f.key ? 'on' : ''}" data-mail-folder="${f.key}">${esc(f.label)}</button>`).join('')}</div>
    <div class="mail-tools">
      <input class="list-search sel mail-search" data-mail-q placeholder="Search mail…" value="${esc(m.query || '')}" autocomplete="off">
      <button class="tbl-filter-btn ${m.threaded ? 'on' : ''}" data-mail-thread-toggle title="Group into conversations">☰ Threads</button>
      ${(m.folder === 'spam' || m.folder === 'trash') ? `<button class="tbl-filter-btn mail-empty-btn" data-mail-empty title="Permanently empty this folder">🗑 Empty</button>` : ''}
      <button class="tbl-filter-btn mail-refresh" data-mail-refresh title="Refresh">↻</button>
    </div>`}
    ${m.error ? `<div class="cal-warn">${esc(m.error)}</div>` : ''}
    ${(m.selected && m.selected.size && !m.open && !m.composing) ? `<div class="mail-bulkbar">
      <span class="mail-bulk-n">${m.selected.size} selected</span>
      <button class="ghost" data-mail-bulk="archive">Archive</button>
      <button class="ghost" data-mail-bulk="read">Mark read</button>
      <button class="ghost" data-mail-bulk="unread">Mark unread</button>
      <button class="ghost" data-mail-bulk="star">Star</button>
      <button class="ghost" data-mail-bulk="move">Move…</button>
      <button class="ghost" data-mail-bulk="delete">Delete</button>
      <button class="ghost mail-bulk-x" data-mail-bulk="clear">Cancel</button>
    </div>` : ''}
    <div class="mail-layout ${m.open || m.composing ? 'reading' : ''} ${(m.selected && m.selected.size) ? 'selecting' : ''}">
      <div class="mail-list-col">${list}</div>
      <div class="mail-reader">${reader}</div>
    </div>
    ${m.shortcuts ? shortcutsOverlayHtml() : ''}
    ${m.moveMenu ? mailMoveMenuHtml() : ''}`;
  if (m.open && m.open.html) { const f = document.getElementById('mail-body-frame'); if (f) f.srcdoc = wrapEmailHtml(m.open.html, mailImagesBlocked(m.open)); }
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
// A block can exist as several in-memory copies: the list entry and the
// currently-open view object (openTable/openNote fetch fresh). Update them all,
// or the star you're looking at (rendered from the open object) won't change.
function favApplyLocal(id, fav, rank) {
  const copies = [
    ...state.tasks.filter((x) => x.id === id), ...state.tables.filter((x) => x.id === id),
    ...state.noteTops.filter((x) => x.id === id), ...state.areas.filter((x) => x.id === id),
    state.tables_open && state.tables_open.id === id ? state.tables_open : null,
    state.note && state.note.current && state.note.current.id === id ? state.note.current : null,
    state.task_open && state.task_open.task && state.task_open.task.id === id ? state.task_open.task : null,
    state.area_open && state.area_open.area && state.area_open.area.id === id ? state.area_open.area : null,
  ].filter(Boolean);
  for (const cp of copies) { cp.props = cp.props || {}; cp.props.fav = fav; if (fav && rank) cp.props.fav_rank = rank; }
  return copies[0];
}
async function toggleFav(id) {
  const b = findBlock(id); if (!b) return;
  const fav = !(b.props && b.props.fav);
  const rank = fav ? Date.now() : (b.props && b.props.fav_rank);
  favApplyLocal(id, fav, rank);
  if (fav) { if (!state.favs.find((f) => f.id === id)) state.favs.push({ id, kind: b.kind, title: b.title, props: { ...(b.props || {}), fav: true } }); }
  else { state.favs = state.favs.filter((f) => f.id !== id); }
  renderNav(); rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { fav, fav_rank: rank } }) }); } catch (e) { toast(e.message); }
}
async function unfav(id) {
  favApplyLocal(id, false);
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
  renderNav(); if (state.view.type === 'home') renderHome();
  favs.forEach((f, i) => { f.props = f.props || {}; f.props.fav_rank = i; api(`/api/blocks/${f.id}`, { method: 'PATCH', body: JSON.stringify({ props: { fav_rank: i } }) }).catch(() => {}); });
}
// Reorder the "Notes inside" list by dragging, persisting each child's position.
async function reorderSubs(draggedId, beforeId) {
  const kids = state.note && state.note.children; if (!kids) return;
  const from = kids.findIndex((k) => k.id === draggedId); if (from < 0) return;
  const [moved] = kids.splice(from, 1);
  let to = beforeId ? kids.findIndex((k) => k.id === beforeId) : kids.length;
  if (to < 0) to = kids.length;
  kids.splice(to, 0, moved);
  renderNote();
  kids.forEach((k, i) => { k.position = i; api(`/api/blocks/${k.id}`, { method: 'PATCH', body: JSON.stringify({ position: i }) }).catch(() => {}); });
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
  const tq = (state.taskQuery || '').trim().toLowerCase();
  const matchesQ = (t) => !tq || (t.title || '').toLowerCase().includes(tq);
  const open = state.tasks.filter((t) => !t.props.done && inFilter(t) && matchesQ(t));       // ticked tasks vanish from view
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
    ${pageCrumb('Tasks')}
    <div class="pane-head"><h1>Tasks</h1></div>
    <div class="list-head">
      <input class="list-search sel" data-task-q placeholder="Search tasks…" value="${esc(state.taskQuery || '')}" autocomplete="off">
      ${state.taskAdding ? '' : `<button class="add-btn wide" data-task-add>+ Add task</button>`}
    </div>
    ${state.taskAdding
      ? `<form id="task-form" class="add-task">
      <input id="task-title" type="text" placeholder="Add a task…" autocomplete="off" required>
      <select id="task-area" class="sel">${opts}</select>
      <select id="task-prio" class="sel"><option value="">—</option><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option></select>
      <button class="add-btn wide" type="submit">Add</button>
      <button type="button" class="ghost" data-task-add-close>Done</button>
    </form>`
      : ''}
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
  migrateCards(n);
  const sep = '<span class="crumb-sep">›</span>';
  const crumbs = state.note.path.map((a, i) => i === state.note.path.length - 1
    ? `<span class="crumb cur">${esc(a.title || 'Untitled')}</span>`
    : `<button class="crumb" data-open-note="${a.id}">${esc(a.title || 'Untitled')}</button>`).join(sep);
  const kids = state.note.children.map((c) => `<button class="subpage" data-open-note="${c.id}" draggable="true" data-sub-id="${c.id}"><span class="sp-grip" title="Drag to reorder">⠿</span><span class="sp-ico">▸</span><span class="sp-t">${esc(c.title || 'Untitled')}</span></button>`).join('');
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button>${sep}<button class="crumb" data-open-notes>Notes</button>${sep}${crumbs}
      <span class="crumb-tools">${areaLinkHtml(n.props && n.props.area)}${areaSelect(n.props && n.props.area, 'data-note-area')}
      <button class="star ${n.props && n.props.fav ? 'on' : ''}" data-fav="${n.id}" title="Favourite">${n.props && n.props.fav ? '★' : '☆'}</button>
      <button class="note-move ghost" data-move-note title="Move this note inside another">Move</button>
      <button class="ghost" data-note-to-table title="Create a table from this note's lines">To table</button>
      <button class="note-del ghost" data-del-note title="Delete this note">Delete</button></span></div>
    <div class="note-layout">
      <div class="note-main">
        <textarea class="note-title" id="note-title" rows="1" placeholder="Untitled">${esc(n.title || '')}</textarea>
        <div class="note-body">${proseEditor(n.body, 'note')}</div>
        ${embedsHtml(n.body)}
      </div>
      <aside class="note-side">
        <div class="subpages" data-subpages><div class="sub-h">Notes inside${state.note.children.length ? ` · ${state.note.children.length}` : ''}</div>
          ${kids}<button class="subpage add" data-new-sub><span class="sp-ico">+</span><span class="sp-t">New note inside</span></button></div>
      </aside>
      <div class="note-attach">${attachSection(n)}</div>
    </div>`;
  autoGrowSoon($('#note-title')); loadThumbs(); hydrateEmbeds();
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
const TYPES = [['text', 'Text'], ['url', 'URL'], ['number', 'Number'], ['date', 'Date'], ['checkbox', 'Tick box'], ['select', 'Select'], ['attach', 'Attachments']];
const tcols = () => (state.tables_open.props.columns || []);
function cellInput(r, col) {
  const v = ((r.props && r.props.values) || {})[col.id]; const k = `${r.id}:${col.id}`;
  if (col.type === 'attach') {
    const list = Array.isArray(v) ? v : [];
    const chips = list.map((a) => `<span class="tcell-att" data-tatt-open="${r.id}:${a.id}" data-tatt-name="${esc(a.name)}" data-tatt-type="${esc(a.type)}" title="${esc(a.name)}"><span class="tcell-att-ic">${attIcon(a.type)}</span><span class="tcell-att-name">${esc(a.name)}</span><button class="tcell-att-x" data-tatt-del="${r.id}:${col.id}:${a.id}" title="Remove">×</button></span>`).join('');
    return `<div class="tcell-atts">${chips}<label class="tcell-att-add" title="Add file"><input type="file" multiple hidden data-tatt-input="${r.id}:${col.id}">+</label></div>`;
  }
  if (col.type === 'checkbox') return `<input type="checkbox" data-cell="${k}" ${v ? 'checked' : ''}>`;
  if (col.type === 'number') return `<input type="number" class="cell" data-cell="${k}" value="${esc(v ?? '')}">`;
  if (col.type === 'date') return `<input type="date" class="cell" data-cell="${k}" value="${esc(v ?? '')}">`;
  if (col.type === 'select') return `<select class="cell" data-cell="${k}"><option value=""></option>${(col.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (col.type === 'url') {
    const raw = String(v ?? '').trim();
    const href = raw ? (/^[a-z][\w+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
    return `<span class="cellwrap${href ? ' has-link' : ''}"><input type="text" class="cell" data-cell="${k}" value="${esc(v ?? '')}" placeholder="https://…" inputmode="url" autocomplete="off">${href ? `<a class="cell-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Open link" tabindex="-1">↗</a>` : ''}</span>`;
  }
  // A text cell holding a URL gets a small open-link button (still editable).
  const url = /^\s*https?:\/\/\S+\s*$/i.test(String(v ?? '')) ? String(v).trim() : null;
  return `<span class="cellwrap${url ? ' has-link' : ''}"><input type="text" class="cell" data-cell="${k}" value="${esc(v ?? '')}">${url ? `<a class="cell-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open link" tabindex="-1">↗</a>` : ''}</span>`;
}
// View-only sort by a column (like the Tasks table). Type-aware; empty cells
// always sink to the bottom whichever way you sort.
// Multi-level sort: compare by the first level, break ties with the next, and
// so on. An empty spec falls back to the first column ascending (a saner default
// than raw creation order). The spec lives in the table's props, so it persists.
function tableSorts() { return (state.tables_view.sorts && state.tables_view.sorts.length) ? state.tables_view.sorts : null; }
function sortRows(rows) {
  const cols = tcols();
  const spec = tableSorts() || (cols[0] ? [{ colId: cols[0].id, dir: 'asc' }] : []);
  if (!spec.length) return rows;
  const cmpLevel = (a, b, s) => {
    const col = cols.find((x) => x.id === s.colId); if (!col) return 0;
    const dir = s.dir === 'asc' ? 1 : -1;
    const raw = (r) => ((r.props && r.props.values) || {})[s.colId];
    const va = raw(a), vb = raw(b);
    if (col.type !== 'checkbox') {
      const empty = (x) => x == null || x === '' || (Array.isArray(x) && !x.length);
      const ea = empty(va), eb = empty(vb);
      if (ea && eb) return 0; if (ea) return 1; if (eb) return -1; // empties last, either direction
    }
    const norm = (v) => col.type === 'number' ? Number(v) : col.type === 'checkbox' ? (v ? 1 : 0) : col.type === 'attach' ? (Array.isArray(v) ? v.length : 0) : col.type === 'date' ? String(v) : String(v).toLowerCase();
    const na = norm(va), nb = norm(vb);
    return na < nb ? -dir : na > nb ? dir : 0;
  };
  return rows.slice().sort((a, b) => {
    for (const s of spec) { const r = cmpLevel(a, b, s); if (r) return r; }
    return 0;
  });
}
// Persist the current sort spec onto the table block so it's there next visit.
function saveTableSort() {
  const t = state.tables_open; if (!t) return;
  const sorts = state.tables_view.sorts || [];
  t.props = t.props || {}; t.props.sorts = sorts;
  const s = state.tables.find((x) => x.id === t.id); if (s) { s.props = s.props || {}; s.props.sorts = sorts; }
  api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ props: { sorts } }) }).catch((e) => toast(e.message));
}
function setSorts(sorts) { state.tables_view.sorts = sorts; state.tables_view.newRow = null; renderTable(); saveTableSort(); }
const DIR_LABELS = (type) => type === 'number' ? ['1 → 9', '9 → 1'] : type === 'date' ? ['Old → New', 'New → Old'] : type === 'checkbox' ? ['Unticked first', 'Ticked first'] : ['A → Z', 'Z → A'];
// Hidden columns: a list of column ids on the table's props. Hiding only affects
// the grid; the data stays (still editable via the expanded row card) and the
// column can be re-shown from any column's ▾ menu. Persisted like the sort spec.
function hiddenCols() { const t = state.tables_open; return (t && t.props && t.props.hiddenCols) || []; }
function visibleCols() { const h = hiddenCols(); return tcols().filter((c) => !h.includes(c.id)); }
function saveTableHidden(hidden) {
  const t = state.tables_open; if (!t) return;
  t.props = t.props || {}; t.props.hiddenCols = hidden;
  const s = state.tables.find((x) => x.id === t.id); if (s) { s.props = s.props || {}; s.props.hiddenCols = hidden; }
  renderTable();
  api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ props: { hiddenCols: hidden } }) }).catch((e) => toast(e.message));
}
// ── table search + filters ───────────────────────────
const cellVal = (r, colId) => ((r.props && r.props.values) || {})[colId];
// Operators offered per column type.
const FILTER_OPS = {
  text: [['contains', 'contains'], ['ncontains', "doesn't contain"], ['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['nempty', 'is not empty']],
  number: [['is', '='], ['isnot', '≠'], ['gt', '>'], ['lt', '<'], ['gte', '≥'], ['lte', '≤'], ['empty', 'is empty']],
  date: [['is', 'is'], ['before', 'before'], ['after', 'after'], ['empty', 'is empty'], ['nempty', 'is not empty']],
  select: [['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['nempty', 'is not empty']],
  checkbox: [['checked', 'is checked'], ['unchecked', 'is unchecked']],
};
const opsFor = (type) => FILTER_OPS[type] || FILTER_OPS.text;
const noValueOp = (op) => op === 'empty' || op === 'nempty' || op === 'checked' || op === 'unchecked';
function matchesFilter(r, f) {
  const col = tcols().find((c) => c.id === f.colId); if (!col) return true;
  const v = cellVal(r, f.colId);
  const sv = String(v ?? '').toLowerCase(), fv = String(f.value ?? '').toLowerCase();
  switch (f.op) {
    case 'contains': return sv.includes(fv);
    case 'ncontains': return !sv.includes(fv);
    case 'is': return sv === fv;
    case 'isnot': return sv !== fv;
    case 'empty': return v == null || v === '' || v === false;
    case 'nempty': return !(v == null || v === '' || v === false);
    case 'gt': return Number(v) > Number(f.value);
    case 'lt': return Number(v) < Number(f.value);
    case 'gte': return Number(v) >= Number(f.value);
    case 'lte': return Number(v) <= Number(f.value);
    case 'checked': return !!v;
    case 'unchecked': return !v;
    case 'before': return String(v || '') < String(f.value || '');
    case 'after': return String(v || '') > String(f.value || '');
    default: return true;
  }
}
function matchesQuery(r) {
  const q = (state.tables_view.query || '').trim().toLowerCase();
  if (!q) return true;
  const vals = (r.props && r.props.values) || {};
  return tcols().some((col) => {
    if (col.type === 'checkbox') return false;
    if (col.type === 'attach') return (Array.isArray(vals[col.id]) ? vals[col.id] : []).some((a) => String(a.name || '').toLowerCase().includes(q));
    return String(vals[col.id] ?? '').toLowerCase().includes(q);
  }) || String(r.body || '').toLowerCase().includes(q);
}
function visibleRows() {
  const filters = state.tables_view.filters || [];
  const rows = sortRows(state.tables_rows).filter((r) => matchesQuery(r) && filters.every((f) => matchesFilter(r, f)));
  // A just-added row is pinned to the top so it's visible to fill in (a blank
  // row otherwise sorts to the bottom). The pin drops on re-sort or reopen.
  const nid = state.tables_view.newRow;
  if (nid) { const i = rows.findIndex((r) => r.id === nid); if (i > 0) { const [row] = rows.splice(i, 1); rows.unshift(row); } }
  return rows;
}
function tableBodyHtml() {
  const c = visibleCols();
  const rows = visibleRows().map((r) => `<tr><td class="row-open" data-open-row="${r.id}" title="Open this row"><span class="ro-ic">⤢</span></td>${c.map((col) => `<td class="${col.type === 'checkbox' ? 'check' : col.type === 'number' ? 'num' : ''}">${cellInput(r, col)}</td>`).join('')}<td class="row-del"><button data-del-row="${r.id}">×</button></td></tr>`).join('');
  const empty = (state.tables_view.query || (state.tables_view.filters || []).length) && !visibleRows().length
    ? `<tr class="tbl-noresult"><td colspan="${c.length + 2}">No rows match.</td></tr>` : '';
  // The add control lives in the toolbar (always visible); no duplicate at the foot.
  return rows + empty;
}
function renderTableBody() { const el = $('#tbl-body'); if (el) el.innerHTML = tableBodyHtml(); }
function filterPanelHtml() {
  const c = tcols(), filters = state.tables_view.filters || [];
  const rows = filters.map((f, i) => {
    const col = c.find((x) => x.id === f.colId) || c[0] || {};
    const colOpts = c.map((x) => `<option value="${x.id}" ${x.id === f.colId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const opOpts = opsFor(col.type).map(([v, l]) => `<option value="${v}" ${v === f.op ? 'selected' : ''}>${esc(l)}</option>`).join('');
    let val = '';
    if (!noValueOp(f.op)) {
      if (col.type === 'select') val = `<select class="sel fv" data-filt-val="${i}"><option value=""></option>${(col.options || []).map((o) => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      else val = `<input class="sel fv" data-filt-val="${i}" type="${col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}" value="${esc(f.value || '')}" placeholder="value">`;
    }
    return `<div class="filt-row"><select class="sel" data-filt-col="${i}">${colOpts}</select><select class="sel" data-filt-op="${i}">${opOpts}</select>${val}<button class="filt-x" data-filt-del="${i}" title="Remove">×</button></div>`;
  }).join('');
  return `<div class="tbl-filters"><div class="filt-rows">${rows || '<div class="filt-empty">No filters yet.</div>'}</div>
    <div class="filt-act"><button class="ghost" data-filt-add>+ Add filter</button>${filters.length ? '<button class="ghost" data-filt-clear>Clear all</button>' : ''}</div></div>`;
}
const FUNNEL = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M1.5 2.5h13l-5 6.2V13l-3 1.5V8.7z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const SORTIC = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4.5 3v10M4.5 13l-2-2.2M4.5 13l2-2.2M11.5 13V3M11.5 3l-2 2.2M11.5 3l2 2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Multi-level sort panel: "Sort by <col> <dir>", "then by <col> <dir>", …
function sortPanelHtml() {
  const c = tcols(), sorts = state.tables_view.sorts || [];
  const rows = sorts.map((s, i) => {
    const col = c.find((x) => x.id === s.colId) || c[0] || {};
    const colOpts = c.map((x) => `<option value="${x.id}" ${x.id === s.colId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const [asc, desc] = DIR_LABELS(col.type);
    const dirOpts = `<option value="asc" ${s.dir === 'asc' ? 'selected' : ''}>${asc}</option><option value="desc" ${s.dir === 'desc' ? 'selected' : ''}>${desc}</option>`;
    return `<div class="filt-row"><span class="sortl-lbl">${i === 0 ? 'Sort by' : 'then by'}</span><select class="sel" data-sortl-col="${i}">${colOpts}</select><select class="sel" data-sortl-dir="${i}">${dirOpts}</select><button class="filt-x" data-sortl-del="${i}" title="Remove">×</button></div>`;
  }).join('');
  return `<div class="tbl-filters"><div class="filt-rows">${rows || '<div class="filt-empty">Sorted by the first column. Add a level to combine sorts.</div>'}</div>
    <div class="filt-act"><button class="ghost" data-sortl-add>+ Add sort</button>${sorts.length ? '<button class="ghost" data-sortl-clear>Clear</button>' : ''}</div></div>`;
}

function renderTable() {
  const t = state.tables_open, c = tcols(), vw = state.tables_view;
  if (vw.openRow) {
    const r = state.tables_rows.find((x) => x.id === vw.openRow) || (vw.openRow = null);
    if (r) {
      migrateCards(r);
      const title = ((r.props && r.props.values) || {})[c[0] && c[0].id] || 'Untitled';
      $('#pane').innerHTML = `${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Tables', attr: 'data-open-tables' }, { label: t.title || 'table', attr: 'data-back-table' }, { label: title }], (r.props && r.props.area) || (t.props && t.props.area))}
        <div class="card">
        <h1 class="card-title">${esc(title)}</h1><div class="card-fields">${c.map((col) => `<label class="crow"><span class="clabel">${esc(col.name)}<em>${esc(col.type)}</em></span><span class="cval">${cellInput(r, col)}</span></label>`).join('')}</div>
        ${notesSection(r.body, 'row')}
        ${attachSection(r)}</div>`;
      loadThumbs(); hydrateEmbeds();
      return;
    }
  }
  const vc = visibleCols();
  const colWidth = (col, first) => col.width || (first ? 230 : 170);
  const colgroup = `<colgroup><col style="width:46px">${vc.map((col, i) => `<col data-cw="${col.id}" style="width:${colWidth(col, i === 0)}px">`).join('')}<col style="width:46px"></colgroup>`;
  const addCol = vw.addingCol
    ? `<th class="th-add" style="text-align:left"><form class="colnew" id="colnew"><input id="cn-name" placeholder="Column" autocomplete="off"><select id="cn-type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="add-btn" type="submit">Add</button></form></th>`
    : `<th class="th-add"><button data-add-col title="Add column">+</button></th>`;
  const sortSpec = vw.sorts || [];
  const sortOf = (id) => { const i = sortSpec.findIndex((s) => s.colId === id); return i < 0 ? null : { dir: sortSpec[i].dir, badge: sortSpec.length > 1 ? i + 1 : '' }; };
  const head = vc.map((col) => { const sd = sortOf(col.id); return `<th><div class="thh"><button class="th-name" data-sort-col="${col.id}" title="Sort by ${esc(col.name)}">${esc(col.name)}${col.type === 'select' ? '<span class="th-type">select</span>' : ''}${sd ? `<span class="sarrow">${sd.dir === 'asc' ? '↑' : '↓'}${sd.badge ? `<b>${sd.badge}</b>` : ''}</span>` : ''}</button><button class="th-menu" data-col-menu="${col.id}" title="Column options — rename, type, options, sort, delete">▾</button></div><span class="resizer" data-resize="${col.id}"></span></th>`; }).join('');
  const nFilt = (vw.filters || []).length, nSort = sortSpec.length;
  $('#pane').innerHTML = `
    ${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Tables', attr: 'data-open-tables' }, { label: t.title || 'Untitled' }], t.props && t.props.area)}
    <div class="tbl-head"><input class="rename" value="${esc(t.title || '')}" data-rename>
      ${areaSelect(t.props && t.props.area, 'data-table-area')}
      <button class="star ${t.props && t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props && t.props.fav ? '★' : '☆'}</button>
      <button class="ghost" data-del-cur>Delete</button></div>
    <div class="tbl-toolbar">
      <input class="list-search sel tbl-search" data-tbl-q placeholder="Search this table…" value="${esc(vw.query || '')}" autocomplete="off">
      <button class="tbl-filter-btn ${nSort > 1 || vw.sorting ? 'on' : ''}" data-tbl-sort title="Sort rows">${SORTIC} Sort${nSort > 1 ? ` · ${nSort}` : ''}</button>
      <button class="tbl-filter-btn ${nFilt || vw.filtering ? 'on' : ''}" data-tbl-filter title="Filter rows">${FUNNEL} Filter${nFilt ? ` · ${nFilt}` : ''}</button>
      <button class="add-btn wide tbl-add-row" data-add-row title="Add a new row">+ New</button>
    </div>
    <div id="tbl-sort-panel">${vw.sorting ? sortPanelHtml() : ''}</div>
    <div id="tbl-filter-panel">${vw.filtering ? filterPanelHtml() : ''}</div>
    <div class="tbl-scroll"><table class="recs fixed">${colgroup}
      <thead><tr><th class="th-open"></th>${head}${addCol}</tr></thead>
      <tbody id="tbl-body">${tableBodyHtml()}</tbody></table></div>
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
  const name = ((await uiPrompt('New life area name:', { title: 'New life area', okLabel: 'Create', placeholder: 'e.g. Writing / Poetry' })) || '').trim(); if (!name) return;
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
  r.props = r.props || {};
  r.props.values = { ...(r.props.values || {}), [colId]: value };
  try { await api(`/api/blocks/${rowId}`, { method: 'PATCH', body: JSON.stringify({ props: { values: r.props.values } }) }); } catch (e) { toast(e.message); }
}

// ── palette (⌘K) ─────────────────────────────────────
function openPalette() { state.pal = { open: true, q: '', items: [], sel: 0 }; renderPalette(); buildPalette(); setTimeout(() => $('#pal-input')?.focus(), 0); }
function closePalette() { state.pal.open = false; $('#palette').innerHTML = ''; }
const ACTIONS = [
  { kind: 'action', title: 'New note', run: () => newNote(null) },
  { kind: 'action', title: 'New journal entry', run: () => quickAdd('journal') },
  { kind: 'action', title: 'Go to Journal', run: () => openJournal() },
  { kind: 'action', title: 'Save a link', run: () => quickAdd('save') },
  { kind: 'action', title: 'Go to Read & Watch', run: () => openReadwatch() },
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
  if (document.getElementById('tblpick-overlay') && document.getElementById('tblpick-overlay').innerHTML && e.key === 'Escape') { e.preventDefault(); closeTableEntryPicker(); return; }
  if (state.linkpick) { if (e.key === 'Escape') { e.preventDefault(); closeLinkPicker(); return; } if (e.key === 'Enter' && e.target.id === 'linkpick-input') { e.preventDefault(); linkPickUrl(); return; } }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); state.pal.open ? closePalette() : openPalette(); return; }
  // ⌥⌘T / ⌥⌘W - the browser owns ⌘T/⌘W, so tabs use the Option variant.
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyT') { e.preventDefault(); newTab(); return; }
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyW') { e.preventDefault(); closeTab(state.activeTab); return; }
  // Mail compose: ⌘/Ctrl + Enter sends.
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state.view.type === 'mail' && state.mail && state.mail.composing) {
    const form = document.getElementById('mail-compose-form');
    if (form) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); return; }
  }
  // Mail single-key shortcuts - while browsing or reading, never while typing.
  if (!e.metaKey && !e.ctrlKey && !e.altKey && state.view.type === 'mail' && state.mail && !state.mail.composing) {
    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    const m = state.mail;
    if (!editing) {
      const active = (m.open && m.open._key) || m.sel;
      if (e.key === '?') { e.preventDefault(); m.shortcuts = !m.shortcuts; renderMail(); return; }
      if (e.key === 'Escape') { e.preventDefault(); if (m.shortcuts) m.shortcuts = false; else m.open = null; renderMail(); return; }
      if (e.key === '/') { e.preventDefault(); const el = $('[data-mail-q]'); if (el) el.focus(); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); startCompose(); return; }
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); mailSelMove(1); return; }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); mailSelMove(-1); return; }
      if ((e.key === 'Enter' || e.key === 'o' || e.key === 'O') && m.sel && !m.open) { e.preventDefault(); openMessage(m.sel); return; }
      if (active && (e.key === 'r' || e.key === 'R')) { if (m.open) { e.preventDefault(); mailReplyStart(false); } return; }
      if (active && (e.key === 'a' || e.key === 'A')) { if (m.open) { e.preventDefault(); mailReplyStart(true); } return; }
      if (active && (e.key === 'f' || e.key === 'F')) { if (m.open) { e.preventDefault(); mailForwardStart(); } return; }
      if (active && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); mailMoveTo(active, 'Archive', 'Archived'); return; }
      if (active && (e.key === 's' || e.key === 'S')) { e.preventDefault(); mailStar(active); return; }
      if (active && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); mailSeen(active, false); return; }
      if (active && e.key === '!') { e.preventDefault(); mailMoveTo(active, 'Junk', 'Marked as spam'); return; }
      if (active && (e.key === 'Backspace' || e.key === 'Delete' || e.key === '#')) { e.preventDefault(); mailMoveTo(active, 'Trash', 'Moved to Trash'); return; }
    }
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
  if (e.target.id === 'linkpick-input' && state.linkpick) { state.linkpick.q = e.target.value; renderLinkPickerList(); }
  if (e.target.matches('[data-completed-q]')) { const pos = e.target.selectionStart; state.completedQuery = e.target.value; renderTasks(); const i = $('[data-completed-q]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch {} } }
  // Page search boxes (Tasks / Notes / Calendar): keep focus + caret across the re-render.
  const liveSearch = (sel, set, render) => { if (!e.target.matches(sel)) return; const pos = e.target.selectionStart; set(e.target.value); render(); const i = $(sel); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch {} } };
  liveSearch('[data-task-q]', (v) => (state.taskQuery = v), renderTasks);
  liveSearch('[data-notes-q]', (v) => (state.notesQuery = v), renderNotesList);
  liveSearch('[data-cal-q]', (v) => (state.calQuery = v), renderCalendar);
  // Table search + filter value inputs: only the tbody re-renders, so the input keeps focus.
  if (e.target.matches('[data-tbl-q]')) { state.tables_view.query = e.target.value; renderTableBody(); }
  // Mail search hits IMAP, so debounce and re-focus the box after results land
  // (a full re-render recreates the input) rather than re-rendering per keystroke.
  if (e.target.matches('[data-home-notepad]')) { state.home.notepad = e.target.value; const v = e.target.value; clearTimeout(window.__padT); window.__padT = setTimeout(() => { api('/api/kv/home_scratchpad', { method: 'PUT', body: JSON.stringify({ value: v }) }).catch(() => {}); }, 700); }
  if (e.target.matches('[data-mail-q]')) { state.mail.query = e.target.value; const v = e.target.value; clearTimeout(window.__mailSearchT); window.__mailSearchT = setTimeout(() => { state.mail.limit = 40; loadMessages().then(() => { const el = $('[data-mail-q]'); if (el) { el.focus(); try { el.setSelectionRange(v.length, v.length); } catch {} } }); }, 450); }
  // Signature bar colour: live-recolour the bar; swatch and hex box stay synced.
  if (e.target.matches('[data-sig-hex]')) applySigColor(e.target.dataset.sigHex, e.target.value, 'hex');
  if (e.target.matches('[data-sig-color-sw]')) applySigColor(e.target.dataset.sigColorSw, e.target.value, 'sw');
  // Compose fields: keep the draft object in sync as you type, then auto-save.
  if (state.mail && state.mail.composing && ['mc-to', 'mc-cc', 'mc-bcc', 'mc-subject', 'mc-body'].includes(e.target.id)) {
    const c = state.mail.composing;
    if (e.target.id === 'mc-to') c.to = e.target.value; else if (e.target.id === 'mc-cc') c.cc = e.target.value;
    else if (e.target.id === 'mc-bcc') c.bcc = e.target.value;
    else if (e.target.id === 'mc-subject') c.subject = e.target.value; else c.body = e.target.innerHTML;
    clearTimeout(window.__mailDraftT); window.__mailDraftT = setTimeout(saveDraft, 600);
  }
  const fvi = e.target.closest('input[data-filt-val]'); if (fvi) { const i = +fvi.dataset.filtVal; if (state.tables_view.filters[i]) { state.tables_view.filters[i].value = e.target.value; renderTableBody(); } }
  if (e.target.dataset && e.target.dataset.prose) { clearTimeout(proseT); proseT = setTimeout(() => saveProse(e.target.dataset.prose, e.target.innerHTML), 800); }
});
let proseT;
document.addEventListener('click', (e) => {
  const t = e.target;
  // Any http(s) link opens in a new tab / the default browser, even from inside
  // an always-editable prose region (where a plain click would just set the caret).
  const alink = t.closest('a[href]');
  // Internal links jump within Robski Life instead of opening a browser tab.
  if (alink) {
    const rl = (alink.getAttribute('href') || '').match(/^#rl-(note|table|area)-(.+)$/i);
    if (rl) { e.preventDefault(); const id = rl[2]; const nav = rl[1].toLowerCase() === 'note' ? openNote(id) : rl[1].toLowerCase() === 'table' ? openTable(id) : openArea(id); nav.catch((x) => toast(x.message)); return; }
  }
  if (alink && /^https?:/i.test(alink.getAttribute('href') || '')) {
    e.preventDefault();
    // Synthesise a real anchor click rather than window.open: an installed PWA
    // hands this to the OS default browser, and it isn't caught by popup blockers.
    const a = document.createElement('a'); a.href = alink.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  const ate = t.closest('[data-add-table-entry]'); if (ate) { e.stopPropagation(); openTableEntryPicker(); return; }
  const tpk = t.closest('[data-tblpick]'); if (tpk) { addTableEntry(tpk.dataset.tblpick); return; }
  if (t.closest('[data-tblpick-bg]') && !t.closest('.pal')) { closeTableEntryPicker(); return; }
  const qadd = t.closest('[data-quick-add]'); if (qadd) { quickAdd(qadd.dataset.quickAdd); return; }
  if (t.closest('[data-nav-back]')) { navBack(); return; }
  if (t.closest('[data-linkpick-bg]') && !t.closest('.pal')) { closeLinkPicker(); return; }
  const lpt = t.closest('[data-linkpick-to]'); if (lpt) { linkPickPick(lpt.dataset.linkpickTo); return; }
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
  if (t.closest('[data-open-journal]')) { openJournal().catch((x) => toast(x.message)); return; }
  const oje = t.closest('[data-open-jentry]'); if (oje) { openJournalEntry(oje.dataset.openJentry).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-journal-start]')) { startJournalEntry(); return; }
  const jnew = t.closest('[data-journal-new]'); if (jnew) { newJournalEntry(jnew.dataset.journalNew, jnew.dataset.journalPrompt); return; }
  if (t.closest('[data-journal-pick-cancel]')) { if (state.journal) state.journal.picking = false; renderJournalList(); return; }
  if (t.closest('[data-journal-deeper]')) { journalDeepen(); return; }
  if (t.closest('[data-del-journal]')) { delJournalEntry(); return; }
  if (t.closest('[data-open-readwatch]')) { openReadwatch().catch((x) => toast(x.message)); return; }
  const rwf = t.closest('[data-rw-filter]'); if (rwf) { if (state.rw) { state.rw.filter = rwf.dataset.rwFilter; renderReadwatch(); } return; }
  const rwd = t.closest('[data-rw-done]'); if (rwd) { const b = (state.rw.items || []).find((x) => x.id === rwd.dataset.rwDone); rwSetDone(rwd.dataset.rwDone, !(b && b.props && b.props.status === 'done')); return; }
  const rwx = t.closest('[data-rw-del]'); if (rwx) { rwDelete(rwx.dataset.rwDel); return; }
  if (t.closest('[data-rw-setup]')) { rwToggleSetup(); return; }
  if (t.closest('[data-rw-bm]')) { e.preventDefault(); toast('Drag this button up to your bookmarks bar to install it'); return; }
  if (t.closest('[data-open-areas]')) { openAreasList(); return; }
  const oa = t.closest('[data-open-area]'); if (oa) { openArea(oa.dataset.openArea).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-view-tasks]')) { openTasks().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-calendar]')) { openCalendar().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-today]')) { openToday(); return; }
  if (t.closest('[data-open-mail]')) { openMail().catch((x) => toast(x.message)); return; }
  // attachments (delete wins over open since the × sits inside the tile)
  const cdel = t.closest('[data-card-del]'); if (cdel) { e.preventDefault(); e.stopPropagation(); removeCardEl(cdel); return; }
  const lcard = t.closest('.link-card[data-linkcard]'); if (lcard && lcard.closest('.prose')) { e.preventDefault(); window.open(lcard.dataset.linkcard, '_blank', 'noopener'); return; }
  const adel = t.closest('[data-att-del]'); if (adel) { e.preventDefault(); e.stopPropagation(); const z = adel.closest('[data-att-zone]'); deleteAttachment(z.dataset.attZone, adel.dataset.attDel); return; }
  const aop = t.closest('[data-att-open]'); if (aop) { const z = aop.closest('[data-att-zone]'); openAttachment(z.dataset.attZone, aop.dataset.attOpen); return; }
  const tad = t.closest('[data-tatt-del]'); if (tad) { e.preventDefault(); e.stopPropagation(); const [rid, cid, aid] = tad.dataset.tattDel.split(':'); delCellAttachment(rid, cid, aid); return; }
  const tao = t.closest('[data-tatt-open]'); if (tao) { const [rid, aid] = tao.dataset.tattOpen.split(':'); openTableAttachment(rid, aid, tao.dataset.tattName, tao.dataset.tattType); return; }
  // mail interactions
  const macc = t.closest('[data-mail-acct]'); if (macc) { state.mail.account = macc.dataset.mailAcct; state.mail.limit = 40; loadMessages(); return; }
  const mfld = t.closest('[data-mail-folder]'); if (mfld) { setMailFolder(mfld.dataset.mailFolder); return; }
  if (t.closest('[data-mail-empty]')) { mailEmptyFolder(); return; }
  if (t.closest('[data-mail-refresh]')) { loadMessages(); return; }
  if (t.closest('[data-mail-more]')) { state.mail.limit = (state.mail.limit || 40) + 60; loadMessages(); return; }
  if (t.closest('[data-mail-thread-toggle]')) { state.mail.threaded = !state.mail.threaded; try { localStorage.setItem('life.mail.threaded', state.mail.threaded ? '1' : '0'); } catch {} renderMail(); return; }
  const mth = t.closest('[data-mail-thread]'); if (mth) { const k = mth.dataset.mailThread; state.mail.expanded = state.mail.expanded || {}; state.mail.expanded[k] = !state.mail.expanded[k]; renderMail(); return; }
  if (t.closest('[data-mail-shortcuts]')) { state.mail.shortcuts = !state.mail.shortcuts; renderMail(); return; }
  if (t.closest('[data-mail-sc-close]')) { state.mail.shortcuts = false; renderMail(); return; }
  const mjoin = t.closest('[data-mail-join]'); if (mjoin) { window.open(mjoin.dataset.mailJoin, '_blank', 'noopener'); return; }
  if (t.closest('[data-mail-invite-add]')) { mailInviteAdd(); return; }
  const mchk = t.closest('[data-mail-check]'); if (mchk) { e.preventDefault(); e.stopPropagation(); mailToggleSelect(mchk.dataset.mailCheck); return; }   // select box sits inside the row button
  const mbulk = t.closest('[data-mail-bulk]'); if (mbulk) { mailBulk(mbulk.dataset.mailBulk); return; }
  const mmto = t.closest('[data-mail-move-to]'); if (mmto) { const mm = state.mail.moveMenu; if (mm) mailMoveTargets(mm.keys, mmto.dataset.mailMoveTo); return; }
  const mmone = t.closest('[data-mail-move-one]'); if (mmone) { openMoveMenu([mmone.dataset.mailMoveOne], mmone); return; }
  if (t.closest('[data-mail-move-close]') && !t.closest('.mail-move')) { state.mail.moveMenu = null; renderMail(); return; }
  const mstar = t.closest('[data-mail-star]'); if (mstar) { e.preventDefault(); e.stopPropagation(); mailStar(mstar.dataset.mailStar); return; }   // star sits inside the row button
  const march = t.closest('[data-mail-archive]'); if (march) { mailMoveTo(march.dataset.mailArchive, 'Archive', 'Archived'); return; }
  const mspam = t.closest('[data-mail-spam]'); if (mspam) { mailMoveTo(mspam.dataset.mailSpam, 'Junk', 'Marked as spam'); return; }
  const mblk = t.closest('[data-mail-block]'); if (mblk) { mailBlock(mblk.dataset.mailBlock, mblk.dataset.mailFrom || ''); return; }
  const munblk = t.closest('[data-mail-unblock]'); if (munblk) { mailUnblock(munblk.dataset.mailUnblock, munblk.dataset.mailUnblockAcct); return; }
  const mo = t.closest('[data-mail-open]'); if (mo) { if (state.mail.selected && state.mail.selected.size) mailToggleSelect(mo.dataset.mailOpen); else openMessage(mo.dataset.mailOpen); return; }
  if (t.closest('[data-mail-back]')) { state.mail.open = null; renderMail(); return; }
  if (t.closest('[data-mail-compose]')) { startCompose(); return; }
  if (t.closest('[data-mail-cancel]')) { saveDraft(); state.mail.composing = false; renderMail(); return; }
  if (t.closest('[data-mail-attach]')) { const f = $('#mc-file'); if (f) f.click(); return; }
  const madel = t.closest('[data-mail-att-del]'); if (madel) { mailRemoveAttachment(madel.dataset.mailAttDel); return; }
  if (t.closest('[data-mail-discard]')) { clearDraft(); (state.mail.composing && state.mail.composing.attachments || []).forEach((a) => mailApi(`/attach/${a.id}?account=${encodeURIComponent(composeAcctId())}`, { method: 'DELETE' }).catch(() => {})); state.mail.composing = false; renderMail(); toast('Draft discarded'); return; }
  if (t.closest('[data-mail-claudius]')) { mailClaudius(); return; }
  if (t.closest('[data-mail-reply]')) { mailReplyStart(false); return; }
  if (t.closest('[data-mail-reply-all]')) { mailReplyStart(true); return; }
  if (t.closest('[data-mail-forward]')) { mailForwardStart(); return; }
  const msa = t.closest('[data-mail-save-att]'); if (msa) { mailSaveAttachment(+msa.dataset.mailSaveAtt, msa.dataset.attName); return; }
  // Rich-text compose toolbar: execCommand on the contenteditable body.
  const rt = t.closest('[data-rt]'); if (rt) {
    const cmd = rt.dataset.rt; const ed = document.getElementById('mc-body'); if (!ed) return;
    ed.focus();
    if (cmd === 'link') {
      const sel = window.getSelection(); const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      uiPrompt('Link to (URL):', { title: 'Add link', okLabel: 'Add link', placeholder: 'https://…' }).then((url) => {
        if (!url || !url.trim()) return;
        ed.focus(); if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
        document.execCommand('createLink', false, url.trim());
        if (state.mail.composing) state.mail.composing.body = ed.innerHTML; saveDraft();
      });
      return;
    }
    document.execCommand(cmd, false, null);
    if (state.mail.composing) state.mail.composing.body = ed.innerHTML; saveDraft();
    return;
  }
  if (t.closest('[data-mail-show-imgs]')) { if (state.mail.open) { state.mail.showImgKey = state.mail.open._key; renderMail(); } return; }
  const mtr = t.closest('[data-mail-trust]'); if (mtr) { trustSender(mtr.dataset.mailTrust); return; }
  const mdl = t.closest('[data-mail-del]'); if (mdl) { mailDelete(mdl.dataset.mailDel); return; }
  if (t.closest('[data-mail-accounts]')) { openMailAccounts().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-mail-add-acct]')) { showMailAccountForm(); return; }
  const mpre = t.closest('[data-mail-preset]'); if (mpre) { applyMailPreset(mpre.dataset.mailPreset); return; }
  const mda = t.closest('[data-mail-del-acct]'); if (mda) { delMailAccount(mda.dataset.mailDelAcct); return; }
  if (t.closest('[data-sig-close-all]')) { document.querySelectorAll('[data-sig-panel]').forEach((p) => { p.hidden = true; }); refreshAcctCrumb(); return; }
  const aet = t.closest('[data-acct-edit-toggle]'); if (aet) { const p = document.querySelector(`[data-acct-edit="${aet.dataset.acctEditToggle}"]`); if (p) { p.hidden = !p.hidden; if (!p.hidden) { const f = p.querySelector('.ae-email'); if (f) f.focus(); } } return; }
  const aec = t.closest('[data-acct-edit-cancel]'); if (aec) { const p = document.querySelector(`[data-acct-edit="${aec.dataset.acctEditCancel}"]`); if (p) p.hidden = true; return; }
  const sigt = t.closest('[data-sig-toggle]'); if (sigt) { const p = document.querySelector(`[data-sig-panel="${sigt.dataset.sigToggle}"]`); if (p) p.hidden = !p.hidden; refreshAcctCrumb(); return; }
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
  if (t.closest('[data-area-add-task]')) { areaAddTask(); return; }
  if (t.closest('[data-area-add-note]')) { areaAddNote(); return; }
  if (t.closest('[data-new-sub]')) { newNote(state.note.current.id).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-note]')) { delNote(); return; }
  if (t.closest('[data-note-to-table]')) { noteToTable(); return; }

  // tasks
  const sh = t.closest('[data-sort]');
  if (sh) { const c = sh.dataset.sort; if (state.taskSort.col === c) state.taskSort.dir = state.taskSort.dir === 'asc' ? 'desc' : 'asc'; else state.taskSort = { col: c, dir: c === 'created' ? 'desc' : 'asc' }; try { localStorage.setItem('life.taskSort', JSON.stringify(state.taskSort)); } catch {} rerenderCurrent(); return; }
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
    const cms = t.closest('[data-cm-sort]'); if (cms) { state.tables_view.colMenu = null; setSorts([{ colId: cmId, dir: cms.dataset.cmSort }]); return; }
    if (t.closest('[data-cm-hide]')) { state.tables_view.colMenu = null; if (visibleCols().length <= 1) { toast('Keep at least one column visible'); renderTable(); return; } saveTableHidden([...hiddenCols(), cmId]); return; }
    const cShow = t.closest('[data-cm-show]'); if (cShow) { state.tables_view.colMenu = null; saveTableHidden(hiddenCols().filter((x) => x !== cShow.dataset.cmShow)); return; }
    if (t.closest('[data-cm-del]')) { state.tables_view.colMenu = null; uiConfirm('Delete this column?', { title: 'Delete column', okLabel: 'Delete', danger: true }).then((ok) => { if (ok) saveTableColumns(tcols().filter((c) => c.id !== cmId)).then(renderTable); else renderTable(); }); return; }
    if (!t.closest('[data-colmenu]')) { state.tables_view.colMenu = null; renderTable(); } // click outside closes; fall through
  }
  // table search + filters
  if (t.closest('[data-tbl-filter]')) { state.tables_view.filtering = !state.tables_view.filtering; renderTable(); return; }
  if (t.closest('[data-filt-add]')) { const col = tcols()[0]; if (col) { state.tables_view.filters = [...(state.tables_view.filters || []), { colId: col.id, op: opsFor(col.type)[0][0], value: '' }]; renderTable(); } return; }
  const fdel = t.closest('[data-filt-del]'); if (fdel) { state.tables_view.filters.splice(+fdel.dataset.filtDel, 1); renderTable(); return; }
  if (t.closest('[data-filt-clear]')) { state.tables_view.filters = []; renderTable(); return; }
  if (t.closest('[data-tbl-sort]')) { state.tables_view.sorting = !state.tables_view.sorting; renderTable(); return; }
  if (t.closest('[data-sortl-add]')) { const used = new Set((state.tables_view.sorts || []).map((s) => s.colId)); const col = tcols().find((x) => !used.has(x.id)) || tcols()[0]; if (col) setSorts([...(state.tables_view.sorts || []), { colId: col.id, dir: 'asc' }]); return; }
  const sldel = t.closest('[data-sortl-del]'); if (sldel) { const n = (state.tables_view.sorts || []).slice(); n.splice(+sldel.dataset.sortlDel, 1); setSorts(n); return; }
  if (t.closest('[data-sortl-clear]')) { setSorts([]); return; }
  // table
  if (t.closest('[data-back-table]')) { state.tables_view.openRow = null; renderTable(); return; }
  const or = t.closest('[data-open-row]'); if (or) { state.tables_view.openRow = or.dataset.openRow; renderTable(); window.scrollTo(0, 0); return; }
  const ec = t.closest('[data-edit-col]'); if (ec) { editColName(ec.dataset.editCol); return; }
  const sc = t.closest('[data-sort-col]');
  if (sc) { const id = sc.dataset.sortCol; const s = state.tables_view.sorts || []; const only = s.length === 1 && s[0].colId === id ? s[0] : null; setSorts([{ colId: id, dir: only && only.dir === 'asc' ? 'desc' : 'asc' }]); return; }
  if (t.closest('[data-add-col]')) { state.tables_view.addingCol = true; renderTable(); return; }
  const dcol = t.closest('[data-del-col]'); if (dcol) { const dcId = dcol.dataset.delCol; uiConfirm('Delete this column?', { title: 'Delete column', okLabel: 'Delete', danger: true }).then((ok) => { if (ok) saveTableColumns(tcols().filter((c) => c.id !== dcId)).then(renderTable).catch((x) => toast(x.message)); }); return; }
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
  if (e.target.id === 'mc-file' && e.target.files && e.target.files.length) { mailAttachFiles([...e.target.files]); e.target.value = ''; return; }
  const c = e.target.closest('[data-cell]'); if (c) { const [rid, cid] = c.dataset.cell.split(':'); setCell(rid, cid, e.target.type === 'checkbox' ? e.target.checked : e.target.value); }
  if (e.target.matches('[data-note-area]')) setBlockArea('note', state.note.current.id, e.target.value);
  if (e.target.matches('[data-table-area]')) setBlockArea('table', state.tables_open.id, e.target.value);
  if (e.target.matches('[data-task-filter]')) { state.taskFilter = e.target.value || null; renderTasks(); }
  if (e.target.matches('[data-prio-task]')) patchTaskProps(e.target.dataset.prioTask, { priority: e.target.value || null });
  if (e.target.matches('[data-area-task]')) patchTaskProps(e.target.dataset.areaTask, { area: e.target.value || null });
  const fi = e.target.closest('[data-att-input]'); if (fi && fi.files && fi.files.length) { uploadFiles(fi.dataset.attInput, fi.files); fi.value = ''; }
  const tfi = e.target.closest('[data-tatt-input]'); if (tfi && tfi.files && tfi.files.length) { uploadCellFiles(tfi.dataset.tattInput, tfi.files); tfi.value = ''; }
  if (e.target.classList && e.target.classList.contains('note-title')) autoGrow(e.target);
  if (e.target.id === 'ce-allday') { const r = $('#ce-timerow'); if (r) r.hidden = e.target.checked; }
  // Table filters
  const scol = e.target.closest('[data-sortl-col]'); if (scol) { const i = +scol.dataset.sortlCol; if (state.tables_view.sorts[i]) { state.tables_view.sorts[i].colId = scol.value; setSorts(state.tables_view.sorts); } return; }
  const sdir = e.target.closest('[data-sortl-dir]'); if (sdir) { const i = +sdir.dataset.sortlDir; if (state.tables_view.sorts[i]) { state.tables_view.sorts[i].dir = sdir.value; setSorts(state.tables_view.sorts); } return; }
  const fcol = e.target.closest('[data-filt-col]'); if (fcol) { const i = +fcol.dataset.filtCol, f = state.tables_view.filters[i]; f.colId = fcol.value; const col = tcols().find((x) => x.id === f.colId); f.op = opsFor(col && col.type)[0][0]; f.value = ''; renderTable(); return; }
  const fop = e.target.closest('[data-filt-op]'); if (fop) { const i = +fop.dataset.filtOp; state.tables_view.filters[i].op = fop.value; renderTable(); return; }
  const fvs = e.target.closest('select[data-filt-val]'); if (fvs) { const i = +fvs.dataset.filtVal; if (state.tables_view.filters[i]) { state.tables_view.filters[i].value = fvs.value; renderTableBody(); } return; }
});
// blur saves for titles/bodies
document.addEventListener('blur', (e) => {
  if (e.target.id === 'note-title') saveNoteTitle(e.target.value.trim());
  if (e.target.id === 'taskcard-title') patchTaskTitle(state.task_open.task.id, e.target.value.trim());
  if (e.target.dataset && e.target.dataset.prose) saveProse(e.target.dataset.prose, e.target.innerHTML);
  if (e.target.dataset && e.target.dataset.rename !== undefined) renameTable(e.target.value.trim());
  if (e.target.id === 'area-title') renameArea(e.target.value.trim());
  const cn = e.target.dataset && e.target.dataset.colname; if (cn !== undefined && cn) renameColumn(cn, e.target.value.trim());
}, true);
document.addEventListener('keydown', (e) => {
  if ((e.target.id === 'note-title' || e.target.id === 'taskcard-title' || e.target.id === 'area-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'task-form') { const v = $('#task-title').value.trim(); if (v) addTask(v, $('#task-area').value, $('#task-prio').value); }
  if (e.target.id === 'qt-form') { const i = $('#qt-title'); const v = i.value.trim(); if (v) { homeAddTask(v, $('#qt-area').value, $('#qt-prio').value); i.value = ''; i.focus(); } }
  if (e.target.id === 'qe-form') { const v = $('#qe-title').value.trim(); if (v) homeAddEvent(v, $('#qe-date').value, $('#qe-time').value, $('#qe-dur').value, $('#qe-loc').value.trim()); }
  if (e.target.id === 'cal-ev-form') { const v = $('#ce-title').value.trim(); const rp = $('#ce-repeat'); const dt = $('#ce-date'); if (v) calSaveEvent(e.target.dataset.ev || null, v, dt ? dt.value : '', $('#ce-time').value, $('#ce-dur').value, $('#ce-loc').value.trim(), $('#ce-allday').checked, rp ? rp.value : 'none'); }
  if (e.target.id === 'mail-acct-form-el') { addMailAccount({ email: $('#ma-email').value.trim(), imapHost: $('#ma-imaphost').value.trim(), imapPort: $('#ma-imapport').value.trim(), smtpHost: $('#ma-smtphost').value.trim(), smtpPort: $('#ma-smtpport').value.trim(), username: $('#ma-user').value.trim(), pass: $('#ma-pass').value }); }
  if (e.target.dataset && e.target.dataset.acctEditForm) {
    const f = e.target, g = (c) => (f.querySelector(c) || {}).value || '';
    saveMailAccount(f.dataset.acctEditForm, { email: g('.ae-email').trim(), imapHost: g('.ae-imaphost').trim(), imapPort: g('.ae-imapport').trim(), smtpHost: g('.ae-smtphost').trim(), smtpPort: g('.ae-smtpport').trim(), username: g('.ae-user').trim(), pass: g('.ae-pass') });
  }
  if (e.target.id === 'mail-compose-form') { const to = $('#mc-to').value.trim(); if (to) { const be = $('#mc-body'); mailSend(to, $('#mc-cc').value.trim(), $('#mc-bcc').value.trim(), $('#mc-subject').value.trim(), be ? be.innerHTML : '', state.mail.composing && state.mail.composing.inReplyTo); } }
  if (e.target.id === 'colnew') { const name = $('#cn-name').value.trim(); const type = $('#cn-type').value; addColumn(name, type); }
  if (e.target.id === 'rw-add-form') { const i = $('#rw-url'); if (i && i.value.trim()) rwSave(i.value); }
  if (e.target.matches('[data-cm-addopt]')) { const i = $('#cm-opt-input'); if (i && state.tables_view && state.tables_view.colMenu) addColOption(state.tables_view.colMenu.colId, i.value); }
});
// drag to reorder favourites on the home, and to reorder the sidebar sections.
// A dragged item dims; the item it would land next to shows an accent insertion
// line (above or below, following the pointer) so the drop target is obvious.
let dragFav = null, dragSec = null, dragSub = null;
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
  const sub = e.target.closest('[data-sub-id]'); if (sub) { dragSub = sub.dataset.subId; sub.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const s = e.target.closest('.nav-sec-h'); if (s) { const sec = s.closest('[data-nav-sec]'); dragSec = sec.dataset.navSec; sec.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
});
document.addEventListener('dragover', (e) => {
  if (dragFav && e.target.closest('#favs')) { e.preventDefault(); const o = e.target.closest('[data-fav-id]'); markDrop(o && o.dataset.favId !== dragFav ? o : null, e, 'v'); return; }
  if (dragSec && e.target.closest('#nav-secs')) { e.preventDefault(); const o = e.target.closest('[data-nav-sec]'); markDrop(o && o.dataset.navSec !== dragSec ? o : null, e, 'v'); return; }
  if (dragSub && e.target.closest('[data-subpages]')) { e.preventDefault(); const o = e.target.closest('[data-sub-id]'); markDrop(o && o.dataset.subId !== dragSub ? o : null, e, 'v'); return; }
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
    const before = over && over.dataset.favId !== dragFav ? dropBefore(over, state.favs.map((x) => x.id), (el) => el.dataset.favId) : null;
    clearDropMarks(); reorderFavs(dragFav, before); dragFav = null; return;
  }
  if (dragSec) {
    e.preventDefault(); const over = e.target.closest('[data-nav-sec]');
    const before = over && over.dataset.navSec !== dragSec ? dropBefore(over, state.nav.order, (el) => el.dataset.navSec) : null;
    clearDropMarks(); reorderSecs(dragSec, before); dragSec = null; return;
  }
  if (dragSub) {
    e.preventDefault(); const over = e.target.closest('[data-sub-id]');
    const ids = (state.note && state.note.children || []).map((k) => k.id);
    const before = over && over.dataset.subId !== dragSub ? dropBefore(over, ids, (el) => el.dataset.subId) : null;
    clearDropMarks(); reorderSubs(dragSub, before); dragSub = null;
  }
});
document.addEventListener('dragend', () => { clearDropMarks(); document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging')); dragFav = null; dragSec = null; dragSub = null; });

// ── mail: swipe a row (mobile) — left = Archive, right = Trash ──
let mailSwipe = null;
const SWIPE_GO = 72;
document.addEventListener('touchstart', (e) => {
  if (state.view.type !== 'mail' || !state.mail || state.mail.open || state.mail.composing || (state.mail.selected && state.mail.selected.size)) return;
  const row = e.target.closest && e.target.closest('.mail-row[data-mail-open]');
  if (!row || row.classList.contains('mail-thread')) return;
  const t = e.touches[0];
  mailSwipe = { row, x: t.clientX, y: t.clientY, key: row.dataset.mailOpen, dx: 0, active: false };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!mailSwipe) return;
  const t = e.touches[0]; const dx = t.clientX - mailSwipe.x, dy = t.clientY - mailSwipe.y;
  if (!mailSwipe.active) { if (Math.abs(dx) < 10) return; if (Math.abs(dy) > Math.abs(dx)) { mailSwipe = null; return; } mailSwipe.active = true; mailSwipe.row.style.transition = 'none'; }
  mailSwipe.dx = dx; mailSwipe.row.style.transform = `translateX(${dx}px)`;
  mailSwipe.row.dataset.swipe = dx <= -SWIPE_GO ? 'archive' : dx >= SWIPE_GO ? 'delete' : '';
  e.preventDefault();
}, { passive: false });
function endMailSwipe() {
  if (!mailSwipe) return; const s = mailSwipe; mailSwipe = null;
  if (!s.active) return;
  s.row.style.transition = 'transform .2s ease';
  if (s.dx <= -SWIPE_GO) { s.row.style.transform = 'translateX(-100%)'; setTimeout(() => mailMoveTo(s.key, 'Archive', 'Archived'), 170); }
  else if (s.dx >= SWIPE_GO) { s.row.style.transform = 'translateX(100%)'; setTimeout(() => mailMoveTo(s.key, 'Trash', 'Moved to Trash'), 170); }
  else { s.row.style.transform = ''; s.row.removeAttribute('data-swipe'); }
}
document.addEventListener('touchend', endMailSwipe);
document.addEventListener('touchcancel', endMailSwipe);

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
  const t = state.task_open.task; migrateCards(t); const a = areaById(t.props.area); const p = t.props.priority;
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-view-tasks>Tasks</button><span class="crumb-sep">›</span><span class="crumb cur">${esc(t.title || 'Untitled')}</span>
      <span class="crumb-tools">${areaLinkHtml(t.props.area)}<button class="star ${t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props.fav ? '★' : '☆'}</button>
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
  autoGrowSoon($('#taskcard-title')); loadThumbs(); hydrateEmbeds();
}

// A prose Notes section, reused by the task card and the row card. Backed by
// the block's `body`, edited inline via the shared rich-text editor.
function notesSection(body, key) {
  return `<section class="focus-notes"><div class="fn-h">Notes</div>${proseEditor(body, key)}${embedsHtml(body)}</section>`;
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
// Remove an inline link card: drop its node and save the surrounding prose.
function removeCardEl(btn) {
  const card = btn.closest('.link-card'); if (!card) return;
  const prose = card.closest('.prose'); if (!prose) { card.remove(); return; }
  card.remove();
  if (prose.dataset.prose) saveProse(prose.dataset.prose, prose.innerHTML);
}
// Notes edited under the brief "cards live in props.cards" model kept their URLs
// out of the body; fold those back in as text so they re-inflate inline.
function migrateCards(b) {
  if (!b || !b.props || !Array.isArray(b.props.cards) || !b.props.cards.length) return;
  const add = b.props.cards.map((u) => `<p><a href="${esc(u)}">${esc(u)}</a></p>`).join('');
  b.body = (b.body || '') + add;
  delete b.props.cards;
  api(`/api/blocks/${b.id}`, { method: 'PATCH', body: JSON.stringify({ body: b.body, props: { cards: null } }) }).catch(() => {});
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
// Table-cell attachments: bytes stored in R2 under the row block, metadata in the
// cell's value list (props.values[colId]) via the ?col= param.
async function uploadCellFiles(key, files) {
  const [rowId, colId] = key.split(':');
  const row = state.tables_rows.find((r) => r.id === rowId); if (!row) return;
  row.props = row.props || {}; row.props.values = row.props.values || {};
  let ok = 0;
  for (const f of Array.from(files)) {
    try {
      const res = await fetch(`/api/blocks/${rowId}/attachments?col=${encodeURIComponent(colId)}&name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || 'application/octet-stream')}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: f });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
      const att = await res.json();
      row.props.values[colId] = [...(Array.isArray(row.props.values[colId]) ? row.props.values[colId] : []), att];
      ok++;
    } catch (e) { toast('Upload failed: ' + e.message); }
  }
  if (ok) renderTable();
}
async function openTableAttachment(rowId, attId, name, type) {
  try {
    const url = await attUrl(rowId, { id: attId });
    const a = document.createElement('a'); a.href = url;
    if (isImgType(type) || type === 'application/pdf') { a.target = '_blank'; a.rel = 'noopener'; } else a.download = name || 'file';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast(e.message); }
}
async function delCellAttachment(rowId, colId, attId) {
  const row = state.tables_rows.find((r) => r.id === rowId); if (!row) return;
  try { await api(`/api/attachments/${rowId}/${attId}?col=${encodeURIComponent(colId)}`, { method: 'DELETE' }); } catch (e) { toast(e.message); return; }
  if (row.props && row.props.values && Array.isArray(row.props.values[colId])) row.props.values[colId] = row.props.values[colId].filter((a) => a.id !== attId);
  renderTable();
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
  let html = linkifyHtml(sanitizeProse(rawHtml));
  const obj = key === 'note' ? (state.note && state.note.current)
    : key === 'task' ? (state.task_open && state.task_open.task)
    : key === 'row' ? (state.tables_rows && state.tables_rows.find((x) => x.id === (state.tables_view && state.tables_view.openRow)))
    : key === 'journal' ? (state.journal && state.journal.current) : null;
  if (!obj) return;
  const prev = obj.body || '';
  obj.body = html;
  const id = obj.id;
  const el = document.querySelector(`.prose[data-prose="${key}"]`);
  const focused = el && document.activeElement === el;
  // Once blurred, reflect the cleaned HTML back in - with standalone URLs turned
  // into inline cards, where they sit. Never while focused: it would move the
  // caret and eat what's being typed.
  if (el && !focused) {
    const display = decorateProse(html);
    if (el.innerHTML !== display) { el.innerHTML = display; hydrateEmbeds(); }
  }
  // YouTube players live in the strip below; refresh it if that set changed.
  const ytChanged = youtubeIds(html).join() !== youtubeIds(prev).join();
  if (ytChanged && !focused) rerenderHost();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ body: html }) }); } catch (e) { toast(e.message); }
}
async function delTaskCard() {
  const t = state.task_open.task; if (!(await uiConfirm(`Delete “${t.title || 'Untitled'}”?`, { title: 'Delete task', okLabel: 'Delete', danger: true }))) return;
  await delTask(t.id); await openTasks();
}
async function saveNoteTitle(v) {
  const n = state.note.current; if (!n || v === n.title) return; n.title = v;
  const top = state.noteTops.find((t) => t.id === n.id); if (top) top.title = v;
  const cr = $('.note-crumbs .crumb.cur'); if (cr) cr.textContent = v || 'Untitled';
  try { await api(`/api/blocks/${n.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); }
}
async function delNote() {
  const n = state.note.current; if (!(await uiConfirm(`Delete “${n.title || 'Untitled'}”?`, { title: 'Delete note', okLabel: 'Delete', danger: true }))) return;
  const parent = state.note.path.length > 1 ? state.note.path[state.note.path.length - 2].id : null;
  try { await api(`/api/blocks/${n.id}`, { method: 'DELETE' }); state.noteTops = state.noteTops.filter((t) => t.id !== n.id); if (parent) await openNote(parent); else await openNotesList(); } catch (e) { toast(e.message); }
}
// Turn a note into a table: each block (bullet/paragraph/heading) becomes a row.
// If every line splits cleanly on a delimiter (| , tab, " - ", ": ", ","), those
// become columns with the first line as headers; otherwise a single "Name" column.
// Non-destructive: the note is kept so nothing is lost.
async function noteToTable() {
  const n = state.note.current; if (!n) return;
  // One line per bullet/paragraph/heading: turn <br> and block ends into
  // newlines, strip tags + leading markdown, decode entities. Works for both
  // markdown-stored and HTML-stored bodies.
  const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
  const lines = String(n.body || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|blockquote|div|summary)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n').map((s) => dec(s).replace(/^[#>*\-\s]+/, '').trim()).filter(Boolean);
  if (!lines.length) { toast('This note has no content to tabulate.'); return; }
  let best = null;
  for (const d of [' | ', '\t', ' — ', ' - ', ': ', ',']) {
    const counts = lines.map((l) => l.split(d).length);
    if (counts[0] >= 2 && counts.every((c) => c === counts[0])) { best = d; break; }
  }
  let columns, rows;
  if (best) {
    columns = lines[0].split(best).map((name, i) => ({ id: uid(), name: name.trim() || `Column ${i + 1}`, type: 'text' }));
    rows = lines.slice(1).map((l) => { const parts = l.split(best); const v = {}; columns.forEach((c, i) => (v[c.id] = (parts[i] || '').trim())); return v; });
    if (!rows.length) rows = [(() => { const v = {}; columns.forEach((c) => (v[c.id] = c.name)); return v; })()];
  } else {
    columns = [{ id: uid(), name: 'Name', type: 'text' }];
    rows = lines.map((l) => ({ [columns[0].id]: l }));
  }
  if (!(await uiConfirm(`Create a ${columns.length}-column table with ${rows.length} row${rows.length === 1 ? '' : 's'} from this note? (The note is kept.)`, { title: 'Note → table', okLabel: 'Create table' }))) return;
  try {
    const table = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'table', title: n.title || 'Untitled', props: { columns, area: (n.props && n.props.area) || null } }) });
    for (const values of rows) await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'row', parent_id: table.id, props: { values } }) });
    state.tables = state.tables || []; state.tables.push(table);
    toast(`Table created (${rows.length} rows)`); await openTable(table.id);
  } catch (e) { toast(e.message); }
}
async function addRow() {
  const r = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'row', parent_id: state.tables_open.id, props: { values: {} } }) });
  state.tables_rows.unshift(r);
  state.tables_view.newRow = r.id;   // pin to the top until re-sorted or reopened
  // A brand-new blank row matches no search or filter, so it would vanish the
  // instant it's added. Clear them so the row you just asked for is visible.
  state.tables_view.query = ''; state.tables_view.filters = []; state.tables_view.filtering = false;
  renderTable();
}
async function addColumn(name, type) { const col = { id: uid(), name: name || 'Column', type }; state.tables_view.addingCol = false; await saveTableColumns([...tcols(), col]); renderTable(); }
async function renameTable(v) { const t = state.tables_open; if (!t || v === t.title) return; t.title = v; const s = state.tables.find((x) => x.id === t.id); if (s) s.title = v; try { await api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); } }
async function renameArea(v) {
  const a = state.area_open && state.area_open.area; if (!a || !v || v === a.title) return;
  a.title = v; const s = state.areas.find((x) => x.id === a.id); if (s) s.title = v;
  try { await api(`/api/blocks/${a.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); }
}
async function renameColumn(id, v) { const cols = tcols().map((c) => c.id === id ? { ...c, name: v } : c); await saveTableColumns(cols).catch((x) => toast(x.message)); }
async function setColType(id, type) {
  let seed = {};
  if (type === 'select') {
    const existing = tcols().find((c) => c.id === id);
    if (existing && (!existing.options || !existing.options.length)) {
      // Seed options from the column's existing distinct values so converting a
      // free-form column to Select doesn't blank out the data already there.
      // Wrapped: a legacy/blank row (null props) must never block the change.
      try {
        seed = { options: [...new Set((state.tables_rows || []).map((r) => ((r && r.props && r.props.values) || {})[id]).filter((x) => x != null && x !== '').map(String))] };
      } catch { seed = { options: [] }; }
    }
  }
  const cols = tcols().map((c) => c.id === id ? { ...c, type, ...seed } : c);
  try { await saveTableColumns(cols); } catch (e) { toast(`Couldn't change column type: ${e.message}`); }
  renderTable();
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
    <button class="cm-item" data-cm-hide>Hide column</button>
    ${(() => { const h = hiddenCols(); if (!h.length) return ''; const names = h.map((id) => tcols().find((c) => c.id === id)).filter(Boolean); if (!names.length) return ''; return `<div class="cm-sep"></div><div class="cm-label">Hidden</div>${names.map((c) => `<button class="cm-item cm-show" data-cm-show="${c.id}">Show “${esc(c.name)}”</button>`).join('')}`; })()}
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
async function delTable() { const t = state.tables_open; if (!(await uiConfirm(`Delete the table “${t.title}” and its rows?`, { title: 'Delete table', okLabel: 'Delete', danger: true }))) return; for (const r of state.tables_rows) await api(`/api/blocks/${r.id}`, { method: 'DELETE' }); await api(`/api/blocks/${t.id}`, { method: 'DELETE' }); state.tables = state.tables.filter((x) => x.id !== t.id); state.tables_open = null; await openTablesList(); }

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
    <button data-fmt="collapse" title="Collapsible section">&#9662;</button>
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
// execCommand('insertUnorderedList') on a paragraph can leave the <ul> nested
// inside the <p> (invalid), which then makes Enter and rendering behave oddly -
// the source of the "bulleting bolds things" weirdness. Lift lists to the top
// level and drop the emptied paragraphs.
function normalizeProseLists(prose) {
  prose.querySelectorAll('p > ul, p > ol').forEach((list) => {
    const p = list.parentElement;
    p.parentNode.insertBefore(list, p);
    if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
  });
  prose.querySelectorAll('ul + ul, ol + ol').forEach((l) => { const prev = l.previousElementSibling; while (l.firstChild) prev.appendChild(l.firstChild); l.remove(); });
}
// Link picker: one dialog that both accepts a URL (type + Enter) and searches
// your notes, tables & areas for an internal link.
async function openLinkPicker(prose, range) {
  state.linkpick = { prose, range, q: '', opts: [], loaded: false };
  renderLinkPicker();
  try {
    const [notes, tables, areas] = await Promise.all([
      api('/api/blocks?kind=note').catch(() => []),
      api('/api/blocks?kind=table').catch(() => []),
      api('/api/blocks?kind=area').catch(() => []),
    ]);
    const map = (arr, kind, icon) => (arr || []).map((b) => ({ id: b.id, kind, icon, title: b.title || 'Untitled' }));
    if (!state.linkpick) return;
    state.linkpick.opts = [...map(notes, 'note', '▤'), ...map(tables, 'table', '▦'), ...map(areas, 'area', '◈')];
    state.linkpick.loaded = true;
    renderLinkPickerList();
  } catch {}
}
function renderLinkPicker() {
  let el = document.getElementById('linkpick-overlay');
  if (!el) { el = document.createElement('div'); el.id = 'linkpick-overlay'; document.body.appendChild(el); }
  el.innerHTML = `<div class="pal-bg" data-linkpick-bg><div class="pal">
    <input id="linkpick-input" placeholder="Paste a URL, or search notes, tables & areas…" value="${esc(state.linkpick.q)}" autocomplete="off" spellcheck="false">
    <div class="pal-hint">Press Enter to link a web URL, or pick a page below to link internally.</div>
    <div class="pal-list" id="linkpick-list"></div></div></div>`;
  renderLinkPickerList();
  const i = $('#linkpick-input'); if (i) i.focus();
}
function renderLinkPickerList() {
  const el = $('#linkpick-list'); if (!el || !state.linkpick) return;
  if (!state.linkpick.loaded) { el.innerHTML = '<div class="pal-empty">Loading your pages…</div>'; return; }
  const q = state.linkpick.q.trim().toLowerCase();
  const opts = state.linkpick.opts.filter((o) => o.title.toLowerCase().includes(q)).slice(0, 40);
  el.innerHTML = opts.map((o) => `<button class="pal-item" data-linkpick-to="${o.kind}:${o.id}"><span class="pal-kind muted">${o.icon}</span><span class="pal-t">${esc(o.title)}</span></button>`).join('') || '<div class="pal-empty">No matching pages.</div>';
}
function insertProseLink(prose, range, href, fallbackText) {
  prose.focus();
  const s = window.getSelection(); s.removeAllRanges(); if (range) s.addRange(range);
  if (!range || range.collapsed) document.execCommand('insertHTML', false, `<a href="${esc(href)}">${esc(fallbackText || href)}</a> `);
  else document.execCommand('createLink', false, href);
  saveProse(prose.dataset.prose, prose.innerHTML);
}
function linkPickUrl() {
  if (!state.linkpick) return;
  let url = state.linkpick.q.trim(); if (!url) return;
  if (!/^https?:\/\//i.test(url) && (/^www\./i.test(url) || /^[\w-]+(\.[\w-]+)+/.test(url))) url = 'https://' + url;
  insertProseLink(state.linkpick.prose, state.linkpick.range, url, url);
  closeLinkPicker();
}
function linkPickPick(val) {
  if (!state.linkpick) return;
  const i = val.indexOf(':'); const kind = val.slice(0, i), id = val.slice(i + 1);
  const opt = state.linkpick.opts.find((o) => o.kind === kind && o.id === id);
  insertProseLink(state.linkpick.prose, state.linkpick.range, `#rl-${kind}-${id}`, opt ? opt.title : 'link');
  closeLinkPicker();
}
function closeLinkPicker() { const el = document.getElementById('linkpick-overlay'); if (el) el.innerHTML = ''; state.linkpick = null; }
function applyFmt(cmd) {
  const prose = activeProse(); if (!prose) return; prose.focus();
  // Emit <b>/<i> tags (sanitised to <strong>/<em>) rather than inline styles.
  try { document.execCommand('styleWithCSS', false, false); } catch {}
  if (cmd === 'bold') document.execCommand('bold');
  else if (cmd === 'italic') document.execCommand('italic');
  else if (cmd === 'h2') document.execCommand('formatBlock', false, currentBlockTag() === 'H2' ? '<p>' : '<h2>');
  else if (cmd === 'quote') document.execCommand('formatBlock', false, currentBlockTag() === 'BLOCKQUOTE' ? '<p>' : '<blockquote>');
  else if (cmd === 'ul') { document.execCommand('insertUnorderedList'); normalizeProseLists(prose); }
  else if (cmd === 'ol') { document.execCommand('insertOrderedList'); normalizeProseLists(prose); }
  else if (cmd === 'link') {
    // The dialog steals focus, so snapshot the selection and restore it before
    // linking, or the link would apply to nothing.
    const sel = window.getSelection(); const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    openLinkPicker(prose, range);
    return;
  }
  else if (cmd === 'collapse') collapseSection(prose);
  positionBubble();
  saveProse(prose.dataset.prose, prose.innerHTML);
}
// Turn the current block into a collapsible <details> section: its text becomes
// the summary; following blocks up to the next heading move inside. Toggling it
// again unwraps back to a heading + loose blocks.
function collapseSection(prose) {
  const sel = window.getSelection(); if (!sel.rangeCount) return;
  let block = sel.getRangeAt(0).startContainer; block = block.nodeType === 1 ? block : block.parentElement;
  block = block && block.closest && block.closest('h1,h2,h3,blockquote,p,li,summary'); if (!block || !prose.contains(block)) return;
  const details = block.closest('details');
  if (details && prose.contains(details)) {
    const summary = details.querySelector('summary');
    const frag = document.createDocumentFragment();
    const h = document.createElement('h3'); h.innerHTML = summary ? summary.innerHTML : 'Section'; frag.appendChild(h);
    [...details.childNodes].forEach((c) => { if (c !== summary) frag.appendChild(c); });
    details.replaceWith(frag);
  } else {
    const d = document.createElement('details'); d.setAttribute('open', '');
    const summary = document.createElement('summary'); summary.innerHTML = block.innerHTML || 'Section'; d.appendChild(summary);
    let next = block.nextElementSibling; block.replaceWith(d);
    const isHead = (el) => el && /^H[1-6]$/.test(el.tagName);
    while (next && !isHead(next)) { const after = next.nextElementSibling; d.appendChild(next); next = after; }
  }
}
// A <summary> toggles its section natively on click; we just persist the new
// open/closed state. `toggle` doesn't bubble, so listen in the capture phase.
document.addEventListener('toggle', (e) => {
  const d = e.target; if (!d || d.tagName !== 'DETAILS') return;
  const prose = d.closest && d.closest('.prose'); if (!prose) return;
  if (d.open) d.setAttribute('open', ''); else d.removeAttribute('open');
  clearTimeout(window.__detToggleT); window.__detToggleT = setTimeout(() => saveProse(prose.dataset.prose, prose.innerHTML), 300);
}, true);
document.addEventListener('selectionchange', positionBubble);
document.addEventListener('mousedown', (e) => {
  const fb = e.target.closest && e.target.closest('#bubble [data-fmt]');
  if (fb) { e.preventDefault(); applyFmt(fb.dataset.fmt); }
});
// A new line should start clean: after Enter, drop any inherited bold/italic and
// turn a continued heading or quote back into a normal paragraph, so formatting
// applied to one line doesn't bleed onto the next. Lists keep their own Enter
// behaviour (new item; empty item exits the list), so leave those alone.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey) return;
  const prose = e.target.closest && e.target.closest('.prose'); if (!prose) return;
  const sel = window.getSelection();
  let inList = false;
  for (let n = sel && sel.anchorNode; n && n !== prose; n = n.parentNode) {
    if (n.nodeType === 1 && (n.tagName === 'LI' || n.tagName === 'UL' || n.tagName === 'OL')) { inList = true; break; }
  }
  // Let the browser insert the break first, then normalise the fresh line.
  setTimeout(() => {
    try { if (document.queryCommandState('bold')) document.execCommand('bold'); } catch {}
    try { if (document.queryCommandState('italic')) document.execCommand('italic'); } catch {}
    if (!inList) { const tag = currentBlockTag(); if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'BLOCKQUOTE') document.execCommand('formatBlock', false, '<p>'); }
    saveProse(prose.dataset.prose, prose.innerHTML);
  }, 0);
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
    else if (route === '/journal') await openJournal();
    else if (route === '/saved' || route === '/read') await openReadwatch();
    else await Promise.resolve(openView(state.tabs.find((t) => t.id === state.activeTab).view)).catch(() => openHome());
  } catch (e) { toast(e.message); renderNav(); }
})();
