// Robski Life — one surface. Sidebar + a single pane that renders any block,
// and a ⌘K palette to jump anywhere. No page reloads.

const $ = (s, r = document) => r.querySelector(s);
const KEY = 'today.token';
// The wordmark: <first name> Daybook. The name comes from the signed-in account
// (see firstName), never from a constant - a hard-coded owner is how every member
// ended up looking at somebody else's name on their own Daybook.
const BRAND = { app: 'Daybook' };
// The tiers. Stored keys describe the arrangement, labels are the marketing name -
// which has changed three times while the arrangement hasn't. Mirrors
// worker/plans.js; change both together.
//   free -> Free · byok -> Premium (your own AI keys) · managed -> Premium Plus (we supply the AI)
const PLAN_KEYS = ['free', 'byok', 'managed'];
const PLAN_LABEL = { free: 'Free', byok: 'Premium', managed: 'Premium Plus' };
const PLAN_PRICE = { free: '', byok: '€6/mo', managed: '€13/mo' };
const normPlan = (p) => { const k = String(p || '').toLowerCase(); return PLAN_KEYS.includes(k) ? k : ({ standard: 'byok', premium: 'managed' }[k] || 'free'); };
const planLabel = (p) => PLAN_LABEL[normPlan(p)];
const isManagedPlan = (p) => normPlan(p) === 'managed';
// The Daybook mark: a sun rising over two page-lines (a book of days). Uses
// currentColor so it takes on the user's accent, and sits between the owner
// name and "Daybook" in the wordmark.
const MARK = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M9.5 19.5a6.5 6.5 0 0 1 13 0z" fill="currentColor"/><path d="M4.5 19.5h23" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M7.8 24.6h16.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" opacity=".5"/></svg>';
// The same mark cropped to its own bounds, for places that size it as an icon
// rather than setting it in a line of text. Derived, never a second copy.
const MARK_TIGHT = MARK.replace('viewBox="0 0 32 32"', 'viewBox="3 12.6 26 13.6"');
// Optional sections/tools. Turn any off in Settings and it vanishes from the nav,
// launcher and home. Home itself is always on. A module is ON unless set false.
const MODULES = [['mail', 'Mail'], ['calendar', 'Calendar'], ['tasks', 'Tasks'], ['today', 'Today'], ['notes', 'Notes'], ['reflect', 'Reflection'], ['financial', 'Money'], ['goals', 'Goals'], ['contacts', 'Contacts'], ['saved', 'Saved'], ['areas', 'Life areas'], ['timer', 'Toolbox'], ['notepad', 'Notepad']];
// Most modules are on unless explicitly turned off; a few (the Focus timer)
// start off and only appear once switched on in Settings.
const MOD_DEFAULT_OFF = new Set(['timer']);
const modOn = (k) => { const v = state.modules && state.modules[k]; return v === true ? true : v === false ? false : !MOD_DEFAULT_OFF.has(k); };
async function saveModules() { try { await api('/api/kv/modules', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(state.modules || {}) }) }); } catch {} }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const token = () => localStorage.getItem(KEY) || '';

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (res.status === 401) { localStorage.removeItem(KEY); if (!$('#gate2')) showGate('Your session expired. Sign in again.'); throw new Error('unauthorized'); }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    let msg = b.error || `HTTP ${res.status}`;
    // Never surface raw database plumbing (or a "upgrade your plan" nag meant for
    // us, not the member) - show something calm and human instead.
    if (/D1_ERROR|row write limit|SQLITE|no such (table|column)/i.test(msg)) {
      msg = /write limit/i.test(msg)
        ? "Couldn't save just now - Daybook is briefly at capacity. Please try again in a little while."
        : "Couldn't save that just now. Please try again.";
    }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
let toastT;
function toast(m, undoFn) {
  const t = $('#toast');
  if (undoFn) {
    t.innerHTML = '<span class="toast-msg"></span><button class="toast-undo" type="button">Undo</button>';
    t.querySelector('.toast-msg').textContent = m;
    t.querySelector('.toast-undo').onclick = () => { t.hidden = true; clearTimeout(toastT); try { undoFn(); } catch {} };
  } else { t.textContent = m; }
  t.hidden = false; clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, undoFn ? 7000 : 2600);
}

const readLS = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch { return fb; } };
const state = {
  view: { type: 'home' },
  noteTops: [], tables: [],
  areas: [], tasks: [], taskFilter: null, taskAdding: false, showCompleted: false, showSnoozed: false, completedQuery: '', taskQuery: '', notesQuery: '', calQuery: '',
  taskFilters: null, taskFiltersOpen: false,
  contacts: [], contactsQuery: '', contactAdding: false, contact_open: null,
  contactGroups: [], contactsGroup: null, contactMenu: null,
  financial: { tab: 'portfolio', data: null, error: null, loading: false, adding: false, editId: null, channels: null, videos: null, trends: null, polling: false, txns: null, spendMonth: null, spendImport: null, tracker: null, trackerLoading: false },
  goals: [], bucket: [], reviews: [], goal_open: null, bucket_open: null, review_open: null, vision_open: null, goalsTab: 'goals', goalsFilter: null,
  // Phones default to priority order (P1 first); desktop to most-recently added.
  taskSort: readLS('life.taskSort', { col: 'priority', dir: 'asc' }),   // default by priority, and remember the user's choice
  taskChipsOpen: readLS('life.taskChipsOpen', true),   // the area-filter chips can be collapsed away

  note: null, tables_open: null,
  favs: [], home: { events: [] }, cal: null, mail: null,
  tabs: [], activeTab: null,
  nav: {
    order: (() => { const def = ['favs', 'notes', 'areas']; const o = readLS('life.nav.order', null); const c = Array.isArray(o) ? o.filter((k) => def.includes(k)) : []; for (const k of def) if (!c.includes(k)) c.push(k); return c; })(),
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
  const isHtml = /<(p|h[1-3]|blockquote|div|ul|ol|details)[\s>]/i.test(s);
  // A non-block body is Markdown. Heal any stray inline formatting tags that a
  // rich paste once dropped in (strong/em/b/i/u/span/font, &nbsp;): left in, the
  // Markdown pass escapes them and they show as literal "<strong>"/"&nbsp;" text.
  // Links (<a>) are left untouched.
  const src = isHtml ? s : body.replace(/&nbsp;/gi, ' ').replace(/<\/?(?:strong|em|b|i|u|span|font)(?:\s[^>]*)?>/gi, '');
  const html = isHtml ? s : mdToHtml(src);
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
  // Wrap pasted tables so a wide one scrolls sideways instead of stretching the
  // page. sanitizeProse strips the wrapper back off when saving.
  d.querySelectorAll('table').forEach((t) => {
    if (t.parentElement && t.parentElement.classList.contains('ptable-wrap')) return;
    const w = document.createElement('div'); w.className = 'ptable-wrap';
    t.replaceWith(w); w.appendChild(t);
  });
  // Empathy reflections are saved as blockquotes starting with 🫶 (the class is
  // stripped on save); re-flag them here so they render as the soft callout.
  d.querySelectorAll('blockquote').forEach((b) => { const tx = (b.textContent || '').trimStart(); if (tx.startsWith('🫶')) b.classList.add('j-empathy'); else if (tx.startsWith('🧭')) b.classList.add('j-coach'); });
  // A trailing card leaves nowhere to type; add an empty line after it.
  const last = d.lastElementChild;
  if (last && last.classList && last.classList.contains('lc-inline')) {
    const p = document.createElement('p'); p.innerHTML = '<br>'; d.appendChild(p);
  }
  return d.innerHTML;
}
// An always-on inline editor. No modes, no markup - you just write, and the
// selection bubble (or ⌘B/⌘I) formats in place. `key` says which block it saves.
function proseEditor(body, key, id, readOnly) {
  // data-block-id ties this editor to ITS block. saveProse writes to that id,
  // never to "whatever note is open now" - without it, a save scheduled here
  // that fires after you follow a link lands in the note you navigated to,
  // silently overwriting it. That bug wiped notes; do not remove the id.
  return `<div class="prose${readOnly ? ' readonly' : ''}" contenteditable="${readOnly ? 'false' : 'true'}" spellcheck="true" data-prose="${key}" data-block-id="${esc(id || '')}" data-ph="Write something here…">${decorateProse(bodyToHtml(body))}</div>`;
}
// ── Collapsible headings (fold content under H1-H3) ──────────────────
// Each heading gets a live-DOM chevron; clicking it hides the following siblings
// up to the next heading of the same-or-higher level. Fold state persists per
// block + heading index; the chevrons are stripped on save (see sanitizeProse).
const HLVL = { H1: 1, H2: 2, H3: 3 };
function proseFolds() { try { return JSON.parse(localStorage.getItem('life.prose.folds')) || {}; } catch { return {}; } }
function getFolds(blockId) { const f = proseFolds()[blockId]; return Array.isArray(f) ? f : []; }
function setFold(blockId, idx, folded) {
  const all = proseFolds(); const cur = new Set(getFolds(blockId));
  if (folded) cur.add(idx); else cur.delete(idx);
  all[blockId] = [...cur].sort((a, b) => a - b);
  try { localStorage.setItem('life.prose.folds', JSON.stringify(all)); } catch {}
}
function proseSiblingsUnder(head) {
  const lvl = HLVL[head.tagName]; const out = [];
  let n = head.nextElementSibling;
  while (n && !(HLVL[n.tagName] && HLVL[n.tagName] <= lvl)) { out.push(n); n = n.nextElementSibling; }
  return out;
}
function applyFold(head, folded) {
  proseSiblingsUnder(head).forEach((el) => el.classList.toggle('folded-hidden', folded));
  head.classList.toggle('folded', folded);
}
// Inject the chevrons and re-apply saved folds. Idempotent; safe to call each render.
// Indent so content reads as belonging to its heading: the shallowest heading in
// the note sits flush-left and every level below - and the text/bullets under it -
// steps in. The prose is a flat list of siblings with no section wrappers, so the
// depth is worked out live here and written as an inline margin the save sanitiser
// strips (see sanitizeProse), so nothing is persisted into the body.
const PROSE_INDENT_EM = 1.5;
function applyProseIndent(prose) {
  const kids = [...prose.children];
  let base = 99;   // shallowest heading level present (a note of only H2s starts flush)
  for (const k of kids) { const l = HLVL[k.tagName]; if (l && l < base) base = l; }
  if (base === 99) { for (const k of kids) k.style.marginLeft = ''; return; }
  let cur = 0;     // indent depth for the current section's content
  for (const k of kids) {
    const l = HLVL[k.tagName];
    let depth;
    if (l) { depth = l - base; cur = depth + 1; }   // a heading sits at its level; its content one deeper
    else { depth = cur; }
    k.style.marginLeft = depth > 0 ? `${(depth * PROSE_INDENT_EM).toFixed(2)}em` : '';
  }
}
function setupFolds() {
  document.querySelectorAll('.prose[data-block-id]').forEach((prose) => {
    applyProseIndent(prose);
    const heads = [...prose.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')];
    if (!heads.length) return;
    const folded = getFolds(prose.dataset.blockId);
    heads.forEach((h, i) => {
      let toggle = h.querySelector(':scope > .fold-toggle');
      if (!toggle) { toggle = document.createElement('span'); toggle.className = 'fold-toggle'; toggle.contentEditable = 'false'; toggle.setAttribute('title', 'Fold / unfold'); h.insertBefore(toggle, h.firstChild); }
      // A grip to drag the whole section (this heading + everything under it, up
      // to the next same-or-higher heading) up or down. Live-DOM only, stripped
      // on save like the fold chevron.
      let grip = h.querySelector(':scope > .head-grip');
      if (!grip) { grip = document.createElement('span'); grip.className = 'head-grip'; grip.contentEditable = 'false'; grip.setAttribute('draggable', 'true'); grip.setAttribute('title', 'Drag to reorder this section'); grip.textContent = '⠿'; }
      h.insertBefore(grip, h.firstChild);   // grip first, then the fold chevron
      const isFolded = folded.includes(i);
      toggle.textContent = isFolded ? '▸' : '▾';
      applyFold(h, isFolded);
    });
  });
}
// Drag a heading's grip to reorder its section within the note. The section is
// the heading plus every following block up to the next same-or-higher heading,
// so the content travels with its title. Drop lands the section above whichever
// heading you're hovering, or at the end past the last one.
let headDrag = null;
function cleanupHeadDrag() {
  if (headDrag && headDrag.head) headDrag.head.classList.remove('head-dragging');
  document.querySelectorAll('.head-drop').forEach((h) => h.classList.remove('head-drop'));
  headDrag = null;
}
document.addEventListener('dragstart', (e) => {
  const grip = e.target.closest && e.target.closest('.head-grip'); if (!grip) return;
  const head = grip.closest('h1,h2,h3'); const prose = head && head.closest('.prose[data-block-id]');
  if (!head || !prose) return;
  headDrag = { prose, head };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', ''); } catch {}   // Firefox needs data set
  setTimeout(() => head.classList.add('head-dragging'), 0);
});
document.addEventListener('dragover', (e) => {
  if (!headDrag) return;
  const prose = e.target.closest && e.target.closest('.prose[data-block-id]');
  if (prose !== headDrag.prose) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const heads = [...prose.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')];
  prose.querySelectorAll('.head-drop').forEach((h) => h.classList.remove('head-drop'));
  let target = null;
  for (const h of heads) { const r = h.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { target = h; break; } }
  prose.dataset.headDrop = target ? String(heads.indexOf(target)) : '-1';
  if (target && target !== headDrag.head) target.classList.add('head-drop');
});
document.addEventListener('drop', (e) => {
  if (!headDrag) return;
  const prose = headDrag.prose;
  const over = e.target.closest && e.target.closest('.prose[data-block-id]');
  if (over !== prose) { cleanupHeadDrag(); return; }
  e.preventDefault();
  const heads = [...prose.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')];
  const idx = parseInt(prose.dataset.headDrop || '-1', 10);
  const target = (idx >= 0 && idx < heads.length) ? heads[idx] : null;
  const section = [headDrag.head, ...proseSiblingsUnder(headDrag.head)];
  cleanupHeadDrag(); delete prose.dataset.headDrop;
  if (target && section.includes(target)) return;   // dropping onto its own section: no-op
  const frag = document.createDocumentFragment();
  section.forEach((n) => frag.appendChild(n));       // detaches each node, then re-inserts as a unit
  if (target) prose.insertBefore(frag, target); else prose.appendChild(frag);
  // Fold state is keyed by heading position, which just changed - clear it for
  // this note so no heading shows wrongly folded after the move.
  try { const all = proseFolds(); delete all[prose.dataset.blockId]; localStorage.setItem('life.prose.folds', JSON.stringify(all)); } catch {}
  saveProse(prose.dataset.prose, prose.innerHTML, prose.dataset.blockId);
  setupFolds();
});
document.addEventListener('dragend', () => { if (headDrag) cleanupHeadDrag(); });
// Keep saved HTML clean: a small whitelist, unwrap everything else, drop all
// attributes but a link's href. Content is Robin's own, so this is about
// tidiness (stray pasted styles) more than security.
const PROSE_OK = { P: 1, H1: 1, H2: 1, H3: 1, STRONG: 1, EM: 1, A: 1, BLOCKQUOTE: 1, BR: 1, CODE: 1, UL: 1, OL: 1, LI: 1, DETAILS: 1, SUMMARY: 1, TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1 };
function sanitizeProse(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // Fold chevrons are live-DOM only (injected on render): remove them so their
  // glyph never gets saved into a heading. Folded content is just hidden, so it
  // stays in the body and is preserved.
  doc.querySelectorAll('.fold-toggle, .head-grip').forEach((el) => el.remove());
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
      // The render-time table scroll wrapper: unwrap it so the stored body holds
      // just the <table> (decorateProse re-wraps on render).
      if (c.tagName === 'DIV' && c.classList.contains('ptable-wrap')) { walk(c); const p = c.parentNode; while (c.firstChild) p.insertBefore(c.firstChild, c); c.remove(); return; }
      walk(c);
      let tag = c.tagName;
      if (tag === 'B') tag = 'STRONG'; else if (tag === 'I') tag = 'EM';
      else if (tag === 'DIV') tag = 'P';
      if (!PROSE_OK[tag]) { const p = c.parentNode; while (c.firstChild) p.insertBefore(c.firstChild, c); c.remove(); return; }
      const el = c.tagName === tag ? c : (() => { const n = doc.createElement(tag); while (c.firstChild) n.appendChild(c.firstChild); c.replaceWith(n); return n; })();
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      const keepOpen = el.tagName === 'DETAILS' && el.hasAttribute('open');   // remember collapse state
      const span = (el.tagName === 'TD' || el.tagName === 'TH') ? { colspan: el.getAttribute('colspan'), rowspan: el.getAttribute('rowspan') } : null;
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (span) { if (span.colspan && +span.colspan > 1) el.setAttribute('colspan', span.colspan); if (span.rowspan && +span.rowspan > 1) el.setAttribute('rowspan', span.rowspan); }
      // Internal links to other Robski Life pages FIRST: an internal link the
      // browser resolved to an absolute URL (https://life.robski.uk/#rl-note-…)
      // would otherwise match the http test below, get target=_blank, and open
      // in a browser tab instead of navigating in-app. Store just the #rl-…
      // fragment so it always routes internally.
      const rlm = href && href.match(/#rl-(note|table|area|row)-[\w-]+/i);
      if (rlm) { el.setAttribute('href', rlm[0]); el.setAttribute('class', 'rl-link'); }
      else if (href && /^(https?:|mailto:)/i.test(href)) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      if (keepOpen) el.setAttribute('open', '');
    });
  };
  walk(doc.body);
  return doc.body.innerHTML.trim();
}

// ── tabs ─────────────────────────────────────────────
// A tab is a saved destination (view + label), not a whole live instance.
// Switching re-opens that view; the active tab tracks wherever you navigate.
const TAB_IC = { home: '⌂', tasks: '✓', taskcard: '✓', calendar: '◑', mail: '✉', mailaccounts: '✉', today: '☀', note: '▤', notes: '▤', table: '▦', tables: '▦', area: '◈', areas: '◈', contacts: '👤', contactcard: '👤', goals: '🎯', goalcard: '🎯', bucketcard: '🎯', reviewcard: '🎯', visioncard: '🎯', visionwall: '🖼', financial: '💰', settings: '⚙', admin: '🛠', friends: '👥', help: 'ⓘ' };
// ── In-app guides ─────────────────────────────────────────────────────
// The little i by the tabs. Hovering shows a one-line tip for whatever tool
// you're on; clicking pins the full guide in its own tab. Content is plain and
// task-focused - what the tool is for and how to drive it, not a feature list.
const HELP = {
  home: { title: 'Home', tip: 'Your whole day on one screen: today’s schedule, your top tasks, a scratchpad and everything you’ve starred.',
    body: `<p>Home is the first thing you see and the place to start your day. It pulls the pieces that matter <em>right now</em> into one screen so you don’t have to go looking.</p>
      <ul><li><b>Today</b> - your calendar events and time blocks for the day.</li>
      <li><b>Priority Tasks</b> - your open P1s, each on its own card, in the order you drag them. “See all” opens the full board.</li>
      <li><b>Notepad</b> - a scratchpad that saves as you type, waiting for you next time.</li>
      <li><b>Starred</b> and <b>Recently viewed</b> - one tap back to the notes, tables and areas you keep returning to.</li></ul>
      <p>Drag sections’ tasks to reorder them, and collapse any section you don’t want with the arrow by its title. Choose which sections appear in <b>Settings › Sections</b>.</p>` },
  tasks: { title: 'Tasks', tip: 'A board of everything to do. Filter it your way, sort by any column, and tick things off.',
    body: `<p>Every task lives here. A task has a title, a priority (P1-P4), an optional life area and an optional due date.</p>
      <ul><li><b>Add</b> one with <b>+ New</b> or the + by Tasks in the sidebar - it’s usable the instant you type it.</li>
      <li><b>Filter</b> builds your own view: add conditions (priority is P1, area is Work, due this week…) and stack as many as you like.</li>
      <li><b>Sort</b> by clicking a column header.</li>
      <li><b>Priority</b> P1 is what surfaces on Home and in your morning brief, so keep it for what truly matters.</li></ul>
      <p>Tick a task anywhere - Home, a note, the board - and it’s done everywhere at once.</p>` },
  notes: { title: 'Notes', tip: 'Free writing with headings, links and sub-notes. Tag a note to one or more life areas.',
    body: `<p>Notes are for anything you want to write down and find again. Type freely; use the toolbar for <b>H1-H3 headings</b> (which fold, to collapse long notes), lists and links.</p>
      <ul><li><b>Sub-notes</b> nest inside a note (the “Notes inside” panel), so a project can hold its own pages.</li>
      <li><b>Link</b> highlighted text to another note or even a table row, to weave things together.</li>
      <li><b>Life areas</b> - tag a note to one or several areas (the chips up top); it then shows on each of those area pages.</li>
      <li>A note can become a <b>table</b> and back with the Note/Table toggle.</li></ul>
      <p>Star a note to pin it to the sidebar; recently opened notes are always a click away there too.</p>` },
  calendar: { title: 'Calendar', tip: 'Your month, week and agenda. Add events; a start date pulls the end along so it never ends before it starts.',
    body: `<p>The calendar shows your events by month, with an agenda and search. It reads and writes your Google calendar.</p>
      <ul><li><b>Add</b> an event with a title, a start date and time (or All day), and a length. All-day events can span several days.</li>
      <li>Set a start date and the end follows to the same day - an event can never end before it begins.</li>
      <li><b>Repeat</b> makes a series (daily, weekdays, weekly, monthly, yearly).</li>
      <li>Events show on your <b>Today</b> page too, alongside the practices and tasks you plan there.</li></ul>` },
  mail: { title: 'Mail', tip: 'All your inboxes in one place. Read, reply, and search across every account.',
    body: `<p>Mail merges your real mailboxes (IMAP/SMTP) into one inbox. Add an account in <b>Settings › Mail accounts</b>.</p>
      <ul><li>Read, reply, forward and compose, choosing which account you send from.</li>
      <li>The inbox stays warm in the background, so opening Mail is instant, and a new message can nudge you.</li>
      <li>Search runs across your accounts.</li></ul>
      <p>Sending, and anything that leaves your account, always waits for you to press the button.</p>` },
  contacts: { title: 'Contacts', tip: 'Your people, with groups you can build from life areas - and a nudge when it has been too long.',
    body: `<p>Contacts holds the people in your life - name, email, phone, birthday, address. Group them however you like, including straight from a life area.</p>
      <p>Contacts with an email are checked against Daybook, so you can see which of your people are here and connect with them.</p>
      <p><b>Keep in touch</b> is on each contact’s card. Tick it, choose how often you’d like to speak - weekly, monthly, every 3 or 6 months, once a year, or a cadence of your own - and they appear in the <b>Keep in touch</b> section on Home when it has been that long.</p>
      <ul><li>The clock measures from the last time you were <b>actually</b> in touch, not from the calendar. Set <b>Last in touch</b> on their card (today is one tap away in the date picker), or tick the <b>✓</b> on Home, and it starts again.</li>
      <li>So a nudge never arrives the morning after you’ve seen someone, and a call made three weeks late still buys you a full interval.</li>
      <li>These stay off your Tasks board and out of your morning brief. Staying in touch isn’t admin, and it shouldn’t queue up behind it.</li></ul>` },
  financial: { title: 'Money', tip: 'Track spending against your life areas, import statements, and watch your portfolio.',
    body: `<p>Money is all your finances in one place. Your <b>life areas double as spending categories</b>, so where your money goes lines up with what your life is about.</p>
      <ul><li><b>Import</b> a statement and Daybook sorts transactions into categories.</li>
      <li>Add extra categories for spending that doesn’t fit an area.</li>
      <li>It remembers the tab you were last on.</li></ul>` },
  goals: { title: 'Goals & Reviews', tip: 'Turn a vision for each life area into goals and actions, and review your progress.',
    body: `<p>Goals connect the big picture to daily action. For each life area you can write a <b>vision</b>, set <b>goals</b> under it, and break those into actions.</p>
      <ul><li><b>Bucket list</b> - the things to do before you die.</li>
      <li><b>Reviews</b> - weekly, monthly, quarterly and yearly check-ins, with reminders when one falls due.</li>
      <li><b>Wheel of Life</b> and a <b>vision board</b> help you see the whole at a glance.</li></ul>` },
  areas: { title: 'Life areas', tip: 'The handful of areas your life orbits. Everything - tasks, notes, money, goals - hangs off them.',
    body: `<p>Life areas are the few domains that matter to you (Work, Health, Family…). They’re the backbone of Daybook: tasks, notes, goals and spending all attach to an area, so any area page gathers everything about that part of your life.</p>
      <ul><li>Give each area a colour so it reads at a glance across the app.</li>
      <li>An area page shows its starred notes, all its notes and tables, and its open tasks.</li>
      <li>Your <b>practices</b> group by area on the Today page, and a task or practice reads in its area's colour.</li></ul>
      <p>Rename, recolour or add areas any time - the whole app follows.</p>` },
  reflect: { title: 'Reflection', tip: 'A journal with prompts, and a “dig deeper” question when you want to go further.',
    body: `<p>Reflection is for journalling. Pick a prompt or write free; each entry is dated and yours to return to.</p>
      <p><b>Dig deeper</b> asks you one thoughtful follow-up question about what you’ve written, to take a thought further.</p>` },
  saved: { title: 'Saved', tip: 'Things to read and watch later. Capture a link in one tap from anywhere.',
    body: `<p>Saved is your read-and-watch list. Drop in a link and come back to it when you have the time.</p>
      <p>One-tap capture (a bookmarklet or an iOS Shortcut) saves a page straight to your list from any browser.</p>` },
  friends: { title: 'Contacts on Daybook', tip: 'Connect with the people in your contacts who are on Daybook too - share notes, assign tasks, and chat.',
    body: `<p>Some of your contacts are on Daybook too, and you can connect with them. Add someone by <b>name or email</b>, or from the contacts of yours already here.</p>
      <ul><li><b>Share</b> a note or task with one of them, view-only or to edit.</li>
      <li><b>Assign</b> a task to one of them.</li>
      <li>Keep <b>shared meeting notes</b>, chat, and start a call.</li></ul>` },
  today: { title: 'Today', tip: 'The hub for planning and tracking your day - drag practices and tasks onto a timed day, tick them off, keep your streaks.',
    body: `<p><b>Today</b> is where you plan and track your day. Three columns: your <b>Practices</b> on the left, the <b>day</b> down the middle as a timed timeline, and your <b>Tasks</b> on the right - the same list as the Tasks board, filtered by life area and priority.</p>
      <ul><li><b>Drag</b> a practice or task onto the day to plan it at a time - grab it anywhere and drop it on the timeline. Everything reads in its <b>life-area colour</b>.</li>
      <li>Every placed block has a <b>tick box</b>: putting it on the day means you mean to do it, ticking it means you did. Ticking a practice on the day also ticks its <b>habit</b>.</li>
      <li><b>Click a task</b> to open it and edit its name, priority, life area or length.</li>
      <li><b>Practices are a palette, not a timetable.</b> They're your options, grouped by life area - the things you could do. Feel like something musical? Open Music, see your choices, and <b>drag</b> one onto the day or just <b>tick</b> what you did.</li>
      <li>Got a calendar event that <b>is</b> a practice (a gym class that's your workout)? It shows a one-tap <b>＋ chip</b> to count it - the event then carries the practice's colour and tick, and ticking it feeds the streak. No need to add the practice twice.</li>
      <li>The <b>Tracker</b> tab is your habits: every practice with tracking on, its streak and history. Set an <b>aim</b> per practice (every day, every other day) - a gentle target, never an alarm. Tick as you go, or on the day.</li>
      <li><b>Practices</b> are the things you do again and again. Add one (or the <b>✎</b> to manage) to set a life area, a length (so you know how long it takes), a note or follow-along video.</li></ul>` },
  tabs: { title: 'Tabs & getting around', tip: 'Keep several places open at once, pin the ones you always want to hand, and jump anywhere with ⌘K.',
    body: `<p>The row along the top is your <b>tabs</b>. Each one holds a place in Daybook - a tool, a note, a guide - and they work like browser tabs, so you can keep a few things open and hop between them.</p>
      <ul><li><b>Open a new tab</b> with the <b>+</b> at the end of the row. It starts on Home, and then follows you wherever you go.</li>
      <li><b>A working tab</b> (not pinned) is reused as you move around: click Tasks, then Notes, and the same tab just changes. That’s what stops you drowning in tabs.</li>
      <li><b>Pin a tab</b> with its <b>📌</b> to lock it to one place. A pinned tab never changes underfoot - navigate somewhere else and Daybook opens a working tab for that instead, leaving your pinned one exactly as it was. Ideal for Mail, your Today page, or a note you keep returning to.</li>
      <li><b>Unpin</b> by tapping the <b>📌</b> again; it becomes an ordinary working tab.</li>
      <li><b>Close</b> a working tab with its <b>×</b> (it shows once you have more than one). Pinned tabs have no ×, so you can’t lose one by accident - unpin it first if you really want it gone.</li>
      <li>Pinned tabs sit at the <b>front</b> of the row, and your whole set of tabs is remembered, so they’re waiting for you next time you open Daybook.</li></ul>
      <p>Two shortcuts worth knowing: tap the <b>ℹ</b> on any tool to pop its guide open in a pinned tab, and press <b>⌘K</b> (Ctrl+K) for the command palette to search or jump anywhere in a couple of keystrokes. The <b>breadcrumbs</b> under the tabs (Home › Notes › your note) step you back up at any time.</p>` },
  settings: { title: 'Settings', tip: 'Your account, look and feel, which sections show, invites, and the tools that manage your setup.',
    body: `<p>Settings is organised into tabs. <b>Account</b> holds your name, sign-in addresses, phone and plan. <b>Appearance</b> sets the theme and accent colour. <b>AI</b> holds your AI keys and a switch to turn all AI off. <b>Notifications</b> has the morning-brief and text-alert switches. <b>Tools</b> turns sections on or off. <b>Invites</b> emails someone an invitation to join. <b>Manage</b> gathers life areas, mail accounts, spending categories and reminders.</p>` },
  'settings-account': { title: 'Account', tip: 'Your name, the addresses you sign in with, your phone and your plan.',
    body: `<p>Your <b>name</b> is the wordmark at the top. Your <b>primary email</b> is fixed, but you can add other addresses that all sign into this one account (each is confirmed by a code). Your <b>phone</b> is used for text alerts. <b>Plan</b> shows what you're on. <b>Download your data</b> exports everything; <b>Close account</b> removes it.</p>` },
  'settings-appearance': { title: 'Appearance', tip: 'Theme, accent colour, and the daily quote.',
    body: `<p><b>Theme</b> follows your local sunrise and sunset by default; tap to override to light or dark. <b>Accent colour</b> recolours the whole app - pick a preset or your own. <b>Daily inspirational quote</b> turns the one-a-day quote on Home, Today and the morning email on or off.</p>` },
  'settings-ai': { title: 'Plan', tip: 'How the AI runs: bring your own keys, or Premium Plus where we handle it.',
    body: `<p><b>Use AI features</b> is a master switch - turn it off and every AI feature (Reflection coaching, Email Scribe replies, advice, statement import) is disabled across Daybook.</p><p>There are two ways to power it. <b>Bring your own keys</b> (Free and Premium): add your own Anthropic and Gemini keys and you control the cost - nothing is stored but whether a key is set. <b>Premium Plus</b>: we run the AI for you, no keys to manage.</p>` },
  'settings-notifications': { title: 'Notifications', tip: 'How and when Daybook reaches you - the morning brief and text alerts.',
    body: `<p><b>Morning brief</b> emails your day's calendar, open P1 tasks and the quote at 08:45. <b>Before a time block starts</b> texts you 5 minutes before a scheduled block (add a phone in Account first).</p>` },
  'settings-sections': { title: 'Tools', tip: 'Turn any tool on or off - hide what you don\'t use.',
    body: `<p>Tick a tool to show it, untick to hide it from the sidebar and Home. Nothing is deleted - turn it back on any time and your data is still there.</p>` },
  'settings-invites': { title: 'Invites', tip: 'Bring people onto Daybook.',
    body: `<p>Put in someone's email and a note, and Daybook emails them the invitation. They click one link, sign in and their own Daybook is set up - there is no code for them to type. Leave the email blank if you'd rather have a code to pass on yourself. You can hold a few open invitations at a time.</p>` },
  'settings-manage': { title: 'Manage', tip: 'Life areas, mail accounts, spending categories and reminders.',
    body: `<p>Each tile opens a small subpage: <b>Life areas</b> (what Daybook orbits), <b>Mail accounts</b> (inboxes you send and receive from), <b>Spending categories</b>, and <b>Reviews &amp; reminders</b> (cadence and nudges). Your daily <b>practices</b> live on the Today page now.</p>` },
};
// Cards and sub-pages fold into their tool's guide.
function helpKey(v) {
  if (v && v.type === 'help') return v.tool || 'home';
  const t = (v && v.type) || 'home';
  return ({ taskcard: 'tasks', note: 'notes', notes: 'notes', table: 'notes', tables: 'notes',
    journal: 'reflect', journalentry: 'reflect', mailaccounts: 'mail', contactcard: 'contacts',
    area: 'areas', goalcard: 'goals', bucketcard: 'goals', reviewcard: 'goals', visioncard: 'goals', visionwall: 'goals',
    readwatch: 'saved' })[t] || t;
}
// The i beside the tabs, keyed to the tool you're on. Hover = the tip; click = pin
// the full guide in its own tab.
function helpIconHtml() {
  const key = helpKey(state.view); const h = HELP[key]; if (!h) return '';
  // The popover is drawn on hover as a fixed element (below), so it isn't clipped
  // by the tab strip's horizontal scroll.
  return `<button class="help-btn" data-help-open="${key}" aria-label="How ${esc(h.title)} works" title="How ${esc(h.title)} works">i</button>`;
}
function showHelpPop(btn) {
  const h = HELP[btn.dataset.helpOpen]; if (!h) return;
  let el = document.getElementById('help-pop');
  if (!el) { el = document.createElement('div'); el.id = 'help-pop'; el.className = 'help-pop'; document.body.appendChild(el); }
  el.innerHTML = `<div class="help-pop-t">${esc(h.title)}</div><div class="help-pop-b">${h.tip}</div><div class="help-pop-hint">Click the i to pin the full guide →</div>`;
  const w = Math.min(300, window.innerWidth - 24);
  el.style.width = `${w}px`;
  el.style.display = 'block';
  const r = btn.getBoundingClientRect();
  const ph = el.offsetHeight;   // now measurable (display set above)
  // The icon sits at the bottom of the sidebar, so opening downward runs off the
  // screen. Prefer below, but flip above whenever it wouldn't fit under the icon.
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
  el.style.top = `${top}px`;
  // Start at the icon's left edge and extend right, clamped fully on-screen.
  el.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`;
}
function hideHelpPop() { const el = document.getElementById('help-pop'); if (el) el.style.display = 'none'; }
function openHelp(key) { state.view = { type: 'help', tool: key }; renderNav(); renderHelp(key); return Promise.resolve(); }
// The tools listed on the Guide home page, in a sensible reading order.
const GUIDE_TOPICS = ['home', 'tabs', 'today', 'tasks', 'calendar', 'mail', 'notes', 'reflect', 'financial', 'goals', 'areas', 'contacts', 'saved', 'friends', 'settings'];
function renderHelp(key) {
  if (key === 'index' || !HELP[key]) return renderGuideIndex();
  const h = HELP[key];
  $('#pane').innerHTML = `${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Guide', attr: 'data-open-guide' }, { label: h.title }])}
    <div class="pane-head home-head"><h1>${esc(h.title)}</h1></div>
    <div class="help-doc"><p class="help-lede">${h.tip}</p>${h.body}
      <p class="help-foot"><button class="help-back-link" data-open-guide>← All guides</button></p></div>`;
}
// The Guide home page: the joining checklist up top, then a card per tool guide.
function renderGuideIndex() {
  const cards = GUIDE_TOPICS.filter((k) => HELP[k]).map((k) => {
    const h = HELP[k];
    return `<button class="guide-card" data-help-open="${k}"><span class="guide-card-t">${esc(h.title)}</span><span class="guide-card-s">${h.tip}</span></button>`;
  }).join('');
  $('#pane').innerHTML = `${pageCrumb('Guide')}
    <div class="pane-head home-head"><h1>Guide</h1></div>
    <div class="help-doc">
      <p class="help-lede">Everything you need to find your way around Daybook. Start with the welcome guide, or pick a tool.</p>
      <div class="guide-start">
        <div class="guide-start-h">✦ New here? The welcome guide</div>
        <p class="guide-start-p">A quick set-up, any time you want to run through it:</p>
        <ol class="guide-checklist">
          <li><b>Choose your username</b> - your Daybook's own web address.</li>
          <li><b>Add AI</b> - bring your own key, or go Premium Plus and we handle it for you.</li>
          <li><b>Connect your email</b> - Gmail (with a one-tap app-password guide) and the rest.</li>
        </ol>
        <button class="add-btn wide" data-onb-replay>Open the welcome guide</button>
      </div>
      <div class="guide-sec-h">All the guides</div>
      <div class="guide-grid">${cards}</div>
      <div class="guide-sec-h">Privacy &amp; terms</div>
      <p class="guide-start-p">How Daybook handles your data, and the terms of use. Daybook is private by design - your content is yours, never sold, and never used to train AI.</p>
      <div class="guide-legal">
        <a class="guide-legal-link" href="https://daybook.fyi/privacy" target="_blank" rel="noopener">Privacy Policy ↗</a>
        <a class="guide-legal-link" href="https://daybook.fyi/terms" target="_blank" rel="noopener">Terms of Service ↗</a>
        <a class="guide-legal-link" href="mailto:contact@daybook.fyi">Contact us ✉</a>
      </div>
      <p class="guide-copyright">Questions or anything at all? Email <a href="mailto:contact@daybook.fyi">contact@daybook.fyi</a>.<br>© ${new Date().getFullYear()} Daybook · daybook.fyi</p>
    </div>`;
}
// Click the i: pin this tool's guide in its own tab. If it's already open, just go there.
function openHelpTab(key) {
  hideHelpPop();
  const view = { type: 'help', tool: key };
  const existing = state.tabs.find((t) => t.view.type === 'help' && t.view.tool === key);
  if (existing) { if (!existing.pinned) { existing.pinned = true; } switchTab(existing.id); renderTabs(); saveTabs(); return; }
  const id = uid();
  state.tabs.push({ id, view, label: labelForView(view), pinned: true });
  state.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  state.activeTab = id;
  Promise.resolve(openView(view)).catch(() => openHome());
  saveTabs();
}
// A one-word-ish summary of a single filter condition, for the tab label -
// "P1", a life-area name, "Snoozed", "no Repeat". Falls back to the field name.
function condShort(c) {
  const f = TASK_FIELDS[c.field]; if (!f) return '';
  if (['isset', 'yes'].includes(c.op)) return f.label;
  if (['notset', 'no'].includes(c.op)) return `no ${f.label}`;
  let val = c.value;
  if (f.choices) { const hit = f.choices().find(([vv]) => String(vv) === String(c.value)); if (hit) val = hit[1]; }
  return String(val || f.label);
}
// The tab title for a Tasks view reflects its filter, so two Tasks tabs (P1 vs a
// life area) read differently in the strip instead of both saying "Tasks".
function taskTabLabel(v) {
  const f = (v && v.filters) || [];
  if (!f.length) return 'Tasks';
  if (f.length === 1) { const s = condShort(f[0]); return s ? `Tasks · ${s}` : 'Tasks'; }
  return `Tasks · ${f.length} filters`;
}
function labelForView(v) {
  switch (v.type) {
    case 'help': return v.tool === 'index' ? 'Guide' : `${(HELP[v.tool] || {}).title || 'Guide'} guide`;
    case 'tasks': return taskTabLabel(v);
    case 'taskcard': return (state.task_open && state.task_open.task.title) || 'Task';
    case 'calendar': return 'Calendar'; case 'mail': return 'Mail'; case 'today': return 'Today';
    case 'mailaccounts': return 'Mail accounts';
    case 'note': return (state.note && state.note.current.title) || 'Note'; case 'notes': return 'Notes';
    case 'journal': return 'Reflection'; case 'journalentry': return (state.journal && state.journal.current && journalDateLabel((state.journal.current.props || {}).date)) || 'Reflection';
    case 'readwatch': return 'Read & Watch';
    case 'settings': return 'Settings';
    case 'admin': return 'Admin';
    case 'friends': return 'Contacts on Daybook';
    case 'table': return (state.tables_open && state.tables_open.title) || 'Table'; case 'tables': return 'Tables';
    case 'area': return (state.area_open && state.area_open.area.title) || 'Area'; case 'areas': return 'Life areas';
    case 'financial': return 'Money';
    case 'contacts': return 'Contacts'; case 'contactcard': return (state.contact_open && state.contact_open.contact.title) || 'Contact';
    case 'goals': return 'Goals'; case 'goalcard': return (state.goal_open && state.goal_open.goal.title) || 'Goal'; case 'bucketcard': return (state.bucket_open && state.bucket_open.item.title) || 'Bucket list';
    case 'reviewcard': return (state.review_open && state.review_open.review.title) || 'Review';
    case 'visioncard': return (state.vision_open && `${state.vision_open.area.title} · Vision`) || 'Vision'; case 'visionwall': return 'The wall';
    default: return 'Home';
  }
}
function openView(v) {
  switch (v.type) {
    case 'tasks': return openTasks(); case 'taskcard': return openTaskCard(v.id);
    case 'calendar': return openCalendar(); case 'mail': return openMail(v.open); case 'today': return openToday();
    case 'mailaccounts': return openMailAccounts();
    case 'note': return openNote(v.id); case 'notes': return openNotesList();
    case 'journal': return openJournal(); case 'journalentry': return openJournalEntry(v.id);
    case 'readwatch': return openReadwatch();
    case 'table': return openTable(v.id); case 'tables': return openTablesList();
    case 'area': return openArea(v.id); case 'areas': return openAreasList();
    case 'financial': return openFinancial(v.tab);
    case 'settings': return openSettings();
    case 'admin': return openAdmin();
    case 'practices': return openPractices();
    case 'friends': return openContacts();   // merged into Contacts
    case 'contacts': return openContacts(); case 'contactcard': return openContactCard(v.id);
    case 'goals': return openGoals(); case 'goalcard': return openGoalCard(v.id); case 'bucketcard': return openBucketCard(v.id); case 'reviewcard': return openReviewCard(v.id);
    case 'visioncard': return openVisionCard(v.id); case 'visionwall': return openVisionWall();
    case 'help': return openHelp(v.tool);
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
  if (key === navLastKey) return;   // a re-render of the same view, not a navigation
  if (navLastView) { navHist.push(navLastView); if (navHist.length > 60) navHist.shift(); }
  navLastKey = key; navLastView = { ...state.view };
  // Landing on a genuinely new page: jump to the top. On mobile the whole page
  // scrolls, so the previous page's scroll position would otherwise carry over.
  try { window.scrollTo(0, 0); const p = document.getElementById('pane'); if (p) p.scrollTop = 0; document.querySelector('.main')?.scrollTo(0, 0); } catch {}
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
function saveTabs() { try { localStorage.setItem('life.tabs', JSON.stringify({ tabs: state.tabs.map((t) => ({ view: t.view, label: t.label, pinned: !!t.pinned })), active: state.tabs.findIndex((t) => t.id === state.activeTab) })); } catch {} }
// A tab must own an INDEPENDENT copy of its view. A Tasks view carries mutable
// filters/sort; a shallow copy leaves every Tasks tab pointing at one shared
// array, so they all show identical content (the "two tabs, same content" bug).
// Deep-copy those so each tab keeps its own P1 / life-area / etc. filter.
function tabViewCopy(v) {
  if (v && v.type === 'tasks') {
    return { type: 'tasks', filters: JSON.parse(JSON.stringify(v.filters || [])), sort: { ...(v.sort || {}) }, q: v.q || '', filtersOpen: !!v.filtersOpen };
  }
  return { ...v };
}
function syncActiveTab() {
  let tab = state.tabs.find((t) => t.id === state.activeTab); if (!tab) return;
  // A pinned tab is locked to its destination. Navigating elsewhere while it's
  // active doesn't overwrite it: it spills into a working (unpinned) tab,
  // creating one if every tab is pinned.
  if (tab.pinned && viewKey(tab.view) !== viewKey(state.view)) {
    let work = state.tabs.find((t) => !t.pinned);
    if (!work) { work = { id: uid(), view: { type: 'home' }, label: 'Home', pinned: false }; state.tabs.push(work); }
    state.activeTab = work.id; tab = work; renderTabs();
  }
  tab.view = tabViewCopy(state.view); tab.label = labelForView(state.view); saveTabs();
}
function togglePin(id) {
  const tab = state.tabs.find((t) => t.id === id); if (!tab) return;
  tab.pinned = !tab.pinned;
  // Keep pinned tabs at the front, each group holding its relative order (JS
  // sort is stable), so a pin literally moves the tab to the top of the strip.
  state.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  renderTabs(); saveTabs();
}
function renderTabs() {
  const el = $('#tabstrip'); if (!el) return;
  const many = state.tabs.length > 1;
  el.innerHTML = state.tabs.map((t) => `<button class="tab ${t.id === state.activeTab ? 'on' : ''}${t.pinned ? ' pinned' : ''}" data-tab="${t.id}">
    <span class="tab-pin ${t.pinned ? 'on' : ''}" data-tab-pin="${t.id}" title="${t.pinned ? 'Unpin' : 'Pin to keep this tab'}">📌</span>
    <span class="tab-ic">${TAB_IC[t.view.type] || '•'}</span><span class="tab-t">${esc(t.label || 'Tab')}</span>${!t.pinned && many ? `<span class="tab-x" data-tab-close="${t.id}" title="Close">×</span>` : ''}</button>`).join('')
    + `<button class="tab-new" data-tab-new title="New tab  ${PK('⌥⌘T')}">+</button>`
    + helpIconHtml()   // the guide i, pushed to the right; desktop only (the strip is hidden on mobile)
    // Settings + Sign out, small round icons in keeping with the i, right of it.
    + `<button class="tab-util ${state.view && state.view.type === 'settings' ? 'on' : ''}" data-open-settings title="Settings" aria-label="Settings">⚙</button>`
    + (state.me ? `<button class="tab-util" data-account-signout title="Sign out" aria-label="Sign out">↪</button>` : '');
}
function newTab() {
  const id = uid(); state.tabs.push({ id, view: { type: 'home' }, label: 'Home', pinned: false }); state.activeTab = id; openHome();
  // A fresh tab opens on Home with the search palette up, ready to jump straight
  // to wherever you meant to go. Desktop only - tabs (and the palette) aren't the
  // mobile flow.
  if (!window.matchMedia('(max-width:820px)').matches) openPalette();
}
// Open a view in a fresh tab, leaving every existing tab untouched. Used when
// something external (a notification) wants to show a page without hijacking the
// tab the user is on.
function openInNewTab(view) {
  const id = uid();
  state.tabs.push({ id, view, label: labelForView(view), pinned: false });
  state.activeTab = id;
  Promise.resolve(openView(view)).catch(() => openHome());
}
function switchTab(id) { if (id === state.activeTab) return; const tab = state.tabs.find((t) => t.id === id); if (!tab) return; commitTaskView(); state.activeTab = id; Promise.resolve(openView(tab.view)).catch(() => openHome()); }
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
    title = 'Starred';
    // Short titles ride two-up; longer ones take a full-width row so you can
    // actually read them.
    rows = state.favs.map((f) => {
      const wide = (f.title || '').length > 15 ? ' nav-sub-wide' : '';
      return `<button class="nav-sub${wide}" data-fav-open="${f.kind}:${f.id}" draggable="true" data-fav-id="${f.id}"><span class="i">${f.kind in KIND_IC ? KIND_IC[f.kind] : '•'}</span><span class="t">${esc(f.title || 'Untitled')}</span></button>`;
    }).join('') || '<div class="nav-sub muted">Star anything to pin it here</div>';
  } else if (key === 'notes') {
    // Notes and tables are one list now; a table note carries the grid icon.
    title = 'Recent Notes'; add = '<button class="nav-add" data-new-note title="New note">+</button>';
    // The 20 most recently viewed notes / table-notes, newest first.
    rows = recentItems().filter((r) => r && (r.kind === 'note' || r.kind === 'table')).slice(0, 20).map((n) => {
      const isT = n.kind === 'table';
      const active = isT ? (v.type === 'table' && state.tables_open && state.tables_open.id === n.id)
        : (v.type === 'note' && state.note && state.note.path[0] && state.note.path[0].id === n.id);
      return sub(active, isT ? `data-open-table="${n.id}"` : `data-open-note="${n.id}"`, isT ? TBL_ICO : NOTE_ICO, n.title);
    }).join('') || '<div class="nav-sub muted">Notes you open appear here</div>';
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
    ${collapsed ? '' : `<div class="nav-sec-body${key === 'favs' ? ' nav-2col' : ''}"${key === 'favs' ? ' id="favs"' : ''}>${rows}</div>`}
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

// ── accent colour (per-user) ──────────────────────────────────────────
// The rusty red is the default; anyone can pick their own. Everything is
// color-mixed from --accent, so overriding --accent (+ --accent-ink for text
// on accent) recolours the whole app. Cached in localStorage for instant paint
// and mirrored to settings (kv_accent) so it follows you across devices.
const ACCENT_PRESETS = [
  ['#c4412e', 'Rust'], ['#c2703a', 'Amber'], ['#3f7d93', 'Teal'],
  ['#5a7d5a', 'Forest'], ['#6b5b95', 'Plum'], ['#4f6d9c', 'Indigo'],
  ['#a8844a', 'Ochre'], ['#9c5a6e', 'Rose'], ['#4a4f57', 'Slate'],
];
function hexRgb(hex) { const h = String(hex || '').replace('#', ''); const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return { r: parseInt(n.slice(0, 2), 16) || 0, g: parseInt(n.slice(2, 4), 16) || 0, b: parseInt(n.slice(4, 6), 16) || 0 }; }
function accentInk(hex) { const { r, g, b } = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#12100b' : '#fff'; }
function applyAccent(hex) {
  const el = document.documentElement.style;
  if (hex && /^#?[0-9a-fA-F]{3,6}$/.test(hex)) { const h = hex[0] === '#' ? hex : '#' + hex; el.setProperty('--accent', h); el.setProperty('--accent-ink', accentInk(h)); }
  else { el.removeProperty('--accent'); el.removeProperty('--accent-ink'); }
}
function savedAccent() { try { return localStorage.getItem('life.accent') || ''; } catch { return ''; } }
async function setAccent(hex) {
  try { hex ? localStorage.setItem('life.accent', hex) : localStorage.removeItem('life.accent'); } catch {}
  applyAccent(hex);
  renderNav();
  if (state.view && state.view.type === 'settings') renderSettings();
  try { await api('/api/kv/accent', { method: 'PUT', body: JSON.stringify({ value: hex || '' }) }); } catch {}
}
async function syncAccentFromServer() {
  try { const r = await api('/api/kv/accent'); const hex = (r && r.value) || ''; if (hex !== savedAccent()) { try { hex ? localStorage.setItem('life.accent', hex) : localStorage.removeItem('life.accent'); } catch {} applyAccent(hex); renderNav(); } } catch {}
}

// ── Settings hub ──────────────────────────────────────────────────────
function openSettings() { state.view = { type: 'settings' }; renderNav(); renderSettings(); loadAccount(); loadInvites(); return Promise.resolve(); }
async function loadAccount() { try { state.account = await api('/api/account'); if (state.view && state.view.type === 'settings') renderSettings(); } catch {} }
async function saveAccount(patch) { try { state.account = await api('/api/account', { method: 'PATCH', body: JSON.stringify(patch) }); } catch (e) { toast(e.message); } }
function aiKeyRow(provider, label, isSet, ph) {
  return `<div class="ai-key-row"><span class="ai-key-l">${label}${isSet ? ' <span class="ai-set">✓ set</span>' : ''}</span>
    <div class="ai-key-in"><input class="sel" type="password" data-ai-key="${provider}" placeholder="${isSet ? '•••••• — enter a new key to replace' : ph}" autocomplete="off" spellcheck="false">
    <button class="add-btn wide" data-ai-key-save="${provider}">Save</button>${isSet ? `<button class="ghost" data-ai-key-clear="${provider}">Clear</button>` : ''}</div></div>`;
}
async function saveAiKey(provider) {
  const el = document.querySelector(`[data-ai-key="${provider}"]`); const value = (el && el.value || '').trim();
  if (!value) { toast('Paste a key first'); return; }
  try { state.account = await api('/api/account/ai-key', { method: 'POST', body: JSON.stringify({ provider, value }) }); renderSettings(); toast('Key saved'); }
  catch (e) { toast(e.message); }
}
async function closeMyAccount() {
  if (state.me && state.me.id === 1) { toast('The owner account cannot be closed here.'); return; }
  if (!(await uiConfirm('Close your account? This permanently deletes your Daybook and everything in it. It cannot be undone.', { danger: true, okLabel: 'Delete everything' }))) return;
  const typed = await uiPrompt('Type DELETE to confirm you want to permanently erase your account.', { title: 'Are you sure?', okLabel: 'Close my account', placeholder: 'DELETE' });
  if ((typed || '').trim().toUpperCase() !== 'DELETE') { toast('Account not closed.'); return; }
  try {
    await api('/api/account/close', { method: 'POST' });
    try { localStorage.clear(); } catch {}
    toast('Your account has been closed.');
    setTimeout(() => { location.href = 'https://daybook.fyi'; }, 900);
  } catch (e) { toast(e.message); }
}
async function clearAiKey(provider) {
  try { state.account = await api('/api/account/ai-key', { method: 'POST', body: JSON.stringify({ provider, value: '' }) }); renderSettings(); toast('Key removed'); }
  catch (e) { toast(e.message); }
}
async function addAlias() {
  const el = $('#alias-input'); const email = (el && el.value || '').trim(); if (!email) return;
  try { state.account = await api('/api/account/alias', { method: 'POST', body: JSON.stringify({ email }) }); state.aliasVerify = email.toLowerCase(); renderSettings(); toast('Code sent — check that inbox'); }
  catch (e) { toast(e.message); }
}
async function verifyAlias(email) {
  const el = document.querySelector(`[data-alias-code="${CSS.escape(email)}"]`); const code = (el && el.value || '').trim(); if (!code) { toast('Enter the code from the email'); return; }
  try { state.account = await api('/api/account/alias/verify', { method: 'POST', body: JSON.stringify({ email, code }) }); state.aliasVerify = null; renderSettings(); toast('Address confirmed'); }
  catch (e) { toast(e.message); }
}
async function resendAlias(email) {
  try { await api('/api/account/alias/resend', { method: 'POST', body: JSON.stringify({ email }) }); state.aliasVerify = email; renderSettings(); toast('New code sent'); }
  catch (e) { toast(e.message); }
}
async function delAlias(email) {
  try { state.account = await api('/api/account/alias', { method: 'DELETE', body: JSON.stringify({ email }) }); if (state.aliasVerify === email) state.aliasVerify = null; renderSettings(); }
  catch (e) { toast(e.message); }
}
async function downloadExport() {
  try {
    const res = await fetch('/api/export', { headers: { Authorization: `Bearer ${localStorage.getItem('today.token')}` } });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `daybook-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Your data is downloading');
  } catch (e) { toast(e.message); }
}
// Sign out of this device. Until now the only sign-out in the app was on the
// signup form - available to someone who had no account yet, and to nobody else.
//
// The token is the session, but it is not all this browser is holding: the mail
// cache, the open tabs (whose labels are note titles), recents, the pomodoro log
// and the saved location are this person's content. On a borrowed or shared
// computer, leaving those behind is the very thing a sign-out is for. So the
// sweep takes everything under life.* plus the token, and keeps only what the
// device chose about how things look - a key added later is cleared by the same
// sweep rather than quietly surviving it.
const SIGNOUT_KEEP = new Set(['life.theme.mode', 'life.accent', 'today.theme']);
async function signOut() {
  if (!(await uiConfirm('Sign out of Daybook on this device? Anything not saved to your account is cleared from this browser.', { title: 'Sign out', okLabel: 'Sign out' }))) return;
  // Push goes first, while the token that authorises it still exists: a device
  // left subscribed would carry on buzzing with this account's mail afterwards.
  try {
    if (pushSupported()) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    }
  } catch {}
  // Object.keys snapshots, so removing while iterating is safe.
  try { for (const k of Object.keys(localStorage)) { if (k === KEY || (k.startsWith('life.') && !SIGNOUT_KEEP.has(k))) localStorage.removeItem(k); } } catch {}
  location.replace('/');
}
async function loadInvites() { try { const r = await api('/api/invites'); state.invites = r.invites || []; if (state.view && (state.view.type === 'settings' || state.view.type === 'admin')) (state.view.type === 'admin' ? renderAdmin : renderSettings)(); } catch {} }
async function cancelInviteAction(code) {
  const inv = (state.invites || []).find((i) => i.code === code);
  const who = inv && inv.email ? inv.email : 'this shareable code';
  if (!(await uiConfirm(`Cancel the invitation for ${who}? Its link and code will stop working.`, { danger: true, okLabel: 'Cancel invite' }))) return;
  try { await api('/api/invites/cancel', { method: 'POST', body: JSON.stringify({ code }) }); state.invites = (state.invites || []).filter((i) => i.code !== code); toast('Invitation cancelled'); (state.view.type === 'admin' ? renderAdmin : renderSettings)(); }
  catch (e) { toast(e.message); }
}
// ── Admin / business dashboard (owner only) ───────────────────────────
async function openAdmin() {
  state.view = { type: 'admin' }; renderNav(); state.admin = state.admin || {}; renderAdmin();
  try {
    const [ov, u, ai, s, q] = await Promise.all([
      api('/api/admin/overview'), api('/api/admin/users'), api('/api/admin/ai-usage'),
      api('/api/admin/settings'), api('/api/admin/quotes'),
    ]);
    state.admin = { ...state.admin, overview: ov, users: u.users || [], aiUsage: ai.usage || [], settings: s, quotes: q.quotes || [] };
  } catch (e) { toast(e.message); }
  if (!state.invites) loadInvites();
  renderAdmin();
}
const admN = (n) => (n || 0).toLocaleString();
const admUSD = (n) => '$' + (n || 0).toFixed(2);
const admTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0));
function adminUserRow(u) {
  const owner = u.id === 1;
  const plans = PLAN_KEYS;
  // The free period (free_until) is editable after signup: grant N months from
  // today, or remove it. The select is an action, so it always sits on its
  // placeholder; the current state reads in the meta line.
  const fu = u.free_until ? new Date(u.free_until) : null;
  const freeActive = fu && fu.getTime() > Date.now();
  const freeOpts = [['1', '1 month'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['24', '24 months']];
  const freeCtl = owner ? '' : `<select class="sel au-free-sel" data-admin-free="${u.id}" title="Grant or change this member's free period"><option value="">Free period…</option>${freeOpts.map(([m, l]) => `<option value="${m}">${l} from today</option>`).join('')}${freeActive ? '<option value="0">Remove free period</option>' : ''}</select>`;
  return `<div class="adm-user ${u.status === 'suspended' ? 'susp' : ''}">
    <div class="adm-user-main"><span class="au-sub">${esc(u.subdomain || '—')}</span><span class="au-email">${esc(u.email)}</span></div>
    <div class="adm-user-meta">${u.aiCalls ? `<span class="au-usage">${admN(u.aiCalls)} AI calls</span> · ` : ''}<span>joined ${esc(fmtDateY(u.created_at))}</span>${u.last_seen ? ` · seen ${esc(fmtDateY(u.last_seen))}` : ''}${freeActive ? ` · <span class="au-free-badge">free until ${esc(fmtDateY(u.free_until))}</span>` : ''}</div>
    <div class="adm-user-acts">${owner ? `<span class="au-plan">${esc(planLabel(u.plan))} · owner</span>`
      : `<select class="sel au-plan-sel" data-admin-plan="${u.id}">${plans.map((p) => `<option value="${p}" ${normPlan(u.plan) === p ? 'selected' : ''}>${PLAN_LABEL[p]}</option>`).join('')}</select>
        ${freeCtl}
        <button class="ghost ${u.status === 'suspended' ? '' : 'acct-danger'}" data-admin-status="${u.id}" data-status="${u.status === 'suspended' ? 'active' : 'suspended'}">${u.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button>`}
    </div>
  </div>`;
}
function renderAdmin() {
  const a = state.admin = state.admin || {};
  const ov = a.overview || {};
  const users = a.users || [];
  const uOv = ov.users || {};
  const ai = ov.ai || {};
  const inv = ov.invites || {};
  const plans = ov.plans || {};
  const pub = a.settings ? a.settings.publicSignup : ov.publicSignup;
  const card = (label, value, sub) => `<div class="adm-card"><div class="adm-card-v">${value}</div><div class="adm-card-l">${label}</div>${sub ? `<div class="adm-card-s">${sub}</div>` : ''}</div>`;
  const planChips = Object.entries(plans).map(([p, n]) => `<span class="adm-plan-chip">${esc(p)} · ${n}</span>`).join('');

  // Admin is five unrelated jobs stacked in one scroll, which on a phone means
  // thumbing past the whole business to reach the quotes. One tab at a time,
  // exactly as Settings does it.
  const TABS = [['overview', 'Overview'], ['members', 'Members'], ['invites', 'Invites'], ['setup', 'Setup'], ['quotes', 'Quotes']];
  if (!TABS.some(([k]) => k === a.tab)) a.tab = 'overview';
  const tab = a.tab;
  const seg = `<div class="seg">${TABS.map(([k, l]) => `<button class="seg-b ${tab === k ? 'on' : ''}" data-adm-tab="${k}">${l}</button>`).join('')}</div>`;

  const overviewPane = `
    <div class="adm-cards">
      ${card('Members', admN(uOv.total), `${uOv.active7 || 0} active this week`)}
      ${card('New members', admN(uOv.new7), `${admN(uOv.new30)} in the last 30 days`)}
      ${card('AI cost this month', admUSD(ai.totalCost), `${admN(ai.calls)} calls${ai.month ? ' · ' + ai.month : ''}`)}
      ${card('Invitations', admN(inv.total), `${inv.unused || 0} still open`)}
    </div>
    ${planChips ? `<div class="adm-plans">${planChips}</div>` : ''}
    ${(a.aiUsage || []).length ? `<div class="home-sec-h" style="margin-top:8px">AI usage · this month</div>
      <div class="admin-list">${a.aiUsage.map((r) => `<div class="admin-row"><span class="au-sub">${esc(r.subdomain || ('user ' + r.userId))}</span><span class="au-email">${admTok(r.inTokens)} in · ${admTok(r.outTokens)} out · ${admN(r.calls)} calls</span><span class="au-plan">${admUSD(r.cost)}</span></div>`).join('')}</div>` : ''}`;

  const membersPane = `<div class="adm-users">${users.map(adminUserRow).join('') || '<div class="home-empty">No members yet.</div>'}</div>`;

  const invitesPane = `<div class="set-card">
      <div class="inv-new"><button class="add-btn wide" data-create-invite>✦ Invite someone</button></div>
      <p class="inv-hint">Put in their email and Daybook sends the invitation - one link, no code for them to type.</p>
      <div class="inv-list">${(state.invites || []).map(inviteRow).join('') || '<div class="home-empty" style="padding:8px 0 0">Nobody invited yet.</div>'}</div>
    </div>`;

  const setupPane = `<div class="set-card">
      <label class="set-mod adm-signup"><span><b>Open registration</b><br><span class="scope">On: anyone can sign up. Off: invite-only (members invite each other, or you).</span></span><input type="checkbox" data-admin-signup ${pub ? 'checked' : ''}></label>
    </div>
    <div class="set-card" style="margin-top:14px">
      <div class="set-row-t">Default life areas</div>
      <p class="home-empty" style="margin:6px 0 14px">Every new account starts with these. Edit a name inline, remove one with ×, or add another. Existing members aren't touched.</p>
      <div class="adm-areas">${(a.settings && a.settings.defaultLifeAreas || []).map((n, i) => `<span class="adm-area-chip"><span class="adm-area-dot" style="--h:${Math.round((210 + i * 137.5) % 360)}"></span><input class="adm-area-in" data-adm-area="${i}" value="${esc(n)}" autocomplete="off"><button class="adm-area-x" data-adm-area-del="${i}" title="Remove">×</button></span>`).join('') || '<span class="sp-cat-empty">None - new accounts start with no life areas.</span>'}</div>
      <div class="adm-area-add"><input class="sel" id="adm-area-new" placeholder="Add a life area…" autocomplete="off"><button class="add-btn wide" data-adm-area-add>Add</button></div>
    </div>`;

  const quotesPane = `<div class="set-card">
      <div class="inv-new"><input class="sel" id="q-text" placeholder="A quote…" autocomplete="off"><input class="sel" id="q-author" placeholder="Author (optional)" autocomplete="off" style="max-width:190px"><button class="add-btn wide" data-quote-add>Add</button></div>
      <div class="admin-quotes">${(a.quotes || []).map((q) => `<div class="admin-row aq-row"><span class="aq-text">${esc(q.text)}</span><span class="aq-author">${esc(q.author || '')}</span><button class="ghost aq-del" data-quote-del="${q.id}" title="Remove">×</button></div>`).join('')}</div>
    </div>`;

  const panes = { overview: overviewPane, members: membersPane, invites: invitesPane, setup: setupPane, quotes: quotesPane };
  const subs = {
    overview: 'Members, usage and what AI is costing',
    members: `${users.length} on Daybook`,
    invites: `${inv.unused || 0} still open`,
    setup: 'Registration & what new accounts start with',
    quotes: `${(a.quotes || []).length} in the pool`,
  };

  $('#pane').innerHTML = `
    ${pageCrumb('Admin')}
    <div class="pane-head home-head"><h1>Admin</h1></div>
    ${seg}
    <section class="home-sec">
      <div class="home-sec-h set-sec-h" style="margin-bottom:14px">${(TABS.find(([k]) => k === tab) || [])[1]}<span class="muted">${esc(subs[tab] || '')}</span></div>
      ${panes[tab] || ''}
    </section>`;
}
async function addQuote() {
  const text = ($('#q-text') || {}).value || ''; const author = ($('#q-author') || {}).value || '';
  if (!text.trim()) return;
  try { await api('/api/admin/quotes', { method: 'POST', body: JSON.stringify({ text, author }) }); const q = await api('/api/admin/quotes'); state.admin.quotes = q.quotes || []; renderAdmin(); toast('Quote added'); }
  catch (e) { toast(e.message); }
}
async function delQuote(id) {
  try { await api(`/api/admin/quotes/${id}`, { method: 'DELETE' }); state.admin.quotes = (state.admin.quotes || []).filter((q) => String(q.id) !== String(id)); renderAdmin(); }
  catch (e) { toast(e.message); }
}
async function toggleAdminSignup(on) {
  try { state.admin.settings = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ publicSignup: on }) }); toast(on ? 'Open registration is ON' : 'Invite-only'); }
  catch (e) { toast(e.message); }
}
// Read the default-life-area names straight from the inputs on the admin page,
// so an inline rename, an add and a delete all funnel through one save.
const adminAreaListFromDom = () => [...document.querySelectorAll('.adm-area-in')].map((i) => i.value.trim()).filter(Boolean);
async function saveDefaultAreas(list) {
  try { state.admin.settings = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ defaultLifeAreas: list }) }); renderAdmin(); }
  catch (e) { toast(e.message); }
}
function adminAreaAdd() {
  const inp = $('#adm-area-new'); const v = (inp && inp.value.trim()) || ''; if (!v) return;
  saveDefaultAreas([...adminAreaListFromDom(), v]);
}
function adminAreaDel(i) { const list = adminAreaListFromDom(); list.splice(Number(i), 1); saveDefaultAreas(list); }
async function setUserPlan(id, plan) {
  try { state.admin.users = (await api(`/api/admin/user/${id}`, { method: 'PATCH', body: JSON.stringify({ plan }) })).users; toast('Plan updated'); }
  catch (e) { toast(e.message); }
}
async function setUserStatus(id, status) {
  if (status === 'suspended' && !(await uiConfirm('Suspend this member? They will be signed out and blocked until reactivated.', { danger: true, okLabel: 'Suspend' }))) return;
  try { state.admin.users = (await api(`/api/admin/user/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })).users; renderAdmin(); toast(status === 'suspended' ? 'Member suspended' : 'Member reactivated'); }
  catch (e) { toast(e.message); }
}
async function setUserFree(id, months) {
  try { state.admin.users = (await api(`/api/admin/user/${id}`, { method: 'PATCH', body: JSON.stringify({ freeMonths: months }) })).users; renderAdmin(); toast(months > 0 ? `Free for ${months} month${months === 1 ? '' : 's'} from today` : 'Free period removed'); }
  catch (e) { toast(e.message); renderAdmin(); }
}
// ── Friends on Daybook ────────────────────────────────────────────────
// Friends merged into Contacts: keep the entry point but land on the unified page.
async function openFriends() { return openContacts(); }
function friendRow(f, action) {
  const n = unreadFrom(f.id);
  return `<div class="friend-row"><span class="fr-av ${f.online ? 'online' : ''}">${esc(initial(f.name || '?'))}</span><span class="fr-body"><span class="fr-name"><span class="fr-nm">${esc(f.name)}</span>${n ? `<span class="fr-unread" title="${n} unread message${n === 1 ? '' : 's'}">${n > 99 ? '99+' : n}</span>` : ''}${f.online ? '<span class="fr-on">online</span>' : ''}</span><span class="fr-sub">${esc(f.subdomain)}.daybook.fyi</span></span>${action}</div>`;
}
// Friends now live inside Contacts; anything that used to re-render the Friends
// page re-renders the unified Contacts view.
function renderFriends() { renderContacts(); }
async function friendAdd(id) { try { state.friends = await api('/api/friends', { method: 'POST', body: JSON.stringify({ id }) }); renderFriends(); toast('Request sent'); } catch (e) { toast(e.message); } }
async function friendAddEmail() {
  const el = $('#friend-email'); const v = (el && el.value || '').trim(); if (!v) return;
  // Only an email address goes straight to a request; a name is ambiguous, so
  // send it to the live search and let them pick the right person.
  if (!v.includes('@')) { peopleSearch(); toast('Pick someone from the results below.'); return; }
  try { state.friends = await api('/api/friends', { method: 'POST', body: JSON.stringify({ email: v }) }); renderFriends(); toast('Request sent'); } catch (e) { toast(e.message); }
}
// Live people-search by name (or handle). Renders into #friend-results without
// re-rendering the whole page, so the input keeps focus while you type.
async function peopleSearch() {
  const el = $('#friend-email'); const box = $('#friend-results'); if (!box) return;
  const q = (el && el.value || '').trim();
  if (q.includes('@') || q.length < 2) { box.innerHTML = ''; return; }
  let people = [];
  try { people = (await api(`/api/friends/search?q=${encodeURIComponent(q)}`)).people || []; } catch {}
  // The input may have changed while the request was in flight; only paint if the
  // query still matches what's typed.
  if (($('#friend-email') || {}).value?.trim() !== q) return;
  box.innerHTML = people.length
    ? `<div class="fr-scan-note">People on Daybook matching &ldquo;${esc(q)}&rdquo;:</div>${people.map((f) => friendRow(f, `<button class="add-btn wide fr-act" data-friend-add="${f.id}">+ Add</button>`)).join('')}`
    : `<div class="home-empty" style="padding:8px 2px">No one on Daybook matches &ldquo;${esc(q)}&rdquo;. Try their email, or invite them from Settings.</div>`;
}
async function friendAccept(id) { try { state.friends = await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ id }) }); renderFriends(); toast('Connected'); } catch (e) { toast(e.message); } }
async function friendRemove(id) { try { state.friends = await api('/api/friends/remove', { method: 'POST', body: JSON.stringify({ id }) }); renderFriends(); } catch (e) { toast(e.message); } }
// Invite someone to Daybook: their email, a note in your own words, Send. The
// worker emails the invitation with a one-click link - the invitee never copies a
// code anywhere. Leave the email blank and it just mints a code to share by hand.
// One dialog behind every entry point (Contacts, Settings, Admin) so there is a
// single way to do this.
function inviteToDaybook(prefill) {
  const owner = !!(state.me && state.me.id === 1);
  const el = uiDialogHost();
  el.innerHTML = `<div class="pal-bg"><div class="recur-dialog ui-dialog-box inv-dialog">
    <div class="recur-h">Invite someone to Daybook</div>
    <p class="recur-p">They get an email with a one-click link. No code to type, nothing to set up first.</p>
    <label class="inv-f"><span>Their email</span>
      <input class="ui-dialog-input" id="inv-d-email" type="email" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="name@example.com" value="${esc(prefill || '')}" autocomplete="off"></label>
    <label class="inv-f"><span>A note from you <em>optional</em></span>
      <textarea class="ui-dialog-input inv-d-msg" id="inv-d-msg" rows="3" placeholder="Thought you'd like this - it's how I run my day."></textarea></label>
    ${owner ? `<div class="inv-d-owner">
      <label class="inv-f"><span>Plan</span><select class="sel" id="inv-d-plan"><option value="byok">Premium · €6</option><option value="managed">Premium Plus · €13</option></select></label>
      <label class="inv-free"><input type="checkbox" id="inv-d-free"> Free of charge (100% off)</label>
      <label class="inv-f inv-d-period" id="inv-d-period-wrap" hidden><span>Free for</span><select class="sel" id="inv-d-period"><option value="">No limit</option><option value="3">3 months</option><option value="6">6 months</option><option value="12">1 year</option></select></label></div>` : ''}
    <p class="inv-d-hint">No email? Leave it blank and we'll just make you a code to pass on.</p>
    <p class="gate2-err inv-d-err" id="inv-d-err" hidden></p>
    <div class="ui-dialog-btns">
      <button class="ui-btn cancel" data-ud="0">Cancel</button>
      <button class="ui-btn primary" data-ud="1" id="inv-d-ok">Send invitation</button>
    </div></div></div>`;
  const emailIn = el.querySelector('#inv-d-email');
  const errEl = el.querySelector('#inv-d-err');
  const ok = el.querySelector('#inv-d-ok');
  const close = () => { el.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const syncBtn = () => { ok.textContent = emailIn.value.trim() ? 'Send invitation' : 'Create a code'; };
  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; ok.disabled = false; };
  // The free-period picker only makes sense on a free-of-charge invite.
  const freeCb = el.querySelector('#inv-d-free'), periodWrap = el.querySelector('#inv-d-period-wrap');
  if (freeCb && periodWrap) freeCb.addEventListener('change', () => { periodWrap.hidden = !freeCb.checked; });
  async function send() {
    const email = emailIn.value.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('That does not look like an email address.');
    errEl.hidden = true; ok.disabled = true;
    const body = { email, message: (el.querySelector('#inv-d-msg').value || '').trim().slice(0, 600) };
    if (owner) { body.plan = el.querySelector('#inv-d-plan').value; const free = el.querySelector('#inv-d-free').checked; body.free = free ? 1 : 0; if (free) { const m = Number(el.querySelector('#inv-d-period').value); if (m) body.freeMonths = m; } }
    try {
      const r = await api('/api/invites', { method: 'POST', body: JSON.stringify(body) });
      close();
      await loadInvites();
      if (r.sent) toast(`Invitation sent to ${r.email}`);
      // The invite exists even when the send failed, so hand its link over
      // rather than losing it to an error toast.
      else if (r.email) copyJoinLink(r.link, `Invite made, but the email didn't send (${r.sendError || 'unknown error'}). Its link is copied - send it yourself.`);
      else copyJoinLink(r.link, 'Invite link copied - share it with anyone');
    } catch (e) { fail(e.message); }
  }
  document.addEventListener('keydown', onKey, true);
  emailIn.addEventListener('input', syncBtn);
  el.querySelector('.pal-bg').addEventListener('click', (e) => { if (e.target.classList.contains('pal-bg')) close(); });
  el.querySelectorAll('[data-ud]').forEach((b) => b.addEventListener('click', () => (b.dataset.ud === '1' ? send() : close())));
  syncBtn();
  setTimeout(() => { emailIn.focus(); emailIn.select(); }, 20);
}
async function copyJoinLink(link, msg) {
  try { await navigator.clipboard.writeText(link); toast(msg); }
  catch { await uiPrompt('Send them this link:', { title: 'Invitation link', value: link, okLabel: 'Done' }); }
}
async function resendInvitation(code) {
  try { const r = await api('/api/invites/resend', { method: 'POST', body: JSON.stringify({ code }) }); toast(`Invitation re-sent to ${r.email}`); }
  catch (e) { toast(e.message); }
}
function startPresence() { const beat = () => api('/api/presence', { method: 'POST' }).catch(() => {}); beat(); setInterval(beat, 60000); }
// The Contacts badge is a genuine notification: the number of people waiting for
// you to accept their invitation to connect. It is NOT a running total of your
// contacts (that just looked like an unread count sitting on the button). Unread
// chat and the online list still feed Home's "People" section, not this badge.
const friendPending = () => ((state.friendStatus || {}).incoming || 0) + ((state.friendStatus || {}).unread || 0);
// Unread messages from one person, for the badge on their row.
const unreadFrom = (id) => (((state.friendStatus || {}).unreadBy) || {})[id] || 0;
async function refreshFriendStatus() {
  try {
    const r = await api('/api/friends/status');
    const sig = JSON.stringify([r.incoming || 0, r.unread || 0, r.unreadBy || {}, (r.online || []).map((o) => o.id).sort()]);
    const changed = sig !== state.__friendSig; state.__friendSig = sig;
    state.friendStatus = { incoming: r.incoming || 0, online: r.online || [], unread: r.unread || 0, unreadBy: r.unreadBy || {}, friends: r.friends || 0 };
    renderNav();
    // Refresh Home's People section on a real change - but never while the user is
    // typing (e.g. in the notepad), which a full re-render would interrupt.
    const ae = document.activeElement; const editing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (changed && state.view && state.view.type === 'home' && !editing) renderHome();
  } catch {}
}
function startFriendStatusPoll() {
  if (window.__friendStatusT) return;
  refreshFriendStatus();
  window.__friendStatusT = setInterval(() => { if (!document.hidden) refreshFriendStatus(); }, 90000);
}
// Home "People" section: whether it shows, and its contents (who's online + a
// nudge when someone wants to connect). Toggle lives in Settings → Appearance.
const peopleOn = () => { try { return localStorage.getItem('life.home.people') !== '0'; } catch { return true; } };
function peopleHtml() {
  const st = state.friendStatus;
  if (!st) { refreshFriendStatus(); return '<div class="home-empty" style="padding:6px 0">Loading…</div>'; }
  const online = st.online || []; const pending = st.incoming || 0;
  let html = '';
  if (pending) html += `<button class="people-nudge" data-open-contacts>👋 ${pending} ${pending === 1 ? 'person wants' : 'people want'} to connect</button>`;
  if (online.length) {
    html += `<div class="people-list">${online.map((f) => `<button class="people-row" data-friend-chat="${f.id}" data-friend-name="${esc(f.name)}" title="Message ${esc(f.name)}"><span class="fr-av online">${esc(initial(f.name || '?'))}</span><span class="people-name">${esc(f.name)}</span><span class="people-msg">💬</span></button>`).join('')}</div>`;
  } else if (!pending) {
    html += '<div class="home-empty">No one online right now. <button class="people-link" data-open-contacts>Open Contacts</button></div>';
  }
  return html;
}
// Chat with a friend: a slide-in panel that polls for new messages while open.
let chatPoll = null;
async function openChat(id, name) {
  state.chat = { with: Number(id), name, messages: [] };
  renderChat(); await loadChat();
  if (chatPoll) clearInterval(chatPoll);
  // Paused while the tab is in the background: a 4s poll running behind a phone's
  // lock screen is a battery cost for nothing. Reading the chat marks it read on
  // the server, so the badge clears as the poll runs.
  chatPoll = setInterval(() => {
    if (!state.chat) { clearInterval(chatPoll); chatPoll = null; return; }
    if (!document.hidden) loadChat();
  }, 4000);
}
async function loadChat() {
  if (!state.chat) return;
  const to = state.chat.with;
  // getMessages marks them read on the server; mirror that locally so the badge
  // drops the moment you open the chat, not at the next 90s status poll.
  if (state.friendStatus && unreadFrom(to)) {
    state.friendStatus.unread = Math.max(0, state.friendStatus.unread - unreadFrom(to));
    delete state.friendStatus.unreadBy[to];
    renderNav();
  }
  try {
    const r = await api(`/api/messages?with=${to}`);
    if (!state.chat || state.chat.with !== to) return;   // switched chats mid-request
    // Compare the content, not the count. A count misses a message that arrives in
    // the same poll as one being removed, and it can't see a message change at all.
    const sig = (list) => (list || []).map((m) => `${m.id || ''}:${m.body}`).join('\u0000');
    if (sig(r.messages) !== sig(state.chat.messages)) { state.chat.messages = r.messages; renderChatMessages(); }
  } catch {}
}
function renderChat() {
  let el = document.getElementById('chat'); if (!el) { el = document.createElement('div'); el.id = 'chat'; document.body.appendChild(el); }
  const c = state.chat;
  el.innerHTML = `<div class="chat-bg" data-chat-close></div><div class="chat-panel">
    <div class="chat-head"><span class="chat-title">${esc(c.name)}</span><button class="chat-x" data-chat-close title="Close">×</button></div>
    <div class="chat-msgs" id="chat-msgs"></div>
    <form class="chat-form" id="chat-form"><input class="chat-input" id="chat-input" placeholder="Message ${esc(c.name)}…" autocomplete="off"><button class="chat-send" type="submit">Send</button></form>
  </div>`;
  renderChatMessages();
  const f = document.getElementById('chat-form'); if (f) f.addEventListener('submit', sendChat);
  // Focus the box on a desktop, but never on a phone: focusing raises the keyboard
  // over the conversation before you've had a chance to read a word of it.
  const inp = document.getElementById('chat-input');
  if (inp && !window.matchMedia('(max-width:820px)').matches) inp.focus();
}
function renderChatMessages() {
  const box = document.getElementById('chat-msgs'); if (!box || !state.chat) return;
  // Whether we were already at the bottom BEFORE the repaint. Scroll down only if
  // we were: someone reading back through the history shouldn't be dragged to the
  // end every time the 4s poll finds a new message.
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = state.chat.messages.map((m) => `<div class="chat-msg ${m.mine ? 'mine' : ''}${m.pending ? ' pending' : ''}"><span class="cm-body">${esc(m.body)}</span></div>`).join('') || '<div class="chat-empty">Say hello 👋</div>';
  if (atEnd) box.scrollTop = box.scrollHeight;
}
async function sendChat(e) {
  if (e) e.preventDefault();
  const inp = document.getElementById('chat-input'); const body = (inp && inp.value || '').trim(); if (!body || !state.chat) return;
  const to = state.chat.with;
  inp.value = '';
  // Show it immediately. A phone on a weak signal takes seconds to round-trip,
  // and a message that vanishes on send reads as a broken app - people retype it
  // and send twice. The pending copy is replaced by the server's list on success.
  const pending = { body, mine: true, pending: true, id: 'pending-' + Date.now() };
  state.chat.messages = [...state.chat.messages, pending];
  renderChatMessages();
  try {
    const r = await api('/api/messages', { method: 'POST', body: JSON.stringify({ to, body }) });
    if (!state.chat || state.chat.with !== to) return;   // they closed it, or opened someone else
    state.chat.messages = r.messages; renderChatMessages();
  } catch (err) {
    // Put the text back in the box rather than losing it to a toast. Typing it
    // out again is the last thing anyone wants after a failed send.
    if (state.chat && state.chat.with === to) {
      state.chat.messages = state.chat.messages.filter((m) => m !== pending);
      renderChatMessages();
      const box = document.getElementById('chat-input');
      if (box && !box.value.trim()) { box.value = body; box.focus(); }
    }
    toast(err.message || 'Message not sent - it is back in the box.');
  }
}
function closeChat() { if (chatPoll) { clearInterval(chatPoll); chatPoll = null; } const el = document.getElementById('chat'); if (el) el.remove(); state.chat = null; }
// ── Sharing a note/task with friends (Friends phase 3a) ───────────────
async function openShare(id, title, kind) {
  state.share = { id, title, kind, friends: (state.friends && state.friends.friends) || [], shares: [], loading: true };
  renderShare();
  try {
    const [fr, sh] = await Promise.all([api('/api/friends'), api(`/api/blocks/${id}/shares`)]);
    state.friends = fr; state.share.friends = fr.friends || []; state.share.shares = sh.shares || [];
  } catch (e) { toast(e.message); }
  state.share.loading = false; renderShare();
}
function shareModeFor(fid) { const s = (state.share.shares || []).find((x) => x.id === fid); return s ? (s.canEdit ? 'edit' : 'view') : ''; }
function renderShare() {
  let el = document.getElementById('share'); if (!el) { el = document.createElement('div'); el.id = 'share'; document.body.appendChild(el); }
  const s = state.share; const friends = s.friends || [];
  const rows = s.loading ? '<div class="chat-empty">Loading…</div>'
    : (friends.length ? friends.map((f) => {
      const mode = shareModeFor(f.id);
      return `<div class="share-row"><span class="fr-av ${f.online ? 'online' : ''}">${esc(initial(f.name || '?'))}</span><span class="fr-body"><span class="fr-name">${esc(f.name)}</span><span class="fr-sub">${esc(f.subdomain)}.daybook.fyi</span></span>${mode
        ? `<span class="share-acts"><select class="sel share-mode" data-share-mode="${f.id}"><option value="edit" ${mode === 'edit' ? 'selected' : ''}>Can edit</option><option value="view" ${mode === 'view' ? 'selected' : ''}>View only</option></select><button class="ghost share-off" data-share-off="${f.id}" title="Stop sharing">×</button></span>`
        : `<button class="add-btn wide" data-share-on="${f.id}">Share</button>`}</div>`;
    }).join('') : `<div class="share-empty">
        <p>You're not connected with anyone on Daybook yet.</p>
        <p class="onb-muted">Invite someone, then you can share this with them - and anything else you like.</p>
        <button class="add-btn wide" data-share-invite>✦ Invite a friend</button>
      </div>`);
  const kindLabel = s.kind === 'task' ? 'task' : s.kind === 'table' ? 'table' : s.kind === 'area' ? 'life area' : 'note';
  el.innerHTML = `<div class="chat-bg" data-share-close></div><div class="chat-panel share-panel">
    <div class="chat-head"><span class="chat-title">Share this ${kindLabel}</span><button class="chat-x" data-share-close title="Close">×</button></div>
    <div class="share-note">People you share with can open and edit it. Switch anyone to view-only, or stop sharing anytime.</div>
    <div class="share-list">${rows}</div>
  </div>`;
}
async function shareSet(fid, canEdit) { try { const r = await api(`/api/blocks/${state.share.id}/share`, { method: 'POST', body: JSON.stringify({ friendId: fid, canEdit }) }); state.share.shares = r.shares; renderShare(); } catch (e) { toast(e.message); } }
async function shareOff(fid) { try { const r = await api(`/api/blocks/${state.share.id}/share`, { method: 'DELETE', body: JSON.stringify({ friendId: fid }) }); state.share.shares = r.shares; renderShare(); } catch (e) { toast(e.message); } }
function closeShare() { const el = document.getElementById('share'); if (el) el.remove(); state.share = null; }
// ── Assigning a task to a friend (Friends phase 3b) ───────────────────
async function openAssign(id, title) {
  state.assign = { id, title, friends: (state.friends && state.friends.friends) || [], assignees: [], loading: true };
  renderAssign();
  try {
    const [fr, as] = await Promise.all([api('/api/friends'), api(`/api/tasks/${id}/assignees`)]);
    state.friends = fr; state.assign.friends = fr.friends || []; state.assign.assignees = as.assignees || [];
  } catch (e) { toast(e.message); }
  state.assign.loading = false; renderAssign();
}
function assignStatusFor(fid) { const a = (state.assign.assignees || []).find((x) => x.id === fid); return a ? a.status : ''; }
function renderAssign() {
  let el = document.getElementById('assign'); if (!el) { el = document.createElement('div'); el.id = 'assign'; document.body.appendChild(el); }
  const s = state.assign; const friends = s.friends || [];
  const rows = s.loading ? '<div class="chat-empty">Loading…</div>'
    : (friends.length ? friends.map((f) => {
      const st = assignStatusFor(f.id);
      return `<div class="share-row"><span class="fr-av ${f.online ? 'online' : ''}">${esc(initial(f.name || '?'))}</span><span class="fr-body"><span class="fr-name">${esc(f.name)}</span><span class="fr-sub">${esc(f.subdomain)}.daybook.fyi</span></span>${st
        ? `<span class="share-acts"><span class="assign-status ${st}">${st === 'accepted' ? '✓ Accepted' : 'Pending'}</span><button class="ghost share-off" data-assign-off="${f.id}" title="Unassign">×</button></span>`
        : `<button class="add-btn wide" data-assign-on="${f.id}">Assign</button>`}</div>`;
    }).join('') : '<div class="home-empty">Add a friend first, then you can assign tasks to them.</div>');
  el.innerHTML = `<div class="chat-bg" data-assign-close></div><div class="chat-panel share-panel">
    <div class="chat-head"><span class="chat-title">Assign this task</span><button class="chat-x" data-assign-close title="Close">×</button></div>
    <div class="share-note">They get a request; once they accept, it becomes a shared task and ticking it off stays in sync for both of you.</div>
    <div class="share-list">${rows}</div>
  </div>`;
}
async function assignTo(fid) { try { const r = await api(`/api/tasks/${state.assign.id}/assign`, { method: 'POST', body: JSON.stringify({ toId: fid }) }); state.assign.assignees = r.assignees; renderAssign(); toast('Assigned - waiting for them to accept'); } catch (e) { toast(e.message); } }
async function unassignFrom(fid) { try { const r = await api(`/api/tasks/${state.assign.id}/assign`, { method: 'DELETE', body: JSON.stringify({ toId: fid }) }); state.assign.assignees = r.assignees; renderAssign(); } catch (e) { toast(e.message); } }
function closeAssign() { const el = document.getElementById('assign'); if (el) el.remove(); state.assign = null; if (state.view && state.view.type === 'taskcard') openTaskCard(state.view.id); }
async function acceptAssign(taskId) { try { state.assignments = await api('/api/assignments/accept', { method: 'POST', body: JSON.stringify({ taskId }) }); toast('Accepted - it\'s in your tasks now'); if (state.view && state.view.type === 'tasks') { await openTasks(); } } catch (e) { toast(e.message); } }
async function declineAssign(taskId) { try { state.assignments = await api('/api/assignments/decline', { method: 'POST', body: JSON.stringify({ taskId }) }); if (state.view && state.view.type === 'tasks') renderTasks(); } catch (e) { toast(e.message); } }
// Open (or create) the shared meeting note for a friend, then show it. It's a
// normal shared note, so the live-sync poll in openNote keeps both sides in step.
async function openMeetingNote(friendId) {
  try { const r = await api('/api/meeting', { method: 'POST', body: JSON.stringify({ friendId }) }); if (r.created) toast('Shared notes started - take them together'); await openNote(r.noteId); }
  catch (e) { toast(e.message); }
}
// Live-ish sync for a shared note: poll the block, and when the other side has
// changed it, reload - unless you're mid-edit, in which case wait and flag it so
// your typing is never clobbered.
let notePoll = null;
function stopNotePoll() { if (notePoll) { clearInterval(notePoll); notePoll = null; } const p = document.getElementById('note-remote-pill'); if (p) p.remove(); }
function startNotePoll(id) {
  stopNotePoll();
  notePoll = setInterval(async () => {
    if (!state.note || !state.note.current || state.note.current.id !== id || !state.view || state.view.type !== 'note') { stopNotePoll(); return; }
    let latest; try { latest = await api(`/api/blocks/${id}`); } catch { return; }
    if (!latest || !latest.updated_at || latest.updated_at <= (state.note.current.updated_at || '')) return;
    const prose = document.querySelector(`.note-body .prose[data-block-id="${id}"]`);
    const editing = prose && (document.activeElement === prose || prose.contains(document.activeElement));
    if (editing) { showNotePill(latest.sharedBy || 'Your co-editor'); return; }
    state.note.current = latest; renderNote();
  }, 5000);
}
function showNotePill(name) {
  if (document.getElementById('note-remote-pill')) return;
  const host = document.querySelector('.note-main'); if (!host) return;
  const pill = document.createElement('div'); pill.id = 'note-remote-pill'; pill.className = 'note-remote-pill';
  pill.textContent = `✎ ${name} is editing - new changes appear when you pause.`;
  host.prepend(pill);
}
// Tick a task I don't own but can edit (an accepted assignment / shared task):
// write straight to the shared block, so the owner sees the same status.
async function sharedToggleDone(id, done) {
  try {
    await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { done } }) });
    if (modOn('friends')) { try { state.assignments = await api('/api/assignments'); } catch {} }
    if (state.view && state.view.type === 'taskcard' && state.view.id === id) openTaskCard(id);
    else if (state.view && state.view.type === 'tasks') renderTasks();
  } catch (e) { toast(e.message); }
}
// Who it went to leads, not the code: an invitation is a person you're waiting on.
const freePeriodLabel = (m) => (Number(m) === 12 ? '1 year' : `${m} months`);
const invitePlanLabel = (i) => (i.free ? `free ${esc(planLabel(i.plan || 'byok'))}${i.free_months ? ' for ' + freePeriodLabel(i.free_months) : ''}` : esc(planLabel(i.plan || 'byok')));
const inviteRow = (i) => `<div class="inv-row ${i.used_by ? 'used' : ''}">
  <span class="inv-who">${i.email ? `<b>${esc(i.email)}</b>` : '<b>Shareable code</b>'}<span class="inv-meta">${esc(i.code)} · ${invitePlanLabel(i)} · ${i.used_by ? 'joined' : i.email ? 'invitation sent' : 'not used yet'}</span></span>
  ${i.used_by ? '' : `<span class="inv-acts">${i.email ? `<button class="ghost inv-copy" data-invite-resend="${esc(i.code)}" title="Send the invitation again">Re-send</button>` : ''}<button class="ghost inv-copy" data-copy-invite="${esc(i.code)}" title="Copy a one-click join link">🔗 Link</button><button class="ghost inv-cancel" data-cancel-invite="${esc(i.code)}" title="Cancel this invitation">Cancel</button></span>`}
</div>`;
// Where AI actually gets used across Daybook, and which model powers each - so
// the AI settings and the onboarding guide can say plainly what a key is for.
const AI_USES = [
  ['Reflection', 'gentle coaching and a "Dig deeper" question while you journal', 'Claude'],
  ['Email Scribe', 'drafts replies to your emails in your own voice', 'Claude'],
  ['Money advice', 'sums up what the channels you follow are saying', 'Gemini'],
  ['Statement import', 'turns a pasted bank statement into tidy transactions', 'Gemini'],
];
const aiUsesHtml = () => `<ul class="ai-uses">${AI_USES.map(([f, why, prov]) =>
  `<li><span class="ai-use-f">${f}</span><span class="ai-use-why">${why}</span><span class="ai-use-prov ai-use-${prov.toLowerCase()}">${prov}</span></li>`).join('')}</ul>`;
// Reusable Gmail app-password guidance. A normal Google password won't work over
// IMAP - this is the single biggest thing that trips people up, so spell it out
// with the exact links.
const GMAIL_APP_PW = `<b>Gmail needs a one-time App Password</b> - not your normal password:
  <ol class="gpw-steps">
    <li>Turn on <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener">2-Step Verification</a> (required before app passwords appear).</li>
    <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Google App passwords</a>, type <b>Daybook</b>, and press Create.</li>
    <li>Copy the 16-character code Google shows and paste it as the password below (spaces don't matter).</li>
  </ol>`;
// ── Mobile Home layout ────────────────────────────────────────────────
// Everything after the tool buttons on mobile Home can be reordered and hidden
// from Settings → Mobile. Today and the tool buttons stay pinned at the top.
// key -> [section class, display name]. Order here is the default arrangement.
const MOBILE_SECTIONS = [
  ['priority', 'home-sec-p1', 'Priority Tasks'],
  ['focus', 'home-sec-focus', "This quarter's focus"],
  ['notepad', 'home-sec-notepad', 'Notepad'],
  ['favs', 'home-sec-favs', 'Starred Notes & Tables'],
  ['favareas', 'home-sec-favareas', 'Life areas'],
  ['recent', 'home-sec-recent', 'Recently viewed'],
  ['keepintouch', 'home-sec-kit', 'Keep in touch'],
  ['people', 'home-sec-people', 'People online'],
  ['toolbox', 'home-toolbox', 'Toolbox'],
];
const MOBILE_KEYS = MOBILE_SECTIONS.map((s) => s[0]);
const MSEC_CLASS = Object.fromEntries(MOBILE_SECTIONS.map((s) => [s[0], s[1]]));
const MSEC_NAME = Object.fromEntries(MOBILE_SECTIONS.map((s) => [s[0], s[2]]));
function mobileHomeCfg() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('life.home.mobile') || '{}') || {}; } catch {}
  let order = Array.isArray(cfg.order) ? cfg.order.filter((k) => MOBILE_KEYS.includes(k)) : [];
  // Append any keys not yet in the saved order (e.g. a new section shipped later).
  order = [...order, ...MOBILE_KEYS.filter((k) => !order.includes(k))];
  const hidden = Array.isArray(cfg.hidden) ? cfg.hidden.filter((k) => MOBILE_KEYS.includes(k)) : [];
  return { order, hidden };
}
function saveMobileHomeCfg(cfg) {
  const val = JSON.stringify({ order: cfg.order, hidden: cfg.hidden });
  try { localStorage.setItem('life.home.mobile', val); } catch {}
  api('/api/kv/home_mobile', { method: 'PUT', body: JSON.stringify({ value: val }) }).catch(() => {});
}
// Apply the saved arrangement to the live Home DOM. Inline `order` only bites on
// mobile (where the sections are flex children); on desktop they're block flow in
// their column, so it's ignored. `mob-hide` hides on mobile only (see the CSS).
function applyMobileHomeOrder() {
  const cfg = mobileHomeCfg(); const hidden = new Set(cfg.hidden);
  cfg.order.forEach((key, i) => { const el = document.querySelector('.' + MSEC_CLASS[key]); if (el) el.style.order = String(3 + i); });
  MOBILE_SECTIONS.forEach(([key, cls]) => { const el = document.querySelector('.' + cls); if (el) el.classList.toggle('mob-hide', hidden.has(key)); });
}
function mobileSettingsHtml() {
  const cfg = mobileHomeCfg(); const hidden = new Set(cfg.hidden);
  const rows = cfg.order.map((key) => `<div class="msec-row" data-msec="${key}">
    <button type="button" class="msec-grip" data-msec-grip="${key}" title="Drag to reorder" aria-label="Drag to reorder">⠿</button>
    <span class="msec-name">${esc(MSEC_NAME[key])}</span>
    <label class="switch msec-switch" title="Show on mobile Home"><input type="checkbox" data-msec-show="${key}" ${hidden.has(key) ? '' : 'checked'}><span class="switch-sl"></span></label>
  </div>`).join('');
  return `<div class="set-card">
    <div class="set-row-t">Your mobile Home</div>
    <div class="set-row-s"><b>Today</b> and the <b>tool buttons</b> stay pinned at the top. Everything below can be dragged into the order you like, and switched off if you'd rather not see it on your phone.</div>
    <div class="msec-list" id="msec-list">${rows}</div>
  </div>`;
}
function renderSettings() {
  const cur = (savedAccent() || '#c4412e').toLowerCase();
  const swatches = ACCENT_PRESETS.map(([hex, name]) =>
    `<button class="acc-swatch ${cur === hex.toLowerCase() ? 'on' : ''}" style="--sw:${hex}" data-accent="${hex}" title="${name}"><span class="acc-dot"></span><span class="acc-name">${name}</span></button>`).join('');
  state.settings = state.settings || {};
  // The management tiles (Life areas, Mail accounts, ...) each open a small
  // subpage; they live together under the Manage tab.
  const tiles = [
    ['◈', 'Life areas', 'What your Daybook orbits', 'data-open-areas=""'],
    ['✉', 'Mail accounts', 'Inboxes you send &amp; receive from', 'data-open-mailaccounts=""'],
    ['🧘', 'Practices', 'Activities you want to repeat, shared with the Today tool', 'data-open-practices=""'],
    ['💰', 'Spending categories', 'Add, rename &amp; organise', 'data-open-spendcats=""'],
    ['🎯', 'Reviews &amp; reminders', 'Cadence, P1 nudges &amp; SMS', 'data-open-reviews=""'],
    ['☀', 'Time streams', 'Your Today lanes &amp; targets', 'data-open-today=""'],
  ];
  if (state.me && state.me.id === 1) tiles.push(['🛠', 'Admin', 'Members, invitations &amp; quotes', 'data-open-admin=""']);
  // Account and Appearance lead. Each section is its own tab rather than a long
  // collapsing scroll, so the settings you reach for most are one tap in.
  const TABS = [
    ['account', 'Account'],
    ['ai', 'Plan'],
    ['appearance', 'Appearance'],
    ['mobile', 'Mobile'],
    ['notifications', 'Notifications'],
    ['sections', 'Tools'],
    ['invites', 'Invites'],
    ['manage', 'Manage'],
  ];
  if (!TABS.some(([k]) => k === state.settings.tab)) state.settings.tab = 'account';
  const tab = state.settings.tab;
  const seg = `<div class="seg">${TABS.map(([k, l]) => `<button class="seg-b ${tab === k ? 'on' : ''}" data-set-tab="${k}">${l}</button>`).join('')}</div>`;

  const accountPane = state.account ? `<div class="set-card set-account">
        <label class="set-field"><span>Full name</span><input class="sel" data-account-name value="${esc(state.account.name || '')}" placeholder="Your full name"></label>
        <label class="set-field"><span>Username</span>
          <div class="su-username-row"><input class="sel su-username-in" data-account-username value="${esc(state.account.subdomain || '')}" placeholder="username" autocomplete="off" spellcheck="false"><span class="su-username-suffix">.daybook.fyi</span></div>
          <div class="su-username-note">Your Daybook lives at <b><span class="js-username-preview">${esc(state.account.subdomain || 'username')}</span>.daybook.fyi</b></div>
        </label>
        <label class="set-field"><span>Primary email</span><input class="sel" value="${esc(state.account.email || '')}" disabled></label>
        <div class="set-field"><span>Also sign in with these addresses</span>
          <div class="alias-list">${(state.account.aliases || []).map((a) => {
            const em = typeof a === 'string' ? a : a.email; const ok = typeof a === 'object' && a.verified;
            return `<span class="alias-chip ${ok ? 'ok' : 'pending'}"><span class="alias-badge" title="${ok ? 'Confirmed' : 'Awaiting confirmation'}">${ok ? '✓' : '⏳'}</span>${esc(em)}<button class="alias-x" data-alias-del="${esc(em)}" title="Remove">×</button></span>`;
          }).join('') || '<span class="muted" style="font-size:14px">No extra addresses yet.</span>'}</div>
          ${(state.account.aliases || []).filter((a) => typeof a === 'object' && !a.verified).map((a) => `<div class="alias-verify"><span class="av-note">Enter the code we emailed to <b>${esc(a.email)}</b>:</span><div class="alias-verify-row"><input class="sel" data-alias-code="${esc(a.email)}" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="off"><button class="add-btn wide" data-alias-verify="${esc(a.email)}">Confirm</button><button class="ghost" data-alias-resend="${esc(a.email)}">Resend</button></div></div>`).join('')}
          <div class="alias-add"><input class="sel" id="alias-input" placeholder="add another email…" autocomplete="off" spellcheck="false"><button class="add-btn wide" data-alias-add>Add</button></div>
        </div>
        ${(() => { const ph = splitPhone(state.account.phone); return `<label class="set-field"><span>Phone</span><span class="acct-phone"><input class="sel acct-phone-cc" type="tel" list="cc-dial-list" value="${esc(ph.cc)}" placeholder="+351" title="Country - type a name or code" autocomplete="off"><input class="sel acct-phone-num" type="tel" value="${esc(ph.number)}" placeholder="211 234 400" autocomplete="off"></span></label>${ccDatalist()}`; })()}
        <div class="acct-actions"><button class="ghost" data-onb-replay>✦ Replay the welcome guide</button><button class="ghost" data-account-export>⬇ Download your data</button><button class="ghost" data-account-signout>↪ Sign out</button><button class="ghost acct-danger" data-account-close>Close account…</button></div>
      </div>` : '<div class="home-empty" style="padding:8px 0 0">Loading your account…</div>';

  const appearancePane = `<div class="set-card">
        <div class="set-row"><div><div class="set-row-t">Theme</div><div class="set-row-s">Auto follows your local sunrise &amp; sunset.</div></div><button class="add-btn wide" data-theme-toggle>${themeLabel()}</button></div>
        <div class="set-block"><div class="set-row-t">Accent colour</div><div class="set-row-s">Recolours the whole app. Pick one, or choose your own.</div>
          <div class="acc-swatches">${swatches}</div>
          <div class="acc-custom"><label class="acc-custom-l">Your own<input type="color" class="acc-color" value="${esc(savedAccent() || '#c4412e')}" data-accent-custom></label>${savedAccent() ? '<button class="ghost" data-accent="">Reset to default</button>' : ''}</div>
        </div>
        ${state.account ? `<label class="set-mod"><span>Daily inspirational quote<small>One quote a day on Home, Today and the morning email</small></span><input type="checkbox" data-account-quote ${state.account.dailyQuote !== false ? 'checked' : ''}></label>` : ''}
        ${modOn('contacts') ? `<label class="set-mod"><span>People on Home<small>Show who's online in the Home sidebar, and a nudge when someone wants to connect. Switch off to hide and pause it.</small></span><input type="checkbox" data-people-toggle ${peopleOn() ? 'checked' : ''}></label>` : ''}
      </div>`;

  const aiPane = state.account ? (() => {
    const a = state.account;
    const plan = (a.plan || 'free').toLowerCase();
    // The managed tier (Premium Plus): the owner and anyone on it run on our
    // built-in keys. Everyone else brings their own.
    const managed = a.isOwner || isManagedPlan(plan);
    const badge = (on) => on ? '<span class="plan-badge">Your plan</span>' : '';
    return `<div class="set-card">
        <label class="set-mod"><span>Use AI features<small>Turn every AI feature on or off across Daybook.</small></span><input type="checkbox" data-account-ai ${a.aiOff ? '' : 'checked'}></label>
        <div class="set-row-t" style="margin-top:16px">What the AI powers</div>
        ${aiUsesHtml()}
      </div>
      <div class="set-row-t" style="margin:22px 0 4px">Two ways to run it</div>
      <div class="plan-cards ${a.aiOff ? 'ai-disabled' : ''}">
        <div class="plan-card ${managed ? '' : 'on'}">
          <div class="plan-h"><b>Bring your own keys</b>${badge(!managed)}</div>
          <div class="plan-price">Free &amp; Premium</div>
          <p class="plan-desc">Plug in your own keys and you control the cost. <b>Gemini</b> has a genuinely free tier; <b>Claude</b> is pay-as-you-go, usually a few pennies.</p>
          ${aiKeyRow('anthropic', 'Claude (Anthropic) &middot; Reflection &amp; Email Scribe', a.aiAnthropicSet, 'sk-ant-…')}
          <a class="ai-get" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Get a Claude key at console.anthropic.com ↗</a>
          ${aiKeyRow('gemini', 'Gemini (Google) &middot; money advice &amp; statement import', a.aiGeminiSet, 'AIza…')}
          <a class="ai-get" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a free Gemini key at aistudio.google.com ↗</a>
        </div>
        <div class="plan-card plan-full ${managed ? 'on' : ''}">
          <div class="plan-h"><b>Premium Plus</b>${badge(managed)}</div>
          <div class="plan-price">€13/mo</div>
          <p class="plan-desc">We run the AI for you - no keys, nothing to set up, it just works across every tool. The hands-off option.</p>
          ${managed
            ? '<div class="plan-active">✓ Active - the AI is handled for you, no keys needed.</div>'
            : '<a class="add-btn wide" href="mailto:contact@daybook.fyi?subject=Daybook%20Premium%20Plus%20plan">Switch to Premium Plus →</a>'}
        </div>
      </div>`;
  })() : '<div class="home-empty" style="padding:8px 0 0">Loading your account…</div>';

  const sectionsPane = `<div class="set-card"><div class="set-mods">${MODULES.map(([k, l]) => `<label class="set-mod"><span>${l}</span><input type="checkbox" data-mod-toggle="${k}" ${modOn(k) ? 'checked' : ''}></label>`).join('')}</div></div>`;

  const notificationsPane = state.account ? `<div class="set-card set-notifs">
        <div class="set-notif-group"><div class="set-notif-h">By email</div>
          <label class="set-mod"><span>Morning brief<small>Your day's calendar, open P1 tasks and the quote, emailed at 08:45</small></span><input type="checkbox" data-account-brief ${state.account.briefEmail !== false ? 'checked' : ''}></label>
        </div>
        <div class="set-notif-group"><div class="set-notif-h">By text</div>
          <label class="set-mod"><span>Before a time block starts<small>A text 5 minutes before a scheduled block${state.account.phone ? '' : ' - add a phone number in the Account tab first'}</small></span><input type="checkbox" data-account-sms ${state.account.smsAlerts ? 'checked' : ''}></label>
        </div>
      </div>` : '<div class="home-empty" style="padding:8px 0 0">Loading your account…</div>';

  const invitesPane = `<div class="set-card">
        <div class="inv-new"><button class="add-btn wide" data-create-invite>✦ Invite someone</button></div>
        <p class="inv-hint">Put in their email and we'll send the invitation for you - they click one link and they're in. ${(state.me && state.me.id === 1) ? '' : 'Up to 5 outstanding at a time.'}</p>
        <div class="inv-list">${(state.invites || []).map(inviteRow).join('') || '<div class="home-empty" style="padding:8px 0 0">Nobody invited yet.</div>'}</div>
      </div>`;

  const managePane = `<div class="set-tiles">${tiles.map(([ic, label, sub, attr]) => `<button class="set-tile" ${attr}><span class="set-tile-ic">${ic}</span><span class="set-tile-t">${label}</span><span class="set-tile-s">${sub}</span></button>`).join('')}</div>`;

  const panes = { account: accountPane, appearance: appearancePane, mobile: mobileSettingsHtml(), ai: aiPane, notifications: notificationsPane, sections: sectionsPane, invites: invitesPane, manage: managePane };
  const subs = { account: 'Your details & sign-in addresses', appearance: 'Theme & accent colour', mobile: 'Arrange your Home on the phone', ai: 'Your plan, and how the AI runs', notifications: 'How and when Daybook reaches you', sections: 'Turn off any tool you don\'t use', invites: 'Email someone an invitation to join', manage: 'Life areas, mail, categories & more' };

  $('#pane').innerHTML = `
    ${pageCrumb('Settings')}
    <div class="pane-head home-head"><h1>Settings</h1></div>
    ${seg}
    <section class="home-sec">
      <div class="home-sec-h set-sec-h" style="margin-bottom:14px">${(TABS.find(([k]) => k === tab) || [])[1]}<span class="muted">${subs[tab] || ''}</span>${HELP['settings-' + tab] ? `<button class="help-btn set-help-btn" data-help-open="settings-${tab}" title="How ${esc(HELP['settings-' + tab].title)} works">i</button>` : ''}</div>
      ${panes[tab] || ''}
    </section>
    ${(state.me && state.me.subdomain) ? `<p class="home-empty" style="padding:6px 0 0">Signed in as <b>${esc(state.me.name || '')}</b> · ${esc(state.me.subdomain)}.daybook.fyi · ${esc(planLabel(state.me.plan))} · <button class="su-signout" data-account-signout>Sign out</button></p>` : ''}`;
}
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
  document.body.dataset.view = (v && v.type) || '';   // lets CSS tailor per view (e.g. hide ⌘K on Mail)
  if ((v && v.type) !== 'mail') document.body.classList.remove('mail-reading');
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#nav').innerHTML = `
    <div class="nav-topline">
      <div class="nav-brand" data-view-home title="Home">${firstName() ? esc(firstName()) : ''}${MARK}<em>${esc(BRAND.app)}</em></div>
      <button class="nav-util-toggle" data-util-toggle aria-label="Show tools" aria-expanded="${state.navUtilOpen ? 'true' : 'false'}" title="Tools">${state.navUtilOpen ? '✕' : '⋯'}</button>
    </div>
    <div class="nav-foot">
      <button class="foot-search" data-palette title="Search">⌕</button>
    </div>
    <button class="nav-k" data-palette><span>Search or jump…</span><kbd>${PK('⌘K')}</kbd></button>
    <div class="nav-grid">
    <button class="nav-item ${v.type === 'home' ? 'on' : ''}" data-view-home><span class="nav-lbl">Home</span></button>
    ${modOn('tasks') ? `<button class="nav-item ${v.type === 'tasks' || v.type === 'taskcard' ? 'on' : ''}" data-view-tasks><span class="nav-lbl">Tasks</span><span class="nav-quick" data-quick-add="task" title="New task">+</span></button>` : ''}
    ${modOn('mail') ? `<button class="nav-item ${v.type === 'mail' || v.type === 'mailaccounts' ? 'on' : ''}" data-open-mail><span class="nav-lbl">Mail</span>${state.mailUnreadTotal ? `<span class="nav-badge">${state.mailUnreadTotal > 99 ? '99+' : state.mailUnreadTotal}</span>` : ''}<span class="nav-quick" data-quick-add="mail" title="New email">+</span></button>` : ''}
    ${modOn('contacts') ? `<button class="nav-item ${v.type === 'contacts' || v.type === 'contactcard' ? 'on' : ''}" data-open-contacts><span class="nav-lbl">Contacts</span>${friendPending() ? `<span class="nav-badge">${friendPending() > 99 ? '99+' : friendPending()}</span>` : ''}<span class="nav-quick" data-quick-add="contact" title="New contact">+</span></button>` : ''}
    ${modOn('calendar') ? `<button class="nav-item ${v.type === 'calendar' ? 'on' : ''}" data-open-calendar><span class="nav-lbl">Calendar</span><span class="nav-quick" data-quick-add="event" title="New event">+</span></button>` : ''}
    ${modOn('today') ? `<button class="nav-item ${v.type === 'today' ? 'on' : ''}" data-open-today><span class="nav-lbl">Today</span></button>` : ''}
    ${modOn('notes') ? `<button class="nav-item ${['notes', 'note', 'table', 'tables'].includes(v.type) ? 'on' : ''}" data-open-notes><span class="nav-lbl">Notes</span><span class="nav-quick" data-quick-add="note" title="New note">+</span></button>` : ''}
    ${modOn('financial') ? `<button class="nav-item ${v.type === 'financial' ? 'on' : ''}" data-open-financial><span class="nav-lbl">Money</span></button>` : ''}
    ${modOn('reflect') ? `<button class="nav-item ${v.type === 'journal' || v.type === 'journalentry' ? 'on' : ''}" data-open-journal><span class="nav-lbl">Reflection</span><span class="nav-quick" data-quick-add="journal" title="New entry">+</span></button>` : ''}
    ${modOn('goals') ? `<button class="nav-item ${['goals', 'goalcard', 'bucketcard'].includes(v.type) ? 'on' : ''}" data-open-goals><span class="nav-lbl">Goals</span><span class="nav-quick" data-quick-add="goal" title="New goal">+</span></button>` : ''}
    ${modOn('areas') ? `<button class="nav-item ${v.type === 'areas' || v.type === 'area' ? 'on' : ''}" data-open-areas><span class="nav-lbl">Life areas</span></button>` : ''}
    ${modOn('saved') ? `<button class="nav-item ${v.type === 'readwatch' ? 'on' : ''}" data-open-readwatch><span class="nav-lbl">Saved</span><span class="nav-quick" data-quick-add="save" title="Save a link">+</span></button>` : ''}
    </div>
    <div class="nav-secs" id="nav-secs">${state.nav.order.map((k) => ((k === 'areas' && !modOn('areas')) || (k === 'notes' && !modOn('notes'))) ? '' : navSection(k, v)).join('')}</div>
    <div class="nav-bottom">
      <div class="nav-bottom-row">
        ${helpIconHtml()}
        <button class="nav-theme" data-theme-toggle title="Theme — Auto follows local sunrise &amp; sunset; press to override">${themeLabel()}</button>
        <button class="nav-theme nav-settings ${v.type === 'settings' ? 'on' : ''}" data-open-settings title="Settings"><span class="ns-ic">⚙</span><span class="ns-lbl"> Settings</span></button>
      </div>
      ${(state.me && state.me.id === 1) ? `<button class="nav-theme nav-adminlink ${v.type === 'admin' ? 'on' : ''}" data-open-admin title="Admin dashboard"><span class="ns-ic">🛠</span><span class="ns-lbl"> Admin</span></button>` : ''}
      ${state.me ? '<button class="nav-theme nav-signout" data-account-signout title="Sign out of Daybook on this device"><span class="ns-ic">↪</span><span class="ns-lbl"> Sign out</span></button>' : ''}
      <div class="nav-legal"><a href="https://daybook.fyi/privacy" target="_blank" rel="noopener">Privacy</a><span>·</span><a href="https://daybook.fyi/terms" target="_blank" rel="noopener">Terms</a><span>·</span><a href="mailto:contact@daybook.fyi">Contact</a><span class="nav-legal-c">© ${new Date().getFullYear()} Daybook</span></div>
    </div>`;
  document.body.classList.toggle('util-open', !!state.navUtilOpen);
  renderTabbar(v);
  syncActiveTab(); renderTabs(); recordHistory();
  queueNavH();
}
// The mobile tools bar (Information, Colour Scheme, Settings) is hidden until you
// tap the ⋯ toggle on the fixed brand header. Re-measure so the breadcrumb below
// pins at the header's new height whether the bar is open or shut.
function toggleNavUtil() { state.navUtilOpen = !state.navUtilOpen; document.body.classList.toggle('util-open', state.navUtilOpen); const b = document.querySelector('[data-util-toggle]'); if (b) { b.textContent = state.navUtilOpen ? '✕' : '⋯'; b.setAttribute('aria-expanded', state.navUtilOpen ? 'true' : 'false'); } setNavH(); }
// The mobile top bar (brand + full-width search box) is sticky and its height
// varies as it wraps, so measure it into --navh; the breadcrumb pins just below
// it (see .crumbbar in the mobile CSS). Desktop ignores --navh.
function setNavH() {
  const nav = document.getElementById('nav');
  const h = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--navh', (h || 56) + 'px');
}
let _navHBound = false;
function queueNavH() {
  requestAnimationFrame(setNavH);
  if (_navHBound) return;
  _navHBound = true;
  window.addEventListener('resize', setNavH);
  window.addEventListener('orientationchange', () => setTimeout(setNavH, 120));
}
// The shortcut HANDLERS all accept metaKey OR ctrlKey, so every shortcut already
// works on Windows/Linux. Only the on-screen LABELS were Mac-only - so PC users
// couldn't tell "⌘K" meant Ctrl+K. PK() rewrites a Mac-style label to this
// platform: on a Mac it's unchanged; elsewhere ⌘→Ctrl, ⌥→Alt, ⇧→Shift, ↵→Enter,
// in Windows order (Ctrl+Alt+…).
const IS_MAC = (() => {
  try {
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/mac|iphone|ipad|ipod/i.test(p)) return true;
    return /Mac/i.test(navigator.userAgent || '') && !/Windows/i.test(navigator.userAgent || '');
  } catch { return true; }
})();
function PK(s) {
  if (IS_MAC) return String(s);
  return String(s)
    .replace(/⌥⌘/g, 'Ctrl+Alt+').replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+')
    .replace(/↵/g, 'Enter').replace(/⌫/g, 'Backspace')
    .replace(/\+\s+/g, '+');   // tidy "Ctrl+ Enter" -> "Ctrl+Enter"
}
// Keyboard shortcuts reference. Open with ⌘/, the palette, or the home link.
const SHORTCUTS = [
  ['General', [
    ['⌘K', 'Command palette'],
    ['⌘/', 'This shortcuts list'],
    ['⌘N', 'New note'],
    ['⌥⌘N', 'New task'],
    ['⌘T', 'New tab'],
    ['⌥⌘W', 'Close tab'],
    ['Esc', 'Close a panel / back out'],
  ]],
  ['Mail (while browsing or reading, not typing)', [
    ['C', 'Compose a new email'],
    ['/', 'Search mail'],
    ['J / K', 'Previous / next message'],
    ['Enter / O', 'Open message or expand thread'],
    ['R', 'Reply'],
    ['A', 'Reply all'],
    ['F', 'Forward'],
    ['E', 'Archive'],
    ['S', 'Star'],
    ['U', 'Mark unread'],
    ['!', 'Mark as spam'],
    ['⌫ / #', 'Delete'],
    ['⌘Enter', 'Send (while composing)'],
    ['?', 'Mail cheatsheet'],
  ]],
  ['Command palette (⌘K)', [
    ['↑ / ↓', 'Move selection'],
    ['Enter', 'Run the highlighted action'],
    ['Esc', 'Close'],
  ]],
];
function openShortcuts() {
  let el = document.getElementById('sc-overlay');
  if (!el) { el = document.createElement('div'); el.id = 'sc-overlay'; document.body.appendChild(el); }
  const groups = SHORTCUTS.map(([title, rows]) => `<div class="sc-group"><div class="sc-group-h">${esc(PK(title))}</div>${rows.map(([k, label]) =>
    `<div class="sc-row"><span class="sc-desc">${esc(label)}</span><span class="sc-keys">${k.split(' / ').map((kk) => `<kbd class="kbd">${esc(PK(kk))}</kbd>`).join('<span class="sc-or">or</span>')}</span></div>`).join('')}</div>`).join('');
  const hint = IS_MAC ? '' : '<p class="sc-hint">Shortcuts use <kbd class="kbd">Ctrl</kbd> and <kbd class="kbd">Alt</kbd> on Windows and Linux.</p>';
  el.innerHTML = `<div class="sc-bg" data-shortcuts-bg><div class="sc-panel" role="dialog" aria-label="Keyboard shortcuts"><div class="sc-head"><h2>Keyboard shortcuts</h2><button class="sc-x" data-close-shortcuts aria-label="Close">×</button></div><div class="sc-body">${groups}${hint}</div></div></div>`;
  state.shortcutsOpen = true;
}
function closeShortcuts() { const el = document.getElementById('sc-overlay'); if (el) el.innerHTML = ''; state.shortcutsOpen = false; }
// Sidebar quick-add: jump to the tool and open its "new" affordance directly.
async function quickAdd(kind) {
  try {
    if (kind === 'task') { state.taskAddArea = null; state.taskAdding = true; state.taskFocusArm = Date.now(); await openTasks(); renderTasks(); }
    else if (kind === 'event') { await openCalendar(); state.cal.adding = true; state.cal.editing = null; renderCalendar(); setTimeout(() => { const i = $('#ce-title'); if (i) i.focus(); }, 0); }
    else if (kind === 'mail') { await openMail(); startCompose(); }
    else if (kind === 'note') { await newNote(null); }
    else if (kind === 'journal') { await openJournal(); await startJournalEntry(); }
    else if (kind === 'save') { await openReadwatch(); setTimeout(() => { const i = $('#rw-url'); if (i) i.focus(); }, 0); }
    else if (kind === 'contact') { await openContacts(); state.contactAdding = true; renderContacts(); setTimeout(() => { const i = $('#ct-name'); if (i) i.focus(); }, 0); }
    else if (kind === 'goal') { await openGoals('goals'); await newGoal(null); }
  } catch (e) { toast(e.message); }
}
// The mobile bottom tab bar lives at body level, NOT inside .nav: .nav has a
// backdrop-filter, which would make it the containing block for a fixed child
// and pin the bar to the nav instead of the viewport.
function renderTabbar(v) {
  let el = document.getElementById('tabbar');
  if (!el) { el = document.createElement('nav'); el.id = 'tabbar'; el.className = 'tabbar'; document.body.appendChild(el); }
  const tab = (on, attr, ic, label, badge) => `<button class="tab-b ${on ? 'on' : ''}" ${attr}><span>${ic}${badge ? `<span class="tab-badge">${badge}</span>` : ''}</span>${label}</button>`;
  el.innerHTML = tab(v.type === 'home', 'data-view-home', '⌂', 'Home')
    + tab(v.type === 'mail' || v.type === 'mailaccounts', 'data-open-mail', '✉', 'Mail', state.mailUnreadTotal ? (state.mailUnreadTotal > 99 ? '99+' : state.mailUnreadTotal) : '')
    + tab(v.type === 'calendar', 'data-open-calendar', '◑', 'Calendar')
    + tab(v.type === 'tasks' || v.type === 'taskcard', 'data-view-tasks', '✓', 'Tasks')
    + tab(['note', 'notes', 'table', 'tables'].includes(v.type), 'data-open-notes', '▤', 'Notes');
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
  // Per-tab Tasks: filters/sort/search ride in this tab's own view, so two Tasks
  // tabs can each hold a different filter. Switching to an existing Tasks tab
  // hydrates its saved view; a fresh open (or a forced filter like "See all P1")
  // falls back to the last-used defaults.
  const cur = state.tabs && state.tabs.find((t) => t.id === state.activeTab);
  const forced = !!state._taskViewForce; state._taskViewForce = false;
  const saved = !forced && cur && cur.view && cur.view.type === 'tasks' && Array.isArray(cur.view.filters) ? cur.view : null;
  if (saved) {
    // Returning to an existing Tasks tab: hydrate ITS saved filters (deep-copied
    // so editing them doesn't reach back into the stored view).
    state.taskFilters = JSON.parse(JSON.stringify(saved.filters));
    if (saved.sort) state.taskSort = { ...saved.sort };
    state.taskQuery = saved.q || '';
    state.taskFiltersOpen = !!saved.filtersOpen;
  } else if (!forced) {
    // A fresh Tasks tab gets its OWN arrays, seeded from the last-used default -
    // never the previous tab's live array, or the two would stay linked.
    let def = []; try { def = JSON.parse(localStorage.getItem('life.tasks.filters')) || []; } catch { def = []; }
    state.taskFilters = def;
    state.taskQuery = '';
    state.taskFiltersOpen = false;
  }
  // forced (e.g. "See all P1" from Home): the caller has already set its own
  // fresh state.taskFilters - leave it untouched.
  state.view = { type: 'tasks', filters: state.taskFilters, sort: state.taskSort, q: state.taskQuery || '', filtersOpen: !!state.taskFiltersOpen };
  if (filter !== undefined) state.taskFilter = filter;
  // Always refetch tasks (they change); reuse cached areas.
  const [areas, tasks] = await Promise.all([
    state.areas.length ? state.areas : api('/api/blocks?kind=area'),
    api('/api/blocks?kind=task'),
  ]);
  state.areas = areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  state.tasks = notKit(tasks);
  renderNav(); renderTasks();
  // Tasks friends have assigned to me (loads quietly, then re-renders the section).
  if (modOn('friends')) api('/api/assignments').then((a) => { state.assignments = a; if (state.view && state.view.type === 'tasks') renderTasks(); }).catch(() => {});
}
// The "Assigned to you" strip: pending requests to accept/decline, then the
// accepted ones you can open. Accepted assigned tasks are the owner's blocks, so
// opening one uses the shared-access path.
function assignedSectionHtml() {
  const a = state.assignments || { pending: [], accepted: [] };
  if (!a.pending.length && !a.accepted.length) return '';
  const prio = (p) => p ? `<span class="p-tag p-${p}">${p}</span>` : '';
  const pend = a.pending.map((t) => `<div class="assigned-row pending"><span class="ar-body"><span class="ar-t">${esc(t.title || 'Untitled task')}</span><span class="ar-meta">from ${esc(t.from)}</span></span><span class="ar-acts"><button class="add-btn wide" data-assign-accept="${t.id}">Accept</button><button class="ghost" data-assign-decline="${t.id}">Decline</button></span></div>`).join('');
  const acc = a.accepted.map((t) => `<div class="assigned-row"><button class="ar-check-btn" data-assign-tick="${t.id}" data-done="${t.done ? 1 : 0}" title="${t.done ? 'Mark not done' : 'Mark done'}">${t.done ? '☑' : '☐'}</button><button class="ar-open" data-open-task="${t.id}"><span class="ar-t ${t.done ? 'struck' : ''}">${esc(t.title || 'Untitled task')}</span><span class="ar-meta">${prio(t.priority)}from ${esc(t.from)}</span></button></div>`).join('');
  return `<section class="assigned-sec">
    <div class="home-sec-h">👤 Assigned to you${a.pending.length ? `<span class="assign-badge">${a.pending.length} new</span>` : ''}</div>
    ${pend}${acc}
  </section>`;
}
async function openNote(id) {
  stopNotePoll();
  const note = await api(`/api/blocks/${id}`);
  const path = [note]; let p = note;
  // Stop the ancestry walk at the first parent we can't reach - a note shared
  // with us sits under the owner's tree, which isn't ours to read.
  while (p.parent_id) { try { p = await api(`/api/blocks/${p.parent_id}`); path.unshift(p); } catch { break; } }
  // Both sub-notes and table notes nested inside this note.
  const children = (await api(`/api/blocks?parent_id=${id}`)).filter((b) => b.kind === 'note' || b.kind === 'table');
  if (!state.allTasks) state.allTasks = notKit(await api('/api/blocks?kind=task').catch(() => []));
  state.note = { current: note, path, children, taskQuery: '' };
  state.view = { type: 'note', id };
  recordRecent('note', id, note.title, blockAreas(note)[0]);
  renderNav(); renderNote();
  // A shared note (given to me, or one I've shared out) syncs live while open.
  if (note.sharedBy || note.sharedWith) startNotePoll(id);
}
async function openTable(id) {
  const table = await api(`/api/blocks/${id}`);
  const rows = await api(`/api/blocks?kind=row&parent_id=${id}`);
  state.tables_open = table; state.tables_rows = rows; state.tables_view = { openRow: null, addingCol: false, sorts: (table.props && table.props.sorts) || [], sorting: false };
  state.view = { type: 'table', id };
  bumpTableRecent(id);
  recordRecent('table', id, table.title, blockAreas(table)[0]);
  renderNav(); renderTable();
}
// Recently viewed items, newest first, for the home list. Client-side only:
// {kind,id,title} in localStorage, deduped by kind+id, capped.
function recentItems() { try { const a = JSON.parse(localStorage.getItem('life.recent') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
const RECENT_KINDS = new Set(['note', 'table', 'journal', 'area', 'task']);   // never emails
function recordRecent(kind, id, title, area) {
  if (!kind || !id || !RECENT_KINDS.has(kind)) return;
  const list = recentItems().filter((x) => x && !(x.kind === kind && x.id === id));
  // `area` (a life-area id) lets the Home list tint the icon in that area's
  // colour. An area item needs none - its own id is the area.
  const entry = { kind, id, title: (title || '').trim() || 'Untitled', ts: Date.now() };
  if (area) entry.area = area;
  list.unshift(entry);
  const capped = list.slice(0, 15);
  try { localStorage.setItem('life.recent', JSON.stringify(capped)); } catch {}
  // Mirror to the server so the list follows you to your phone and back. Fire-
  // and-forget, debounced; openHome merges it back in by recency (the ts).
  clearTimeout(window.__recentSyncT);
  window.__recentSyncT = setTimeout(() => { api('/api/kv/home_recent', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(capped) }) }).catch(() => {}); }, 500);
}
// Keep a recent entry's title in step when a block is renamed, so "Recently
// viewed" doesn't sit on a stale "Untitled" until the item is reopened.
function updateRecentTitle(kind, id, title) {
  const list = recentItems();
  const it = list.find((x) => x && x.kind === kind && x.id === id);
  if (!it) return;
  const t = (title || '').trim() || 'Untitled';
  if (it.title === t) return;
  it.title = t;
  try { localStorage.setItem('life.recent', JSON.stringify(list)); } catch {}
  clearTimeout(window.__recentSyncT);
  window.__recentSyncT = setTimeout(() => { api('/api/kv/home_recent', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(list) }) }).catch(() => {}); }, 800);
}
// Union the server's recent list with this device's, dedupe by kind+id keeping
// the newer touch, and cache the result locally for instant render.
function mergeRecent(serverJson) {
  let server = [];
  try { const a = JSON.parse(serverJson || '[]'); if (Array.isArray(a)) server = a; } catch {}
  const byKey = new Map();
  for (const x of [...server, ...recentItems()]) {
    if (!x || !x.kind || !x.id) continue;
    const k = `${x.kind}:${x.id}`, prev = byKey.get(k);
    if (!prev || (x.ts || 0) > (prev.ts || 0)) byKey.set(k, x);
  }
  const merged = [...byKey.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 15);
  const mergedJson = JSON.stringify(merged);
  try { localStorage.setItem('life.recent', mergedJson); } catch {}
  // If this device held items the server didn't (e.g. recents from before sync
  // existed), push the union back so the other devices pick them up.
  if (mergedJson !== JSON.stringify(server)) api('/api/kv/home_recent', { method: 'PUT', body: JSON.stringify({ value: mergedJson }) }).catch(() => {});
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
// Minutes → a compact human duration: 45m, 1h, 1h 30m.
const fmtDur = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), mm = m % 60; return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`; };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
// The name to be greeted by: the first word of your full name, and failing that
// your username. "Good afternoon" is a person speaking, so it uses what you'd
// actually be called - not "Robin Lumley-Savile", and certainly not "Robski",
// which is what this was hard-coded to and what every other member was greeted
// as. Falls back to a bare "Good afternoon" rather than a dangling comma.
const firstName = () => {
  const m = state.me || {};
  return String(m.name || '').trim().split(/\s+/)[0] || String(m.subdomain || '').trim();
};
// "Saturday 29th August" - weekday, ordinal day, month.
function homeDate() {
  const d = new Date();
  const ord = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
  return `${d.toLocaleDateString('en-GB', { weekday: 'long' })} ${ord(d.getDate())} ${d.toLocaleDateString('en-GB', { month: 'long' })}`;
}
const TBL_ICO = '<span class="ico-tbl">▦</span>';   // pink grid = table note
const NOTE_ICO = '<span class="ico-note">▤</span>';  // the note glyph, shown in front of every note in a list
const KIND_IC = { note: NOTE_ICO, table: TBL_ICO, task: '✓', row: TBL_ICO, area: '◈', journal: '✎' };
const KIND_LABEL = { task: 'Tasks', note: 'Notes', table: 'Tables', area: 'Life areas' };

async function openHome() {
  state.view = { type: 'home' };
  const [favs, day, pad, rec, goals, alerts, spirit, order, mob, sideOrd] = await Promise.all([
    api('/api/favorites').catch(() => state.favs),
    api('/api/day').catch(() => ({ events: [] })),
    api('/api/kv/home_scratchpad').catch(() => ({ value: '' })),
    api('/api/kv/home_recent').catch(() => null),
    api('/api/blocks?kind=goal').catch(() => state.goals || []),
    api('/api/home/alerts').catch(() => null),
    api('/api/kv/spirit_card').catch(() => null),
    api('/api/kv/home_order').catch(() => null),
    api('/api/kv/home_mobile').catch(() => null),
    api('/api/kv/home_side_order').catch(() => null),
  ]);
  // The mobile Home arrangement follows the account too, so a change made on the
  // desktop settings shows up on the phone.
  if (mob && mob.value) { try { const m = JSON.parse(mob.value); if (m && (Array.isArray(m.order) || Array.isArray(m.hidden))) localStorage.setItem('life.home.mobile', mob.value); } catch {} }
  // The right-column (side) arrangement follows the account, like the main one.
  if (sideOrd && sideOrd.value) { try { if (Array.isArray(JSON.parse(sideOrd.value))) localStorage.setItem('life.home.sideOrder', sideOrd.value); } catch {} }
  state.goals = goals || [];
  // The desktop section arrangement follows your account: seed this device's copy
  // from the server so a rearrangement made on one desktop shows on the next.
  if (order && order.value) { try { if (Array.isArray(JSON.parse(order.value))) localStorage.setItem('life.home.mainOrder', order.value); } catch {} }
  if (rec) mergeRecent(rec.value);   // fold the server's recent list into this device's before rendering
  // The pinned spirit card follows the account: take the server's if we have one.
  if (spirit && spirit.value) { try { const s = JSON.parse(spirit.value); if (s && s.name) { state.spiritCard = s; localStorage.setItem('life.spiritCard', spirit.value); } } catch {} }
  state.favs = favs; state.home = { events: day.events || [], slots: day.slots || [], lanes: day.lanes || [], notepad: (pad && pad.value) || '', quote: day.quote || null, quoteMode: day.quoteMode || 'random', alerts: alerts || { birthdays: [], p1: 0 }, today: day.today || dayKey(new Date()), dayOffset: 0, dayData: null };
  renderNav(); renderHome();
}
// Home "Today" = calendar events + the blocks placed on the Today tool (timed
// practices and task-bearing slots), merged and sorted by time. A slot that
// carries Life tasks lists them; a bare practice shows the block on its own.
// This is the "bits added to Today but not the calendar" Robin wanted surfaced.
// Date maths on the plain YYYY-MM-DD string, in UTC, so adding days never trips
// on a DST change or the device's own timezone.
function addDaysStr(ds, n) { const [y, m, d] = String(ds).split('-').map(Number); const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1)); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
// The day the Today section is currently showing, and a friendly label for it.
function homeViewDay() { return addDaysStr(state.home.today || dayKey(new Date()), state.home.dayOffset || 0); }
function homeDayLabel(off) {
  if (!off) return 'Today';
  if (off === 1) return 'Tomorrow';
  const ds = addDaysStr(state.home.today || dayKey(new Date()), off);
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function homeTodayItems() {
  const off = state.home.dayOffset || 0;
  // Today reads live state; another day reads the fetched day-view. Birthdays and
  // snoozed-task surfacing are a today-only signal, so they don't ride along.
  const src = off === 0 ? state.home : (state.home.dayData || { events: [], slots: [] });
  const hues = {}; (state.home.lanes || []).forEach((l) => { hues[l.key] = l.hue; });
  const items = (src.events || []).map((e) => ({ kind: 'event', allDay: !!e.allDay, start_min: e.allDay ? null : (e.start_min ?? 0), end_min: e.allDay ? null : (e.end_min ?? null), sort: e.allDay ? -1 : (e.start_min ?? 0), title: e.title, location: e.location, url: e.url }));
  // Birthdays (from Contacts) whose day is today lead the list, all-day style.
  if (off === 0) ((state.home.alerts && state.home.alerts.birthdays) || [])
    .filter((b) => !alertDismissed('bday:' + b.id))
    .forEach((b) => items.push({ kind: 'birthday', id: b.id, sort: -2, title: b.name }));
  for (const s of src.slots || []) {
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
// Step the Today section to another day (0 = today). Today's data is already in
// state.home; any other day is fetched once into dayData and cached until you
// move again, so stepping back and forth doesn't refetch the same day.
async function homeDaySet(off) {
  off = Math.max(0, off | 0);
  state.home.dayOffset = off;
  if (off === 0) { state.home.dayData = null; state.home.dayLoading = false; renderHome(); return; }
  const ds = homeViewDay();
  if (state.home.dayData && state.home.dayData.date === ds) { renderHome(); return; }
  state.home.dayLoading = true; state.home.dayData = null; renderHome();
  try {
    const r = await api(`/api/day?date=${ds}`);
    if ((state.home.dayOffset || 0) !== off) return;   // moved again while loading
    state.home.dayData = { date: ds, events: r.events || [], slots: r.slots || [] };
  } catch { if ((state.home.dayOffset || 0) === off) state.home.dayData = { date: ds, events: [], slots: [] }; }
  state.home.dayLoading = false;
  renderHome();
}
// ── Pomodoro focus timer (Home) ───────────────────────────────────────
// Subtle, opt-in: sits quietly in the Home sidebar. Runs off a wall-clock end
// time so it stays accurate across navigation and reloads; a single ticker
// updates just the digits each second.
const POMO_MIN = { focus: 25, break: 5 };
let pomo = (() => { try { const p = JSON.parse(localStorage.getItem('life.pomo')); if (p && p.mode) return p; } catch {} return { mode: 'focus', running: false, endAt: null, remaining: POMO_MIN.focus * 60, target: null }; })();
// What you're focusing on: pick a type (Life area / Goal / Task), then the item.
// Tasks lazy-load when you first pick that type (they're not on Home otherwise).
function pomoTargetOptions(type) {
  const t = pomo.target || {};
  const sel = (id) => (t.kind === type && String(t.id) === String(id)) ? ' selected' : '';
  let items = [];
  if (type === 'area') items = (state.areas || []).map((a) => [a.id, a.title]);
  else if (type === 'goal') items = (state.goals || []).filter((g) => (gp(g).status || 'active') === 'active').map((g) => [g.id, g.title || 'Goal']);
  else if (type === 'task') items = (state.pomoTasks || []).map((tk) => [tk.id, tk.title || 'Task']);
  return `<option value="">Choose…</option>` + items.map(([id, ttl]) => `<option value="${type}:${id}"${sel(id)}>${esc(ttl || 'Untitled')}</option>`).join('');
}
function savePomo() { try { localStorage.setItem('life.pomo', JSON.stringify(pomo)); } catch {} }
// Focus log: one entry per completed focus block, attributed to whatever you
// were focusing on. Only whole completed blocks count (standard Pomodoro) - a
// paused or reset block doesn't, so the numbers stay honest.
function pomoLog() { try { const a = JSON.parse(localStorage.getItem('life.pomo.log')); return Array.isArray(a) ? a : []; } catch { return []; } }
function logFocusSession(mins) {
  const t = pomo.target || {};
  const log = pomoLog();
  log.push({ ts: Date.now(), mins, kind: t.kind || null, id: t.id != null ? String(t.id) : null, label: t.label || null });
  try { localStorage.setItem('life.pomo.log', JSON.stringify(log.slice(-2000))); } catch {}
}
function focusMinsFor(kind, id) { return pomoLog().filter((e) => e.kind === kind && String(e.id) === String(id)).reduce((s, e) => s + (e.mins || 0), 0); }
function focusMinsToday() { const d = new Date(); d.setHours(0, 0, 0, 0); const t0 = d.getTime(); return pomoLog().filter((e) => e.ts >= t0).reduce((s, e) => s + (e.mins || 0), 0); }
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
function pomoRemaining() { return (pomo.running && pomo.endAt) ? Math.max(0, Math.round((pomo.endAt - Date.now()) / 1000)) : pomo.remaining; }
const pomoFmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
let pomoTicker = null;
function pomoEnsureTicker() {
  if (pomoTicker) return;
  pomoTicker = setInterval(() => {
    if (!pomo.running) return;
    const r = pomoRemaining();
    document.querySelectorAll('.js-pomo-time').forEach((el) => { el.textContent = pomoFmt(r); });
    if (r <= 0) {
      const done = pomo.mode;
      pomo.running = false; pomo.endAt = null;
      if (done === 'focus') logFocusSession(POMO_MIN.focus);
      pomo.mode = done === 'focus' ? 'break' : 'focus';
      pomo.remaining = POMO_MIN[pomo.mode] * 60;
      savePomo();
      toast(done === 'focus' ? '🍅 Focus done — take a break' : '✓ Break over — back to it');
      if (state.view && state.view.type === 'home') renderHome();
    }
  }, 1000);
}
function pomoToggle() {
  if (pomo.running) { pomo.remaining = pomoRemaining(); pomo.running = false; pomo.endAt = null; }
  else { pomo.endAt = Date.now() + pomoRemaining() * 1000; pomo.running = true; pomoEnsureTicker(); }
  savePomo(); renderHome();
}
function pomoReset() { pomo.running = false; pomo.endAt = null; pomo.remaining = POMO_MIN[pomo.mode] * 60; savePomo(); renderHome(); }
function pomoSetMode(m) { if (!POMO_MIN[m]) return; pomo.mode = m; pomo.running = false; pomo.endAt = null; pomo.remaining = POMO_MIN[m] * 60; savePomo(); renderHome(); }
if (pomo.running) pomoEnsureTicker();   // a timer left running keeps ticking across reloads
function pomoHtml() {
  const r = pomoRemaining();
  const open = localStorage.getItem('life.home.pomoOpen') === '1';
  const pt = state.pomoPickType || (pomo.target && pomo.target.kind) || '';
  return `<section class="home-sec home-pomo">
    <div class="home-sec-h home-sec-toggle" data-pomo-collapse><span class="hs-chev">${open ? '▾' : '▸'}</span>Focus timer${(!open && pomo.running) ? `<span class="pomo-mini js-pomo-time">${pomoFmt(r)}</span>` : ''}</div>
    ${open ? `<div class="pomo ${pomo.running ? 'running' : ''}">
      <div class="pomo-time js-pomo-time" id="pomo-time">${pomoFmt(r)}</div>
      <div class="pomo-modes">
        <button class="pomo-mode ${pomo.mode === 'focus' ? 'on' : ''}" data-pomo-mode="focus">Focus</button>
        <button class="pomo-mode ${pomo.mode === 'break' ? 'on' : ''}" data-pomo-mode="break">Break</button>
      </div>
      <div class="pomo-ctrls">
        <button class="add-btn wide" data-pomo-toggle>${pomo.running ? 'Pause' : (r < POMO_MIN[pomo.mode] * 60 ? 'Resume' : 'Start')}</button>
        <button class="ghost pomo-reset" data-pomo-reset title="Reset">↺</button>
      </div>
      <div class="pomo-focus"><span class="pomo-focus-l">Focus on</span>
        <div class="pomo-cats">
          <button class="pomo-cat ${pt === 'area' ? 'on' : ''}" data-pomo-cat="area">Life areas</button>
          <button class="pomo-cat ${pt === 'goal' ? 'on' : ''}" data-pomo-cat="goal">Goals</button>
          <button class="pomo-cat ${pt === 'task' ? 'on' : ''}" data-pomo-cat="task">Tasks</button>
        </div>
        ${pt ? `<select class="sel" data-pomo-target>${pomoTargetOptions(pt)}</select>` : ''}
        ${pomo.target ? `<div class="pomo-on">Focusing on <b>${esc(pomo.target.label)}</b>${(() => { const m = focusMinsFor(pomo.target.kind, pomo.target.id); return m ? ` · <span class="pomo-tot">${fmtMins(m)} logged</span>` : ''; })()}</div>` : ''}
      </div>
      ${(() => { const m = focusMinsToday(); return `<div class="pomo-today">${m ? `🍅 ${fmtMins(m)} focused today` : 'Complete a focus block to log time'}</div>`; })()}
    </div>` : ''}
  </section>`;
}
// The Focus timer body, without its own section shell, for embedding in the Toolbox.
function pomoPanel() {
  const r = pomoRemaining();
  const pt = state.pomoPickType || (pomo.target && pomo.target.kind) || '';
  return `<div class="pomo ${pomo.running ? 'running' : ''}">
      <div class="pomo-time js-pomo-time">${pomoFmt(r)}</div>
      <div class="pomo-modes">
        <button class="pomo-mode ${pomo.mode === 'focus' ? 'on' : ''}" data-pomo-mode="focus">Focus</button>
        <button class="pomo-mode ${pomo.mode === 'break' ? 'on' : ''}" data-pomo-mode="break">Break</button>
      </div>
      <div class="pomo-ctrls">
        <button class="add-btn wide" data-pomo-toggle>${pomo.running ? 'Pause' : (r < POMO_MIN[pomo.mode] * 60 ? 'Resume' : 'Start')}</button>
        <button class="ghost pomo-reset" data-pomo-reset title="Reset">↺</button>
      </div>
      <div class="pomo-focus"><span class="pomo-focus-l">Focus on</span>
        <div class="pomo-cats">
          <button class="pomo-cat ${pt === 'area' ? 'on' : ''}" data-pomo-cat="area">Life areas</button>
          <button class="pomo-cat ${pt === 'goal' ? 'on' : ''}" data-pomo-cat="goal">Goals</button>
          <button class="pomo-cat ${pt === 'task' ? 'on' : ''}" data-pomo-cat="task">Tasks</button>
        </div>
        ${pt ? `<select class="sel" data-pomo-target>${pomoTargetOptions(pt)}</select>` : ''}
        ${pomo.target ? `<div class="pomo-on">Focusing on <b>${esc(pomo.target.label)}</b>${(() => { const m = focusMinsFor(pomo.target.kind, pomo.target.id); return m ? ` · <span class="pomo-tot">${fmtMins(m)} logged</span>` : ''; })()}</div>` : ''}
      </div>
      ${(() => { const m = focusMinsToday(); return `<div class="pomo-today">${m ? `🍅 ${fmtMins(m)} focused today` : 'Complete a focus block to log time'}</div>`; })()}
    </div>`;
}

// ── Toolbox: Focus, a plain countdown Timer, and Daily Practices ─────────
// All three tools show at once, each collapsible on its own.
function tbxToolOpen(k) { try { return !(JSON.parse(localStorage.getItem('life.toolbox.collapsed') || '{}')[k]); } catch { return true; } }
function tbxToolToggle(k) { try { const c = JSON.parse(localStorage.getItem('life.toolbox.collapsed') || '{}'); if (c[k]) delete c[k]; else c[k] = true; localStorage.setItem('life.toolbox.collapsed', JSON.stringify(c)); } catch {} renderHome(); }
function toolboxHtml() {
  const open = secOpen('toolbox');
  const badge = (k) => (k === 'focus' && pomo.running) ? `<span class="tbx-run js-pomo-time">${pomoFmt(pomoRemaining())}</span>`
    : (k === 'timer' && timerState.running) ? `<span class="tbx-run js-timer-time">${timerFmt(timerRemaining())}</span>` : '';
  const tool = (k, ic, label, panel) => { const o = tbxToolOpen(k); return `<div class="tbx-tool">
    <div class="tbx-tool-h" data-tbx-tool="${k}"><span class="hs-chev">${o ? '▾' : '▸'}</span><span class="tbx-ic">${ic}</span><span class="tbx-tt">${label}</span>${badge(k)}</div>
    ${o ? `<div class="tbx-tool-body tbx-${k}">${panel}</div>` : ''}
  </div>`; };
  return `<section class="home-sec home-toolbox" data-hsec="toolbox">
    ${secH('toolbox', '🧰 Toolbox', '', true)}
    ${open ? `<div class="tbx-tools">${tool('focus', '⏱', 'Focus', pomoPanel())}${tool('timer', '⏲', 'Timer', timerPanel())}${tool('tracker', '✓', 'Daily Practices', trackerPanel())}</div>` : ''}
  </section>`;
}

// ── plain countdown Timer ───────────────────────────────────────────────
const TIMER_QUICK = [5, 10, 15, 25, 45];
let timerState = (() => { try { const t = JSON.parse(localStorage.getItem('life.timer')); if (t && typeof t.dur === 'number') return t; } catch {} return { label: '', running: false, endAt: null, remaining: 600, dur: 600 }; })();
function saveTimer() { try { localStorage.setItem('life.timer', JSON.stringify(timerState)); } catch {} }
function timerRemaining() { return (timerState.running && timerState.endAt) ? Math.max(0, Math.round((timerState.endAt - Date.now()) / 1000)) : timerState.remaining; }
const timerFmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
let timerTicker = null;
function timerEnsureTicker() {
  if (timerTicker) return;
  timerTicker = setInterval(() => {
    if (!timerState.running) return;
    const r = timerRemaining();
    document.querySelectorAll('.js-timer-time').forEach((el) => { el.textContent = timerFmt(r); });
    if (r <= 0) {
      timerState.running = false; timerState.endAt = null; timerState.remaining = timerState.dur; saveTimer();
      timerChime(); const what = (timerState.label || '').trim();
      toast(`⏲ Timer done${what ? ` - ${what}` : ''}`); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
      if (state.view && state.view.type === 'home') renderHome();
    }
  }, 500);
}
function timerChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    o.start(); o.stop(ctx.currentTime + 0.95);
  } catch {}
}
function timerPanel() {
  const r = timerRemaining();
  return `<div class="tmr ${timerState.running ? 'running' : ''}">
      <div class="tmr-time js-timer-time">${timerFmt(r)}</div>
      <input class="sel tmr-label" data-timer-label placeholder="What are you working on?" value="${esc(timerState.label || '')}" autocomplete="off">
      <div class="tmr-quick">${TIMER_QUICK.map((m) => `<button class="tmr-q ${timerState.dur === m * 60 ? 'on' : ''}" data-timer-set="${m}">${m}m</button>`).join('')}</div>
      <div class="tmr-custom"><span class="tmr-custom-l">Custom</span><input class="sel tmr-cnum" id="timer-min" type="number" min="0" max="1440" inputmode="numeric" value="${Math.floor(timerState.dur / 60)}" title="Minutes"><span class="tmr-colon">:</span><input class="sel tmr-cnum" id="timer-sec" type="number" min="0" max="59" inputmode="numeric" value="${String(timerState.dur % 60).padStart(2, '0')}" title="Seconds"><button class="ghost tmr-set" data-timer-custom>Set</button></div>
      <div class="tmr-ctrls"><button class="add-btn wide" data-timer-toggle>${timerState.running ? 'Pause' : (r < timerState.dur ? 'Resume' : 'Start')}</button><button class="ghost pomo-reset" data-timer-reset title="Reset">↺</button></div>
    </div>`;
}
function timerToggle() {
  if (timerState.running) { timerState.remaining = timerRemaining(); timerState.running = false; timerState.endAt = null; }
  else { if (timerRemaining() <= 0) timerState.remaining = timerState.dur; timerState.endAt = Date.now() + timerRemaining() * 1000; timerState.running = true; timerEnsureTicker(); }
  saveTimer(); renderHome();
}
function timerReset() { timerState.running = false; timerState.endAt = null; timerState.remaining = timerState.dur; saveTimer(); renderHome(); }
function timerSet(min) { timerState.dur = min * 60; timerState.running = false; timerState.endAt = null; timerState.remaining = min * 60; saveTimer(); renderHome(); }
// Any exact length: minutes + seconds from the custom inputs.
function timerSetCustom() {
  const mi = document.getElementById('timer-min'), se = document.getElementById('timer-sec');
  const m = Math.max(0, Math.min(1440, Math.floor(Number(mi && mi.value) || 0)));
  const s = Math.max(0, Math.min(59, Math.floor(Number(se && se.value) || 0)));
  const total = m * 60 + s; if (total < 1) { toast('Set at least one second'); return; }
  timerState.dur = total; timerState.running = false; timerState.endAt = null; timerState.remaining = total; saveTimer(); renderHome();
}
if (timerState.running) timerEnsureTicker();

// ── Daily Practices (shared with the Today tool via `activities`) ─────────
// The list of practices lives in the shared `activities` model, grouped by lane
// (your life-area categories), so editing it here shows in the Today tool and
// vice-versa. The daily ticks are ours, kept per-user in a kv setting.
const dayKey = (d) => d.toISOString().slice(0, 10);
function trackerLast7() { const out = []; const d = new Date(); for (let i = 6; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); out.push(dayKey(x)); } return out; }
let practicesLoaded = false;
async function loadPractices(force) {
  if (practicesLoaded && !force && state.practices) return state.practices;
  try {
    const [a, m, areas] = await Promise.all([
      api('/api/activities'),
      api('/api/kv/practice_marks').catch(() => ({ value: null })),
      (state.areas && state.areas.length) ? Promise.resolve(state.areas) : api('/api/blocks?kind=area').catch(() => []),
    ]);
    let marks = {}; try { marks = m && m.value ? JSON.parse(m.value) : {}; } catch {}
    state.areas = (areas || []).slice().sort((x, y) => (x.title || '').localeCompare(y.title || ''));
    state.practices = { activities: a.activities || [], lanes: a.lanes || [], marks };
    practicesLoaded = true;
  } catch { state.practices = state.practices || { activities: [], lanes: [], marks: {} }; }
  return state.practices;
}
// ── practice scheduling helpers (Today redesign) ──────────────────────
const prcHHMM = (m) => (m == null || m === '') ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// A practice's life area (by its stored area id), or null.
const practiceArea = (a) => a && a.area ? (state.areas || []).find((x) => x.id === a.area) : null;
// ── cadence + tracking (per practice AND per life area) ───────────────
// The one cadence list, shared by the area check-in and each practice's aim.
const PRESET_CADS = [['1d', 'every day'], ['2d', 'every other day'], ['3d', 'every 3 days'], ['2w', 'twice a week'], ['1w', 'once a week'], ['14d', 'every 2 weeks']];
const parseCadence = (c) => { const m = String(c || '').match(/^(\d+)([dw])$/); return m ? { n: Number(m[1]), unit: m[2], raw: c } : null; };
function cadenceLabel(c) { const p = parseCadence(c); if (!p) return ''; if (p.unit === 'w') return p.n === 1 ? 'Once a week' : `${p.n}× a week`; return p.n === 1 ? 'Every day' : p.n === 2 ? 'Every other day' : `Every ${p.n} days`; }
const daysBetweenStr = (a, b) => Math.round((Date.parse(b + 'T00:00') - Date.parse(a + 'T00:00')) / 86400000);
// The days (YYYY-MM-DD) a practice was ticked, most-recent first.
function prcMarkedDays(id) {
  if (!state.practices) return [];
  const pre = `${id}:`; const out = [];
  for (const k in state.practices.marks) if (k.indexOf(pre) === 0 && state.practices.marks[k]) out.push(k.slice(pre.length));
  return out.sort().reverse();
}
// A life area counts as "kept alive" on any day ANY of its tracked practices was
// ticked - so the union of its practices' marked days.
function areaMarkedDays(areaId) {
  const set = new Set();
  (state.practices.activities || []).filter((a) => a.area === areaId && a.tracked).forEach((a) => prcMarkedDays(a.id).forEach((d) => set.add(d)));
  return [...set].sort().reverse();
}
// On-track status for a set of marked days against a cadence. Robin dislikes red,
// so "slipping" is a gentle amber, never a scold.
function cadenceStatus(daysDesc, cadence) {
  const today = dayKey(new Date());
  const cad = parseCadence(cadence);
  const lastDone = daysDesc[0] || null;
  const doneToday = lastDone === today;
  const daysSince = lastDone ? daysBetweenStr(lastDone, today) : Infinity;
  if (!cad) return { status: doneToday ? 'ontrack' : 'none', label: lastDone ? (doneToday ? 'done today' : `${daysSince}d ago`) : 'not yet', streak: dailyStreak(daysDesc, today) };
  if (cad.unit === 'd') {
    let status, label;
    if (doneToday) { status = 'ontrack'; label = 'done today'; }
    else if (daysSince <= cad.n - 1) { status = 'ontrack'; label = `done ${daysSince}d ago`; }
    else if (daysSince === cad.n) { status = 'due'; label = 'due today'; }
    else { status = 'slipping'; label = lastDone ? `${daysSince}d ago` : 'not yet'; }
    return { status, label, streak: cadenceStreak(daysDesc, cad, today) };
  }
  const weekCount = daysDesc.filter((d) => daysBetweenStr(d, today) < 7).length;
  const status = weekCount >= cad.n ? 'ontrack' : (weekCount > 0 ? 'building' : 'slipping');
  return { status, label: `${weekCount} of ${cad.n} this week`, streak: weekCount };
}
// A life area's check-in status, said forwards: are you on track, and how many
// days until you should do something in it next? ("3 days to do something", not
// "3d ago"). daysDesc is the union of the area's practice ticks, newest first.
function areaCheckin(daysDesc, cadence) {
  const today = dayKey(new Date());
  const cad = parseCadence(cadence);
  if (!cad) return null;
  const lastDone = daysDesc[0] || null;
  if (cad.unit === 'd') {
    if (!lastDone) return { status: 'due', label: 'do something to start' };
    const remaining = cad.n - daysBetweenStr(lastDone, today);
    if (remaining >= 2) return { status: 'ontrack', label: `${remaining} days to do something` };
    if (remaining === 1) return { status: 'ontrack', label: '1 day to do something' };
    if (remaining === 0) return { status: 'due', label: 'do something today' };
    return { status: 'slipping', label: 'do something soon' };
  }
  // A "N times a week" area: count this week's, say how many are left.
  const weekCount = daysDesc.filter((d) => daysBetweenStr(d, today) < 7).length;
  if (weekCount >= cad.n) return { status: 'ontrack', label: `done ${weekCount}× this week` };
  return { status: weekCount ? 'building' : 'slipping', label: `${cad.n - weekCount} more this week` };
}
// A cadence said as a plain phrase, for any value (presets or a custom one).
function areaCadLabel(v) {
  const c = parseCadence(v); if (!c) return v || '';
  if (c.unit === 'd') { if (c.n === 1) return 'every day'; if (c.n === 2) return 'every other day'; if (c.n % 7 === 0) { const w = c.n / 7; return w === 1 ? 'every week' : `every ${w} weeks`; } return `every ${c.n} days`; }
  return c.n === 1 ? 'once a week' : c.n === 2 ? 'twice a week' : `${c.n}× a week`;
}
function dailyStreak(daysDesc, today) {
  if (!daysDesc.length) return 0;
  if (daysBetweenStr(daysDesc[0], today) > 1) return 0;
  let s = 1; for (let i = 1; i < daysDesc.length; i++) { if (daysBetweenStr(daysDesc[i], daysDesc[i - 1]) === 1) s++; else break; } return s;
}
function cadenceStreak(daysDesc, cad, today) {
  if (!daysDesc.length || daysBetweenStr(daysDesc[0], today) > cad.n) return 0;
  let s = 1; for (let i = 1; i < daysDesc.length; i++) { if (daysBetweenStr(daysDesc[i], daysDesc[i - 1]) <= cad.n) s++; else break; } return s;
}
function savePracticeMarks() { if (!state.practices) return; api('/api/kv/practice_marks', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(state.practices.marks) }) }).catch(() => {}); }
const practiceMarked = (id, day) => !!(state.practices && state.practices.marks[`${id}:${day}`]);
function rerenderPractices() { const v = state.view.type; if (v === 'home') renderHome(); else if (v === 'practices') renderPractices(); else if (v === 'today') renderToday(); }
async function openPractices() { state.view = { type: 'practices' }; renderNav(); await loadPractices(true); renderPractices(); }
function renderPractices() {
  if (!state.practices) return;
  $('#pane').innerHTML = `
    ${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Settings', attr: 'data-open-settings' }, { label: 'Practices' }])}
    <div class="pane-head home-head"><h1>Practices</h1></div>
    <p class="t2-sub">Activities you want to repeat</p>
    <p class="home-empty" style="margin:6px 0 18px">Your menu of options for a well-lived day, grouped by life area. Tap one to edit it; drag it onto your <b>Today</b> when the mood strikes, or tick it on the <b>Tracker</b>.</p>
    ${practicesManageHtml()}`;
}
// The Practices page as clean area cards (matching the Tracker). Each row opens
// the editor - no tick or dots here, that is the Tracker's job; this is for
// shaping your practices. Delete lives inside the editor.
function practicesManageHtml() {
  const P = state.practices; const acts = (P.activities || []);
  if (!acts.length) return '<div class="home-empty" style="padding:8px 0">No practices yet.<br><button class="add-btn wide trk-newbtn" data-prc-new style="margin-top:14px">＋ New practice</button></div>';
  const laneOf = (k) => (P.lanes || []).find((l) => l.key === k) || { label: k, hue: 0 };
  const groups = new Map();
  acts.forEach((a) => { const ar = practiceArea(a); const key = ar ? ar.id : `lane:${a.lane}`; if (!groups.has(key)) groups.set(key, { areaId: ar ? ar.id : null, label: ar ? (ar.title || 'Untitled') : laneOf(a.lane).label, hue: ar ? hueOf(ar) : laneOf(a.lane).hue, items: [] }); groups.get(key).items.push(a); });
  const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  const body = ordered.map((g) => {
    const rows = g.items.map((a) => {
      const meta = !a.timed ? '<span class="pm-len">habit</span>' : (a.duration ? `<span class="pm-len">${a.duration} min</span>` : '');
      return `<button class="pm-row" data-prc-edit="${a.id}"><span class="pm-name">${esc(a.title)}${a.video ? ' <span class="t2-vid-i">🎥</span>' : ''}</span>${meta}<span class="pm-edit" title="Edit">✎</span></button>`;
    }).join('');
    return `<div class="trk-area" style="--h:${g.hue}">
      <div class="trk-area-h"><span class="cd"></span><span class="trk-area-name">${esc(g.label)}</span></div>
      ${rows}
      ${g.areaId ? `<button class="trk-addp" data-prc-new-area="${g.areaId}">＋ add a practice</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="trk-dash">${body}</div><button class="add-btn wide trk-newbtn" data-prc-new>＋ New practice</button>`;
}
function practiceToggle(id, day) { const P = state.practices; if (!P) return; const k = `${id}:${day}`; if (P.marks[k]) delete P.marks[k]; else P.marks[k] = 1; savePracticeMarks(); rerenderPractices(); }
function practiceStreak(id) { if (!state.practices) return 0; let s = 0; const d = new Date(); for (;;) { if (state.practices.marks[`${id}:${dayKey(d)}`]) { s++; d.setDate(d.getDate() - 1); } else break; } return s; }
async function practiceAdd(area, title) {
  title = (title || '').trim(); if (!title || !state.practices) return;
  try { const a = await api('/api/activities', { method: 'POST', body: JSON.stringify({ area: area || undefined, title: title.slice(0, 80), duration: 30 }) }); state.practices.activities.push(a); rerenderPractices(); }
  catch (e) { toast(e.message); }
}
async function practiceDelete(id) {
  try {
    await api('/api/activities/' + id, { method: 'DELETE' });
    if (state.practices) state.practices.activities = state.practices.activities.filter((a) => String(a.id) !== String(id));
    if (state.practiceEdit && String(state.practiceEdit.id) === String(id)) state.practiceEdit = null;
    rerenderPractices();
  } catch (e) { toast(e.message); }
}
// Practices grouped by LIFE AREA (falling back to the legacy lane label for any
// not yet filed under an area). withWeek adds the 7-day dot row + streak (Home);
// the management list (withWeek=false) adds a schedule summary + an edit button.
function practicesGroups(withWeek) {
  const P = state.practices; const today = dayKey(new Date()); const days = trackerLast7(); const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const laneOf = (k) => (P.lanes || []).find((l) => l.key === k) || { label: k, hue: 0 };
  // Group key: area id when set, else `lane:<lane>`. Carry a label + hue for each.
  const groups = new Map();
  (P.activities || []).forEach((a) => {
    const ar = practiceArea(a);
    const key = ar ? ar.id : `lane:${a.lane}`;
    if (!groups.has(key)) groups.set(key, { label: ar ? (ar.title || 'Untitled') : laneOf(a.lane).label, hue: ar ? hueOf(ar) : laneOf(a.lane).hue, items: [] });
    groups.get(key).items.push(a);
  });
  const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  return ordered.map((g) => {
    const rows = g.items.map((a) => {
      const len = (a.timed && a.duration) ? `<span class="prc-sched">${a.duration} min</span>` : '';
      const badges = `${a.video ? '<span class="prc-badge">🎥</span>' : ''}${!a.timed ? '<span class="prc-badge dim" title="A habit — not on the day">habit</span>' : ''}`;
      return `<div class="prc-row">
        <button class="trk-tick ${practiceMarked(a.id, today) ? 'on' : ''}" data-prc-tick="${a.id}" title="Done today">✓</button>
        <span class="prc-name">${esc(a.title)}${badges}${withWeek ? '' : len}</span>
        ${withWeek ? `<span class="trk-week">${days.map((d) => `<span class="trk-dot ${practiceMarked(a.id, d) ? 'on' : ''} ${d === today ? 'today' : ''}" data-prc-day="${a.id}:${d}" title="${d}"><i>${dow[new Date(d + 'T00:00').getDay()]}</i></span>`).join('')}</span>${(() => { const s = practiceStreak(a.id); return s ? `<span class="trk-streak">🔥 ${s}</span>` : ''; })()}` : `<button class="prc-edit" data-prc-edit="${a.id}" title="Edit practice">✎</button>`}
        <button class="trk-del" data-prc-del="${a.id}" title="Remove practice">×</button>
      </div>`;
    }).join('');
    return `<div class="prc-group"><div class="prc-lane" style="--h:${g.hue}"><span class="prc-lane-dot"></span>${esc(g.label)}</div>${rows}</div>`;
  }).join('');
}
function practiceAddForm() {
  const areas = state.areas || [];
  return `<form class="prc-add" data-prc-add-form><select class="sel prc-lane-sel" id="prc-area"><option value="">No area</option>${areas.map((a) => `<option value="${a.id}">${esc(a.title || 'Untitled')}</option>`).join('')}</select><input class="sel" id="prc-new" placeholder="New daily practice…" autocomplete="off"><button class="add-btn wide" type="submit">Add</button></form>`;
}
// ── practice editor ───────────────────────────────────────────────────
// A body-level overlay, so the editor opens from the Today page as well as the
// Daily Practices page.
function openPracticeEditor(id, presetArea) {
  const a = id ? (state.practices.activities || []).find((x) => String(x.id) === String(id)) : null;
  state.practiceEdit = { id: a ? a.id : null, area: presetArea || '' };
  let host = document.getElementById('prac-editor-host');
  if (!host) { host = document.createElement('div'); host.id = 'prac-editor-host'; document.body.appendChild(host); }
  host.innerHTML = practiceEditorHtml();
  setTimeout(() => { const t = document.getElementById('pe-title'); if (t) t.focus(); }, 30);
}
function closePracticeEditor() { state.practiceEdit = null; const h = document.getElementById('prac-editor-host'); if (h) h.remove(); }
function practiceEditorHtml() {
  const pe = state.practiceEdit;
  const a = pe.id ? ((state.practices.activities || []).find((x) => String(x.id) === String(pe.id)) || {}) : {};
  const areas = state.areas || [];
  const timed = a.timed == null ? true : !!a.timed;
  const tracked = a.tracked == null ? true : !!a.tracked;
  const noteText = a.note ? String(a.note).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim() : '';
  const selArea = pe.id ? (a.area || '') : (pe.area || '');   // a new practice can be pre-set to an area (e.g. from the Tracker)
  return `<div class="pe-bg" data-prc-close></div>
    <div class="pe-panel ${timed ? 'timed-on' : ''}" role="dialog" aria-label="Practice">
      <div class="pe-head"><h2>${pe.id ? 'Edit practice' : 'New practice'}</h2><button class="pe-x" data-prc-close aria-label="Close">×</button></div>
      <div class="pe-body">
        <label class="pe-f"><span>Name</span><input class="sel" id="pe-title" value="${esc(a.title || '')}" placeholder="What do you do?" autocomplete="off"></label>
        <label class="pe-f"><span>Life area</span><select class="sel" id="pe-area"><option value="">No area</option>${areas.map((x) => `<option value="${x.id}" ${selArea === x.id ? 'selected' : ''}>${esc(x.title || 'Untitled')}</option>`).join('')}</select></label>
        <label class="pe-tog"><input type="checkbox" id="pe-timed" ${timed ? 'checked' : ''} data-pe-timed><span><b>Takes time</b> — has a length, so you can drop it onto your day</span></label>
        <div class="pe-timing">
          <label class="pe-f pe-inline"><span>Length</span><span class="pe-durwrap"><input class="sel pe-num" id="pe-dur" type="number" min="5" max="720" value="${a.duration || 30}"> min</span></label>
        </div>
        <label class="pe-tog"><input type="checkbox" id="pe-tracked" ${tracked ? 'checked' : ''}><span><b>Track it</b> — ticking it builds a streak</span></label>
        <label class="pe-f"><span>Aim to do it</span>${(() => {
          const cur = a.cadence || '';
          const opts = (cur && !PRESET_CADS.some(([v]) => v === cur)) ? [[cur, areaCadLabel(cur)], ...PRESET_CADS] : PRESET_CADS;
          return `<select class="sel" id="pe-cadence" data-prev="${cur}"><option value="" ${!cur ? 'selected' : ''}>Whenever</option>${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}<option value="__custom">Custom…</option></select>`;
        })()}</label>
        <label class="pe-f"><span>Follow-along video</span><input class="sel" id="pe-video" value="${esc(a.video || '')}" placeholder="Paste a video link (optional)" autocomplete="off"></label>
        <label class="pe-f"><span>Note</span><textarea class="sel pe-note" id="pe-note" rows="3" placeholder="How you like to do it (optional)">${esc(noteText)}</textarea></label>
      </div>
      <div class="pe-foot">${pe.id ? `<button class="ghost pe-del" data-prc-del="${pe.id}">Delete</button>` : '<span></span>'}<button class="add-btn wide" data-prc-save>${pe.id ? 'Save' : 'Add practice'}</button></div>
    </div>`;
}
async function savePractice() {
  const pe = state.practiceEdit; if (!pe) return;
  const title = (($('#pe-title') || {}).value || '').trim(); if (!title) { toast('Give it a name'); return; }
  const body = {
    title: title.slice(0, 80),
    area: ($('#pe-area') || {}).value || '',
    duration: Math.max(5, Math.min(720, Number(($('#pe-dur') || {}).value) || 30)),
    timed: $('#pe-timed') ? $('#pe-timed').checked : true,
    tracked: $('#pe-tracked') ? $('#pe-tracked').checked : true,
    days: '',        // practices are a palette of options, not a timetable
    time_min: '',
    cadence: ($('#pe-cadence') || {}).value || '',
    video: (($('#pe-video') || {}).value || '').trim(),
    note: (($('#pe-note') || {}).value || '').trim(),
  };
  try {
    let a;
    if (pe.id) { a = await api('/api/activities/' + pe.id, { method: 'PATCH', body: JSON.stringify(body) }); const i = state.practices.activities.findIndex((x) => String(x.id) === String(pe.id)); if (i >= 0) state.practices.activities[i] = a; }
    else { a = await api('/api/activities', { method: 'POST', body: JSON.stringify(body) }); state.practices.activities.push(a); }
    closePracticeEditor(); toast(pe.id ? 'Saved' : 'Practice added');
    if (state.view.type === 'today') renderToday(); else rerenderPractices();
  } catch (e) { toast(e.message); }
}
function trackerPanel() {
  if (!state.practices) { loadPractices().then(() => { if (state.view.type === 'home') renderHome(); }); return '<div class="home-empty" style="padding:6px 0">Loading practices…</div>'; }
  const groups = practicesGroups(true);
  return `<div class="prc">${groups || '<div class="home-empty" style="padding:6px 0">No practices yet. Add one below - it shows in the Today tool too.</div>'}${practiceAddForm()}</div>`;
}

// Gentle Home notifications - today's birthdays and open P1 tasks. Each can be
// dismissed for the day with the ×. Never overwhelming: only shows what's live.
function alertsHtml() {
  const cards = [];
  // Birthdays now appear in the Today section (see homeTodayItems), so they're no
  // longer duplicated as a banner here. The priority-task count lived here too,
  // but the Priority Tasks section already lists them - so the banner is empty
  // for now, kept as the home for any future gentle alerts.
  return cards.length ? `<div class="home-alerts">${cards.join('')}</div>` : '';
}
// The day's teaching, moved here from Today. Dismissible - once you've read it,
// the × hides it for the rest of the day (per-device).
function homeQuoteHtml() {
  // The server already gates the quote (off / dismissed today), so if it sent one,
  // show it. Closing it dismisses the day's quote everywhere (see the × handler).
  const q = state.home && state.home.quote; if (!q) return '';
  return `<figure class="home-quote"><button class="home-quote-x" data-home-quote-x title="Hide today's quote (everywhere)">×</button><blockquote>“${esc(q.text)}”</blockquote>${q.author ? `<figcaption>— ${esc(q.author)}</figcaption>` : ''}</figure>`;
}
// A Home alert dismissed with its × stays gone for the rest of the day and comes
// back tomorrow. Deliberately not permanent: you're waving away today's reminder,
// not unsubscribing from someone's birthday for good.
function alertDismissed(key) {
  try { return localStorage.getItem('life.home.alert.' + key) === todayISO(); } catch { return false; }
}
// Every Home section can be collapsed; the set of collapsed keys persists.
function homeCollapsed() { try { return JSON.parse(localStorage.getItem('life.home.collapsed')) || {}; } catch { return {}; } }
const isMobileHome = () => window.matchMedia('(max-width:820px)').matches;
// A section is open unless you've collapsed it. With no explicit choice yet, the
// default differs by device: on mobile only Today starts open (the rest closed,
// so the phone home is a short scroll); on desktop everything starts open.
function secOpen(key) {
  const c = homeCollapsed();
  if (key in c) return c[key] !== true;   // your explicit choice always wins
  return !isMobileHome() || key === 'today';
}
// Reposition-by-drag is a desktop affordance; on a phone the grip only misaligns
// the header and can swallow the tap, so mobile headers are plain tap-to-collapse.
function secH(key, title, extra, drag) {
  const mobile = matchMedia('(max-width:820px)').matches;
  const deskDrag = drag && !mobile;
  // On mobile the sections are draggable in place too, but only the ones the mobile
  // arrangement actually orders (Today stays pinned). Touch drag uses pointer
  // events (data-hsec-mgrip), not HTML5 drag, which doesn't fire on a phone.
  const mobDrag = drag && mobile && MOBILE_KEYS.includes(key);
  const grip = deskDrag ? '<span class="home-grip" title="Drag to reposition">⠿</span>'
    : mobDrag ? `<span class="home-mgrip" data-hsec-mgrip="${key}" title="Drag to reorder" aria-label="Drag to reorder">⠿</span>` : '';
  return `<div class="home-sec-h home-sec-toggle${deskDrag ? ' home-drag-h' : ''}${mobDrag ? ' home-mdrag-h' : ''}" data-sec-collapse="${key}" ${deskDrag ? `draggable="true" data-hsec-grip="${key}"` : ''}>${grip}<span class="hs-chev">${secOpen(key) ? '▾' : '▸'}</span>${title}${extra || ''}</div>`;
}
// The Priority Tasks list, in whatever order you've dragged it into. A custom
// order persists in localStorage; anything not yet ordered (a freshly-flagged
// task) falls to the end until you place it.
function p1OrderIds() { try { const o = JSON.parse(localStorage.getItem('life.home.p1Order')); return Array.isArray(o) ? o : []; } catch { return []; } }
// Default order is most-recently-added first; a task you've explicitly dragged
// keeps its manual position (that always wins over the date sort).
function sortP1(list) {
  const o = p1OrderIds();
  return list.slice().sort((a, b) => {
    const ia = o.indexOf(a.id), ib = o.indexOf(b.id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}
function priorityTasks() { return sortP1((state.home && state.home.alerts && state.home.alerts.p1list) || []); }
function reorderP1(dragged, before) {
  const ids = priorityTasks().map((t) => t.id).filter((id) => id !== dragged);
  let i = before ? ids.indexOf(before) : ids.length; if (i < 0) i = ids.length;
  ids.splice(i, 0, dragged);
  try { localStorage.setItem('life.home.p1Order', JSON.stringify(ids)); } catch {}
  renderHome();
}
// Jump to the Tasks board showing every P1: set a priority filter, then open it.
// _taskViewForce tells openTasks to use this filter rather than the tab's saved one.
function openP1Tasks() {
  loadTaskFilters();
  state.taskFilters = [{ field: 'priority', op: 'is', value: 'P1' }];
  state.taskFiltersOpen = false; saveTaskFilters(); state._taskViewForce = true; openTasks();
}
// The Home section: who you're overdue with, longest first. The nudge is a
// person, not a chore, so the row opens their card - and the ✓ is there for the
// common case where you rang them before Daybook got round to asking.
function kitHomeHtml() {
  const due = (state.home.alerts && state.home.alerts.keepInTouch) || [];
  if (!due.length) return '';
  const rows = due.map((k) => {
    const a = areaById(k.area);
    const since = k.last ? `Last spoke ${kitWhen(k.last)}` : 'Not spoken yet';
    return `<div class="kit-hrow"${a ? ` style="--h:${hueOf(a)}"` : ''}>
      <button class="kit-hopen" data-open-contact="${k.id}">
        <span class="contact-av kit-hav">${esc(initial(k.name || '?'))}</span>
        <span class="kit-hnm">${esc(k.name)}</span><span class="kit-hsub">${esc(since)}</span>
      </button>
      <button class="kit-hdone" data-kit-done="${esc(k.taskId)}" title="I've been in touch">✓</button>
    </div>`;
  }).join('');
  return `<section class="home-sec home-sec-kit" data-hsec="keepintouch">${secH('keepintouch', 'Keep in touch', `<span class="muted">${due.length}</span>`, true)}${secOpen('keepintouch') ? `<div class="kit-hlist">${rows}</div>` : ''}</section>`;
}
function p1Html() {
  const all = priorityTasks();
  if (!all.length) return '';
  const total = (state.home && state.home.alerts && state.home.alerts.p1) || all.length;
  const shown = all.slice(0, 8);
  const more = total - shown.length;
  return `<section class="home-sec home-sec-p1" data-hsec="priority">${secH('priority', 'Priority Tasks', `<span class="muted">${total}</span>`, true)}${secOpen('priority') ? `<div class="p1-list">${shown.map((tk) => { const a = areaById(tk.area); return `<button class="p1-row" data-open-task="${tk.id}" draggable="true" data-p1-id="${tk.id}" style="--h:${hueOf(a)}"><span class="p1-grip" title="Drag to reorder">⠿</span><span class="p1-t">${esc(tk.title)}</span>${a ? `<span class="p1-area"><span class="cd"></span>${esc(a.title)}</span>` : ''}</button>`; }).join('')}</div><button class="p1-all" data-open-p1>${more > 0 ? `See all ${total} P1 tasks` : 'Open P1 on the Tasks board'} →</button>` : ''}</section>`;
}
function renderHome() {
  if (homeSecDrag) return;   // never rebuild the DOM out from under an in-progress section drag
  const favs = state.favs || [];
  const ev = (state.home.events || []).slice().sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start_min ?? 0) - (b.start_min ?? 0));
  const todayItems = homeTodayItems();
  // Compact cards. Tasks stay their own group; notes and tables share one list,
  // each with its own icon so you can tell them apart. Life areas are omitted -
  // faved areas have their own section at the top of Home.
  const favIc = (k) => (k === 'note' ? NOTE_ICO : (KIND_IC[k] || '•'));
  // A starred note/table tagged to a life area gets a left edge in that area's
  // colour, the same at-a-glance sorting the Priority Task cards carry.
  const favCard = (f) => { const a = areaById(blockAreas(f)[0]); return `<div class="fav-card${a ? ' has-area' : ''}"${a ? ` style="--h:${hueOf(a)}"` : ''} draggable="true" data-fav-id="${f.id}"><button class="fav-card-open" data-fav-open="${f.kind}:${f.id}"><span class="fav-ic">${favIc(f.kind)}</span><span class="fav-t">${esc(f.title || 'Untitled')}</span></button><button class="fav-x" data-unfav="${f.id}" title="Remove">×</button></div>`; };
  const favGroup = (label, list) => list.length ? `<div class="fav-group"><div class="fav-group-h">${label}</div><div class="fav-cards">${list.map(favCard).join('')}</div></div>` : '';
  const favDocs = favs.filter((f) => f.kind === 'note' || f.kind === 'table');
  const favGroups = [
    favGroup('Tasks', favs.filter((f) => f.kind === 'task')),
    favDocs.length ? `<div class="fav-group"><div class="fav-cards">${favDocs.map(favCard).join('')}</div></div>` : '',
  ].join('');
  const evRows = todayItems.map((it) => {
    if (it.kind === 'birthday') {
      return `<div class="ev-row ev-bday ev-click" data-open-contact="${it.id}" role="button" tabindex="0" title="Open this contact"><span class="ev-time">🎂</span><span class="ev-t">${esc(it.title)}'s birthday</span><button class="ev-bday-x" data-alert-x="bday:${it.id}" title="Hide this for today" aria-label="Hide ${esc(it.title)}'s birthday for today">×</button></div>`;
    }
    if (it.kind === 'event') {
      const hasEnd = !it.allDay && it.end_min != null && it.end_min !== it.start_min;
      return `<div class="ev-row ev-click" data-home-cal role="button" tabindex="0" title="Open in the calendar"><span class="ev-time">${it.allDay ? 'all day' : hhmm(it.start_min)}${hasEnd ? `<span class="ev-end">${hhmm(it.end_min)}</span>` : ''}</span><span class="ev-t">${esc(it.title)}${it.url ? '<span class="cal-ag-join" title="Has a video meeting link">🎥</span>' : ''}${hasEnd ? `<span class="ev-dur">${fmtDur(it.end_min - it.start_min)}</span>` : ''}</span>${it.location ? `<span class="ev-loc">${esc(it.location)}</span>` : ''}</div>`;
    }
    // (end time stacked under start; duration tag after the title)
    return `<div class="ev-row ev-slot ev-click${it.done ? ' done' : ''}" data-home-cal role="button" tabindex="0" title="Open in the calendar"><span class="ev-time">${it.start_min == null ? 'anytime' : hhmm(it.start_min)}</span><span class="ev-t"><span class="ev-dot" style="--h:${it.hue}"></span>${esc(it.title)}</span>${it.badge ? `<span class="ev-loc">${esc(it.badge)}</span>` : ''}</div>`;
  }).join('');
  // Tasks that have surfaced from snooze sit in Today too, each tickable in place
  // (a tick completes it and it drops out; snoozing it again hides it).
  const surfacedRows = ((state.home.alerts && state.home.alerts.surfaced) || []).map((t) => {
    const a = areaById(t.area); const hue = a ? hueOf(a) : 220;
    return `<div class="ev-row ev-task ev-click" data-open-task="${t.id}" role="button" tabindex="0" title="Open this task">
      <span class="ev-time"><button class="ev-check" data-home-task-tick="${t.id}" title="Mark done" aria-label="Mark done">✓</button></span>
      <span class="ev-t"><span class="ev-dot" style="--h:${hue}"></span>${esc(t.title)}</span><span class="ev-loc ev-surfaced">back from snooze</span>
      <button class="ev-x" data-home-task-dismiss="${t.id}" title="Remove from Today (keeps the task; doesn't complete it)" aria-label="Remove from Today">×</button></div>`;
  }).join('');
  const recents = recentItems().filter((r) => r && RECENT_KINDS.has(r.kind)).slice(0, 8);
  // Tint each icon in its life area's colour (an area item is its own area);
  // with no area it falls back to the accent (terracotta by default) via CSS.
  const recentHue = (r) => {
    let aid = r.kind === 'area' ? r.id : r.area;
    // Older entries predate the stored area; recover it from whatever's loaded
    // (favourites carry props, areas/tables/notes are in state) so they colour too.
    if (!aid && r.kind !== 'area') {
      const b = (state.favs || []).find((x) => x.id === r.id) || (state.tables || []).find((x) => x.id === r.id) || (state.noteTops || []).find((x) => x.id === r.id);
      if (b) aid = blockAreas(b)[0];
    }
    const a = aid && areaById(aid);
    return a ? hueOf(a) : null;
  };
  const recentHtml = recents.length
    ? `<div class="recent-list">${recents.map((r) => { const hue = recentHue(r); return `<button class="recent-item${hue != null ? ' has-area' : ''}"${hue != null ? ` style="--h:${hue}"` : ''} data-fav-open="${r.kind}:${r.id}" title="${esc(r.title || 'Untitled')}"><span class="recent-ic">${favIc(r.kind)}</span><span class="recent-t">${esc(r.title || 'Untitled')}</span></button>`; }).join('')}</div>`
    : '<div class="home-empty">Open a note, table, task or area and it lands here.</div>';
  $('#pane').innerHTML = `
    <div class="home">
      ${navHist.length ? '<button class="crumb-back home-back" data-nav-back title="Back to where you were">← Back</button>' : ''}
      <button class="home-search" data-palette title="Search or jump to anything"><span class="hs-ic">⌕</span><span>Search or jump…</span></button>
      <div class="home-head">
        <div class="home-hi"><h1>${greeting()}${firstName() ? `, <span class="hi-name">${esc(firstName())}</span>` : ''}</h1><div class="home-date">${homeDate()}</div></div>
        <div class="home-actions"><button class="add-btn wide" data-new-note>+ Note</button><button class="add-btn wide" data-quick-task>+ Task</button><button class="add-btn wide" data-quick-event>+ Event</button></div>
      </div>
      ${alertsHtml()}
      ${homeQuoteHtml()}
      ${modOn('reflect') ? spiritPinnedHtml() : ''}
      <div id="qt-wrap"></div>
      <div class="home-body">
        <!-- Mobile-only launcher. On desktop the sidebar already lists every
             section, so this is hidden (see .home-launch in life.css). On mobile
             the sidebar is gone, so this is how you reach the sections the bottom
             tab bar doesn't hold. It lives inside home-body so the mobile flex
             order can sit it just below Today. -->
        <nav class="home-launch">
          <button class="hl-btn hl-guide" data-open-guide><span class="hl-ic">${MARK_TIGHT}</span><span class="hl-t">Guide</span></button>
          ${modOn('tasks') ? `<button class="hl-btn" data-view-tasks><span class="hl-ic">✓</span><span class="hl-t">Tasks</span></button>` : ''}
          ${modOn('mail') ? `<button class="hl-btn" data-open-mail><span class="hl-ic">✉</span><span class="hl-t">Mail</span>${state.mailUnreadTotal ? `<span class="hl-badge">${state.mailUnreadTotal > 99 ? '99+' : state.mailUnreadTotal}</span>` : ''}</button>` : ''}
          ${modOn('contacts') ? `<button class="hl-btn" data-open-contacts><span class="hl-ic">👤</span><span class="hl-t">Contacts</span>${friendPending() ? `<span class="hl-badge">${friendPending() > 99 ? '99+' : friendPending()}</span>` : ''}</button>` : ''}
          ${modOn('calendar') ? `<button class="hl-btn" data-open-calendar><span class="hl-ic">◑</span><span class="hl-t">Calendar</span></button>` : ''}
          ${modOn('today') ? `<button class="hl-btn" data-open-today><span class="hl-ic">☀</span><span class="hl-t">Today</span></button>` : ''}
          ${modOn('notes') ? `<button class="hl-btn" data-open-notes><span class="hl-ic">▤</span><span class="hl-t">Notes</span></button>` : ''}
          ${modOn('financial') ? `<button class="hl-btn" data-open-financial><span class="hl-ic">💰</span><span class="hl-t">Money</span></button>` : ''}
          ${modOn('reflect') ? `<button class="hl-btn" data-open-journal><span class="hl-ic">✎</span><span class="hl-t">Reflection</span></button>` : ''}
          ${modOn('goals') ? `<button class="hl-btn" data-open-goals><span class="hl-ic">🎯</span><span class="hl-t">Goals</span></button>` : ''}
          ${modOn('areas') ? `<button class="hl-btn" data-open-areas><span class="hl-ic">◈</span><span class="hl-t">Life areas</span></button>` : ''}
          ${modOn('saved') ? `<button class="hl-btn" data-open-readwatch><span class="hl-ic">🔖</span><span class="hl-t">Saved</span></button>` : ''}
        </nav>
        <div class="home-main">${(() => {
          const favAreas = (state.areas || []).filter((a) => a.props && a.props.fav);
          // All active goals on Home, starred ones first (and still drag-orderable),
          // then the rest - not only the starred subset.
          const fg = focusGoals();
          const fgIds = new Set(fg.map((g) => g.id));
          const restGoals = (state.goals || []).filter((g) => (gp(g).status || 'active') === 'active' && !fgIds.has(g.id));
          const homeGoals = [...fg, ...restGoals];
          const sec = {
            favareas: favAreas.length ? `<section class="home-sec home-sec-favareas" data-hsec="favareas">${secH('favareas', 'Life areas', '', true)}${secOpen('favareas') ? `<div class="favarea-grid">${favAreas.map((a) => `<button class="favarea" style="--h:${hueOf(a)}" data-open-area="${a.id}"><span class="fa-dot"></span><span class="fa-t">${esc(a.title || 'Untitled')}</span></button>`).join('')}</div>` : ''}</section>` : '',
            today: (() => {
              const off = state.home.dayOffset || 0;
              // Nav sits in the header: › steps forward a day, ‹ steps back, and a
              // Today pill jumps straight home (the day you want most of the time).
              const nav = `<span class="today-nav">${off > 0 ? `<button class="today-nav-btn" data-home-day-set="0" title="Back to today">Today</button><button class="today-nav-arw" data-home-day="-1" title="Previous day" aria-label="Previous day">‹</button>` : ''}<button class="today-nav-arw" data-home-day="1" title="Next day" aria-label="Next day">›</button></span>`;
              const rows = evRows + (off === 0 ? surfacedRows : '');
              const body = state.home.dayLoading ? '<div class="home-empty">Loading…</div>'
                : (rows || `<div class="home-empty">${off === 0 ? 'Nothing planned today. Open Today to add practices and tasks.' : 'Nothing on this day.'}</div>`);
              return `<section class="home-sec home-sec-today" data-hsec="today">${secH('today', homeDayLabel(off), nav, true)}${secOpen('today') ? `<div class="today-cal">${body}</div>` : ''}</section>`;
            })(),
            priority: p1Html(),
            focus: homeGoals.length ? `<section class="home-sec home-sec-focus" data-hsec="focus">${secH('focus', '🎯 Goals', '', true)}${secOpen('focus') ? `<div class="goal-grid">${homeGoals.map((g) => goalCardMini(g, gp(g).focus)).join('')}</div>` : ''}</section>` : '',
            toolbox: modOn('timer') ? toolboxHtml() : '',
            keepintouch: kitHomeHtml(),
            favs: `<section class="home-sec home-sec-favs" data-hsec="favs">${secH('favs', 'Starred Notes and Tables', '', true)}${secOpen('favs') ? `${favGroups || '<div class="home-empty">Star a note or table (the ☆ on it) to pin it here.</div>'}<button class="p1-all" data-open-notes>See all notes →</button>` : ''}</section>`,
          };
          const def = ['favareas', 'today', 'priority', 'keepintouch', 'focus', 'toolbox', 'favs'];
          let order = def; try { const o = JSON.parse(localStorage.getItem('life.home.mainOrder')); if (Array.isArray(o)) order = [...o.filter((k) => def.includes(k)), ...def.filter((k) => !o.includes(k))]; } catch {}
          return order.map((k) => sec[k] || '').join('');
        })()}</div>
        <aside class="home-side">${(() => {
          // The right column is drag-reorderable too (grips on desktop), each
          // section carrying data-hsec so the drop logic can read the order.
          const sideSec = {
            recent: `<section class="home-sec home-sec-recent" data-hsec="recent">${secH('recent', 'Recently viewed', '', true)}${secOpen('recent') ? recentHtml : ''}</section>`,
            notepad: modOn('notepad') ? `<section class="home-sec home-sec-notepad" data-hsec="notepad">${secH('notepad', 'Notepad', '', true)}${secOpen('notepad') ? `<textarea class="home-notepad" data-home-notepad placeholder="Jot anything here - it's saved automatically and waiting for you next time.">${esc(state.home.notepad || '')}</textarea>` : ''}</section>` : '',
            people: (modOn('contacts') && peopleOn()) ? `<section class="home-sec home-sec-people" data-hsec="people">${secH('people', 'People', '', true)}${secOpen('people') ? peopleHtml() : ''}</section>` : '',
          };
          const sdef = ['recent', 'notepad', 'people'];
          let sorder = sdef; try { const o = JSON.parse(localStorage.getItem('life.home.sideOrder')); if (Array.isArray(o)) sorder = [...o.filter((k) => sdef.includes(k)), ...sdef.filter((k) => !o.includes(k))]; } catch {}
          return sorder.map((k) => sideSec[k] || '').join('');
        })()}</aside>
      </div>
      <div class="home-foot"><button class="home-sc-link" data-open-shortcuts>⌨ Keyboard shortcuts</button></div>
    </div>`;
  applyMobileHomeOrder();   // the user's saved mobile section order & hidden set
}
function openTablesList() {
  state.view = { type: 'tables' };
  renderNav();
  const favTables = state.tables.filter((t) => t.props && t.props.fav);
  const cards = (list) => list.map((t) => `<button class="tbl-card" data-open-table="${t.id}"><span class="tc-ic ico-tbl">▦</span><span class="tc-t">${esc(t.title || 'Untitled')}</span></button>`).join('');
  $('#pane').innerHTML = `
    ${pageCrumb('Tables')}
    <div class="pane-head home-head"><h1>Tables</h1><button class="add-btn wide" data-new-table>+ New table</button></div>
    ${favTables.length ? `<section class="home-sec"><div class="home-sec-h">Starred</div><div class="tbl-cards">${cards(favTables)}</div></section>` : ''}
    <section class="home-sec"><div class="home-sec-h">All tables · ${state.tables.length}</div><div class="tbl-cards">${cards(state.tables) || '<div class="empty">No tables yet.</div>'}</div></section>`;
}

function openNotesList() {
  state.view = { type: 'notes' };
  renderNav();
  renderNotesList();
}
const NOTE_SORTS = [['added-desc', 'Newest first'], ['added-asc', 'Oldest first'], ['az', 'Name A-Z'], ['za', 'Name Z-A'], ['area', 'Life area']];
function notesSortMode() { return state.notesSort || (state.notesSort = localStorage.getItem('life.notesSort') || 'added-desc'); }
// A note's life-area title for sorting (its first, if it has several); no-area
// sorts last (￿).
const noteAreaTitle = (n) => { const ids = blockAreas(n); const a = ids[0] && areaById(ids[0]); return a ? (a.title || '') : '￿'; };
function sortNotes(list) {
  const mode = notesSortMode();
  const t = (n) => (n.title || '').toLowerCase();
  const d = (n) => n.created_at || '';
  const arr = [...list];
  if (mode === 'added-asc') arr.sort((a, b) => (d(a) < d(b) ? -1 : d(a) > d(b) ? 1 : 0));
  else if (mode === 'az') arr.sort((a, b) => t(a).localeCompare(t(b)));
  else if (mode === 'za') arr.sort((a, b) => t(b).localeCompare(t(a)));
  else if (mode === 'area') arr.sort((a, b) => noteAreaTitle(a).localeCompare(noteAreaTitle(b)) || t(a).localeCompare(t(b)));
  else arr.sort((a, b) => (d(a) < d(b) ? 1 : d(a) > d(b) ? -1 : 0));   // added-desc (default)
  return arr;
}
// Every top-level note, regular or table - one unified list.
function noteEntries() { return [...(state.noteTops || []), ...(state.tables || [])]; }
const isTableNote = (n) => (n && n.kind) === 'table';
function notesTypeMode() { return state.notesType || (state.notesType = localStorage.getItem('life.notesType') || 'all'); }
const NOTE_TYPES = [['all', 'All'], ['note', 'Notes'], ['table', 'Tables']];
function noteCard(n) {
  const t = isTableNote(n);
  // No bullet on a regular note; a table keeps its grid icon so it stands out.
  return `<button class="tbl-card" data-open-${t ? 'table' : 'note'}="${n.id}">${t ? '<span class="tc-ic ico-tbl">▦</span>' : ''}<span class="tc-t">${esc(n.title || 'Untitled')}</span>${areaTag(n)}</button>`;
}
// The Note · Table type switch shown in a note/table header.
function noteTypeToggle(id, current) {
  return `<span class="ntype-toggle" role="group" aria-label="Note type">
    <button class="ntt ${current === 'note' ? 'on' : ''}" data-set-note-type="${id}:note" title="Plain note">Note</button>
    <button class="ntt ${current === 'table' ? 'on' : ''}" data-set-note-type="${id}:table" title="Table">Table</button></span>`;
}
// Flip a note ↔ table. Non-destructive: the flip only changes the block's kind
// (a table gets a starter column if it has none). A note's prose and a table's
// rows both stay in place and reappear if you toggle back.
async function setNoteType(id, type) {
  try {
    const blk = await api(`/api/blocks/${id}`);
    if ((blk.kind || 'note') === type) return;   // already that type
    const patch = { kind: type };
    if (type === 'table' && !((blk.props && blk.props.columns) || []).length) {
      patch.props = { columns: [{ id: 'c' + Math.random().toString(36).slice(2, 7), name: 'Column', type: 'text' }] };
    }
    await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    // Refresh the top-level lists so the sidebar and Notes page reclassify it.
    [state.noteTops, state.tables] = await Promise.all([
      api('/api/blocks?kind=note&parent_id=').catch(() => state.noteTops),
      api('/api/blocks?kind=table').catch(() => state.tables),
    ]);
    if (type === 'table') await openTable(id); else await openNote(id);
    toast(type === 'table' ? 'Now a table' : 'Now a plain note');
  } catch (e) { toast(e.message); }
}
function renderNotesList() {
  const q = (state.notesQuery || '').trim().toLowerCase();
  const mode = notesSortMode();
  const type = notesTypeMode();
  const typed = (list) => type === 'all' ? list : list.filter((n) => (isTableNote(n) ? 'table' : 'note') === type);
  const base = typed(noteEntries());
  const favNotes = sortNotes(base.filter((n) => n.props && n.props.fav));
  // Recently opened notes/tables, newest first, mapped back to the live entries
  // (so a deleted or type-filtered-out one drops off). Capped for a tidy strip.
  const byId = new Map(base.map((n) => [n.id, n]));
  const recentNotes = recentItems()
    .filter((x) => x && (x.kind === 'note' || x.kind === 'table'))
    .map((x) => byId.get(x.id)).filter(Boolean).slice(0, 12);
  const all = sortNotes(q ? base.filter((n) => (n.title || '').toLowerCase().includes(q)) : base);
  const cards = (list) => list.map(noteCard).join('');
  const noun = type === 'table' ? 'tables' : type === 'note' ? 'notes' : 'notes';
  const sortSel = `<select class="sel notes-sort" data-notes-sort title="Sort">${NOTE_SORTS.map(([v, l]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const typeChips = `<div class="note-type-chips">${NOTE_TYPES.map(([v, l]) => `<button class="ntype ${type === v ? 'on' : ''}" data-notes-type="${v}">${l}</button>`).join('')}</div>`;
  // In "Life area" order (unfiltered), split into a section per area.
  let listHtml;
  if (mode === 'area' && !q) {
    const groups = new Map();
    // A note in several areas shows under each of them; one with none groups
    // under "No life area".
    for (const n of all) { const ks = blockAreas(n); (ks.length ? ks : ['']).forEach((k) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }); }
    const keys = [...groups.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || ((areaById(a) || {}).title || '').localeCompare((areaById(b) || {}).title || ''));
    listHtml = keys.map((k) => `<section class="home-sec"><div class="home-sec-h">${k ? esc((areaById(k) || {}).title || 'Life area') : 'No life area'} · ${groups.get(k).length}</div><div class="tbl-cards">${cards(groups.get(k))}</div></section>`).join('') || `<div class="empty">Nothing here yet.</div>`;
  } else {
    listHtml = `<section class="home-sec"><div class="home-sec-h">${q ? `Results · ${all.length}` : `All ${noun} · ${base.length}`}</div><div class="tbl-cards">${cards(all) || `<div class="empty">${q ? 'Nothing matches.' : 'Nothing here yet.'}</div>`}</div></section>`;
  }
  $('#pane').innerHTML = `
    ${pageCrumb('Notes')}
    <div class="pane-head home-head"><h1>Notes</h1></div>
    <div class="notes-toolbar"><input class="list-search sel" data-notes-q placeholder="Search notes…" value="${esc(state.notesQuery || '')}" autocomplete="off">${typeChips}${sortSel}<button class="add-btn wide notes-new" data-new-note>+ New note</button></div>
    ${!q && favNotes.length ? `<section class="home-sec"><div class="home-sec-h">Starred notes</div><div class="tbl-cards">${cards(favNotes)}</div></section>` : ''}
    ${!q && recentNotes.length ? `<section class="home-sec"><div class="home-sec-h">Recent notes</div><div class="tbl-cards">${cards(recentNotes)}</div></section>` : ''}
    ${listHtml}`;
}

// ── Journal ──────────────────────────────────────────
// Entries are top-level blocks (kind 'journal') with props {date, mode, prompt}.
// The prompt and any "Dig deeper" question live in the body as <blockquote>s;
// answers are ordinary paragraphs. Nothing leaves the device unless Dig deeper
// is pressed (see /api/journal/deepen).
const JOURNAL_MODES = [
  { key: 'free', label: 'Free write', icon: '✍️', prompts: [
    'Just start writing, and do not stop to edit. See where it goes.',
  ] },
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
// ── Spirit Cards ──────────────────────────────────────────────────────
// A gentle oracle deck inside Reflect: draw a card for a moment's reflection.
// Built-in deck for now; publisher decks + payouts come later.
const SPIRIT_CARDS = [
  ['Stillness', '✦', 'The answer arrives when you stop chasing it.'],
  ['Courage', '🔥', "The thing you're avoiding is smaller than the story about it."],
  ['Rest', '🌙', "You're allowed to do nothing and still be worthy."],
  ['Trust', '🌊', "You don't have to see the whole staircase to take the first step."],
  ['Release', '🍃', "Not everything you're carrying is yours to hold."],
  ['Beginning', '🌱', 'You can start again, right now, in the middle of anything.'],
  ['Presence', '☀', 'Life is happening in this breath, not the next one.'],
  ['Gentleness', '🕊', 'Speak to yourself as you would to someone you love.'],
  ['Enough', '🪷', 'You are already enough. The rest is decoration.'],
  ['Patience', '🌾', 'Some things only grow in the dark, and in their own time.'],
  ['Truth', '🗝', 'The thing you keep circling is the thing to say out loud.'],
  ['Play', '🎈', 'Take yourself less seriously and life gets lighter.'],
  ['Boundaries', '🧱', 'No is a complete sentence.'],
  ['Wonder', '✨', "Look again - you've stopped seeing what's in front of you."],
  ['Forgiveness', '🤍', 'You can set it down without saying it was okay.'],
  ['Focus', '🎯', 'One thing, done with your whole heart, is plenty.'],
  ['Change', '🦋', 'What feels like falling apart may be falling into place.'],
  ['Body', '🌿', "Come back into your body - it's been waiting."],
  ['Connection', '🔗', 'Reach out. The bridge is built from your side too.'],
  ['Simplicity', '🪟', 'Remove one thing today. Notice the room it makes.'],
  ['Gratitude', '🌻', 'Name three ordinary things. They were never ordinary.'],
  ['Faith', '🌅', "The sun doesn't ask permission to rise. Neither should you."],
  ['Solitude', '🏔', "Time alone isn't lonely. It's where you meet yourself."],
  ['Flow', '💧', 'Stop forcing the river. Let it carry you a while.'],
  ['Curiosity', '🐚', 'Ask a better question and the wall becomes a door.'],
  ['Acceptance', '⚓', "You can't move from a place you refuse to stand. Arrive first."],
  ['Compassion', '🫧', 'Everyone is carrying something unseen. Go gently, yourself included.'],
  ['Roots', '🌳', 'Grow down before you grow up - depth is what holds the height.'],
  ['Ease', '🌤', "It doesn't have to be hard to be worth it."],
  ['Devotion', '🕯', 'Small and often is how everything that lasts gets built.'],
  ['Humility', '🌒', "Not knowing isn't a gap to fill. It's where the room is."],
  ['Hope', '🌷', 'Plant it anyway. The planting is the hope.'],
  ['Attention', '🔭', 'Where your attention goes, your life follows. Aim it kindly.'],
  ['Return', '🧭', "You haven't lost the way. You're being called back to it."],
  ['Warmth', '🍵', 'Be a warm room to come in from the cold - starting with yourself.'],
  ['Mystery', '🌌', "You don't need the whole map to love the walk."],
];
const scFront = (c) => `<span class="sc-sym">${c[1]}</span><h3 class="sc-name">${esc(c[0])}</h3><p class="sc-msg">${esc(c[2])}</p>`;
function renderSpirit() {
  let el = document.getElementById('spirit'); if (!el) { el = document.createElement('div'); el.id = 'spirit'; document.body.appendChild(el); }
  const c = state.spirit && state.spirit.card;
  el.innerHTML = `<div class="spirit-bg">
    <button class="spirit-x" data-spirit-close title="Close">×</button>
    <div class="spirit-card ${c ? 'drawn' : ''}" data-spirit-draw>
      <div class="sc-face sc-back"><span class="sc-mark">✦</span><span class="sc-hint">Tap to draw</span></div>
      <div class="sc-face sc-front">${c ? scFront(c) : ''}</div>
    </div>
    <button class="spirit-again" data-spirit-draw ${c ? '' : 'hidden'}>Draw another</button>
  </div>`;
}
// The card you last drew, kept pinned on Home and Reflect. Held per-device in
// localStorage for instant paint and mirrored to the account so it follows you.
// A card lasts one day: 24 hours after you draw it (or the moment you dismiss it)
// it's gone, whichever comes first.
const SPIRIT_TTL = 24 * 60 * 60 * 1000;
const spiritFresh = (s) => ((s && s.name && s.at && (Date.now() - s.at) < SPIRIT_TTL) ? s : null);
function loadSpiritCard() { try { return spiritFresh(JSON.parse(localStorage.getItem('life.spiritCard'))); } catch { return null; } }
function currentSpirit() { if (state.spiritCard === undefined) state.spiritCard = loadSpiritCard(); return spiritFresh(state.spiritCard); }
function saveSpiritCard(c) {
  const saved = { name: c[0], symbol: c[1], message: c[2], at: Date.now() };
  state.spiritCard = saved;
  try { localStorage.setItem('life.spiritCard', JSON.stringify(saved)); } catch {}
  api('/api/kv/spirit_card', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(saved) }) }).catch(() => {});
}
// The pinned card, a small tap-to-reopen tile. Nothing until you've drawn one.
function spiritPinnedHtml() {
  const s = currentSpirit(); if (!s) return '';
  return `<div class="spirit-pin-wrap"><button class="spirit-pin" data-spirit-open title="Draw another spirit card"><span class="sp-sym">${esc(s.symbol || '✦')}</span><span class="sp-body"><span class="sp-name">${esc(s.name)}</span><span class="sp-msg">${esc(s.message)}</span></span><span class="sp-tag">Spirit card</span></button><button class="sp-x" data-spirit-dismiss title="Dismiss this card">×</button></div>`;
}
// Dismiss the pinned card now, before its 24 hours are up. Clears it on this
// device and on the account so it doesn't come back on your next load.
function dismissSpirit() {
  state.spiritCard = null;
  try { localStorage.removeItem('life.spiritCard'); } catch {}
  api('/api/kv/spirit_card', { method: 'PUT', body: JSON.stringify({ value: '' }) }).catch(() => {});
  const v = state.view && state.view.type;
  if (v === 'home') renderHome(); else if (v === 'journal') renderJournalList();
}
// Opening from Reflect or a pinned tile shows the current card (with "Draw
// another"); the very first time there's nothing yet, so a blank back to tap.
function openSpiritCards() { const s = currentSpirit(); state.spirit = { card: s ? [s.name, s.symbol, s.message] : null }; renderSpirit(); }
function drawSpiritCard() {
  const prev = state.spirit && state.spirit.card;
  let c; do { c = SPIRIT_CARDS[Math.floor(Math.random() * SPIRIT_CARDS.length)]; } while (prev && c[0] === prev[0]);
  state.spirit = { card: c };
  saveSpiritCard(c);
  const card = document.querySelector('.spirit-card'); if (!card) { renderSpirit(); return; }
  const again = document.querySelector('.spirit-again'); if (again) again.hidden = false;
  const setFront = () => { const f = document.querySelector('.sc-front'); if (f) f.innerHTML = scFront(c); };
  if (card.classList.contains('drawn')) { card.classList.remove('drawn'); setTimeout(() => { setFront(); card.classList.add('drawn'); }, 300); }
  else { setFront(); card.classList.add('drawn'); }
}
function closeSpirit() {
  const el = document.getElementById('spirit'); if (el) el.remove(); state.spirit = null;
  // Refresh the page beneath so a card just drawn shows up pinned right away.
  const v = state.view && state.view.type;
  if (v === 'home') renderHome(); else if (v === 'journal') renderJournalList();
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
  try { window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0); } catch {}   // always land at the top
  // Load the history of generated insights (each is a dated 'insight' block).
  api('/api/blocks?kind=insight').then((list) => {
    if (state.journal && state.view.type === 'journal') {
      state.journal.insightsList = (list || []).sort((a, b) => String((b.props && b.props.ts) || b.created_at || '').localeCompare(String((a.props && a.props.ts) || a.created_at || '')));
      renderJournalList();
    }
  }).catch(() => {});
}
async function newCoachingSession() {
  if (!state.journal) await openJournal();
  const date = new Date().toISOString();
  try {
    const entry = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'journal', title: `Coaching · ${journalDateLabel(date)}`, body: '<p><br></p>', props: { date, mode: 'coaching', prompt: '' } }) });
    state.journal.entries = state.journal.entries || []; state.journal.entries.unshift(entry);
    await openJournalEntry(entry.id);
    journalCoach();   // the coach opens the session with a warm greeting
  } catch (e) { toast(e.message); }
}
async function journalInsights() {
  if (!state.journal) return;
  state.journal.insightsOpen = true; state.journal.insightsLoading = true; renderJournalList();
  try {
    const r = await api('/api/journal/insights', { method: 'POST' });
    if (r && r.text) {
      // Keep every generation as its own dated block, so the history builds up.
      const block = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'insight', title: '', props: { text: r.text, points: r.points || [], from: r.from || 0, ts: r.ts || new Date().toISOString() } }) });
      state.journal.insightsList = [block, ...(state.journal.insightsList || [])];
      state.journal.readingInsight = block.id;   // open the fresh one to read
    } else {
      toast('Write a few entries first, then Insights has something to read.');
    }
  } catch (e) { toast(e.message); }
  state.journal.insightsLoading = false; renderJournalList();
}
async function delInsight(id) {
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
  state.journal.insightsList = (state.journal.insightsList || []).filter((x) => x.id !== id);
  if (state.journal.readingInsight === id) state.journal.readingInsight = null;
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
    const modeLabel = mode ? `${mode.icon} ${esc(mode.label)}` : ((n.props && n.props.mode) === 'coaching' ? '🧭 Coaching session' : '');
    return `<button class="j-card" data-open-jentry="${n.id}">
      <span class="j-card-date">${esc(journalDateLabel((n.props && n.props.date) || n.created_at))}</span>
      <span class="j-card-snip">${esc(journalSnippet(n))}</span>
      ${modeLabel ? `<span class="j-card-mode">${modeLabel}</span>` : ''}</button>`;
  }).join('');
  const list = j.insightsList || [];
  const open = !!j.insightsOpen;   // collapsed by default each visit
  // Rescue older insights that stored the raw JSON as their text, and always
  // read text + points back cleanly.
  const insParsed = (props) => {
    let text = (props && props.text) || '', points = (props && props.points) || [];
    const s = String(text).trim();
    if (s.startsWith('{') && /"text"\s*:/.test(s)) {
      try { const o = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); if (o && o.text != null) { text = String(o.text); if (Array.isArray(o.points) && !points.length) points = o.points; return { text, points }; } } catch {}
      // The stored text is a JSON blob the model mis-formatted so it wouldn't
      // parse. Strip the scaffolding by hand so it reads as plain prose - no
      // {"text": ..., "points": [...]} showing through.
      text = String(s)
        .replace(/^\{\s*"text"\s*:\s*"/, '')
        .replace(/"\s*,\s*"points"\s*:\s*\[\s*"?/, '\n\n')
        .replace(/"?\s*\]\s*\}\s*$/, '')
        .replace(/"\s*\}\s*$/, '')
        .replace(/"\s*,\s*"/g, '\n\n')
        .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\t/g, ' ')
        .replace(/^["']+|["']+$/g, '')
        .trim();
      points = [];
    }
    return { text, points };
  };
  // Render the overview as paragraphs: split on blank lines / newlines, else
  // group the sentences a few at a time so it isn't one wall of text.
  const insParas = (text) => {
    let t = String(text || '').trim(); if (!t) return '';
    let paras;
    if (/\n\s*\n/.test(t)) paras = t.split(/\n\s*\n/);
    else if (/\n/.test(t)) paras = t.split(/\n/);
    else { const sents = t.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [t]; paras = []; for (let i = 0; i < sents.length; i += 3) paras.push(sents.slice(i, i + 3).join('').trim()); }
    return paras.map((p) => p.trim()).filter(Boolean).map((p) => `<p class="j-insights-t">${esc(p)}</p>`).join('');
  };
  const insDate = (b) => { try { return new Date((b.props && b.props.ts) || b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const reading = list.find((x) => x.id === j.readingInsight);
  const insightsCard = `<div class="j-insights ${open ? '' : 'collapsed'}">
      <div class="j-insights-h" data-journal-insights-toggle><span class="acw-chev">${open ? '▾' : '▸'}</span>✨ Insights${list.length ? `<span class="j-insights-ts">${list.length} generated</span>` : ''}</div>
      <div class="j-insights-body">
        <div class="j-ins-actions">
          <button class="add-btn wide" data-journal-insights-read ${list.length ? '' : 'disabled'}>📖 Read insights</button>
          <button class="add-btn wide" data-journal-insights ${j.insightsLoading ? 'disabled' : ''}>${j.insightsLoading ? '✨ Reading your entries…' : '✨ Create insights'}</button>
        </div>
        ${reading ? `<div class="j-ins-read">
          <div class="j-ins-read-h"><span>${esc(insDate(reading))}${reading.props && reading.props.from ? ` · from your last ${reading.props.from} entries` : ''}</span><button class="ghost j-ins-close" data-journal-insights-close title="Close">×</button></div>
          ${(() => { const p = insParsed(reading.props); return `${insParas(p.text)}${p.points.length ? `<ul class="j-insights-pts">${p.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`; })()}</div>` : ''}
        ${list.length ? `<div class="j-ins-list"><div class="j-ins-list-h">Previous insights</div>${list.map((b) => `<button class="j-ins-item ${b.id === j.readingInsight ? 'on' : ''}" data-read-insight="${b.id}"><span class="j-ins-item-date">${esc(insDate(b))}</span><span class="j-ins-item-snip">${esc(insParsed(b.props).text.slice(0, 90))}</span><span class="j-ins-del" data-del-insight="${b.id}" title="Delete this insight">×</span></button>`).join('')}</div>`
          : '<div class="home-empty" style="padding:8px 0 4px">No insights yet. Create one and it reads back your recent entries - the themes, what lifts you, what drains you.</div>'}
      </div>
    </div>`;
  $('#pane').innerHTML = `
    ${pageCrumb('Reflection')}
    <div class="pane-head home-head"><h1>Reflection</h1>${j.picking ? '' : `<div class="j-head-act"><div class="j-head-primary"><button class="add-btn wide j-mode-btn" data-journal-start><span class="jm-ic">📓</span><span class="jm-t">Journal</span></button><button class="add-btn wide j-mode-btn" data-journal-coaching><span class="jm-ic">🧭</span><span class="jm-t">Coaching</span></button><button class="add-btn wide j-mode-btn" data-journal-dream title="Write a dream and get a gentle interpretation"><span class="jm-ic">💭</span><span class="jm-t">Dreams</span></button><button class="add-btn wide j-mode-btn" data-spirit-open title="Draw a card for a moment's reflection"><span class="jm-ic">🃏</span><span class="jm-t">Spirit Cards</span></button></div></div>`}</div>
    ${j.picking ? '' : spiritPinnedHtml()}
    ${picker}
    ${insightsCard}
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
  recordRecent('journal', id, entry.title || 'Reflection entry', blockAreas(entry)[0]);
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
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button>${sep}<button class="crumb" data-open-journal>Reflection</button>${sep}<span class="crumb cur">${esc(dateLabel)}</span>
      <span class="crumb-tools"><button class="note-del ghost" data-del-journal title="Delete this entry">Delete</button></span></div>
    <div class="j-entry">
      <div class="j-entry-head"><h1 class="j-entry-date">${esc(dateLabel)}</h1>${mode ? `<span class="j-card-mode">${mode.icon} ${esc(mode.label)}</span>` : ((n.props && n.props.mode) === 'coaching' ? '<span class="j-card-mode">🧭 Coaching session</span>' : '')}</div>
      <div class="note-body">${proseEditor(n.body, 'journal', n.id)}</div>
      <div class="j-deeper-bar">
        ${(n.props && n.props.mode) === 'coaching'
          ? `<button class="add-btn j-coach-btn" data-journal-coach>🧭 Continue session</button>
             <span class="j-deeper-hint">Write your reply above, then continue - the coach reads the whole session and responds. Keep going as long as you like.</span>`
          : `<button class="add-btn j-deeper" data-journal-deeper>${journalDeeperLabel(n.props && n.props.mode)}</button>
             <button class="add-btn j-empathy-btn" data-journal-empathy title="A warm, understanding reflection - the sort of thing a good therapist might say. No advice, no judgement.">♡ Empathy</button>
             <span class="j-deeper-hint">Dig deeper asks one question to take it further. Empathy gives a warm, understanding reflection. Use either as often as you like.</span>`}
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
      saveProse('journal', ed.innerHTML, ed.dataset.blockId);
      const p = ed.lastElementChild;
      if (p) { const r = document.createRange(); r.selectNodeContents(p); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); p.scrollIntoView({ block: 'center' }); }
    }
  } catch (e) { toast(e.message); }
  finally { const b = document.querySelector('[data-journal-deeper]'); if (b) { b.disabled = false; b.textContent = journalDeeperLabel(n.props && n.props.mode); } }
}
// Empathy: a warm, validating reflection (no question), inserted as its own soft
// callout. Marked with a leading 🫶 so decorateProse can re-style it on reload
// (sanitizeProse strips the class, but the marker survives in the text).
async function journalEmpathise() {
  const n = state.journal && state.journal.current; if (!n) return;
  const ed = document.querySelector('.prose[data-prose="journal"]');
  const text = ed ? (ed.innerText || '').trim() : '';
  const btn = document.querySelector('[data-journal-empathy]');
  if (btn) { btn.disabled = true; btn.textContent = '♡ Listening…'; }
  try {
    const { question } = await api('/api/journal/deepen', { method: 'POST', body: JSON.stringify({ kind: 'empathy', mode: n.props && n.props.mode, prompt: n.props && n.props.prompt, text }) });
    if (ed && question) {
      ed.insertAdjacentHTML('beforeend', `<blockquote class="j-empathy">🫶 ${esc(question).replace(/\n+/g, '<br>')}</blockquote><p><br></p>`);
      saveProse('journal', ed.innerHTML, ed.dataset.blockId);
      const p = ed.lastElementChild;
      if (p) { const r = document.createRange(); r.selectNodeContents(p); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); p.scrollIntoView({ block: 'center' }); }
    }
  } catch (e) { toast(e.message); }
  finally { const b = document.querySelector('[data-journal-empathy]'); if (b) { b.disabled = false; b.textContent = '♡ Empathy'; } }
}
// The coach: an ongoing session. Each press reads the whole entry (its own turns
// marked 🧭) and appends the next coaching message, then a blank line to reply.
async function journalCoach() {
  const n = state.journal && state.journal.current; if (!n) return;
  const ed = document.querySelector('.prose[data-prose="journal"]');
  const text = ed ? (ed.innerText || '').trim() : '';
  const btn = document.querySelector('[data-journal-coach]');
  const label = btn ? btn.textContent : '🧭 Coach';
  if (btn) { btn.disabled = true; btn.textContent = '🧭 Thinking…'; }
  try {
    const { reply } = await api('/api/journal/coach', { method: 'POST', body: JSON.stringify({ mode: n.props && n.props.mode, prompt: n.props && n.props.prompt, text }) });
    if (ed && reply) {
      ed.insertAdjacentHTML('beforeend', `<blockquote class="j-coach">🧭 ${esc(reply).replace(/\n+/g, '<br>')}</blockquote><p><br></p>`);
      saveProse('journal', ed.innerHTML, ed.dataset.blockId);
      const p = ed.lastElementChild;
      if (p) { const r = document.createRange(); r.selectNodeContents(p); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); p.scrollIntoView({ block: 'center' }); }
    }
  } catch (e) { toast(e.message); }
  finally { const b = document.querySelector('[data-journal-coach]'); if (b) { b.disabled = false; b.textContent = label; } }
}
async function delJournalEntry() {
  const n = state.journal && state.journal.current; if (!n) return;
  if (!(await uiConfirm('Delete this journal entry?', { title: 'Delete entry', okLabel: 'Delete', danger: true }))) return;
  try { await api(`/api/blocks/${n.id}`, { method: 'DELETE' }); if (state.journal.entries) state.journal.entries = state.journal.entries.filter((e) => e.id !== n.id); state.journal.current = null; await openJournal(); } catch (e) { toast(e.message); }
}

// ── Read & Watch (bookmarks) ─────────────────────────
// Saved links: blocks kind 'bookmark', props {url,title,image,site,media,status,added}.
// Captured via the iOS Shortcut / desktop bookmarklet (/api/capture) or pasted here.
const RW_SORTS = [['added-desc', 'Newest'], ['added-asc', 'Oldest'], ['title', 'Title A–Z'], ['media', 'Type']];
function rwSortList(list, sort) {
  const added = (b) => String((b.props && b.props.added) || b.created_at || '');
  const title = (b) => String((b.props && b.props.title) || b.title || '').toLowerCase();
  const media = (b) => String((b.props && b.props.media) || 'article');
  const s = list.slice();
  if (sort === 'added-asc') s.sort((a, b) => added(a).localeCompare(added(b)));
  else if (sort === 'title') s.sort((a, b) => title(a).localeCompare(title(b)));
  else if (sort === 'media') s.sort((a, b) => media(a).localeCompare(media(b)) || added(b).localeCompare(added(a)));
  else s.sort((a, b) => added(b).localeCompare(added(a)));   // newest first (default)
  return s;
}
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
  const savedSort = (() => { try { return localStorage.getItem('life.rwSort'); } catch { return null; } })();
  try { state.rw = { items: await api('/api/blocks?kind=bookmark&parent_id='), filter: prev.filter || 'todo', sort: prev.sort || savedSort || 'added-desc', addType: prev.addType, setup: prev.setup, showSetup: false, saving: false }; }
  catch (e) { state.rw = { items: [], filter: 'todo' }; toast(e.message); }
  state.rw.items.sort((a, b) => String((b.props && b.props.added) || b.created_at || '').localeCompare(String((a.props && a.props.added) || a.created_at || '')));
  renderReadwatch();
}
function renderReadwatch() {
  const rw = state.rw || { items: [] };
  const items = rw.items || [];
  const sort = rw.sort || 'added-desc';
  // One list, split by state: unread on top, read below. Ticking the box moves an
  // item between the two. The box IS the read/unread toggle - empty = unread.
  const unread = rwSortList(items.filter((b) => (b.props || {}).status !== 'done'), sort);
  const read = rwSortList(items.filter((b) => (b.props || {}).status === 'done'), sort);
  const card = (b) => {
    const p = b.props || {}; const done = p.status === 'done'; const vid = p.media === 'video'; const book = p.media === 'book'; const film = p.media === 'film';
    // A book/film with no stored link falls back to a web search, so tapping it
    // always leads somewhere (find it, buy it, watch it).
    const href = p.url || (book ? `https://www.google.com/search?q=${encodeURIComponent((p.title || '') + ' book')}`
      : film ? `https://www.google.com/search?q=${encodeURIComponent((p.title || '') + ' film')}`
      : vid ? `https://www.youtube.com/results?search_query=${encodeURIComponent(p.title || '')}` : '#');
    const art = !vid && !book && !film;
    const icon = vid ? '▶' : book ? '📖' : film ? '🎬' : '📰';
    return `<div class="rw-card ${done ? 'done' : ''} ${book ? 'is-book' : ''} ${film ? 'is-film' : ''}">
      <button class="rw-tick ${done ? 'on' : ''}" data-rw-done="${b.id}" role="checkbox" aria-checked="${done}" title="${done ? 'Read - tap to mark unread' : 'Tap when you\'ve read/watched it'}">${done ? '✓' : ''}</button>
      <a class="rw-thumb ${vid ? 'vid' : ''} ${book ? 'book' : ''} ${film ? 'film' : ''} ${art ? 'article' : ''}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="rw-thumb-ic">${icon}</span></a>
      <div class="rw-body">
        <a class="rw-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.title || p.url)}</a>
        <div class="rw-meta"><span class="rw-media">${vid ? '▶ Video' : book ? '📖 Book' : film ? '🎬 Film' : '📰 Article'}</span>${p.site ? `<span class="rw-site">${esc(p.site)}</span>` : ''}<span class="rw-added">${fmtDate(p.added || b.created_at)}</span></div>
      </div>
      <button class="rw-del" data-rw-del="${b.id}" title="Remove">×</button>
    </div>`;
  };
  const section = (label, list, empty) => `<section class="rw-sec"><div class="home-sec-h rw-sec-h">${label}<span class="muted">${list.length}</span></div><div class="rw-list">${list.map(card).join('') || (empty ? `<div class="empty">${empty}</div>` : '')}</div></section>`;
  $('#pane').innerHTML = `
    ${pageCrumb('Read & Watch')}
    <div class="pane-head home-head"><h1>Read &amp; Watch</h1><button class="ghost rw-setup-btn" data-rw-setup title="Set up one-tap saving">⚙ Quick-save</button></div>
    <form class="rw-add" id="rw-add-form"><input id="rw-url" placeholder="Paste a link, or type a book or film title…" autocomplete="off" ${rw.saving ? 'disabled' : ''}><button class="add-btn wide" type="submit" ${rw.saving ? 'disabled' : ''}>${rw.saving ? 'Saving…' : 'Save'}</button></form>
    <div class="rw-type" title="Daybook works out what a title is. Press one only when it guesses wrong.">${[['book', '📖 Book'], ['film', '🎬 Film']].map(([k, l]) => `<button class="rw-type-btn ${rw.addType === k ? 'on' : ''}" data-rw-type="${k}">${l}</button>`).join('')}</div>
    <div id="rw-setup">${rw.showSetup ? rwSetupHtml() : ''}</div>
    ${items.length ? `<div class="rw-sortbar"><select class="rw-sort sel" data-rw-sort title="Order">${RW_SORTS.map(([k, l]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${section('To read &amp; watch', unread, 'All caught up - nothing left.')}${read.length ? section('Finished', read, '') : ''}`
      : '<div class="empty">Nothing here yet. Paste a link above, or set up one-tap saving.</div>'}`;
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
async function rwSave(input) {
  input = (input || '').trim(); if (!input || !state.rw) return;
  // A link (http… or a bare domain with no spaces) is fetched for its metadata;
  // anything else is treated as a book / title recommendation - stored as-is.
  const isLink = /^https?:\/\//i.test(input) || /^[^\s]+\.[a-z]{2,}(\/|\?|#|$)/i.test(input);
  const type = ['film', 'book'].includes(state.rw.addType) ? state.rw.addType : 'auto';
  state.rw.saving = true; renderReadwatch();
  try {
    let bm;
    if (isLink) { bm = await api('/api/bookmark', { method: 'POST', body: JSON.stringify({ url: input }) }); }
    else {
      // Look the title up (poster/cover + year + a link), then store it. The
      // lookup never fails hard: a blank result just gives the bare title.
      let d = { title: input.slice(0, 300), url: '', image: '', site: '', year: '', media: type === 'auto' ? 'book' : type };
      try { d = await api(`/api/lookup?type=${type}&q=${encodeURIComponent(input)}`); } catch {}
      // On 'auto' the server decides which it is, so the answer's media wins.
      const media = d.media || (type === 'auto' ? 'book' : type);
      const props = { title: (d.title || input).slice(0, 300), url: d.url || '', image: d.image || '', site: d.site || '', year: d.year || '', media, status: 'todo', added: new Date().toISOString() };
      bm = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'bookmark', title: props.title, props }) });
    }
    state.rw.items.unshift(bm); state.rw.saving = false; renderReadwatch();
    toast(isLink ? 'Saved' : (bm.props || {}).media === 'film' ? '🎬 Film added' : '📖 Book added');
  } catch (e) { state.rw.saving = false; renderReadwatch(); toast(e.message); }
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
  const tags = blockAreas(b).map((id) => areaById(id)).filter(Boolean)
    .map((a) => `<span class="area-tag" style="--h:${hueOf(a)}"><span class="cd"></span>${esc(a.title)}</span>`).join('');
  return tags ? `<span class="area-tags">${tags}</span>` : '';
}
// A picker to set a block's life area, used on note and table pages.
function areaSelect(cur, attr) {
  return `<span class="area-pick"><select class="area-sel" ${attr}><option value="">+ Life area</option>${
    state.areas.map((a) => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${esc(a.title)}</option>`).join('')
  }</select></span>`;
}
// A note can sit in several life areas. Each shows as a removable chip that also
// links to its area; the dropdown lists the areas it isn't in yet, so picking one
// adds it. With none chosen it's just the familiar "+ Life area" control.
function noteAreasControl(n) { return blockAreasControl('note', n); }
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
    ${favAreas.length ? `<section class="home-sec"><div class="home-sec-h">Starred</div><div class="area-cards">${favAreas.map(card).join('')}</div></section>` : ''}
    <section class="home-sec"><div class="home-sec-h">All areas · ${state.areas.length}</div>
      <div class="area-cards">${state.areas.map(card).join('') || '<div class="empty">No life areas yet.</div>'}</div></section>`;
}
async function openArea(id) {
  state.view = { type: 'area', id };
  const [area, blocks] = await Promise.all([api(`/api/blocks/${id}`), api(`/api/blocks?area=${id}`)]);
  state.area_open = { area, blocks };
  recordRecent('area', id, area.title);
  renderNav(); renderArea();
}
function renderArea() {
  const { area, blocks } = state.area_open;
  const tasks = blocks.filter((b) => b.kind === 'task');
  const openTs = tasks.filter((t) => !t.props.done).sort((a, b) => (PRIO_ORDER[a.props.priority || ''] || 5) - (PRIO_ORDER[b.props.priority || ''] || 5));
  const doneN = tasks.length - openTs.length;
  const tables = blocks.filter((b) => b.kind === 'table');
  // Every note that carries this area shows here. The 2026-08-12 cleanup pruned
  // the area off notes nested deeper than first level (they had inherited it on
  // import), so this stays a readable outline - and any note you now
  // associate with the area appears here, whatever its depth.
  // Notes filed from an email are their own "Emails" section; the rest are notes.
  const allNotes = blocks.filter((b) => b.kind === 'note');
  const emails = allNotes.filter((n) => n.props && n.props.fromEmail);
  const notes = allNotes.filter((n) => !(n.props && n.props.fromEmail));
  const goals = blocks.filter((b) => b.kind === 'goal');
  const bucket = blocks.filter((b) => b.kind === 'bucket');
  const contacts = blocks.filter((b) => b.kind === 'contact');
  const bookmarks = blocks.filter((b) => b.kind === 'bookmark');
  const journals = blocks.filter((b) => b.kind === 'journal');
  const activeGoals = goals.filter((g) => (gp(g).status || 'active') === 'active');
  const h = hueOf(area);
  const visImgs = ((area.props && area.props.attachments) || []).filter((x) => isImgType(x.type));
  const visionInner = `<button class="vision-card area-vision" data-open-vision="${area.id}" style="--h:${h}">${(area.props && (area.props.vision || '').trim()) ? `<div class="vc-text">${esc(area.props.vision)}</div>` : '<div class="vc-empty">Picture this area at its best — tap to write your vision and add images.</div>'}${visImgs.length ? `<div class="vc-thumbs">${visImgs.slice(0, 5).map((im) => `<img data-vimg="${area.id}:${im.id}" alt="">`).join('')}</div>` : ''}</button>`;
  const tblCards = tables.map((t) => `<button class="tbl-card" data-open-table="${t.id}"><span class="tc-ic ico-tbl">▦</span><span class="tc-t">${esc(t.title || 'Untitled')}</span></button>`).join('');
  const isFav = (n) => !!(n.props && n.props.fav);
  const starredNotes = notes.filter(isFav);
  const otherNotes = notes.filter((n) => !isFav(n));
  const noteCard = (n, starred) => `<button class="tbl-card" data-open-note="${n.id}">${starred ? '<span class="tc-lead-star">★</span>' : ''}${(n.props && n.props.fromEmail) ? '<span class="tc-mail" title="Filed from an email">✉</span>' : ''}<span class="tc-t">${esc(n.title || 'Untitled')}</span></button>`;
  const starredNoteCards = starredNotes.map((n) => noteCard(n, true)).join('');
  const noteCards = otherNotes.map((n) => noteCard(n, false)).join('');
  // Everything else that can carry this area, each linking to its own tool.
  const emailCards = emails.map((n) => `<button class="tbl-card" data-open-note="${n.id}"><span class="tc-mail" title="Filed from an email">✉</span><span class="tc-t">${esc(n.title || 'Untitled')}</span></button>`).join('');
  const contactCards = contacts.map((c) => `<button class="tbl-card" data-open-contact="${c.id}"><span class="tc-ic">👤</span><span class="tc-t">${esc(c.title || 'Unnamed')}</span></button>`).join('');
  const bookmarkCards = bookmarks.map((bm) => { const u = (bm.props && bm.props.url) || ''; return u ? `<a class="tbl-card" href="${esc(u)}" target="_blank" rel="noopener noreferrer"><span class="tc-ic">🔖</span><span class="tc-t">${esc(bm.title || u)}</span></a>` : `<button class="tbl-card"><span class="tc-ic">🔖</span><span class="tc-t">${esc(bm.title || 'Saved')}</span></button>`; }).join('');
  const journalCards = journals.map((j) => `<button class="tbl-card" data-open-jentry="${j.id}"><span class="tc-ic">✎</span><span class="tc-t">${esc(j.title || 'Journal entry')}</span></button>`).join('');
  const sec = (label, n, inner) => n ? `<section class="home-sec"><div class="home-sec-h">${label} · ${n}</div>${inner}</section>` : '';
  $('#pane').innerHTML = `
    <div class="area-hero" style="--h:${h}">
      <div class="area-hero-top">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-areas>Life areas</button>
        ${shareBtn(area, 'area')}${area.sharedBy ? '' : '<button class="area-gear" data-area-color title="Customise this area\'s colour">⚙</button>'}<button class="star ${area.props && area.props.fav ? 'on' : ''}" data-fav="${area.id}" title="Favourite">${area.props && area.props.fav ? '★' : '☆'}</button></div>
      <h1><span class="ac-dot"></span><input class="area-title-edit" id="area-title" value="${esc(area.title)}" placeholder="Life area" data-area-rename ${area.sharedBy ? 'readonly' : ''}></h1>
      <p class="area-meta">${notes.length} note${notes.length === 1 ? '' : 's'} · ${tables.length} table${tables.length === 1 ? '' : 's'} · ${openTs.length} open task${openTs.length === 1 ? '' : 's'}${(() => { const m = focusMinsFor('area', area.id); return m ? ` · 🍅 ${fmtMins(m)} focused` : ''; })()}</p>
      ${sharedBanner(area)}
      ${area.sharedBy ? '' : '<div class="area-actions"><button class="add-btn wide" data-area-add-bucket>+ Bucket</button><button class="add-btn wide" data-area-add-goal>+ Goal</button><button class="add-btn wide" data-area-add-task>+ Task</button><button class="add-btn wide" data-area-add-note>+ Note</button></div>'}
    </div>
    <section class="home-sec"><div class="home-sec-h">Vision</div>${visionInner}</section>
    ${sec('Goals', activeGoals.length, `<div class="goal-grid">${activeGoals.map(goalCardMini).join('')}</div>`)}
    ${sec('Bucket list', bucket.length, `<div class="bucket-grid">${bucket.map(bucketCard).join('')}</div>`)}
    ${sec('Starred notes', starredNotes.length, `<div class="tbl-cards">${starredNoteCards}</div>`)}
    ${sec('Notes', otherNotes.length, `<div class="tbl-cards">${noteCards}</div>`)}
    ${sec('Emails', emails.length, `<div class="tbl-cards">${emailCards}</div>`)}
    ${sec('Tables', tables.length, `<div class="tbl-cards">${tblCards}</div>`)}
    ${sec('Contacts', contacts.length, `<div class="tbl-cards">${contactCards}</div>`)}
    ${sec('Saved links', bookmarks.length, `<div class="tbl-cards">${bookmarkCards}</div>`)}
    ${sec('Reflections', journals.length, `<div class="tbl-cards">${journalCards}</div>`)}
    ${sec('Tasks', openTs.length, taskTableHtml(openTs, 'No open tasks here.'))}`;
  visImgs.forEach(async (im) => { const el = document.querySelector(`img[data-vimg="${area.id}:${im.id}"]`); if (el && !el.dataset.loaded) { try { el.src = await attUrl(area.id, im); el.dataset.loaded = '1'; } catch {} } });
}
async function setBlockArea(kind, id, areaId) {
  try {
    await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { area: areaId || null } }) });
    const bump = (b) => { if (b) { b.props = b.props || {}; b.props.area = areaId || null; } };
    if (kind === 'note') { bump(state.note && state.note.current); bump(state.noteTops.find((n) => n.id === id)); }
    if (kind === 'table') { bump(state.tables_open); bump(state.tables.find((t) => t.id === id)); }
    if (kind === 'contact') { bump(state.contact_open && state.contact_open.contact); bump((state.contacts || []).find((x) => x.id === id)); }
    toast(areaId ? 'Life area set' : 'Life area cleared');
  } catch (e) { toast(e.message); }
}
// Set a note's full list of life areas. props.area mirrors the first so any
// single-area reader (and older code) still works. Updates the in-memory copies
// and re-renders before the save so the chips feel instant.
async function setNoteAreas(id, ids) {
  ids = [...new Set(ids.filter(Boolean))];
  const props = { areas: ids, area: ids[0] || null };
  const bump = (b) => { if (b) { b.props = b.props || {}; b.props.areas = ids; b.props.area = ids[0] || null; } };
  bump(state.note && state.note.current); bump(state.noteTops && state.noteTops.find((n) => n.id === id));
  if (state.note && state.note.current && state.note.current.id === id) renderNote();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props }) }); } catch (e) { toast(e.message); }
}
function addNoteArea(id, areaId) { if (!areaId) return; const cur = blockAreas(state.note && state.note.current); setNoteAreas(id, [...cur, areaId]); toast('Added to life area'); }
function removeNoteArea(id, areaId) { const cur = blockAreas(state.note && state.note.current); setNoteAreas(id, cur.filter((x) => x !== areaId)); }
// ── Life areas on any block ──────────────────────────────────────────
// Every card that carries a life area lets you attach more than one. The list
// lives in props.areas; props.area mirrors the first so single-area readers - the
// Today lane map, task filters, the ?area= listing, older code - keep working.
// One control and one setter serve notes, tasks, contacts, tables, goals and
// bucket items alike. Each host names where its live copies live and how to
// repaint the open card once the areas change.
const AREA_HOSTS = {
  note:    { copies: () => [state.note && state.note.current, ...(state.noteTops || [])], render: () => { if (state.view.type === 'note') renderNote(); } },
  task:    { copies: () => [state.task_open && state.task_open.task, ...(state.tasks || [])], render: () => { if (state.view.type === 'taskcard') renderTaskCard(); } },
  contact: { copies: () => [state.contact_open && state.contact_open.contact, ...(state.contacts || [])], render: () => { if (state.view.type === 'contactcard') renderContactCard(); } },
  table:   { copies: () => [state.tables_open, ...(state.tables || [])], render: () => { if (state.view.type === 'table') renderTable(); } },
  goal:    { copies: () => [state.goal_open && state.goal_open.goal, ...(state.goals || [])], render: () => { if (state.view.type === 'goalcard') renderGoalCard(); } },
  bucket:  { copies: () => [state.bucket_open && state.bucket_open.item, ...(state.bucket || [])], render: () => { if (state.view.type === 'bucketcard') renderBucketCard(); } },
};
const areaHostBlock = (kind, id) => { const h = AREA_HOSTS[kind]; return h ? (h.copies() || []).find((b) => b && b.id === id) || null : null; };
async function setBlockAreas(kind, id, ids) {
  ids = [...new Set(ids.filter(Boolean))];
  const props = { areas: ids, area: ids[0] || null };
  const h = AREA_HOSTS[kind];
  if (h) { for (const b of (h.copies() || [])) { if (b && b.id === id) { b.props = b.props || {}; b.props.areas = ids; b.props.area = ids[0] || null; } } h.render(); }
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props }) }); } catch (e) { toast(e.message); }
}
function addBlockArea(kind, id, areaId) { if (!areaId) return; setBlockAreas(kind, id, [...blockAreas(areaHostBlock(kind, id)), areaId]); }
function removeBlockArea(kind, id, areaId) { setBlockAreas(kind, id, blockAreas(areaHostBlock(kind, id)).filter((x) => x !== areaId)); }
// The chip + picker. Each attached area is a chip that links through to its page
// and carries an x to drop it; the dropdown offers the areas not yet attached.
// With none chosen it reads as the familiar "+ Life area".
function blockAreasControl(kind, b) {
  const id = b.id; const ids = blockAreas(b);
  const chips = ids.map((aid) => { const a = areaById(aid); if (!a) return ''; return `<span class="area-chip-pick" style="--h:${hueOf(a)}"><button class="acp-link" data-open-area="${aid}"><span class="cd"></span>${esc(a.title)}</button><button class="acp-x" data-area-remove="${kind}:${id}:${aid}" title="Remove from this area">×</button></span>`; }).join('');
  const remaining = state.areas.filter((a) => !ids.includes(a.id));
  const add = remaining.length ? `<span class="area-pick"><select class="area-sel" data-area-add="${kind}:${id}"><option value="">${ids.length ? '+ Add area' : '+ Life area'}</option>${remaining.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select></span>` : '';
  return `<span class="note-areas">${chips}${add}</span>`;
}
// From a life-area page: create a task/note already tagged to this area, then
// open it for naming. It shows up in the Tasks/Notes lists too.
async function areaAddTask() {
  const area = state.area_open && state.area_open.area; if (!area) return;
  // Open the Tasks add form pre-tagged to this area, rather than pre-creating an
  // empty placeholder task and hoping the naming step lands - that left orphaned,
  // title-less tasks whenever the name never saved (e.g. a write failed).
  state.taskAddArea = area.id;
  state.taskAdding = true; state.taskFocusArm = Date.now();
  await openTasks(); renderTasks();
}
async function areaAddNote() {
  const area = state.area_open && state.area_open.area; if (!area) return;
  try {
    const n = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title: '', parent_id: null, props: { area: area.id } }) });
    state.noteTops.unshift(n);
    await openNote(n.id); setTimeout(() => $('#note-title') && $('#note-title').focus(), 30);
  } catch (e) { toast(e.message); }
}
// Customise a life area's colour. A hue is all an area stores (saturation and
// lightness are fixed, so every area sits in the same tonal family); the picker
// offers a spread of swatches plus a slider, previews live across the page, and
// on Done saves props.hue - which the whole app then follows.
const AREA_HUES = [0, 20, 40, 65, 90, 130, 160, 185, 210, 235, 265, 290, 320, 345];
function openAreaColor() {
  const area = state.area_open && state.area_open.area; if (!area || area.sharedBy) return;
  const start = hueOf(area);
  let hue = start;
  const el = uiDialogHost();
  el.innerHTML = `<div class="pal-bg"><div class="recur-dialog ui-dialog-box areacol-dialog" style="--h:${start}">
    <div class="recur-h">Area colour</div>
    <p class="recur-p">Pick the colour for <b>${esc(area.title || 'this area')}</b>. It follows everywhere the area appears - tasks, notes, Home and more.</p>
    <div class="areacol-swatches">${AREA_HUES.map((hu) => `<button class="areacol-sw${hu === start ? ' on' : ''}" style="--h:${hu}" data-areacol="${hu}" aria-label="Hue ${hu}"></button>`).join('')}</div>
    <label class="areacol-fine">Fine tune<input type="range" min="0" max="359" value="${start}" class="areacol-slider" data-areacol-slider></label>
    <div class="ui-dialog-btns"><button class="ui-btn cancel" data-areacol-cancel>Cancel</button><button class="ui-btn primary" data-areacol-done>Done</button></div>
  </div></div>`;
  const box = el.querySelector('.areacol-dialog');
  const preview = (h) => { hue = h; document.querySelectorAll('.area-hero').forEach((x) => x.style.setProperty('--h', h)); box.style.setProperty('--h', h); el.querySelectorAll('.areacol-sw').forEach((sw) => sw.classList.toggle('on', +sw.dataset.areacol === h)); box.querySelector('.areacol-slider').value = h; };
  const close = () => { el.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const cancel = () => { close(); renderArea(); };   // renderArea repaints from the stored (unchanged) hue
  const commit = async () => {
    close();
    if (hue !== start) {
      area.props = { ...(area.props || {}), hue };
      const s = state.areas.find((x) => x.id === area.id); if (s) s.props = { ...(s.props || {}), hue };
      api(`/api/blocks/${area.id}`, { method: 'PATCH', body: JSON.stringify({ props: { hue } }) }).catch((e) => toast(e.message));
      renderNav();
    }
    renderArea();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } else if (e.key === 'Enter') { e.preventDefault(); commit(); } };
  document.addEventListener('keydown', onKey, true);
  el.querySelector('.pal-bg').addEventListener('click', (e) => { if (e.target.classList.contains('pal-bg')) cancel(); });
  el.querySelectorAll('[data-areacol]').forEach((b) => b.addEventListener('click', () => preview(+b.dataset.areacol)));
  el.querySelector('[data-areacol-slider]').addEventListener('input', (e) => preview(+e.target.value));
  el.querySelector('[data-areacol-cancel]').addEventListener('click', cancel);
  el.querySelector('[data-areacol-done]').addEventListener('click', commit);
}

// ── view: calendar ───────────────────────────────────
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`; // m is 0-based
const todayISO = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth(), d.getDate()); };

// ── date picker (custom, always Monday-first) ─────────────────────────────
// The native <input type=date> popup takes its week-start from the browser's
// locale, which a web page can't override - so it kept showing Sunday-first.
// This controlled popover always starts on Monday and writes the ISO value
// into a hidden input, so existing readers ($('#id').value) keep working.
const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dpLabel(iso) {
  // A yearless birthday: no weekday either, since it isn't the same day each year.
  const ny = /^--(\d{2})-(\d{2})$/.exec(iso || '');
  if (ny) return `${Number(ny[2])} ${MONTHS_LONG[Number(ny[1]) - 1]}`;
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'Pick a date';
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW_ABBR[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}
function dateFieldHtml(id, iso) {
  return `<input type="hidden" id="${id}" value="${esc(iso || '')}"><button type="button" class="date-field sel" data-dp-open="${id}">${esc(dpLabel(iso))}</button>`;
}
function openDatePicker(id) {
  const inp = document.getElementById(id); if (!inp) return;
  // Only a birthday may go without a year; a due date or an event without one
  // would be meaningless.
  const optionalYear = /-bday$/.test(id);
  const cur = inp.value || '';
  const noYear = optionalYear && /^--\d{2}-\d{2}$/.test(cur);
  // With no year, lay the grid out on this year - it only decides which weekday
  // each date falls on, and none of that is stored.
  const iso = noYear ? `${new Date().getFullYear()}-${cur.slice(2)}`
    : (/^\d{4}-\d{2}-\d{2}$/.test(cur) ? cur : todayISO());
  const [y, m] = iso.split('-').map(Number);
  // An event's end can't fall before its start, so the end picker greys out any
  // day earlier than the chosen start.
  const min = id === 'ce-enddate' ? ((document.getElementById('ce-date') || {}).value || null) : null;
  state.dp = { id, y, m: m - 1, min, optionalYear, noYear };
  renderDatePicker();
}
// Newest first, so this year and the next few sit at the top where a due date or
// a snooze wants them. A birthday scrolls to its decade, which beats stepping the
// month arrow six hundred times.
function dpYears(selected) {
  const now = new Date().getFullYear();
  const hi = Math.max(now + 10, selected || 0);
  const lo = Math.min(now - 120, selected || now);
  const out = [];
  for (let y = hi; y >= lo; y--) out.push(y);
  return out;
}
function renderDatePicker() {
  const dp = state.dp; if (!dp) return;
  let el = document.getElementById('dp-pop');
  if (!el) { el = document.createElement('div'); el.id = 'dp-pop'; document.body.appendChild(el); }
  const inp = document.getElementById(dp.id);
  const cur = inp ? inp.value : ''; const today = todayISO();
  const startDow = (new Date(dp.y, dp.m, 1).getDay() + 6) % 7;   // Monday = 0
  const start = new Date(dp.y, dp.m, 1 - startDow);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = ymd(d.getFullYear(), d.getMonth(), d.getDate());
    const cls = ['dp-day'];
    if (d.getMonth() !== dp.m) cls.push('dp-other');
    if (iso === cur) cls.push('dp-sel');
    if (iso === today) cls.push('dp-today');
    const disabled = dp.min && iso < dp.min;
    if (disabled) cls.push('dp-disabled');
    cells += `<button type="button" class="${cls.join(' ')}"${disabled ? ' disabled' : ` data-dp-pick="${iso}"`}>${d.getDate()}</button>`;
  }
  el.innerHTML = `<div class="dp-bg" data-dp-close><div class="dp-cal" role="dialog" aria-label="Pick a date">
    <div class="dp-head"><button type="button" class="dp-nav" data-dp-step="-1" aria-label="Previous month">‹</button>
      <span class="dp-title">
        <select class="dp-pick" data-dp-month aria-label="Month">${MONTHS_LONG.map((mn, i) => `<option value="${i}" ${i === dp.m ? 'selected' : ''}>${mn}</option>`).join('')}</select>
        <select class="dp-pick dp-year" data-dp-year aria-label="Year">${dp.optionalYear ? `<option value="" ${dp.noYear ? 'selected' : ''}>Year</option>` : ''}${dpYears(dp.y).map((y) => `<option value="${y}" ${!dp.noYear && y === dp.y ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </span>
      <button type="button" class="dp-nav" data-dp-step="1" aria-label="Next month">›</button></div>
    <div class="dp-dows">${WEEKDAYS.map((w) => `<span>${w[0]}</span>`).join('')}</div>
    <div class="dp-grid">${cells}</div>
    <div class="dp-foot"><button type="button" class="dp-link" data-dp-jump-today>Today</button></div>
  </div></div>`;
}
function closeDatePicker() { const el = document.getElementById('dp-pop'); if (el) el.innerHTML = ''; state.dp = null; }
// Set a date field's value and refresh its button label. No change event, so a
// caller adjusting one field in response to another can't loop.
function setDateField(id, iso) {
  const inp = document.getElementById(id); if (!inp) return;
  inp.value = iso || '';
  const btn = document.querySelector(`[data-dp-open="${id}"]`); if (btn) btn.textContent = dpLabel(iso);
}
function datePick(iso) {
  const dp = state.dp; if (!dp) return;
  const inp = document.getElementById(dp.id);
  if (inp) {
    // A birthday with the year left off keeps only the day and month, in vCard's
    // --MM-DD form. Which is what most birthdays actually are: you know it's the
    // 3rd of September, and the year is either private or not the point.
    setDateField(dp.id, dp.noYear ? `--${iso.slice(5)}` : iso);
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeDatePicker();
}
function dpStep(delta) {
  const dp = state.dp; if (!dp) return;
  let m = dp.m + delta, y = dp.y;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  dp.m = m; dp.y = y; renderDatePicker();
}
const addDayISO = (iso, n = 1) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
const isoToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minToLabel = (m) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const prettyDate = (iso) => { const [y, mo, d] = iso.split('-').map(Number); const dt = new Date(y, mo - 1, d); return `${WEEKDAYS_LONG[dt.getDay()]} ${d} ${MONTHS_LONG[mo - 1]}`; };

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
// A rolling 7-day window starting from `iso` (today by default) - today + the
// next 6 days, rather than snapping back to Monday. Each cell shows its own
// weekday since the window no longer lines up with Mon-Sun.
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekDays(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(y, m - 1, d + i); const di = ymd(x.getFullYear(), x.getMonth(), x.getDate()); return { iso: di, day: x.getDate(), mon: x.getMonth(), dow: DOW3[x.getDay()], today: di === todayISO() }; });
}
async function openCalendar(dateStr) {
  const base = dateStr || (state.cal && state.cal.selected) || todayISO();
  const [y, m] = base.split('-').map(Number);
  // weekAnchor = the first day of the rolling week window (today by default),
  // kept separate from `selected` so clicking a day doesn't shift the window.
  state.cal = { y, m: m - 1, selected: base, weekAnchor: todayISO(), mode: localStorage.getItem('life.calMode') === 'week' ? 'week' : 'month', events: [], error: null, editing: null, adding: false };
  state.view = { type: 'calendar' };
  renderNav(); renderCalendar();
  // The connect flow bounces back to /calendar?gcal=... - surface the outcome once.
  try {
    const g = new URLSearchParams(location.search).get('gcal');
    if (g) { history.replaceState(null, '', location.pathname); toast(g === 'connected' ? 'Google Calendar connected' : g === 'denied' ? 'Calendar connect cancelled' : 'Could not connect the calendar - try again'); }
  } catch {}
  api('/api/gcal/status').then((s) => { state.gcal = s; if (state.view.type === 'calendar') renderCalendar(); }).catch(() => {});
  await loadCalendar();
}
async function loadCalendar() {
  let from, to;
  if (state.cal.mode === 'week') { const wk = weekDays(state.cal.weekAnchor || todayISO()); from = wk[0].iso; to = wk[6].iso; }
  else { const weeks = monthWeeks(state.cal.y, state.cal.m); from = weeks[0][0].iso; to = weeks[5][6].iso; }
  try {
    const r = await api(`/api/calendar?from=${from}&to=${to}`);
    state.cal.events = r.events || []; state.cal.error = r.error || null;
  } catch (e) { state.cal.error = e.message; }
  if (state.view.type === 'calendar') renderCalendar();
}
// The member Google-connect strip. Hidden for the owner (who reads the shared
// Workspace calendar) and when the member calendar client isn't configured yet.
function gcalBarHtml() {
  const s = state.gcal;
  if (!s || !s.available) return '';
  if (state.me && state.me.id === 1) return '';
  if (s.connected) return `<div class="gcal-bar connected"><span class="gcal-dot"></span><span class="gcal-t">Google Calendar connected${s.email ? ` · ${esc(s.email)}` : ''}</span><button class="ghost gcal-x" data-gcal-disconnect>Disconnect</button></div>`;
  return `<div class="gcal-bar"><span class="gcal-t">See your own Google Calendar events here alongside your Daybook ones.</span><button class="add-btn wide" data-gcal-connect>Connect Google Calendar</button></div>`;
}
async function gcalConnect() {
  try { const r = await api('/api/gcal/connect'); if (r && r.url) location.href = r.url; else toast('Calendar connect is not set up yet.'); }
  catch (e) { toast(e.message); }
}
async function gcalDisconnect() {
  if (!(await uiConfirm('Disconnect your Google Calendar? Your Google events will stop showing in Daybook.', { okLabel: 'Disconnect', danger: true }))) return;
  try { await api('/api/gcal/disconnect', { method: 'POST' }); state.gcal = { ...(state.gcal || {}), connected: false, email: null }; toast('Google Calendar disconnected'); if (state.view.type === 'calendar') { renderCalendar(); loadCalendar(); } }
  catch (e) { toast(e.message); }
}
function setCalMode(mode) { state.cal.mode = mode; localStorage.setItem('life.calMode', mode); state.cal.adding = false; state.cal.editing = null; renderCalendar(); loadCalendar(); }
function stepCal(delta) {
  if (state.cal.mode === 'week') { state.cal.weekAnchor = addDayISO(state.cal.weekAnchor || todayISO(), delta * 7); state.cal.selected = state.cal.weekAnchor; const [y, m] = state.cal.selected.split('-').map(Number); state.cal.y = y; state.cal.m = m - 1; }
  else { let m = state.cal.m + delta, y = state.cal.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } state.cal.y = y; state.cal.m = m; }
  state.cal.adding = false; state.cal.editing = null; renderCalendar(); loadCalendar();
}
function renderCalendar() {
  const c = state.cal, byDay = eventsByDay();
  let title, body;
  if (c.mode === 'week') {
    const wk = weekDays(c.weekAnchor || todayISO()), a = wk[0], b = wk[6];
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
      <span class="cal-ag-t">${esc(e.title)}${e.url ? '<span class="cal-ag-join" title="Has a video meeting link">🎥</span>' : ''}</span>${e.location ? `<span class="cal-ag-loc">${esc(e.location)}</span>` : ''}</button>`).join('')
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
    ${gcalBarHtml()}
    <input class="list-search sel" data-cal-q placeholder="Search calendar…" value="${esc(state.calQuery || '')}" autocomplete="off">
    ${c.error && c.error !== null ? `<div class="cal-warn">Calendar: ${esc(String(c.error))}</div>` : ''}
    ${cq ? searchBlock : `<section class="cal-agenda cal-agenda-top">
      <div class="cal-ag-head"><h2>${c.selected === todayISO() ? 'Today: ' : ''}${prettyDate(c.selected)}</h2><button class="add-btn wide" data-cal-add>+ Event</button></div>
      <div id="cal-form"></div>
      <div class="cal-ag-list">${agendaRows}</div>
    </section>
    ${body}`}`;
  if (c.adding) showCalForm();
  else if (c.editing) showCalForm(c.editing);
}
// Any http(s) links inside an event's notes, rendered as tappable chips under the
// notes box - so links saved from an invitation email are one tap away, not just
// text to copy.
function noteLinksHtml(notes) {
  const s = String(notes || ''); const seen = new Set(); const links = []; let m; BARE_URL.lastIndex = 0;
  while ((m = BARE_URL.exec(s))) { const u = m[0]; const k = u.toLowerCase(); if (!seen.has(k)) { seen.add(k); links.push(u); } }
  if (!links.length) return '';
  const label = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  return `<div class="ce-notelinks">${links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">🔗 ${esc(label(u))}</a>`).join('')}</div>`;
}
function showCalForm(ev) {
  const c = state.cal;
  const title = ev ? ev.title : '';
  const allDay = ev ? !!ev.allDay : false;
  const dur = ev && !ev.allDay ? Math.max(15, (ev.end_min ?? ev.start_min + 60) - ev.start_min) : 60;
  const loc = ev ? (ev.location || '') : '';
  const notes = ev ? (ev.notes || '') : '';
  const startDate = ev ? ev.date : (c.selected || todayISO());
  const startTime = ev && !ev.allDay ? minToLabel(ev.start_min) : '09:00';
  // Existing all-day events store an exclusive end (day after the last), so show
  // the inclusive last day. Timed events derive the end from start + duration -
  // rolling to the next day when they cross midnight.
  const endDisplay = ev ? (ev.allDay && ev.end_date ? new Date(Date.parse(ev.end_date) - 86400000).toISOString().slice(0, 10) : ev.date) : startDate;
  let endDate, endTime;
  if (allDay) { endDate = endDisplay; endTime = '10:00'; }
  else { const sMin = ev && !ev.allDay ? ev.start_min : isoToMin(startTime); const eMin = sMin + dur; endDate = addDayISO(startDate, Math.floor(eMin / 1440)); endTime = minToLabel(eMin % 1440); }
  // Start and End each get their own row of date + time. The end defaults to the
  // same day (and an hour on); change it only when you mean to.
  $('#cal-form').innerHTML = `<form id="cal-ev-form" class="add-task add-event${allDay ? ' allday-on' : ''}" data-ev="${ev ? ev.id : ''}" data-evgap="${allDay ? 60 : dur}">
    <input id="ce-title" class="ce-title" placeholder="Event title…" autocomplete="off" required value="${esc(title)}">
    ${ev && ev.url ? `<a class="ce-join" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">🎥 Join the meeting</a>` : ''}
    <div class="ce-when">
      <div class="ce-when-row"><span class="ce-when-lbl">Starts</span><span class="ce-when-fields">${dateFieldHtml('ce-date', startDate)}<input id="ce-time" type="time" class="sel ce-timefield" value="${startTime}"></span></div>
      <div class="ce-when-row"><span class="ce-when-lbl">Ends</span><span class="ce-when-fields">${dateFieldHtml('ce-enddate', endDate)}<input id="ce-endtime" type="time" class="sel ce-timefield" value="${endTime}"></span></div>
    </div>
    <label class="ce-allday"><input type="checkbox" id="ce-allday" ${allDay ? 'checked' : ''}> All day <span class="ce-allday-hint">(a trip can span several days)</span></label>
    <textarea id="ce-notes" class="sel ce-notes" placeholder="Notes (optional)" rows="2">${esc(notes)}</textarea>
    ${noteLinksHtml(notes)}
    <div class="ce-foot">
      <input id="ce-loc" class="sel ce-loc" placeholder="Location (optional)" autocomplete="off" value="${esc(loc)}">
      ${ev ? (ev.recurringId ? '<span class="ce-recur-note">↻ Part of a repeating series</span>' : '') : `<select id="ce-repeat" class="sel ce-repeat" title="Repeat">
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekdays">Every weekday (Mon-Fri)</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option></select>`}
      <button class="add-btn wide ce-submit" type="submit">${ev ? 'Save' : 'Add to calendar'}</button>
      ${ev ? '<button type="button" class="ghost cal-del" data-cal-del>Delete</button>' : ''}
    </div></form>`;
  $('#ce-title').focus();
}
// Keep an event's end sensibly after its start. The event's length lives on the
// form as data-evgap (minutes); moving the start date/time slides the end along
// by that length, so the end is never left sitting before the start. Editing the
// end just updates the stored length. Shared by the calendar (ce) and Home (qe)
// event forms via the id prefix.
const evAbsMs = (dateId, timeId) => { const d = (document.getElementById(dateId) || {}).value; if (!d) return null; const t = (document.getElementById(timeId) || {}).value || '00:00'; return Date.parse(`${d}T${t}:00`); };
const evFormOf = (prefix) => { const el = document.getElementById(`${prefix}-time`) || document.getElementById(`${prefix}-title`); return el ? el.closest('form') : null; };
function syncEventEnd(prefix) {
  const startMs = evAbsMs(`${prefix}-date`, `${prefix}-time`); if (startMs == null) return;
  const form = evFormOf(prefix); let gap = form ? Number(form.dataset.evgap) : 60; if (!(gap > 0)) gap = 60;
  const d = new Date(startMs + gap * 60000);
  setDateField(`${prefix}-enddate`, `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  const et = document.getElementById(`${prefix}-endtime`); if (et) et.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function onEventEndEdit(prefix) {
  const startMs = evAbsMs(`${prefix}-date`, `${prefix}-time`), endMs = evAbsMs(`${prefix}-enddate`, `${prefix}-endtime`);
  if (startMs == null || endMs == null) return;
  if (endMs <= startMs) { syncEventEnd(prefix); return; }   // an end at or before the start snaps back to start + length
  const form = evFormOf(prefix); if (form) form.dataset.evgap = String(Math.max(15, Math.round((endMs - startMs) / 60000)));
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);
// The POST/PATCH body for an event, from the fields both the calendar form and
// Home's quick-event form collect. `repeat` is only sent on a new event (isNew).
function buildEventBody({ title, startDate, startTime, endDate, endTime, location, allDay, repeat, notes, isNew, fallbackDate }) {
  startDate = startDate || fallbackDate || todayISO();
  endDate = endDate || startDate;
  const rep = isNew && repeat && repeat !== 'none' ? { repeat } : {};
  const nt = (notes && String(notes).trim()) ? { notes: String(notes).trim() } : { notes: '' };
  if (allDay) {
    // Stored end is exclusive (the day after the last), so a multi-day trip pushes
    // the inclusive end date on by one.
    const multi = endDate && endDate > startDate ? { end_date: addDayISO(endDate, 1) } : {};
    return { title, day: startDate, allDay: true, location: location || undefined, ...multi, ...rep, ...nt };
  }
  // Duration = the gap between the two date+times (spanning days if it crosses
  // midnight). A non-positive or missing end falls back to an hour.
  const sMin = isoToMin(startTime);
  let duration = Math.max(0, daysBetween(startDate, endDate)) * 1440 + isoToMin(endTime) - sMin;
  if (!(duration > 0)) duration = 60;
  duration = Math.max(15, duration);
  return { title, day: startDate, start_min: sMin, duration, location: location || undefined, ...rep, ...nt };
}
async function calSaveEvent(id, title, startDate, startTime, endDate, endTime, location, allDay, repeat, notes) {
  const body = JSON.stringify(buildEventBody({ title, startDate, startTime, endDate, endTime, location, allDay, repeat, notes, isNew: !id, fallbackDate: state.cal.selected }));
  startDate = startDate || state.cal.selected;
  try {
    if (id) await api(`/api/events/${id}`, { method: 'PATCH', body });
    else await api('/api/events', { method: 'POST', body });
    toast(id ? 'Event updated' : 'Added to your calendar');
    state.cal.adding = false; state.cal.editing = null;
    // Jump the view to the event's day so it's visible even if it moved months.
    state.cal.selected = startDate; const [yy, mm] = startDate.split('-').map(Number); if (yy && mm) { state.cal.y = yy; state.cal.m = mm - 1; }
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
  } else if (!(await uiConfirm('Delete this event?', { title: 'Delete event', okLabel: 'Delete', danger: true }))) return;
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
function openToday() { state.view = { type: 'today' }; if (!state.today) state.today = { day: todayISO(), taskPrios: new Set(['P1']) }; renderNav(); return loadToday(); }
// ── Today: native timed day + practices + tasks + habits ───────────────
const T2_START = 6, T2_END = 23, T2_PPM = 0.9;   // canvas spans 06:00–23:00
const t2Top = (m) => Math.max(0, Math.round((Math.max(T2_START * 60, Math.min(T2_END * 60, m)) - T2_START * 60) * T2_PPM));
const t2Height = (T2_END - T2_START) * 60 * T2_PPM;
async function loadToday(day) {
  const T = state.today; if (day) T.day = day;
  renderToday();   // paints the shell + a loading day while we fetch
  try {
    const [dayData, tasks] = await Promise.all([
      api('/api/day?date=' + T.day),
      api('/api/tasks').then((r) => r.tasks || []).catch(() => []),
    ]);
    await loadPractices();               // activities + marks + areas
    T.data = dayData; T.tasks = tasks;
  } catch (e) { toast(e.message); }
  renderToday();
}
function renderToday() {
  const T = state.today; const data = T.data;
  if (!T.tab) T.tab = 'today';
  const isToday = T.day === todayISO();
  const d = new Date(T.day + 'T00:00');
  const dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  // Always show the day + date; when it's today, lead with "Today" and set the date beside it.
  const h1 = T.tab === 'tracker' ? 'Tracker' : (isToday ? `Today <span class="t2-dsmall">${esc(dateLabel)}</span>` : esc(dateLabel));
  const nav = `<span class="t2-nav">${!isToday ? '<button class="t2-navbtn" data-t2-today>Today</button>' : ''}<button class="t2-arw" data-t2-day="-1" aria-label="Previous day">‹</button><button class="t2-arw" data-t2-day="1" aria-label="Next day">›</button></span>`;
  const toTick = (state.practices && (state.practices.activities || []).filter((a) => a.tracked && !practiceMarked(a.id, dayKey(new Date()))).length) || 0;
  const tabs = `<div class="t2-tabs">
    <button class="t2-tab ${T.tab === 'today' ? 'on' : ''}" data-t2-tab="today">Today</button>
    <button class="t2-tab ${T.tab === 'tracker' ? 'on' : ''}" data-t2-tab="tracker">Tracker${toTick ? `<span class="t2-tabc">${toTick}</span>` : ''}</button>
  </div>`;
  $('#pane').innerHTML = `
    ${pageCrumb('Today')}
    <div class="pane-head t2-head"><h1>${h1}</h1>${T.tab === 'today' ? nav : ''}</div>
    <p class="t2-sub">Plan your day, track your day</p>
    ${tabs}
    ${!data ? '<div class="home-empty" style="padding:24px">Loading your day…</div>'
      : (T.tab === 'tracker' ? t2TrackerHtml() : `
    <div class="t2-grid" style="--t2h:${t2Height}px">
      <aside class="t2-col t2-practices">${t2PracticesHtml()}</aside>
      <section class="t2-col t2-day">${t2DayHtml()}</section>
      <aside class="t2-col t2-tasks">${t2TasksHtml()}</aside>
    </div>`)}`;
}
// The Tracker tab: every tracked practice, grouped by life area, with today's
// tick, a 7-day dot row and its streak. The habit history lives here, off the day.
// Each life area can carry a check-in rhythm; the area then says, plainly and
// forwards, how many days until you should do something in it next. An area
// counts a day done if you did ANY of its practices. Each practice shows its own
// run + status against its own aim.
function t2TrackerHtml() {
  const P = state.practices;
  const tracked = (P.activities || []).filter((a) => a.tracked);
  if (!tracked.length) return '<div class="home-empty" style="padding:24px 0">Nothing tracked yet. Add a practice with <b>Track it</b> on and its run of days appears here.<br><button class="add-btn wide trk-newbtn" data-prc-new style="margin-top:14px">＋ New practice</button></div>';
  const today = dayKey(new Date());
  const laneOf = (k) => (P.lanes || []).find((l) => l.key === k) || { label: k, hue: 0 };
  const groups = new Map();
  tracked.forEach((a) => { const ar = practiceArea(a); const key = ar ? ar.id : `lane:${a.lane}`; if (!groups.has(key)) groups.set(key, { areaId: ar ? ar.id : null, area: ar, label: ar ? (ar.title || 'Untitled') : laneOf(a.lane).label, hue: ar ? hueOf(ar) : laneOf(a.lane).hue, items: [] }); groups.get(key).items.push(a); });
  const ordered = [...groups.values()].sort((x, y) => x.label.localeCompare(y.label));
  const days = trackerLast7();
  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  // A short, plain list - just the cadence, no "check in" prefix.
  const body = ordered.map((g) => {
    const areaCad = g.area ? ((g.area.props || {}).cadence || '') : '';
    const areaStat = g.areaId ? areaCheckin(areaMarkedDays(g.areaId), areaCad) : null;
    // A custom value (say every 5 days) shows itself at the top; "Custom…" opens a prompt.
    const cadOpts = (areaCad && !PRESET_CADS.some(([v]) => v === areaCad)) ? [[areaCad, areaCadLabel(areaCad)], ...PRESET_CADS] : PRESET_CADS;
    const cadSel = g.areaId ? `<select class="sel trk-cadsel" data-trk-area-cad="${g.areaId}" title="How often do you want to do something in this area?">
      <option value="" ${!areaCad ? 'selected' : ''}>No check-in</option>
      ${cadOpts.map(([v, l]) => `<option value="${v}" ${areaCad === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      <option value="__custom">Custom…</option></select>` : '';
    const rows = g.items.map((a) => {
      const s = cadenceStatus(prcMarkedDays(a.id), a.cadence);
      const marked = practiceMarked(a.id, today);
      const streak = practiceStreak(a.id);
      // The run of recent days - tap any dot to log it, the chain you don't want to break.
      const week = days.map((d) => `<span class="trk-dot ${practiceMarked(a.id, d) ? 'on' : ''} ${d === today ? 'today' : ''}" data-prc-day="${a.id}:${d}" title="${d}"><i>${dow[new Date(d + 'T00:00').getDay()]}</i></span>`).join('');
      return `<div class="trk-prow">
        <button class="t2-tick ${marked ? 'on' : ''}" data-prc-tick="${a.id}" title="Done today">✓</button>
        <span class="trk-pname">${esc(a.title)}${a.cadence ? `<span class="trk-cad">${esc(cadenceLabel(a.cadence))}</span>` : ''}</span>
        <span class="trk-week">${week}</span>
        <span class="trk-runend">${streak ? `<span class="trk-streak">🔥${streak}</span>` : ''}<span class="trk-dot2 trk-${s.status}" title="${esc(s.label)}"></span></span>
      </div>`;
    }).join('');
    return `<div class="trk-area" style="--h:${g.hue}">
      <div class="trk-area-h"><span class="cd"></span><span class="trk-area-name">${esc(g.label)}</span>${cadSel}</div>
      ${areaStat ? `<div class="trk-area-status trk-s-${areaStat.status}"><span class="trk-dot2 trk-${areaStat.status}"></span><b>${esc(areaStat.label)}</b></div>` : ''}
      ${rows}
      ${g.areaId ? `<button class="trk-addp" data-prc-new-area="${g.areaId}">＋ add a practice</button>` : ''}
    </div>`;
  }).join('');
  return `<p class="home-empty trk-intro"><b>Is every part of your life ticking over?</b> Tick practices as you go - each keeps its run of days. Give an area a <b>check-in</b> and it tells you how long until you should do something in it next.</p><div class="trk-dash">${body}</div><button class="add-btn wide trk-newbtn" data-prc-new>＋ New practice</button>`;
}
// Does a calendar event name a practice? Accents off, case off, whole words only
// ("Work" must not swallow "Workshop"; \b is ASCII-only so it breaks on "Forró").
// This is what lets a gym event count as the "Work out" practice without retyping.
const evFold = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
function evNames(title, word) {
  const n = evFold(word); if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, 'u').test(title);
}
function practiceForEvent(title) {
  const t = evFold(title); if (!t) return null;
  return (state.practices.activities || []).find((a) => evNames(t, a.title)) || null;
}
// Count a matched event as its practice: a slot carrying the event links the two.
// The slot draws as the event (it's filtered out of the block list), ticks the
// habit when done, and suppresses the auto-dropped duplicate. Any planned block
// already down for that practice today is folded into the event so it isn't twinned.
async function t2CountEvent(eventId) {
  const T = state.today; const ev = (T.data.events || []).find((e) => String(e.id) === String(eventId)); if (!ev) return;
  const act = practiceForEvent(ev.title); if (!act) return;
  // Drop a planned (non-event) slot for the same practice - the event supersedes it.
  const dup = (T.data.slots || []).find((s) => !s.event_id && String(s.activity_id) === String(act.id));
  if (dup) { try { await api('/api/slots/' + dup.id, { method: 'DELETE' }); } catch {} }
  try { await api('/api/slots', { method: 'POST', body: JSON.stringify({ day: T.day, lane: act.lane, title: act.title, start_min: ev.start_min, duration: ev.duration || 30, activity_id: act.id, event_id: String(ev.id) }) }); } catch (e) { toast(e.message); }
  await loadToday();
}
// Stop counting an event as a practice: drop the link slot and any habit tick.
async function t2UncountEvent(slotId) {
  const T = state.today; const s = (T.data.slots || []).find((x) => String(x.id) === String(slotId)); if (!s) return;
  if (s.done && s.activity_id) { const k = `${s.activity_id}:${T.day}`; delete state.practices.marks[k]; savePracticeMarks(); }
  try { await api('/api/slots/' + slotId, { method: 'DELETE' }); } catch (e) { toast(e.message); }
  await loadToday();
}
// The timed day canvas: hour grid, all-day + timed calendar events (a matched one
// can be counted as its practice), and placed slots (each with a tick).
function t2DayHtml() {
  const T = state.today; const data = T.data; const isToday = T.day === todayISO();
  const events = (data.events || []);
  // No birthdays on the planner - this is for planning the day, not a reminder feed.
  const allDay = events.filter((e) => e.allDay && !/birthday/i.test(e.title || ''));
  const timed = events.filter((e) => !e.allDay && e.start_min != null);
  const slots = (data.slots || []).filter((s) => !s.event_id);   // adopted events draw as the event
  const floating = slots.filter((s) => s.start_min == null);
  const placed = slots.filter((s) => s.start_min != null);
  const hours = [];
  for (let h = T2_START; h <= T2_END; h++) hours.push(`<div class="t2-hour" style="top:${t2Top(h * 60)}px"><span class="t2-hlab">${String(h).padStart(2, '0')}:00</span></div>`);
  const nowTop = isToday ? (() => { const n = new Date(); return t2Top(n.getHours() * 60 + n.getMinutes()); })() : null;
  // Events already counted as a practice (a slot carries the event id).
  const evSlots = {}; (data.slots || []).forEach((s) => { if (s.event_id) evSlots[String(s.event_id)] = s; });
  const evBlocks = timed.map((e) => {
    const link = evSlots[String(e.id)];
    const act = link && link.activity_id ? (state.practices.activities || []).find((a) => String(a.id) === String(link.activity_id)) : null;
    if (link) {
      const done = !!link.done; const hue = act ? (hueOf(practiceArea(act)) ?? 220) : 220;
      return `<div class="t2-block t2-event t2-evlink ${done ? 'done' : ''}" style="top:${t2Top(e.start_min)}px;height:${Math.max(26, Math.round((e.duration || 30) * T2_PPM))}px;--h:${hue}">
        <div class="t2-brow"><button class="t2-tick ${done ? 'on' : ''}" data-t2-slot-tick="${link.id}" title="${done ? 'Done' : 'Mark done'}">✓</button><span class="t2-btime">${prcHHMM(e.start_min)}</span><span class="t2-btitle">${esc(e.title || '(event)')}</span>${e.url ? `<a class="t2-join" href="${esc(e.url)}" target="_blank" rel="noopener">🎥</a>` : ''}<button class="t2-x" data-t2-uncount="${link.id}" title="Don't count as ${esc(act ? act.title : 'practice')}">×</button></div>
        <div class="t2-evtag">counts as ${esc(act ? act.title : 'a practice')}</div></div>`;
    }
    const match = isToday ? practiceForEvent(e.title) : null;
    return `<div class="t2-block t2-event" style="top:${t2Top(e.start_min)}px;height:${Math.max(26, Math.round((e.duration || 30) * T2_PPM))}px">
    <div class="t2-brow"><span class="t2-btime">${prcHHMM(e.start_min)}</span><span class="t2-btitle">${esc(e.title || '(event)')}</span>${e.url ? `<a class="t2-join" href="${esc(e.url)}" target="_blank" rel="noopener">🎥</a>` : ''}${match ? `<button class="t2-countbtn" data-t2-count-ev="${e.id}" title="Count this as your ${esc(match.title)} practice">＋ ${esc(match.title)}</button>` : ''}</div></div>`;
  }).join('');
  const slotBlocks = placed.map((s) => t2SlotBlock(s)).join('');
  return `
    ${allDay.length ? `<div class="t2-allday">${allDay.map((e) => `<span class="t2-adchip">${esc(e.title || '(all-day)')}</span>`).join('')}</div>` : ''}
    ${floating.length ? `<div class="t2-tray"><span class="t2-tray-h">Anytime today</span>${floating.map((s) => t2SlotBlock(s, true)).join('')}</div>` : ''}
    <div class="t2-canvas" style="height:${t2Height}px">
      ${hours.join('')}
      ${nowTop != null ? `<div class="t2-now" style="top:${nowTop}px"><span class="t2-now-dot"></span></div>` : ''}
      ${evBlocks}${slotBlocks}
    </div>`;
}
function t2SlotBlock(s, floating) {
  const act = s.activity_id ? (state.practices.activities || []).find((a) => String(a.id) === String(s.activity_id)) : null;
  const hue = act ? (hueOf(practiceArea(act)) ?? 220) : 220;
  const task = (s.tasks && s.tasks.length) ? s.tasks[0] : null;
  const done = !!s.done || (task && task.done);
  const pos = floating ? '' : `style="top:${t2Top(s.start_min)}px;height:${Math.max(26, Math.round((s.duration || 30) * T2_PPM))}px;--h:${hue}"`;
  const vid = (act && act.video) ? '<span class="t2-vid" data-t2-open-slot="' + s.id + '">🎥</span>' : '';
  return `<div class="t2-block t2-slot ${done ? 'done' : ''} ${floating ? 't2-float' : ''}" ${floating ? `style="--h:${hue}"` : pos} data-slot-id="${s.id}" data-t2-drag="slot" data-t2-drag-id="${s.id}" data-t2-drag-label="${esc(s.title || 'Block')}">
    <div class="t2-brow"><button class="t2-tick ${done ? 'on' : ''}" data-t2-slot-tick="${s.id}" title="${done ? 'Done' : 'Mark done'}">✓</button>${floating ? '' : `<span class="t2-btime">${prcHHMM(s.start_min)}</span>`}<span class="t2-btitle">${esc(s.title || 'Block')}</span>${task && task.priority ? `<span class="p-tag p-${task.priority}">${task.priority}</span>` : ''}${vid}<button class="t2-x" data-t2-del-slot="${s.id}" title="Remove">×</button></div>
  </div>`;
}
function t2PracticesHtml() {
  const P = state.practices; const today = dayKey(new Date());
  const acts = (P.activities || []);
  if (!acts.length) return '<div class="t2-emptycol">No practices yet.<br><button class="add-btn wide" data-open-practices style="margin-top:10px">Add practices</button></div>';
  // Group by area (fallback lane label).
  const laneOf = (k) => (P.lanes || []).find((l) => l.key === k) || { label: k, hue: 0 };
  const groups = new Map();
  acts.forEach((a) => { const ar = practiceArea(a); const key = ar ? ar.id : `lane:${a.lane}`; if (!groups.has(key)) groups.set(key, { label: ar ? (ar.title || 'Untitled') : laneOf(a.lane).label, hue: ar ? hueOf(ar) : laneOf(a.lane).hue, items: [] }); groups.get(key).items.push(a); });
  const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  const body = ordered.map((g) => `<div class="t2-pgroup"><div class="t2-pglabel" style="--h:${g.hue}"><span class="cd"></span>${esc(g.label)}</div>${g.items.map((a) => {
    const marked = practiceMarked(a.id, today);
    const streak = practiceStreak(a.id);
    const len = (a.timed && a.duration) ? `<span class="t2-psched">${a.duration} min</span>` : '';
    return `<div class="t2-prow ${a.timed ? 't2-draggable' : ''}" ${a.timed ? `data-t2-drag="prac" data-t2-drag-id="${a.id}" data-t2-drag-label="${esc(a.title)}" title="Fancy this? Drag it onto your day"` : ''} style="--h:${g.hue}">
      <button class="t2-tick ${marked ? 'on' : ''}" data-prc-tick="${a.id}" title="Done today">✓</button>
      <span class="t2-pbody"><span class="t2-pname">${esc(a.title)}${a.video ? ' <span class="t2-vid-i">🎥</span>' : ''}</span>${len}</span>
      ${streak ? `<span class="t2-streak">🔥${streak}</span>` : ''}
    </div>`;
  }).join('')}</div>`).join('');
  return `<div class="t2-colh"><h2>Practices</h2><button class="t2-colnew" data-open-practices title="Manage practices">✎</button></div><div class="t2-scroll">${body}</div><button class="t2-newrow" data-prc-new>＋ New practice</button>`;
}
function t2TasksHtml() {
  const T = state.today; const tasks = T.tasks || [];
  const areas = state.areas || [];
  const f = T.taskArea || '';
  const prios = T.taskPrios instanceof Set ? T.taskPrios : (T.taskPrios = new Set());
  const areaHue = (id) => id ? (hueOf(areas.find((a) => a.id === id)) ?? 220) : 220;
  // Area filter + a P1–P4 toggle row. No priority selected = show every priority.
  const shown = tasks.filter((t) => (!f || t.area_id === f) && (!prios.size || prios.has(t.priority)));
  const filter = `<div class="t2-tctl">
    <select class="sel t2-tfilter" data-t2-taskfilter><option value="">All life areas</option>${areas.map((a) => `<option value="${a.id}" ${f === a.id ? 'selected' : ''}>${esc(a.title || 'Untitled')}</option>`).join('')}</select>
    <div class="t2-prios">${['P1', 'P2', 'P3', 'P4'].map((p) => `<button class="t2-prio ${prios.has(p) ? 'on' : ''}" data-t2-prio="${p}">${p}</button>`).join('')}</div>
  </div>`;
  const rows = shown.map((t) => `<div class="t2-trow t2-draggable" data-t2-drag="task" data-t2-drag-id="${esc(t.tana_id)}" data-t2-drag-label="${esc(t.title || 'Task')}" title="Drag onto your day to plan it" style="--h:${areaHue(t.area_id)}">
    <span class="cd"></span><span class="t2-ttitle">${esc(t.title || 'Task')}</span>${t.priority ? `<span class="p-tag p-${t.priority}">${t.priority}</span>` : ''}
  </div>`).join('') || `<div class="t2-emptycol">${tasks.length ? 'None match the filter.' : 'Nothing to plan.'}</div>`;
  return `<div class="t2-colh"><h2>Tasks</h2><span class="t2-colcount">${shown.length}</span></div>${filter}<div class="t2-tlist t2-scroll">${rows}</div>
    <form class="t2-newrow t2-taskadd" data-t2-taskadd><input id="t2-newtask" placeholder="＋ New task…" autocomplete="off"></form>`;
}
async function t2AddTask() {
  const inp = document.getElementById('t2-newtask'); const title = (inp && inp.value || '').trim(); if (!title) return;
  const T = state.today;
  // Inherit the current filters: the area if one's picked, and P1 if that's the
  // only priority shown (so a new task lands where you're looking).
  const area = T.taskArea || undefined;
  const prio = (T.taskPrios && T.taskPrios.size === 1) ? [...T.taskPrios][0] : 'P1';
  try {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: title.slice(0, 200), area, priority: prio }) });
    if (inp) inp.value = '';
    T.tasks = await api('/api/tasks').then((r) => r.tasks || []).catch(() => T.tasks);
    renderToday();
    setTimeout(() => { const i = document.getElementById('t2-newtask'); if (i) i.focus(); }, 20);
  } catch (e) { toast(e.message); }
}
function t2HabitsHtml() {
  const P = state.practices; const today = dayKey(new Date());
  const tracked = (P.activities || []).filter((a) => a.tracked);
  if (!tracked.length) return '';
  const toTick = tracked.filter((a) => !practiceMarked(a.id, today)).length;
  const chips = tracked.map((a) => { const on = practiceMarked(a.id, today); const s = practiceStreak(a.id); return `<div class="t2-habit ${on ? 'done' : ''}">
    <button class="t2-tick ${on ? 'on' : ''}" data-prc-tick="${a.id}" title="${on ? 'Done today' : 'Tick'}">✓</button>
    <span class="t2-hname">${esc(a.title)}</span>${s ? `<span class="t2-streak">🔥${s}</span>` : ''}</div>`; }).join('');
  return `<section class="t2-habits"><div class="t2-habh"><h2>Habits</h2>${toTick ? `<span class="t2-tocnt">${toTick} to tick</span>` : '<span class="t2-alldone">all ticked ✓</span>'}<span class="t2-habnote">tick as you go</span></div><div class="t2-habgrid">${chips}</div></section>`;
}
// startMin given (a drag drop) = pinned to that time. startMin omitted (the ＋
// button) = floating, lands in the "Anytime" tray to schedule later.
async function t2PlacePractice(activityId, startMin) {
  const a = (state.practices.activities || []).find((x) => String(x.id) === String(activityId)); if (!a) return;
  try {
    await api('/api/slots', { method: 'POST', body: JSON.stringify({ day: state.today.day, lane: a.lane, title: a.title, start_min: startMin != null ? startMin : null, duration: a.duration || 30, activity_id: a.id, url: a.video || undefined }) });
    toast(startMin != null ? 'Added to your day' : 'Added to today — in Anytime'); loadToday();
  } catch (e) { toast(e.message === 'That event is already counted.' ? 'Already on your day' : e.message); }
}
async function t2PlaceTask(taskId, startMin) {
  const t = (state.today.tasks || []).find((x) => String(x.tana_id) === String(taskId)); if (!t) return;
  try {
    await api('/api/slots', { method: 'POST', body: JSON.stringify({ day: state.today.day, lane: t.lane, title: t.title, start_min: startMin != null ? startMin : null, duration: t.duration || 30, tana_id: t.tana_id }) });
    toast(startMin != null ? 'Added to your day' : 'Added to today — in Anytime'); loadToday();
  } catch (e) { toast(e.message); }
}
// ── Today drag: place a practice/task at a time, or reschedule a slot ──
const t2SnapMin = (m) => Math.max(T2_START * 60, Math.min(T2_END * 60, Math.round(m / 5) * 5));
let t2Drag = null;
document.addEventListener('pointerdown', (e) => {
  if (!state.view || state.view.type !== 'today') return;
  if (e.target.closest('button, a, input, select, textarea')) return;   // let controls work
  const src = e.target.closest('[data-t2-drag]'); if (!src) return;
  const canvas = document.querySelector('.t2-canvas'); if (!canvas) return;
  // NB: no preventDefault / capture here - a purely vertical touch must be free to
  // scroll the list (touch-action:pan-y). The drag arms only once the pointer moves
  // (see pointermove), which on touch is a horizontal-ish gesture toward the day.
  t2Drag = { type: src.dataset.t2Drag, id: src.dataset.t2DragId, label: (src.dataset.t2DragLabel || src.textContent || 'Move').trim().slice(0, 40), canvas, pid: e.pointerId, sx: e.clientX, sy: e.clientY, active: false, dropMin: null, src };
});
document.addEventListener('pointermove', (e) => {
  const d = t2Drag; if (!d || e.pointerId !== d.pid) return;
  if (!d.active) {
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 6) return;
    d.active = true;
    try { d.src.setPointerCapture(e.pointerId); } catch {}
    d.ghost = document.createElement('div'); d.ghost.className = 't2-dragghost'; d.ghost.textContent = d.label; document.body.appendChild(d.ghost); d.src.classList.add('t2-dragsrc');
  }
  e.preventDefault();
  d.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - 12}px)`;
  const r = d.canvas.getBoundingClientRect();
  const over = e.clientX >= r.left - 40 && e.clientX <= r.right + 40 && e.clientY >= r.top && e.clientY <= r.bottom;
  let ind = d.canvas.querySelector('.t2-dropind');
  if (over) {
    const min = t2SnapMin(T2_START * 60 + (e.clientY - r.top) / T2_PPM);
    d.dropMin = min;
    if (!ind) { ind = document.createElement('div'); ind.className = 't2-dropind'; d.canvas.appendChild(ind); }
    ind.style.top = t2Top(min) + 'px'; ind.innerHTML = `<span class="t2-dropt">${prcHHMM(min)}</span>`;
  } else { d.dropMin = null; if (ind) ind.remove(); }
  // gentle edge auto-scroll for long days
  if (e.clientY < 90) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
});
function t2DragEnd(e) {
  const d = t2Drag; if (!d || (e && e.pointerId !== d.pid)) return; t2Drag = null;
  if (d.ghost) d.ghost.remove(); if (d.src) d.src.classList.remove('t2-dragsrc');
  const ind = d.canvas.querySelector('.t2-dropind'); if (ind) ind.remove();
  if (d.active) t2SuppressClick = Date.now();   // a real drag happened - don't let the release open the task popover
  if (!d.active || d.dropMin == null) return;
  if (d.type === 'prac') t2PlacePractice(d.id, d.dropMin);
  else if (d.type === 'task') t2PlaceTask(d.id, d.dropMin);
  else if (d.type === 'slot') { api('/api/slots/' + d.id, { method: 'PATCH', body: JSON.stringify({ start_min: d.dropMin }) }).then(() => loadToday()).catch((err) => toast(err.message)); }
}
document.addEventListener('pointerup', t2DragEnd);
document.addEventListener('pointercancel', t2DragEnd);
// Tick a placed block. A practice block also ticks its habit (one tick, counted
// everywhere), per the agreed rule.
async function t2SlotTick(slotId) {
  const T = state.today; const s = (T.data.slots || []).find((x) => String(x.id) === String(slotId)); if (!s) return;
  const now = !s.done;
  s.done = now ? 1 : 0; renderToday();
  try { await api('/api/slots/' + slotId, { method: 'PATCH', body: JSON.stringify({ done: now }) }); } catch (e) { toast(e.message); }
  if (s.activity_id) {
    const a = (state.practices.activities || []).find((x) => String(x.id) === String(s.activity_id));
    if (a && a.tracked) {
      const k = `${a.id}:${T.day}`;
      if (now) state.practices.marks[k] = 1; else delete state.practices.marks[k];
      savePracticeMarks(); renderToday();
    }
  }
}
async function t2DelSlot(slotId) {
  try { await api('/api/slots/' + slotId, { method: 'DELETE' }); loadToday(); } catch (e) { toast(e.message); }
}
// Set a life area's check-in rhythm (stored in the area block's props.cadence).
async function setAreaCadence(areaId, cadence) {
  const a = (state.areas || []).find((x) => x.id === areaId); if (!a) return;
  a.props = a.props || {}; a.props.cadence = cadence || null;
  renderToday();
  try { await api('/api/blocks/' + areaId, { method: 'PATCH', body: JSON.stringify({ props: { cadence: cadence || null } }) }); } catch (e) { toast(e.message); }
}
// "Custom…" check-in: ask for any rhythm in plain words. "5" or "every 5 days"
// -> 5d; "3 a week" -> 3w; "every 2 weeks" -> 14d.
function parseCustomCadence(s) {
  s = String(s || '').toLowerCase().trim();
  const m = s.match(/\d+/); if (!m) return null;
  const n = Math.max(1, Math.min(60, Number(m[0])));
  if (/(a|per|times|×|x)\s*week|weekly/.test(s)) return `${Math.min(7, n)}w`;   // "3 a week"
  if (/week/.test(s)) return `${Math.min(84, n * 7)}d`;                          // "every 2 weeks"
  return `${Math.min(90, n)}d`;                                                  // "every 5 days"
}
async function promptAreaCadence(areaId) {
  const raw = await uiPrompt('Do something in this area how often?', { title: 'Custom check-in', placeholder: "e.g. 5 (every 5 days), 3 a week, every 2 weeks" });
  if (raw == null) { renderToday(); return; }                    // cancelled - restore the select
  const cad = parseCustomCadence(raw);
  if (!cad) { toast("Try a number, e.g. 5 or '3 a week'"); renderToday(); return; }
  setAreaCadence(areaId, cad);
}
// Custom aim inside the practice editor. Unlike the area (which saves at once),
// here we just add and select the option; savePractice reads it on Save.
async function promptPracticeCadence(sel) {
  const raw = await uiPrompt('Do this how often?', { title: 'Custom aim', placeholder: "e.g. 5 (every 5 days), 3 a week, every 2 weeks" });
  const cad = raw == null ? null : parseCustomCadence(raw);
  if (!cad) { sel.value = sel.dataset.prev || ''; if (raw != null) toast("Try a number, e.g. 5 or '3 a week'"); return; }
  if (![...sel.options].some((o) => o.value === cad)) { const o = document.createElement('option'); o.value = cad; o.textContent = areaCadLabel(cad); sel.insertBefore(o, sel.options[sel.options.length - 1]); }
  sel.value = cad; sel.dataset.prev = cad;
}
// Click a task on Today to open its details in a popover (name, priority, area,
// length, done) - a body-level overlay like the practice editor.
let t2SuppressClick = 0;
function openTaskPopover(taskId) {
  const t = (state.today.tasks || []).find((x) => String(x.tana_id) === String(taskId)); if (!t) return;
  state.taskEdit = { id: t.tana_id };
  let host = document.getElementById('task-editor-host');
  if (!host) { host = document.createElement('div'); host.id = 'task-editor-host'; document.body.appendChild(host); }
  const areas = state.areas || [];
  host.innerHTML = `<div class="pe-bg" data-task-close></div>
    <div class="pe-panel" role="dialog" aria-label="Task">
      <div class="pe-head"><h2>Task</h2><button class="pe-x" data-task-close aria-label="Close">×</button></div>
      <div class="pe-body">
        <label class="pe-f"><span>Name</span><input class="sel" id="te-title" value="${esc(t.title || '')}" placeholder="What needs doing?" autocomplete="off"></label>
        <div class="pe-two">
          <label class="pe-f pe-inline"><span>Priority</span><select class="sel" id="te-prio"><option value="">None</option>${['P1', 'P2', 'P3', 'P4'].map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label class="pe-f pe-inline"><span>Length</span><span class="pe-durwrap"><input class="sel pe-num" id="te-dur" type="number" min="5" max="720" value="${t.duration || 30}"> min</span></label>
        </div>
        <label class="pe-f"><span>Life area</span><select class="sel" id="te-area"><option value="">No area</option>${areas.map((a) => `<option value="${a.id}" ${t.area_id === a.id ? 'selected' : ''}>${esc(a.title || 'Untitled')}</option>`).join('')}</select></label>
        <label class="pe-tog"><input type="checkbox" id="te-done" ${t.done ? 'checked' : ''}><span><b>Done</b></span></label>
      </div>
      <div class="pe-foot"><button class="ghost pe-del" data-task-del="${esc(t.tana_id)}">Delete</button><button class="add-btn wide" data-task-save>Save</button></div>
    </div>`;
  setTimeout(() => { const el = document.getElementById('te-title'); if (el) el.focus(); }, 30);
}
function closeTaskPopover() { state.taskEdit = null; const h = document.getElementById('task-editor-host'); if (h) h.remove(); }
async function saveTaskPopover() {
  const te = state.taskEdit; if (!te) return;
  const title = (($('#te-title') || {}).value || '').trim(); if (!title) { toast('Give it a name'); return; }
  const props = {
    priority: ($('#te-prio') || {}).value || null,
    area: ($('#te-area') || {}).value || null,
    duration: Math.max(5, Math.min(720, Number(($('#te-dur') || {}).value) || 30)),
    done: $('#te-done') ? $('#te-done').checked : false,
  };
  try { await api('/api/blocks/' + te.id, { method: 'PATCH', body: JSON.stringify({ title, props }) }); closeTaskPopover(); toast('Saved'); loadToday(); }
  catch (e) { toast(e.message); }
}
async function deleteTaskFromPopover(id) {
  if (!(await uiConfirm('Delete this task?', { danger: true, okLabel: 'Delete' }))) return;
  try { await api('/api/blocks/' + id, { method: 'DELETE' }); closeTaskPopover(); toast('Task deleted'); loadToday(); }
  catch (e) { toast(e.message); }
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
  { key: 'unread', label: 'Unread', mailbox: 'INBOX', unseen: true },
  { key: 'starred', label: '★ Starred', mailbox: 'INBOX', flagged: true },
  { key: 'drafts', label: 'Drafts', local: true },
  { key: 'sent', label: 'Sent', mailbox: 'Sent' },
  { key: 'archive', label: 'Archive', mailbox: 'Archive' },
  { key: 'spam', label: 'Spam', mailbox: 'Junk' },
  { key: 'trash', label: 'Trash', mailbox: 'Trash' },
];
const mailFolder = () => MAIL_FOLDERS.find((f) => f.key === (state.mail.folder || 'inbox')) || MAIL_FOLDERS[0];
function setMailFolder(key) {
  state.mail.folder = key; state.mail.open = null; state.mail.limit = 40;
  const f = mailFolder();
  if (f.local) { renderMail(); return; }   // Drafts is client-side, no fetch
  state.mail.mailbox = f.mailbox; loadMessages();
}
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
  // In the Starred view, unstarring drops it from the list - but never while
  // you're reading it: pressing S just toggles the star, leaving the mail open.
  if (!on && state.mail.folder === 'starred' && !(o && o._key === key)) {
    state.mail.messages = state.mail.messages.filter((m) => m._key !== key);
  }
  renderMail();
  try { await mailApi('/flag', { method: 'POST', body: JSON.stringify({ account: target._acct, mailbox: target._mailbox, uid: target.uid, flagged: on }) }); }
  catch (e) { toast(e.message); }
}
// Every message key in the same conversation as `key` (just [key] when threading
// is off), so Archive/Spam/Trash act on the whole thread at once.
function threadKeysFor(key) {
  if (!state.mail) return [key];   // mail is always threaded now
  const th = buildThreads(state.mail.messages || []).find((t) => t.messages.some((m) => m._key === key));
  return th ? th.messages.map((m) => m._key) : [key];
}
async function mailMoveTo(key, target, label) {
  const keys = threadKeysFor(key);
  const rows = keys.map((k) => mailRow(k)).filter(Boolean);
  if (!rows.length) return;
  const msgs = state.mail.messages || []; const idx = msgs.findIndex((m) => m._key === key);
  try {
    for (const row of rows) {
      await mailApi('/move', { method: 'POST', body: JSON.stringify({ account: row._acct, mailbox: row._mailbox, uid: row.uid, target }) });
      // Archiving/trashing an unread message clears its badge count right away.
      if (!row.seen && /^inbox$/i.test(row._mailbox || '')) bumpUnread(row._acct, -1);
    }
    const gone = new Set(keys);
    // Remember them as gone so a lagging Gmail refetch can't list them again for a
    // moment. Undo clears the flag so a restored message can come back.
    keys.forEach((k) => state.mail.gone.add(k));
    const openKey = state.mail.open && state.mail.open._key;
    const openIdx = openKey ? msgs.findIndex((m) => m._key === openKey) : -1;
    // Undo: move each message back from `target` to where it came from, found by
    // its Message-ID (its UID changed in the move).
    const undoRows = rows.filter((r) => r.messageId).map((r) => ({ account: r._acct, from: target, messageId: r.messageId, to: r._mailbox || 'INBOX' }));
    const undo = undoRows.length ? async () => {
      toast('Restoring…');
      keys.forEach((k) => state.mail.gone.delete(k));
      let ok = 0;
      for (const u of undoRows) { try { await mailApi('/move-by-msgid', { method: 'POST', body: JSON.stringify(u) }); ok++; } catch {} }
      toast(ok ? (ok > 1 ? `Restored ${ok} messages` : 'Restored') : 'Could not undo'); loadMessages();
    } : null;
    toast(rows.length > 1 ? `${label} · ${rows.length} messages` : label, undo);
    state.mail.messages = msgs.filter((m) => !gone.has(m._key));
    mailForgetKeys(keys);
    // Keep keyboard triage flowing: move the highlight to the next row.
    if (gone.has(state.mail.sel)) { const n = state.mail.messages[idx] || state.mail.messages[idx - 1]; state.mail.sel = n ? n._key : null; }
    // Reading a message we just triaged? Advance to the next one (Spark-style)
    // rather than dropping back to the list.
    if (openKey && gone.has(openKey)) {
      let next = null;
      for (let i = openIdx + 1; i < msgs.length && !next; i++) if (!gone.has(msgs[i]._key)) next = msgs[i];
      for (let i = openIdx - 1; i >= 0 && !next; i--) if (!gone.has(msgs[i]._key)) next = msgs[i];
      state.mail.open = null;
      if (next) { renderMail(); openMessage(next._key); return; }
    }
    renderMail();
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
// Adjust the per-account and total unread counts, then reflect them everywhere
// straight away (nav badges + app-icon badge) - the server's cached count lags
// a couple of minutes, so we can't wait for it to clear the numbers.
function bumpUnread(acct, delta) {
  if (!state.mail) return;
  state.mail.unseen = state.mail.unseen || {};
  state.mail.unseen[acct] = Math.max(0, (state.mail.unseen[acct] || 0) + delta);
  state.mailUnreadTotal = Math.max(0, (state.mailUnreadTotal || 0) + delta);
  setAppBadgeCount(state.mailUnreadTotal);
  renderNav();
}
async function mailSeen(key, seen) {
  const row = mailRow(key); if (!row) return;
  const listRow = (state.mail.messages || []).find((x) => x._key === key);
  const was = listRow ? !!listRow.seen : !!row.seen;
  if (listRow) listRow.seen = seen;
  if (state.mail.open && state.mail.open._key === key) state.mail.open.seen = seen;
  if (was !== !!seen) bumpUnread(row._acct, seen ? -1 : 1);
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
// The life-area picker for the open email: a small popup of your areas. Picking
// one files the email in that area (see mailToArea).
function mailAreaMenuHtml() {
  const am = state.mail.areaMenu; if (!am) return '';
  const areas = state.areas || [];
  return `<div class="mail-movebg" data-mail-area-close><div class="mail-move" style="top:${am.y}px;left:${am.x}px" role="menu">
    <div class="mail-move-h">File in a life area…</div>
    ${areas.length ? areas.map((a) => `<button class="mail-move-item" data-mail-area-to="${a.id}"><span class="mm-dot" style="background:hsl(${hueOf(a)} 55% 55%)"></span>${esc(a.title || 'Untitled')}</button>`).join('') : '<div class="mail-move-empty">No life areas yet.</div>'}
  </div></div>`;
}
async function openMailAreaMenu(anchor) {
  if (!state.areas || !state.areas.length) { try { state.areas = (await api('/api/blocks?kind=area')).sort((a, b) => (a.title || '').localeCompare(b.title || '')); } catch {} }
  const r = anchor ? anchor.getBoundingClientRect() : { left: 240, bottom: 200 };
  state.mail.areaMenu = { x: Math.min(r.left, window.innerWidth - 250), y: r.bottom + 6 };
  renderMail();
}
// File the open email in a life area: snapshot it as a note tagged to that area
// (the same shape "Make a task from this email" uses), so it shows on the area
// page and stays readable even after the message leaves the inbox.
async function mailToArea(areaId) {
  state.mail.areaMenu = null;
  const o = state.mail && state.mail.open; if (!o) { renderMail(); return; }
  const area = areaById(areaId);
  const title = ((o.subject || '').trim()) || '(no subject)';
  const name = o.from ? (o.from.name || o.from.address || '') : '';
  const addr = o.from ? (o.from.address || '') : '';
  const when = o.date ? new Date(o.date).toLocaleString() : '';
  const fromLine = (name || addr) ? `From: ${esc(name || addr)}${name && addr ? ` &lt;${esc(addr)}&gt;` : ''}` : '';
  const hdr = (fromLine || when) ? `<p>${fromLine}${fromLine && when ? ' · ' : ''}${when ? esc(when) : ''}</p>` : '';
  const src = (o.text || '').replace(/\r\n/g, '\n').trim();
  const content = src ? src.split(/\n{2,}/).map((p) => `<p>${linkifyText(p).replace(/\n/g, '<br>')}</p>`).join('') : '';
  try {
    await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title, body: hdr + content, props: { area: areaId, areas: [areaId], fromEmail: true } }) });
    toast(`Filed in ${area ? esc(area.title) : 'life area'}`);
  } catch (e) { toast(e.message); }
  renderMail();
}
async function mailMoveTargets(keys, target) {
  const list = [...keys]; state.mail.moveMenu = null;
  // Group by account+mailbox so each group is ONE IMAP session (a separate
  // login/select/move per message is what made deleting several Gmail messages
  // crawl). Within a group the whole set moves in a single UID MOVE.
  const groups = new Map();
  for (const k of list) {
    const row = mailRow(k); if (!row) continue;
    const gid = `${row._acct} ${row._mailbox}`;
    if (!groups.has(gid)) groups.set(gid, { account: row._acct, mailbox: row._mailbox, keys: [], uids: [] });
    const g = groups.get(gid); g.keys.push(k); g.uids.push(row.uid);
  }
  if (!groups.size) return;
  const label = target === 'INBOX' ? 'Inbox' : target;
  // Keep the rows on screen but mark them pending, so it's clearly working and a
  // background refresh can't make them flicker back. They're removed only once
  // the server confirms the move - no more "looks like it didn't work".
  list.forEach((k) => { state.mail.pending.add(k); state.mail.selected.delete(k); });
  state.mail.selected = new Set(); renderMail();
  const done = []; let failed = 0; let lastErr = '';
  for (const g of groups.values()) {
    try {
      await mailApi('/move-bulk', { method: 'POST', body: JSON.stringify({ account: g.account, mailbox: g.mailbox, uids: g.uids, target }) });
      done.push(...g.keys);
    } catch (e) { failed += g.keys.length; lastErr = e.message; }
  }
  done.forEach((k) => { state.mail.pending.delete(k); state.mail.gone.add(k); });
  // Failures stay in the list (un-pending) so they can be retried, with the real error.
  groups.forEach((g) => g.keys.forEach((k) => { if (!done.includes(k)) state.mail.pending.delete(k); }));
  state.mail.messages = (state.mail.messages || []).filter((m) => !state.mail.gone.has(m._key));
  if (state.mail.open && done.includes(state.mail.open._key)) state.mail.open = null;
  if (!failed) toast(done.length === 1 ? `Moved to ${label}` : `Moved ${done.length} to ${label}`);
  else if (done.length) toast(`Moved ${done.length}; ${failed} could not be moved${lastErr ? ` (${lastErr})` : ''}`);
  else toast(lastErr || `Could not move to ${label}`);
  renderMail();
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
// Clear stray unread (old messages flagged unread, older than the visible page)
// across the current scope, then refresh the badge and the list.
async function mailReconcileUnread() {
  const ids = state.mail.account === 'all' ? (state.mail.accounts || []).map((a) => a.id) : [state.mail.account];
  toast('Clearing…');
  let cleared = 0;
  for (const id of ids) {
    if (!id) continue;
    try {
      const r = await mailApi('/reconcile-unread', { method: 'POST', body: JSON.stringify({ account: id }) });
      cleared += r.cleared || 0;
      state.mail.unseen = state.mail.unseen || {}; state.mail.unseen[id] = r.unseen || 0;
      state.mail.liveUnseen = state.mail.liveUnseen || {}; state.mail.liveUnseen[id] = r.unseen || 0;
    } catch (e) { toast(e && e.message ? e.message : 'Could not clear'); }
  }
  await refreshMailUnread();
  toast(cleared ? `Cleared ${cleared} unread` : 'Nothing stray to clear');
  loadMessages();
}
// Keep the unread badges fresh on their own, from the cheap D1 cache count.
async function refreshMailUnread() {
  try {
    const r = await mailApi('/unread');
    state.mailUnreadTotal = r.total || 0;
    if (state.mail) state.mail.unseen = { ...(state.mail.unseen || {}), ...(r.unseen || {}) };
    setAppBadgeCount(state.mailUnreadTotal);   // keep the icon badge honest while the app is open
    renderNav();
    if (state.view.type === 'mail' && state.mail && !state.mail.open && !state.mail.composing) renderMail();
  } catch {}
}
// ── Web Push: a number on the installed app icon when mail arrives ─────────
const VAPID_PUBLIC = 'BADBCS2EyxvWXx85la0chNU2CKNDhp_dW_3A8doQFEcViPaCe4TzIi0f1O0JW9mzZ-fiZP7tKKnPu7k6wKFF4Zk';
function setAppBadgeCount(n) {
  try { if (navigator.setAppBadge) { n > 0 ? navigator.setAppBadge(n) : (navigator.clearAppBadge && navigator.clearAppBadge()); } } catch {}
}
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// Register the SW (idempotent) and, if permission is already granted, make sure
// the server has our current subscription. Called on boot; never prompts.
async function initPush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    // A tapped notification asks us (not a hard reload) to show its target - in a
    // NEW tab, so the tab the user was on is left exactly as they had it.
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'notification-open') openInNewTab({ type: d.target === 'mail' ? 'mail' : d.target === 'contacts' ? 'contacts' : 'home' });
    });
    if (Notification.permission === 'granted') await subscribePush(reg);
  } catch (e) { /* SW unsupported/blocked - fine, app still works */ }
}
async function subscribePush(reg) {
  reg = reg || await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
}
// User tapped "Enable notifications": prompt, subscribe, register with server.
async function enablePush() {
  if (!pushSupported()) { toast('Notifications are not supported in this browser. On iPhone, add Robski Life to your Home Screen from Safari first.'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast(perm === 'denied' ? 'Notifications are blocked - allow them in browser settings.' : 'Notifications not enabled.'); return; }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    await subscribePush(reg);
    toast('Notifications on ✓');
    if (state.view && state.view.type === 'mailaccounts') openMailAccounts().catch(() => {});
  } catch (e) { toast('Could not enable notifications: ' + e.message); }
}
async function pushTest() {
  try { const r = await api('/api/push/test', { method: 'POST' }); toast(r && r.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}` : 'No devices subscribed yet'); }
  catch (e) { toast(e.message); }
}
function pushSectionHtml() {
  if (!pushSupported()) {
    return `<section class="push-sec"><div class="home-sec-h">Notifications</div>
      <p class="scope">To get a badge on the app icon when mail arrives, add Robski Life to your Home Screen (iPhone: Safari → Share → Add to Home Screen), then open it from there and come back here.</p></section>`;
  }
  const perm = Notification.permission;
  const on = perm === 'granted';
  return `<section class="push-sec"><div class="home-sec-h">Notifications</div>
    <p class="scope">Show a number on the Robski Life app icon when new mail arrives. Install it as an app first (Brave: menu → Install; iPhone: Share → Add to Home Screen).</p>
    <div class="push-acts">${perm === 'denied'
      ? '<span class="push-status">Blocked in your browser settings. Allow notifications for this site, then reload.</span>'
      : `<button class="add-btn wide" data-push-enable>${on ? '✓ Notifications on' : 'Enable notifications'}</button>${on ? '<button class="ghost" data-push-test>Send test</button>' : ''}`}</div></section>`;
}
function startMailUnreadPoll() {
  if (window.__mailUnreadT) return;
  refreshMailUnread();
  window.__mailUnreadT = setInterval(() => { if (!document.hidden) refreshMailUnread(); }, 90000);
}
async function openMail(openKey) {
  startMailUnreadPoll();
  // Which tab asked for this. Fetching accounts and a message list takes real
  // time, and anything after an await must check the answer is still wanted:
  // openMessage below WRITES state.view and syncs it onto the active tab, so a
  // late continuation would turn whatever tab you'd moved to into Mail.
  const myTab = state.activeTab;
  const mine = () => state.activeTab === myTab && state.view && state.view.type === 'mail';
  loadContacts().then(() => { if (state.view.type === 'mail' && state.mail && (state.mail.open || state.mail.composing)) renderMail(); }).catch(() => {});
  if (!state.mail) {
    let seed = {}; try { seed = JSON.parse(localStorage.getItem('life.mail.cache') || '{}'); } catch {}
    state.mail = { account: seed.account || null, mailbox: 'INBOX', folder: 'inbox', messages: [], open: null, composing: false, query: '', limit: 40, unseen: {}, hasMore: false, sel: null, shortcuts: false, threaded: localStorage.getItem('life.mail.threaded') !== '0', expanded: {}, selected: new Set(), pending: new Set(), gone: new Set(), mailboxes: [], moveMenu: null, accounts: Array.isArray(seed.accounts) && seed.accounts.length ? seed.accounts : undefined, listCache: seed.listCache || {} };
  }
  // Come back to Mail and land where you left off: reopen the message that was
  // open (from the tab's remembered view, or the still-open one in memory).
  if (!openKey && state.mail.open && !state.mail.composing) openKey = state.mail.open._key;
  state.view = openKey ? { type: 'mail', open: openKey } : { type: 'mail' };
  // Opening the Mail list (not resuming an open message or a compose): if there's
  // unread waiting, land straight on the Unread tab.
  if (!openKey && !state.mail.composing) {
    const unread = state.mailUnreadTotal || Object.values(state.mail.unseen || {}).reduce((a, b) => a + b, 0);
    if (unread > 0) state.mail.folder = 'unread';
  }
  if (!state.mailTrust) {
    state.mailTrust = new Set();
    api('/api/kv/mail_trusted').then((r) => { try { (JSON.parse(r.value || '[]') || []).forEach((a) => state.mailTrust.add(String(a).toLowerCase())); } catch {} if (state.view.type === 'mail' && state.mail && state.mail.open) renderMail(); }).catch(() => {});
  }
  renderNav();
  // Instant cold open: if we have a cached inbox, paint it now and refresh behind
  // it (loadMessages is stale-while-revalidate); otherwise show a loader.
  const haveCache = state.mail.accounts && state.mail.accounts.length && state.mail.account;
  if (haveCache) loadMessages(); else renderMail(true);
  try {
    const fresh = await mailApi('/accounts');
    if (!mine()) return;
    const changed = JSON.stringify(fresh.map((a) => a.id)) !== JSON.stringify((state.mail.accounts || []).map((a) => a.id));
    state.mail.accounts = fresh;
    if (!fresh.length) { renderMailAccounts('Add a mailbox to get started.'); return; }
    if (!state.mail.account) state.mail.account = fresh.length > 1 ? 'all' : fresh[0].id;
    // Cache the folder list (for "Move to folder") from the active/first account.
    const primary = state.mail.account !== 'all' ? state.mail.account : fresh[0].id;
    mailApi(`/mailboxes?account=${primary}`).then((mb) => { state.mail.mailboxes = Array.isArray(mb) ? mb : []; }).catch(() => {});
    persistMailCache();
    if (!haveCache || changed) await loadMessages();   // already loading above unless nothing was cached / accounts changed
    if (!mine()) return;
    // Restore the message that was open in this tab before you switched away.
    if (openKey && !state.mail.composing) {
      if (!(state.mail.messages || []).some((m) => m._key === openKey)) await loadMessages().catch(() => {});
      if (!mine()) return;
      if ((state.mail.messages || []).some((m) => m._key === openKey)) openMessage(openKey);
    }
  } catch (e) { if (!mine()) return; state.mail.error = e.message; renderMail(); }
}
// Map the D1 inbox-cache response into the keyed message shape the list uses.
function applyCachedList(r) {
  state.mail.unseen = r.unseen || {};
  state.mail._cacheSyncedAt = r.syncedAt || null;
  const nameOf = (id) => { const a = (state.mail.accounts || []).find((x) => x.id === id) || {}; return a.name || a.email || ''; };
  state.mail.messages = (r.messages || []).map((x) => { const mb = x.mailbox || 'INBOX'; return { ...x, _acct: x.account, _acctName: nameOf(x.account), _mailbox: mb, _key: `${x.account}:${mb}:${x.uid}` }; }).filter((m) => !(state.mail.gone && state.mail.gone.has(m._key)));
  state.mail.error = null; state.mail.acctErrors = []; state.mail.hasMore = false;
}
async function loadMessages(quiet, force) {
  // quiet = a live search: refresh only the list, leaving the search box (and
  // its focus/caret) alone. force = the user tapped Refresh, so always go live
  // even when the cache is fresh. A generation counter drops stale slow responses.
  const gen = (state.mail._gen = (state.mail._gen || 0) + 1);
  state.mail.searching = null;
  state.mail.open = null; state.mail.composing = false; state.mail.selected = new Set(); state.mail.moveMenu = null; state.mail.hover = null;
  const f = mailFolder(); state.mail.mailbox = f.mailbox;
  const all = state.mail.account === 'all';
  const accts = all ? (state.mail.accounts || []) : (state.mail.accounts || []).filter((a) => a.id === state.mail.account);
  const q = (state.mail.query || '').trim();
  const limit = state.mail.limit || 40;
  // Stale-while-revalidate: show the last list for this view instantly, then
  // refresh behind it, so switching folders/accounts or going back feels snappy.
  const viewKey = `${state.mail.account}|${f.mailbox}|${f.flagged ? 'F' : ''}${f.unseen ? 'U' : ''}|${q}|${limit}`;
  state.mail._viewKey = viewKey;
  state.mail.listCache = state.mail.listCache || {};
  const cached = state.mail.listCache[viewKey];
  const isDefaultInbox = !q && !f.flagged && !f.unseen && f.mailbox === 'INBOX' && limit <= 40;
  let painted = false;
  // 1) In-memory cache is freshest within a session (reflects this session's triage).
  if (cached && !quiet) { state.mail.messages = cached; state.mail.error = null; state.mail.acctErrors = []; renderMail(); painted = true; }
  // 2) Otherwise the server-side inbox cache (kept warm by the cron) - instant on a cold open.
  if (!painted && isDefaultInbox && !quiet) {
    try {
      const r = await mailApi(`/cached?account=${encodeURIComponent(state.mail.account)}`);
      if (state.mail._gen !== gen) return;
      if (r && Array.isArray(r.messages) && r.messages.length) { applyCachedList(r); renderMail(); painted = true; prefetchTop(); }
    } catch {}
  }
  // If the warm cache (kept fresh by the cron) is recent, or we did a live
  // refresh moments ago, skip the slow live IMAP round-trip for the plain inbox -
  // Gmail especially is slow to answer from the cloud. Kick a background warm so
  // the next open stays fresh, then stop here.
  state.mail._liveAt = state.mail._liveAt || {};
  const cacheFresh = state.mail._cacheSyncedAt && (Date.now() - Date.parse(state.mail._cacheSyncedAt) < 120000);
  const recentlyLive = state.mail._liveAt[viewKey] && (Date.now() - state.mail._liveAt[viewKey] < 90000);
  if (painted && isDefaultInbox && !quiet && !force && (cacheFresh || recentlyLive)) {
    state.mail.hasMore = (state.mail.messages || []).length >= 200;
    renderMailList(false); prefetchTop();
    if (!cacheFresh) mailApi('/sync', { method: 'POST' }).catch(() => {});
    return;
  }
  // 3) Nothing cached: a loader while the live fetch runs.
  if (q) state.mail.messages = [];   // nothing stale under a search
  if (!painted) { if (quiet) renderMailList(true); else renderMail(true); }
  state.mail.unseen = {};
  const acctErrors = [];
  let more = false;
  // Progressive load: seed per-account buckets from what's already on screen (the
  // cached paint), then refresh each mailbox independently and re-render as each
  // returns - so fast mailboxes show at once instead of the whole list waiting on
  // the slowest account (Gmail throttles cloud IPs). Each keeps its cached rows
  // until its own live result lands, so nothing blanks out mid-load.
  const bucket = {};
  // Seeding only makes sense when the new view is a variation of the old one -
  // another folder, another account - where holding the last rows stops a blank
  // flash. A SEARCH is not a variation: the rows already on screen are the
  // unfiltered inbox, and leaving them under a search box is exactly what makes
  // search look broken. Worse, a search that errors or times out never replaces
  // them, so the inbox sits there for good, looking like the result.
  if (!q) for (const mm of (state.mail.messages || [])) (bucket[mm._acct] = bucket[mm._acct] || []).push(mm);
  const rebuild = () => {
    let msgs = accts.flatMap((a) => bucket[a.id] || []);
    if (all) msgs = msgs.sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0));
    // Drop anything we've just deleted/moved: Gmail is eventually consistent, so a
    // live refetch can still list a message for a moment after it's gone.
    if (state.mail.gone && state.mail.gone.size) msgs = msgs.filter((m) => !state.mail.gone.has(m._key));
    state.mail.messages = msgs;
    if (!state.mail.open) { const has = msgs.some((x) => x._key === state.mail.sel); if (!has) state.mail.sel = msgs[0] ? msgs[0]._key : null; }
    state.mail.error = null; state.mail.acctErrors = acctErrors;
    renderMailList(false);
  };
  const loadOne = async (a) => {
    try {
      const r = await mailApi(`/messages?account=${a.id}&mailbox=${encodeURIComponent(f.mailbox)}&limit=${limit}${f.flagged ? '&flagged=1' : ''}${f.unseen ? '&unseen=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (state.mail._gen !== gen) return;
      state.mail.unseen[a.id] = r.unseen || 0;
      // Live IMAP unseen count, kept apart from the cache-poll number so a
      // background /unread refresh can't stomp the stray-unread banner signal.
      if (f.mailbox === 'INBOX' && !f.flagged && !q) { state.mail.liveUnseen = state.mail.liveUnseen || {}; state.mail.liveUnseen[a.id] = r.unseen || 0; }
      // A search sweeps every folder, so each hit carries its own mailbox; key by
      // it too, since UIDs are only unique within a mailbox.
      bucket[a.id] = (r.messages || []).map((x) => { const mb = x.mailbox || f.mailbox; return { ...x, _acct: a.id, _acctName: a.name || a.email, _mailbox: mb, _key: `${a.id}:${mb}:${x.uid}` }; });
      if ((r.failed || []).length) acctErrors.push({ name: a.name || a.email, msg: `could not search ${r.failed.length} folder${r.failed.length === 1 ? '' : 's'} (${r.failed.slice(0, 3).join(', ')})` });
      if (!r.searchedAll && (r.total || 0) > bucket[a.id].length) more = true;
    } catch (e) { acctErrors.push({ name: a.name || a.email, msg: e.message }); if (bucket[a.id] === undefined) bucket[a.id] = []; }
    if (state.mail._gen === gen) rebuild();   // render as each mailbox lands
  };
  // Browsing fans out: every account at once, each painting as it lands. SEARCHING
  // goes one at a time. A search is many SELECTs and a UID SEARCH per folder, and
  // firing that at several providers simultaneously is how Gmail decides you are
  // being a nuisance and drops the connection - which came back as "No matches"
  // for an account that had never actually been searched. Slower, and right.
  if (q) {
    for (const a of accts) {
      state.mail.searching = a.name || a.email;
      renderMailList(false);
      await loadOne(a);
      if (state.mail._gen !== gen) return;
    }
    state.mail.searching = null;
    renderMailList(false);
  } else await Promise.all(accts.map(loadOne));
  if (state.mail._gen !== gen) return;   // a newer load superseded this one
  state.mail.listCache[viewKey] = state.mail.messages;   // freshen for next time
  state.mail._liveAt[viewKey] = Date.now();              // note when we last hit live IMAP for this view
  state.mail.hasMore = more && !q && !f.flagged && !f.unseen;   // "Load older" only when browsing
  if (!q) persistMailCache();                             // instant cold open next time
  renderMailList(false);
  prefetchTop();   // warm the top few bodies so tapping one is instant
}
// Persist accounts + the recent folder lists so opening Mail after an app
// restart paints the last-seen inbox immediately, then refreshes. No secrets
// here - just headers/subjects (the same data already on screen).
function persistMailCache() {
  try {
    const lc = state.mail.listCache || {};
    const keys = Object.keys(lc).filter((k) => !k.split('|')[3]).slice(-6);   // skip search keys
    const trimmed = {}; for (const k of keys) trimmed[k] = (lc[k] || []).slice(0, 40);
    localStorage.setItem('life.mail.cache', JSON.stringify({ accounts: state.mail.accounts || [], account: state.mail.account, listCache: trimmed }));
  } catch {}
}
// Fetch a message body once and cache it by key (bodies are immutable). Reused
// by both opening and hover-prefetch, with an in-flight guard so a hover then a
// click share the same request.
function mailFetchMsg(row) {
  const key = row._key;
  state.mail.msgCache = state.mail.msgCache || {};
  if (state.mail.msgCache[key]) return Promise.resolve(state.mail.msgCache[key]);
  state.mail._inflight = state.mail._inflight || {};
  if (!state.mail._inflight[key]) {
    state.mail._inflight[key] = mailApi(`/message?account=${row._acct}&mailbox=${encodeURIComponent(row._mailbox)}&uid=${row.uid}`)
      .then((m) => { const c = state.mail.msgCache; c[key] = m; const ks = Object.keys(c); if (ks.length > 40) delete c[ks[0]]; return m; })
      .finally(() => { delete state.mail._inflight[key]; });
  }
  return state.mail._inflight[key];
}
// Warm the cache for a row the mouse is resting on, so the click is instant.
function prefetchMsg(key) {
  const row = (state.mail.messages || []).find((x) => x._key === key);
  if (row && !(state.mail.msgCache && state.mail.msgCache[key])) mailFetchMsg(row).catch(() => {});
}
// Warm the bodies of the top few messages so opening one (a tap, no hover to
// prefetch on) is instant - especially on mobile. Gentle: only a handful, two
// at a time, and it bails the moment you open/leave so it never competes.
let _prefetchGen = 0;
async function prefetchTop(n = 6) {
  const m = state.mail; if (!m || m.open || m.composing || mailSearching() || state.view.type !== 'mail') return;
  m.msgCache = m.msgCache || {};
  const rows = (m.messages || []).filter((r) => !m.msgCache[r._key]).slice(0, n);
  if (!rows.length) return;
  const gen = ++_prefetchGen;
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const row = rows[i++];
      if (gen !== _prefetchGen || state.view.type !== 'mail' || m.open || m.composing) return;
      try { await mailFetchMsg(row); } catch {}
    }
  };
  await Promise.all([worker(), worker()]);
}
// Drop keys from every cached list, so an archived/deleted message doesn't
// reappear when you navigate back to a view served from the list cache.
function mailForgetKeys(keys) {
  const set = new Set(keys); const lc = state.mail.listCache || {};
  for (const k in lc) lc[k] = (lc[k] || []).filter((m) => !set.has(m._key));
}
async function openMessage(key) {
  const row = (state.mail.messages || []).find((x) => x._key === key); if (!row) return;
  state.mail.sel = key; state.mail.hoverThread = null;   // the cursor follows what you open, so it's here after Back
  // Record the open message on the view so this tab reopens it after a switch.
  state.view = { type: 'mail', open: key }; syncActiveTab();
  const cached = state.mail.msgCache && state.mail.msgCache[key];
  // /message doesn't report flags, so carry the row's starred state across -
  // otherwise the reader star always shows empty and needs two clicks to set.
  const apply = (m) => { state.mail.open = { ...m, _acct: row._acct, _mailbox: row._mailbox, _acctName: row._acctName, _key: row._key, uid: row.uid, flagged: !!row.flagged }; };
  if (cached) apply(cached); else renderMail(true);   // cached opens instantly, no loading flash
  if (!row.seen) { row.seen = true; bumpUnread(row._acct, -1); mailApi('/flag', { method: 'POST', body: JSON.stringify({ account: row._acct, mailbox: row._mailbox, uid: row.uid, seen: true }) }).catch(() => {}); }
  if (cached) { renderMail(); return; }
  try { apply(await mailFetchMsg(row)); } catch (e) { toast(e.message); }
  renderMail();
}
async function mailDelete(key) {
  const row = mailRow(key); if (!row) return;
  // No confirm: Trash is recoverable, so a mis-tap costs a trip to the Trash
  // folder, not the message. Matches the keyboard Del shortcut, which never asked.
  mailMoveTo(key, 'Trash', 'Moved to Trash');   // thread-aware + advances to the next message
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
  // Everything is inside the try: building the payload (signature, sanitise)
  // can throw too, and a silent throw here is a Send that "does nothing".
  try {
    const from = composeAcctId();
    if (!from) { toast('No account to send from'); return; }
    const acct = (state.mail.accounts || []).find((a) => a.id === from);
    const sig = acct && acct.signature;
    const attachments = (state.mail.composing && state.mail.composing.attachments) || [];
    const text = htmlToPlain(bodyHtml) + (sig ? `\n\n${sigToText(sig)}` : '');
    const html = `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;font-size:15px;line-height:1.55;color:#1b1820">${sanitizeEmailHtml(bodyHtml || '')}</div>${sig ? `<br>${sig}` : ''}`;
    const payload = { account: from, to, cc, bcc, subject, text, html, inReplyTo, attachments };
    toast('Sending…');
    await mailApi('/send', { method: 'POST', body: JSON.stringify(payload) });
    toast('Sent'); clearDraft(); state.mail.composing = false; renderMail();
  } catch (e) { toast(e && e.message ? e.message : 'Could not send'); }
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
// Drafts are local (localStorage), MULTIPLE, and cover every compose - new
// messages, replies and forwards alike. They survive an app-switch because we
// flush on visibilitychange/pagehide (below), not just on a debounce timer.
const DRAFTS_KEY = 'life.mail.drafts';
const allDrafts = () => { try { const a = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const writeDrafts = (a) => { try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(a)); } catch {} };
const draftCount = () => allDrafts().length;
const newDraftId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const draftEmpty = (c) => !((c.to || '').trim() || (c.cc || '').trim() || (c.bcc || '').trim() || (c.subject || '').trim() || (c.body || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || (c.attachments && c.attachments.length));
// Pull the latest field values out of the live compose DOM into the state, so a
// flush captures keystrokes the debounce hasn't committed yet.
function syncCompose() {
  const c = state.mail && state.mail.composing; if (!c) return;
  const g = (id) => document.getElementById(id);
  if (g('mc-to')) c.to = g('mc-to').value;
  if (g('mc-cc')) c.cc = g('mc-cc').value;
  if (g('mc-bcc')) c.bcc = g('mc-bcc').value;
  if (g('mc-subject')) c.subject = g('mc-subject').value;
  if (g('mc-body')) c.body = g('mc-body').innerHTML;
}
function saveDraft() {
  const c = state.mail && state.mail.composing; if (!c) return;
  syncCompose();
  if (!c._draftId) c._draftId = newDraftId();
  const list = allDrafts().filter((d) => d.id !== c._draftId);
  if (draftEmpty(c)) { writeDrafts(list); return; }
  list.unshift({ id: c._draftId, acct: c._acct || composeAcctId(), to: c.to || '', cc: c.cc || '', bcc: c.bcc || '', subject: c.subject || '', body: c.body || '', attachments: c.attachments || [], inReplyTo: c.inReplyTo || null, updated: Date.now() });
  writeDrafts(list);
}
function removeDraft(id) { if (id) writeDrafts(allDrafts().filter((d) => d.id !== id)); }
function clearDraft() { const c = state.mail && state.mail.composing; if (c) removeDraft(c._draftId); }
function startCompose() {
  state.mail.composing = { _draftId: newDraftId() };
  renderMail(); setTimeout(() => { const el = $('#mc-to'); if (el) el.focus(); }, 30);
}
function resumeDraft(id) {
  const d = allDrafts().find((x) => x.id === id); if (!d) return;
  state.mail.composing = { _draftId: d.id, _acct: d.acct, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body, attachments: d.attachments || [], inReplyTo: d.inReplyTo || undefined, _resumed: true };
  renderMail(); setTimeout(() => { const el = $('#mc-body'); if (el) el.focus(); }, 30);
}
function delDraft(id) { removeDraft(id); renderMail(); }
function draftsListHtml() {
  const d = allDrafts();
  if (!d.length) return '<div class="home-empty">No drafts. A half-written email is saved here the moment you start typing, so you can always pick it back up.</div>';
  return d.map((x) => {
    const snip = (x.body || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
    const to = (x.to || '').trim();
    const when = x.updated ? new Date(x.updated).toLocaleString() : '';
    return `<button class="draft-row" data-resume-draft="${x.id}">
      <span class="draft-main">
        <span class="draft-top"><span class="draft-subj">${esc(x.subject || '(no subject)')}</span><span class="draft-when">${esc(when)}</span></span>
        <span class="draft-sub">${to ? `To: ${esc(to)}` : '<i>No recipient yet</i>'}${snip ? ` — ${esc(snip)}` : ''}</span>
      </span>
      <span class="draft-x" data-del-draft="${x.id}" title="Delete draft">×</span>
    </button>`;
  }).join('');
}
async function openMailAccounts() {
  state.view = { type: 'mailaccounts' }; renderNav();
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
      // Prefer the attachment's own signed URL (works for both the light and
      // full paths); fall back to the idx route for anything without one.
      const res = a.url
        ? await fetch(a.url)
        : await fetch(`/api/mail/attachment?account=${encodeURIComponent(o._acct)}&mailbox=${encodeURIComponent(o._mailbox)}&uid=${o.uid}&idx=${a.idx}`, { headers: { Authorization: `Bearer ${localStorage.getItem('today.token')}` } });
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
// Email Scribe drafts a reply, then drops it into a normal reply compose above the
// quoted original. It never sends - Robin reviews and edits like any draft.
async function mailClaudius() {
  const o = state.mail.open; if (!o) return;
  const btn = document.querySelector('[data-mail-claudius]');
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
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
    toast('Email Scribe drafted a reply - review it before sending');
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
  }
}

// No auto-signature: the editor starts blank, so nothing is ever appended to a
// message unless you deliberately write and save a signature yourself.
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
  const s = a.signature || '';
  const hexM = s.match(/border-left\s*:\s*[^;"']*?(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/i);
  if (hexM) return normHex(hexM[1]) || '#c4412e';
  // Browsers serialise an assigned colour to rgb(...), so read that form too -
  // otherwise the picker can't recover a saved colour and shows the red default.
  const rgbM = s.match(/border-left\s*:\s*[^;"']*?rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbM) { const hx = '#' + rgbM.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join(''); return normHex(hx) || '#c4412e'; }
  return normHex(a.color || '#c4412e') || '#c4412e';
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
      <div class="mail-sig-ed prose" contenteditable="true" data-sig-acct="${a.id}" data-ph="Your signature…">${a.signature || ''}</div>
      <div class="mail-sig-act"><button class="add-btn" data-sig-save="${a.id}">Save signature</button><span class="sig-hint">Added to the bottom of messages you send from this address.</span></div>
    </div>
    ${(a.blocked && a.blocked.length) ? `<div class="mail-blocked"><span class="mail-blocked-h">Blocked senders · ${a.blocked.length}</span><div class="mail-blocked-chips">${a.blocked.map((addr) => `<span class="mail-blocked-chip">${esc(addr)}<button data-mail-unblock="${esc(addr)}" data-mail-unblock-acct="${a.id}" title="Unblock">×</button></span>`).join('')}</div></div>` : ''}
    </div>`).join('');
  $('#pane').innerHTML = `${acctCrumbHtml(false)}
    <div class="pane-head home-head"><h1>Accounts</h1><button class="add-btn wide" data-mail-add-acct>+ Add mailbox</button></div>
    <p class="scope">${note ? esc(note) + ' ' : ''}Connect as many mailboxes as you like - adding one never removes another.</p>
    <div class="mail-acct-list">${rows}</div>
    <div id="mail-acct-form"></div>
    ${(state.mail.accounts || []).length ? `<button class="mail-add-more" data-mail-add-acct>+ Add another mailbox</button>` : ''}
    ${pushSectionHtml()}
    <section class="push-sec"><div class="home-sec-h">Default email app</div>
      <p class="scope" style="margin:0 0 12px">Make Robski Life open when you click a <b>mailto:</b> email link in your browser. Your browser will ask you to allow it, then you set it as the default (Brave/Chrome: <b>Settings → Site &amp; Shields settings → Handlers</b>, or the ⛓ icon in the address bar).</p>
      <button class="add-btn wide" data-mail-handler>Set Robski Life as my email app</button></section>`;
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
  google: { label: 'Google / Workspace', imap: 'imap.gmail.com', imapPort: 993, smtp: 'smtp.gmail.com', smtpPort: 465, note: GMAIL_APP_PW + ' <span class="gpw-admin">On a Workspace account, your admin must also allow IMAP.</span>' },
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
  // No <base target="_blank"> - instead we intercept link clicks and hand the URL
  // to the parent, which opens it in the OS default browser (a sandboxed iframe
  // can't do that itself, and its own scripts were already stripped).
  return `<!doctype html><html><head><meta name="color-scheme" content="light">
    <style>html,body{margin:0}body{padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:15px;line-height:1.5;color:#1b1820;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#c4412e}table{max-width:100%}</style>
    </head><body>${sanitizeEmailHtml(html, blockImages)}<script>(function(){function h(){parent.postMessage({__mailHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)},'*');}window.addEventListener('load',h);document.addEventListener('load',h,true);try{new ResizeObserver(h).observe(document.documentElement);}catch(e){}setTimeout(h,60);setTimeout(h,500);document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var href=a.getAttribute('href')||'';if(/^(https?:|mailto:)/i.test(href)){e.preventDefault();parent.postMessage({__mailLink:href},'*');}},true);document.addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;var k=e.key;if(/^[a-zA-Z!#]$/.test(k)||k==='Escape')parent.postMessage({__mailKey:k},'*');},true);})();<\/script></body></html>`;
}
// Open a URL in the OS default browser via a marked, user-initiated anchor click
// (works in installed PWAs / WKWebView wrappers). The data-ext-open marker stops
// the document click handler re-catching it into an infinite loop.
function openExternal(url) {
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.dataset.extOpen = '1';
  document.body.appendChild(a); a.click(); a.remove();
}
// Grow #mail-body-frame to whatever height it reports (installed once).
if (typeof window !== 'undefined' && !window.__mailFrameSizer) {
  window.__mailFrameSizer = true;
  window.addEventListener('message', (ev) => {
    if (!ev.data || typeof ev.data.__mailHeight !== 'number') return;
    const f = document.getElementById('mail-body-frame');
    if (f) f.style.height = `${Math.max(200, Math.min(ev.data.__mailHeight + 6, 40000))}px`;
  });
  // A single-key shortcut pressed while the email body iframe has focus: the
  // parent's keydown handler never sees it, so the iframe forwards the key and
  // we replay it on the document (E archive, S star, R reply, Esc close, …).
  window.addEventListener('message', (ev) => {
    const k = ev.data && ev.data.__mailKey;
    if (typeof k !== 'string') return;
    const f = document.getElementById('mail-body-frame');
    if (!f || ev.source !== f.contentWindow) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
  // A link clicked inside the email frame: open it in the OS default browser
  // (same as links elsewhere in the app); a mailto starts an in-app reply.
  window.addEventListener('message', (ev) => {
    const url = ev.data && ev.data.__mailLink;
    if (typeof url !== 'string') return;
    const f = document.getElementById('mail-body-frame');
    if (!f || ev.source !== f.contentWindow) return;
    if (/^mailto:/i.test(url)) {
      const to = decodeURIComponent(url.slice(7).split('?')[0]);
      if (state.mail) { state.mail.composing = { to }; renderMail(); setTimeout(() => { const el = document.getElementById('mc-to'); if (el) el.focus(); }, 30); }
      return;
    }
    if (/^https?:/i.test(url)) openExternal(url);
  });
}
const MAIL_SHORTCUTS = [
  ['J / K', 'Previous / next message'], ['Enter / O', 'Open highlighted'], ['Esc', 'Back to the list'],
  ['R', 'Reply'], ['A', 'Reply all'], ['F', 'Forward'], ['E', 'Archive'], ['S', 'Star / unstar'],
  ['U', 'Mark unread'], ['!', 'Mark as spam'], ['⌫ · Del · #', 'Delete (to Trash)'],
  ['C', 'Compose'], ['/', 'Jump to search'], ['⌘ ↵', 'Send (while composing)'], ['?', 'Toggle this panel'],
];
function shortcutsOverlayHtml() {
  return `<div class="mail-sc-bg" data-mail-sc-close><div class="mail-sc" role="dialog" aria-label="Keyboard shortcuts">
    <div class="mail-sc-h"><b>Keyboard shortcuts</b><button class="ghost" data-mail-sc-close title="Close">×</button></div>
    <div class="mail-sc-grid">${MAIL_SHORTCUTS.map(([k, d]) => `<div class="mail-sc-row"><kbd>${esc(PK(k))}</kbd><span>${esc(d)}</span></div>`).join('')}</div>
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
// Short, friendly folder name for the chip shown on cross-folder search hits.
function prettyMailbox(p) {
  const s = String(p || '').replace(/^\[Gmail\]\//i, '');
  if (/^INBOX$/i.test(s)) return 'Inbox';
  return s.split(/[/.]/).filter(Boolean).pop() || s;
}
const mailSearching = () => !!(state.mail && state.mail.query && state.mail.query.trim());
const folderChip = (x) => (mailSearching() && x._mailbox && !/^INBOX$/i.test(x._mailbox)) ? `<span class="mail-folder-chip">${esc(prettyMailbox(x._mailbox))}</span>` : '';
// One message row. `count` (>1) shows a quiet conversation tally, Spark-style -
// no chevrons or badges, the thread just reads as one row.
const mailRowHtml = (x, child, count) => `<button class="mail-row ${x.seen ? '' : 'unread'} ${child ? 'mail-child' : ''} ${state.mail.pending && state.mail.pending.has(x._key) ? 'mail-pending' : ''} ${state.mail.selected && state.mail.selected.has(x._key) ? 'picked' : ''} ${state.mail.open && state.mail.open._key === x._key ? 'csel' : (state.mail.sel === x._key ? 'ksel' : '')}" data-mail-open="${esc(x._key)}">
    <span class="mail-check ${state.mail.selected && state.mail.selected.has(x._key) ? 'on' : ''}" data-mail-check="${esc(x._key)}" title="Select">${state.mail.selected && state.mail.selected.has(x._key) ? '✓' : ''}</span>
    <span class="mail-avatar">${esc(initial(mailFrom(x)))}</span>
    <span class="mail-row-main"><span class="mail-row-top"><span class="mail-from">${esc(mailFrom(x) || '(unknown)')}${count > 1 ? `<span class="mail-conv-n">${count}</span>` : ''}</span><span class="mail-date">${mailDate(x.date)}</span></span>
    <span class="mail-subject">${state.mail.account === 'all' ? `<span class="mail-acct-chip">${esc(x._acctName || '')}</span>` : ''}${folderChip(x)}${esc(x.subject)}</span>
    ${x.preview ? `<span class="mail-preview">${esc(x.preview)}</span>` : ''}</span>
    <span class="mail-star ${x.flagged ? 'on' : ''}" data-mail-star="${esc(x._key)}" title="${x.flagged ? 'Unstar' : 'Star'}">${x.flagged ? '★' : '☆'}</span></button>`;
// Clean, consistent line icons for the reader toolbar (currentColor stroke), so
// it reads as one set rather than a jumble of emoji.
const mIco = (p, fill) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const MAIL_ICO = {
  starOn: mIco('<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 17.9 6.9 20.6l1-5.7-4.1-4 5.7-.8z"/>', true),
  starOff: mIco('<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 17.9 6.9 20.6l1-5.7-4.1-4 5.7-.8z"/>'),
  reply: mIco('<path d="M9 8L4.5 12 9 16"/><path d="M4.5 12h9a5 5 0 0 1 5 5v1"/>'),
  replyAll: mIco('<path d="M8 8l-4 4 4 4"/><path d="M12.5 8l-4 4 4 4"/><path d="M8.5 12h6a5 5 0 0 1 5 5v1"/>'),
  forward: mIco('<path d="M15 8l4.5 4L15 16"/><path d="M19.5 12h-9a5 5 0 0 0-5 5v1"/>'),
  archive: mIco('<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5"/><path d="M10 12.5h4"/>'),
  spam: mIco('<path d="M12 4l8.5 14.6H3.5z"/><path d="M12 10v3.5"/><path d="M12 16.8h.01"/>'),
  block: mIco('<circle cx="12" cy="12" r="8.4"/><path d="M6.1 6.1l11.8 11.8"/>'),
  trash: mIco('<path d="M4.5 7h15"/><path d="M9 7V5.3A1.3 1.3 0 0 1 10.3 4h3.4A1.3 1.3 0 0 1 15 5.3V7"/><path d="M6.6 7l.85 11.3A1.6 1.6 0 0 0 9 20h6a1.6 1.6 0 0 0 1.6-1.7L17.4 7"/>'),
  sparkle: mIco('<path d="M12 3.6l1.7 4.9 4.9 1.7-4.9 1.7L12 16.7l-1.7-4.8L5.4 10l4.9-1.7z"/>', true),
  task: mIco('<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M8.4 12.3l2.4 2.4 4.8-5.4"/>'),
  area: mIco('<path d="M12 3.6l8.4 8.4-8.4 8.4L3.6 12z"/>'),   // the ◈ life-area diamond, as a line icon
};
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
  if (!state.calAdded && !state._calAddedReq) { state._calAddedReq = true; loadCalAdded().then(() => { if (state.view && state.view.type === 'mail') renderMail(); }); }
  const added = calInviteAdded(inv);
  return `<div class="mail-invite">
    <div class="mail-invite-h">📅 Calendar invitation</div>
    <div class="mail-invite-title">${esc(inv.summary || '(no title)')}</div>
    <div class="mail-invite-when">${esc(when)}</div>
    ${inv.location ? `<div class="mail-invite-loc">📍 ${esc(inv.location)}</div>` : ''}
    ${inv.organizer ? `<div class="mail-invite-org">from ${esc(inv.organizer)}</div>` : ''}
    <div class="mail-invite-act">${added ? '<span class="mail-invite-added">✓ On your calendar</span>' : '<button class="add-btn wide" data-mail-invite-add>Add to Calendar</button>'}${inv.url ? `<button class="ghost" data-mail-join="${esc(inv.url)}">🎥 Join</button>` : ''}</div>
  </div>`;
}
// One invite = one calendar event. Track which we've added (by the .ics UID, or a
// title+start fallback) in a kv setting, so a second tap - or reopening the same
// email - shows it's already there instead of duplicating it.
const inviteKey = (inv) => inv.uid || `${inv.summary || ''}|${inv.start || inv.startDate || ''}`;
const calInviteAdded = (inv) => !!(state.calAdded && state.calAdded[inviteKey(inv)]);
async function loadCalAdded() {
  if (state.calAdded) return state.calAdded;
  try { const r = await api('/api/kv/cal_added'); state.calAdded = (r && r.value && JSON.parse(r.value)) || {}; } catch { state.calAdded = {}; }
  return state.calAdded;
}
// The distinct http(s) links in an open email - <a href> targets in the HTML
// part plus bare URLs in the text part - so an invite's "Add to Calendar" can
// stash them as event notes. Skips the meeting/join link (already carried as the
// event's url), image/stylesheet/script assets and obvious unsubscribe cruft, and
// caps the list so a newsletter-style invite can't dump its whole footer.
function mailInviteLinks(o, skipLink) {
  if (!o) return [];
  const skipUrl = (u) => {
    if (skipLink && u === skipLink) return true;
    if (/\.(png|jpe?g|gif|svg|webp|ico|bmp|css|js|woff2?|ttf)(\?|$)/i.test(u)) return true;
    if (/(unsubscribe|list-manage|email-preferences)/i.test(u)) return true;
    return false;
  };
  const seen = new Set(); const out = [];
  const add = (raw) => {
    if (out.length >= 12) return;
    const u = String(raw || '').replace(/["'&<>]+$/, '').trim();
    if (!/^https?:\/\//i.test(u) || skipUrl(u)) return;
    const key = u.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return; seen.add(key); out.push(u);
  };
  const html = String(o.html || ''); const HREF = /href\s*=\s*["']([^"']+)["']/gi; let m;
  while ((m = HREF.exec(html))) add(m[1]);
  const text = String(o.text || ''); BARE_URL.lastIndex = 0;
  while ((m = BARE_URL.exec(text))) add(m[0]);
  return out;
}
async function mailInviteAdd() {
  const inv = state.mail.open && state.mail.open.invite; if (!inv) return;
  await loadCalAdded();
  if (calInviteAdded(inv)) { toast('Already on your calendar'); return; }
  // Carry any webinar/meeting link (from the .ics, or found in the email body)
  // onto the event, so the calendar entry can offer a Join link.
  const link = inv.url || mailMeetingLink(state.mail.open) || undefined;
  // Save any other links from the invitation email as the event's notes.
  const links = mailInviteLinks(state.mail.open, link);
  const notes = links.length ? `Links from the invitation email:\n${links.join('\n')}` : undefined;
  // Carry the invite's iCalUID so the worker can spot an event Gmail already
  // added to the calendar and adopt it, rather than creating a duplicate.
  const uid = inv.uid || undefined;
  let body;
  if (inv.allDay) body = { title: inv.summary, allDay: true, day: inv.startDate, location: inv.location || undefined, url: link, notes, uid };
  else { let end = inv.end; if (!end && inv.start) { try { end = new Date(new Date(inv.start).getTime() + 3600000).toISOString(); } catch {} }
    body = { title: inv.summary, start: inv.start, end, tz: inv.tz || undefined, location: inv.location || undefined, url: link, notes, uid }; }
  try {
    const r = await api('/api/events', { method: 'POST', body: JSON.stringify(body) });
    state.calAdded[inviteKey(inv)] = 1;
    api('/api/kv/cal_added', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(state.calAdded) }) }).catch(() => {});
    toast(r && r.existed ? 'Already on your calendar' : 'Added to your calendar'); renderMail();
  } catch (e) { toast(e.message); }
}
// The inner HTML of the .mail-list container (rows / loading / empty state).
// Kept separate so a live search can refresh just the list without rebuilding
// the header - which would destroy the search box and steal focus mid-type.
function mailListInner(loading) {
  const m = state.mail;
  if (m.folder === 'drafts') return draftsListHtml();
  const showAcct = m.account === 'all';
  // Always threaded, Spark-style: one clean row per conversation (the latest
  // message), with a quiet count when there's more than one. Opening it shows
  // the whole conversation. No toggle, no chevrons, no big-deal badges.
  const rows = buildThreads(m.messages || []).map((th) => mailRowHtml(th.latest, false, th.count)).join('');
  const errBanner = (!loading && (m.acctErrors || []).length)
    ? m.acctErrors.map((e) => `<div class="mail-acct-err">⚠ <b>${esc(e.name)}</b> could not load: ${esc(e.msg)}</div>`).join('')
    : '';
  const emptyMsg = m.query
    ? ((m.acctErrors || []).length ? 'No matches in the accounts that answered - see above.' : 'No matches.')
    : m.folder === 'unread' ? 'No unread messages. Inbox zero.' : 'No messages.';
  // While a sweep is still running, an empty list means "not yet", not "nothing".
  const busy = !loading && m.query && m.searching;
  const body = loading ? '<div class="home-empty">Searching…</div>'
    : (rows || (busy ? '' : `<div class="home-empty">${emptyMsg}</div>`));
  const busyLine = busy ? `<div class="home-empty mail-searching">Searching ${esc(m.searching)}…</div>` : '';
  return `${errBanner}${body}${busyLine}${!loading && m.hasMore ? '<button class="mail-loadmore" data-mail-more>Load older</button>' : ''}`;
}
// Refresh only the message list in place, keeping the header/search box intact.
function renderMailList(loading) {
  const el = document.querySelector('.mail-list');
  if (el) el.innerHTML = mailListInner(loading);
  else renderMail(loading);
}
function renderMail(loading) {
  // Mail's loads are the slowest in the app (IMAP, over the network, sometimes
  // seconds), so a response can land long after you've moved on. Painting it then
  // drops the mail list on top of whatever you're actually looking at. Every mail
  // render goes through here, so this one guard closes the whole class of it.
  if (!state.view || (state.view.type !== 'mail' && state.view.type !== 'mailaccounts')) return;
  const m = state.mail;
  document.body.classList.toggle('mail-reading', !!(m && (m.open || m.composing)));   // mobile: full-screen reader
  if (m.accounts && !m.accounts.length) return renderMailAccounts('Add a mailbox to get started.');
  const unseenOf = (id) => (m.unseen && m.unseen[id]) || 0;
  const badge = (n) => n ? `<span class="mail-unread-b">${n}</span>` : '';
  const totalUnseen = Object.values(m.unseen || {}).reduce((a, b) => a + b, 0);
  // A "stray" unread: the account's unseen count is higher than the unread you
  // can actually see in the list (an old message flagged unread, older than the
  // newest page). Offer to clear it, since it's otherwise unreachable.
  const liveUnseenOf = (id) => (m.liveUnseen && m.liveUnseen[id]) || 0;
  const scopeUnseen = m.account === 'all' ? (m.accounts || []).reduce((a, x) => a + liveUnseenOf(x.id), 0) : liveUnseenOf(m.account);
  const visibleUnread = (m.messages || []).filter((x) => !x.seen).length;
  const strayUnread = (m.folder || 'inbox') === 'inbox' && !mailSearching() ? Math.max(0, scopeUnseen - visibleUnread) : 0;
  m._stray = strayUnread;   // remembered so the hide button knows which count was dismissed
  // One compact dropdown instead of a row of account tabs: defaults to All, pick
  // a single box only when you want to.
  const accScope = (m.accounts || []).length > 1 ? `<select class="sel mail-acct-scope-sel" data-mail-acct-sel title="Which mailbox">
      <option value="all" ${m.account === 'all' ? 'selected' : ''}>All accounts${totalUnseen ? ` · ${totalUnseen} unread` : ''}</option>
      ${(m.accounts || []).map((a) => `<option value="${a.id}" ${a.id === m.account ? 'selected' : ''}>${esc(a.name || a.email)}${unseenOf(a.id) ? ` · ${unseenOf(a.id)}` : ''}</option>`).join('')}
    </select>` : '';
  const showAcct = m.account === 'all';
  const list = `<div class="mail-list">${mailListInner(loading)}</div>`;
  let reader;
  if (m.composing) {
    const catts = m.composing.attachments || [];
    reader = `<form id="mail-compose-form" class="mail-compose">
      <div class="mail-reader-head mail-compose-head"><button type="button" class="ghost mail-back" data-mail-cancel title="Cancel">← Back</button><span class="mail-reader-title">New message</span>${m.composing._resumed ? '<span class="mail-draft-note">Resumed draft</span>' : ''}<span class="mail-compose-head-act"><button type="button" class="ghost mail-act-ic" data-mail-attach title="Attach files">📎</button><button type="button" class="ghost mail-act-ic mail-discard" data-mail-discard title="Discard draft">🗑</button><button class="add-btn wide mail-send-btn" type="submit">Send</button></span></div>
      ${(m.accounts && m.accounts.length > 1) ? `<label class="mc-from"><span class="mc-from-l">From</span><select id="mc-from">${m.accounts.map((a) => { const nm = (a.name || '').trim(); const label = nm && nm.toLowerCase() !== (a.email || '').toLowerCase() ? `${nm} · ${a.email}` : a.email; return `<option value="${esc(a.id)}" ${a.id === composeAcctId() ? 'selected' : ''}>${esc(label)}</option>`; }).join('')}</select></label>` : ''}
      <input id="mc-to" placeholder="To" value="${esc(m.composing.to || '')}" list="contacts-dl" required>
      <input id="mc-cc" placeholder="Cc" value="${esc(m.composing.cc || '')}" list="contacts-dl">
      <input id="mc-bcc" placeholder="Bcc" value="${esc(m.composing.bcc || '')}" list="contacts-dl">
      ${contactsDatalist()}
      <input id="mc-subject" placeholder="Subject" value="${esc(m.composing.subject || '')}">
      <div class="mail-rt-toolbar">
        <button type="button" data-rt="bold" title="Bold  ·  ${PK('⌘B')}"><b>B</b></button>
        <button type="button" data-rt="italic" title="Italic  ·  ${PK('⌘I')}"><i>I</i></button>
        <button type="button" data-rt="underline" title="Underline  ·  ${PK('⌘U')}"><u>U</u></button>
        <button type="button" data-rt="insertUnorderedList" title="Bullet list">•&nbsp;List</button>
        <button type="button" data-rt="link" title="Add link">🔗</button>
      </div>
      <div id="mc-body" class="mail-compose-body prose" contenteditable="true" data-ph="Write your message…">${m.composing.body || ''}</div>
      ${catts.length ? `<div class="mail-att">${catts.map((a) => `<span class="mail-att-chip">📎 ${esc(a.name)}<button type="button" class="mail-att-x" data-mail-att-del="${esc(a.id)}" title="Remove">×</button></span>`).join('')}</div>` : ''}
      ${(() => { const a = (m.accounts || []).find((x) => x.id === composeAcctId()); return a && a.signature ? `<div class="mail-sig-note">✓ Signature for <b>${esc(a.email)}</b> will be added</div>` : ''; })()}
      <input type="file" id="mc-file" multiple hidden></form>`;
  } else if (m.open) {
    const o = m.open;
    // Order by how often it's reached for: respond, triage, flag, then the two
    // "capture into Daybook" actions (file in a life area, make a task), the AI
    // draft, and the rare spam/block last. On mobile the whole bar wraps so none
    // of these hide off-screen (the life-area button used to scroll out of view).
    const msgActs = `<button class="ghost mail-act-ic" data-mail-reply title="Reply  ·  R">${MAIL_ICO.reply}</button><button class="ghost mail-act-ic" data-mail-reply-all title="Reply all  ·  A">${MAIL_ICO.replyAll}</button><button class="ghost mail-act-ic" data-mail-forward title="Forward  ·  F">${MAIL_ICO.forward}</button><button class="ghost mail-act-ic" data-mail-archive="${esc(o._key)}" title="Archive - remove from inbox, keep it  ·  E">${MAIL_ICO.archive}</button><button class="ghost mail-act-ic" data-mail-del="${esc(o._key)}" title="Delete">${MAIL_ICO.trash}</button><button class="ghost mail-act-ic mail-star-btn ${o.flagged ? 'on' : ''}" data-mail-star="${esc(o._key)}" title="Star  ·  S">${o.flagged ? MAIL_ICO.starOn : MAIL_ICO.starOff}</button><button class="ghost mail-act-ic" data-mail-area title="File this email in a life area">${MAIL_ICO.area}</button><button class="ghost mail-act-ic" data-mail-task title="Make a task from this email">${MAIL_ICO.task}</button><button class="mail-claudius mail-act-ic" data-mail-claudius title="Draft a reply with Email Scribe">${MAIL_ICO.sparkle}</button><button class="ghost mail-act-ic" data-mail-spam="${esc(o._key)}" title="Mark as spam (move to Junk)">${MAIL_ICO.spam}</button><button class="ghost mail-act-ic" data-mail-block="${esc(o._key)}" data-mail-from="${esc(o.from ? o.from.address : '')}" title="Block this sender - their mail goes straight to Junk">${MAIL_ICO.block}</button>`;
    // The other messages in this conversation, oldest first, so you can jump to
    // any of them (opening swaps the reader, using the prefetched cache).
    const oThread = buildThreads(state.mail.messages || []).find((th) => th.messages.some((mm) => mm._key === o._key));
    const convStrip = (oThread && oThread.count > 1)
      ? `<div class="mail-conv-strip">${oThread.messages.map((mm) => `<button class="mail-conv-item ${mm._key === o._key ? 'on' : ''}" data-mail-open="${esc(mm._key)}"><span class="mc-from">${esc(mailFrom(mm) || '?')}</span><span class="mc-date">${mailDate(mm.date)}</span>${mm.flagged ? '<span class="mc-star">★</span>' : ''}</button>`).join('')}</div>`
      : '';
    reader = `<div class="mail-msg">
      <div class="mail-reader-head"><button class="ghost mail-back" data-mail-back>← Inbox</button>
        <span class="mail-msg-act">${msgActs}</span></div>
      <h1 class="mail-subj">${esc(o.subject)}</h1>
      ${convStrip}
      <div class="mail-meta"><span class="mail-avatar big">${esc(initial(o.from ? (o.from.name || o.from.address) : '?'))}</span>
        <span class="mail-meta-lines"><b>${esc(o.from ? (o.from.name || o.from.address) : '')}</b><span class="mail-addr">${esc(o.from ? o.from.address : '')}</span></span>
        ${o.from && o.from.address ? (haveContact(o.from.address) ? '<span class="mail-contact-have" title="In your contacts">👤 Contact</span>' : `<button class="ghost mail-savecontact" data-save-contact data-c-name="${esc(o.from.name || '')}" data-c-email="${esc(o.from.address)}" title="Save to contacts">＋ Save contact</button>`) : ''}
        ${showAcct && o._acctName ? `<span class="mail-acct-chip">${esc(o._acctName)}</span>` : ''}<span class="mail-when">${o.date ? new Date(o.date).toLocaleString() : ''}</span></div>
      ${o.attachments && o.attachments.length ? `<div class="mail-att">${o.attachments.map((a) => `<a class="mail-att-chip mail-att-dl" href="${esc(a.url || '#')}" target="_blank" rel="noopener noreferrer" title="Open attachment in your browser">📎 ${esc(a.filename || 'attachment')} <span class="mail-att-sz">${fmtBytes(a.size)}</span> ↗</a>`).join('')}</div>` : ''}
      ${o.invite ? inviteCardHtml(o.invite) : ''}
      ${(() => { const ml = mailMeetingLink(o); return ml ? `<div class="mail-join-bar"><button class="add-btn wide" data-mail-join="${esc(ml)}">🎥 Join meeting</button><span class="mail-join-url">${esc(ml)}</span></div>` : ''; })()}
      ${mailImagesBlocked(o) ? `<div class="mail-imgbar"><span class="mail-imgbar-t">🖼 Remote images are hidden to protect your privacy.</span><span class="mail-imgbar-act"><button class="ghost" data-mail-show-imgs="${o.from && o.from.address ? esc(o.from.address) : ''}">Show images</button>${o.from && o.from.address ? '<span class="mail-imgbar-note">and always from this sender</span>' : ''}</span></div>` : ''}
      ${o.html ? `<iframe class="mail-body-frame" id="mail-body-frame" sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts" title="Message"></iframe>` : `<div class="mail-text">${linkifyText(o.text || '')}</div>`}</div>`;
  } else {
    reader = `<div class="mail-empty">${loading ? '' : 'Select a message to read.'}</div>`;
  }
  $('#pane').innerHTML = `
    ${pageCrumb('Mail')}
    <div class="pane-head home-head"><h1>Mail</h1>
      <div class="mail-head-act"><button class="ghost" data-mail-shortcuts title="Keyboard shortcuts  ·  ?">⌨</button><button class="ghost" data-mail-accounts title="Accounts">Accounts</button><button class="add-btn wide" data-mail-compose>+ Compose</button></div></div>
    ${(m.open || m.composing) ? '' : `
    ${accScope ? `<div class="mail-acct-scope">${accScope}</div>` : ''}
    <div class="mail-folders">${MAIL_FOLDERS.map((f) => { const dc = f.key === 'drafts' ? draftCount() : f.key === 'unread' ? (m.account ? unseenOf(m.account) : totalUnseen) : 0; return `<button class="mail-folder ${(m.folder || 'inbox') === f.key ? 'on' : ''}" data-mail-folder="${f.key}">${esc(f.label)}${dc ? ` <span class="mail-folder-c">${dc}</span>` : ''}</button>`; }).join('')}</div>
    ${(m.selected && m.selected.size) ? `<div class="mail-bulkbar">
      <span class="mail-bulk-n">${m.selected.size} selected</span>
      <button class="ghost" data-mail-bulk="archive">Archive</button>
      <button class="ghost" data-mail-bulk="read">Mark read</button>
      <button class="ghost" data-mail-bulk="unread">Mark unread</button>
      <button class="ghost" data-mail-bulk="star">Star</button>
      <button class="ghost" data-mail-bulk="move">Move…</button>
      <button class="ghost" data-mail-bulk="delete">Delete</button>
      <button class="ghost mail-bulk-x" data-mail-bulk="clear">Cancel</button>
    </div>` : `<div class="mail-tools">
      <input class="list-search sel mail-search" data-mail-q placeholder="Search mail…" value="${esc(m.query || '')}" autocomplete="off">
      ${(m.folder === 'spam' || m.folder === 'trash') ? `<button class="tbl-filter-btn mail-empty-btn" data-mail-empty title="Permanently empty this folder">🗑 Empty</button>` : ''}
      <button class="tbl-filter-btn mail-refresh" data-mail-refresh title="Refresh">↻</button>
    </div>`}`}
    ${(!m.open && !m.composing && strayUnread && m.strayHidden !== strayUnread) ? `<div class="mail-stray"><span>${strayUnread} older unread email${strayUnread > 1 ? 's sit' : ' sits'} further down, below the newest ${m.limit || 40} shown here.</span><span class="mail-stray-act"><button class="ghost" data-mail-more title="Load older mail to reach them">Show</button><button class="ghost" data-mail-reconcile title="Flag those older ones as read">Mark read</button><button class="ghost mail-stray-x" data-mail-stray-hide title="Hide">×</button></span></div>` : ''}
    ${m.error ? `<div class="cal-warn">${esc(m.error)}</div>` : ''}
    <div class="mail-layout ${m.open || m.composing ? 'reading' : ''} ${(m.selected && m.selected.size) ? 'selecting' : ''}">
      <div class="mail-list-col">${list}</div>
      <div class="mail-reader">${reader}</div>
    </div>
    ${m.shortcuts ? shortcutsOverlayHtml() : ''}
    ${m.moveMenu ? mailMoveMenuHtml() : ''}
    ${m.areaMenu ? mailAreaMenuHtml() : ''}
    ${m.taskMenu ? mailTaskMenuHtml() : ''}`;
  if (m.open && m.open.html) { const f = document.getElementById('mail-body-frame'); if (f) f.srcdoc = wrapEmailHtml(m.open.html, mailImagesBlocked(m.open)); }
  // Keep keyboard focus on the reader (not the body iframe / a stale button) so
  // single-key shortcuts - R reply, E archive… - land every time you're reading.
  if (m.open && !m.composing) { const el = document.querySelector('.mail-msg'); if (el) { el.tabIndex = -1; setTimeout(() => { try { el.focus({ preventScroll: true }); } catch {} }, 0); } }
}

function showQuickTask() {
  const opts = `<option value="">No area</option>` + (state.areas || []).map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
  // The full task options, matching the Tasks board's add form: area, priority,
  // duration, snooze (hide until), repeat and notes.
  $('#qt-wrap').innerHTML = `<form id="qt-form" class="add-task expanded" style="margin-bottom:22px">
    <input id="qt-title" placeholder="Add a task…" autocomplete="off" required>
    <div class="atf-grid">
      <label class="atf"><span>Life area</span><select id="qt-area" class="sel">${opts}</select></label>
      <label class="atf"><span>Priority</span><select id="qt-prio" class="sel"><option value="">—</option><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option></select></label>
      <label class="atf"><span>Duration</span><select id="qt-dur" class="sel">${DURATION_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="atf"><span>Snooze until</span>${dateFieldHtml('qt-snooze', '')}</label>
      <label class="atf"><span>Repeat</span><select id="qt-repeat" class="sel">${REPEATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    </div>
    <label class="atf atf-full"><span>Notes</span><textarea id="qt-notes" class="sel" rows="3" placeholder="Any details, context or links…" autocomplete="off"></textarea></label>
    <button class="add-btn wide" type="submit">Add task</button></form>`;
  $('#qt-title').focus();
}
// Turn the open email into a Robski Life task: subject becomes the title, and
// the sender line + the email's text are carried into the task's note (body).
// It lands in Tasks with no priority/area set.
// Turning an email into a task opens a little popover first, so the title, life
// area and priority can be set before it's created (rather than a bare task).
async function openMailTaskMenu(anchor) {
  const o = state.mail && state.mail.open; if (!o) return;
  if (!state.areas || !state.areas.length) { try { state.areas = (await api('/api/blocks?kind=area')).sort((a, b) => (a.title || '').localeCompare(b.title || '')); } catch {} }
  const title = ((o.subject || '').trim()) || '(no subject)';
  const name = o.from ? (o.from.name || o.from.address || '') : '';
  const addr = o.from ? (o.from.address || '') : '';
  const when = o.date ? new Date(o.date).toLocaleString() : '';
  const fromLine = (name || addr) ? `From: ${esc(name || addr)}${name && addr ? ` &lt;${esc(addr)}&gt;` : ''}` : '';
  const hdr = (fromLine || when) ? `<p>${fromLine}${fromLine && when ? ' · ' : ''}${when ? esc(when) : ''}</p>` : '';
  const src = (o.text || '').replace(/\r\n/g, '\n').trim();
  const content = src ? src.split(/\n{2,}/).map((p) => `<p>${linkifyText(p).replace(/\n/g, '<br>')}</p>`).join('') : '';
  const r = anchor ? anchor.getBoundingClientRect() : { left: 240, bottom: 200 };
  const w = 300;
  state.mail.taskMenu = { title, body: hdr + content, x: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)), y: r.bottom + 6 };
  renderMail();
  setTimeout(() => { const el = document.getElementById('mtask-title'); if (el) { el.focus(); el.select(); } }, 30);
}
async function mailTaskCreate() {
  const tm = state.mail && state.mail.taskMenu; if (!tm) return;
  const title = (document.getElementById('mtask-title')?.value || '').trim() || tm.title;
  const area = document.getElementById('mtask-area')?.value || null;
  const priority = document.getElementById('mtask-prio')?.value || null;
  state.mail.taskMenu = null; renderMail();
  try {
    await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title, body: tm.body, props: { priority, area, done: false } }) });
    toast(`Added to Tasks: “${title.length > 40 ? title.slice(0, 40) + '…' : title}”`);
  } catch (e) { toast(e.message); }
}
function mailTaskMenuHtml() {
  const tm = state.mail && state.mail.taskMenu; if (!tm) return '';
  const areas = state.areas || [];
  const PRIOS = [['', 'No priority'], ['P1', 'P1 · Urgent'], ['P2', 'P2'], ['P3', 'P3'], ['P4', 'P4']];
  return `<div class="mail-movebg" data-mail-task-bg><div class="mail-task-pop" style="top:${tm.y}px;left:${tm.x}px" role="dialog" aria-label="New task">
    <div class="mail-move-h">New task from this email</div>
    <input class="sel mtask-title" id="mtask-title" value="${esc(tm.title)}" placeholder="Task title" autocomplete="off">
    <label class="mtask-field"><span>Life area</span><select class="sel" id="mtask-area"><option value="">None</option>${areas.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select></label>
    <label class="mtask-field"><span>Priority</span><select class="sel" id="mtask-prio">${PRIOS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
    <div class="mtask-actions"><button class="ghost" data-mail-task-close>Cancel</button><button class="add-btn wide" data-mail-task-add>Add task</button></div>
  </div></div>`;
}
async function homeAddTask(o) {
  const props = { area: o.area || null, priority: o.priority || null, done: false };
  if (o.duration) props.duration = Number(o.duration);
  if (o.snooze) props.snooze = o.snooze;
  if (o.repeat) props.repeat = o.repeat;
  const body = textToProse(o.notes);
  try { await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title: o.title, props, ...(body ? { body } : {}) }) }); toast('Task added'); }
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
  // Default to the next quarter-hour, an hour long - same as the calendar form.
  const mins = Math.ceil((d.getHours() * 60 + d.getMinutes() + 5) / 15) * 15;
  const start = `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`;
  const endMin = mins + 60;
  const endDate = addDayISO(today, Math.floor(endMin / 1440));
  const endTime = `${pad2(Math.floor((endMin % 1440) / 60))}:${pad2(endMin % 60)}`;
  // Full event options, matching the calendar's own form: start/end date+time,
  // all-day, location and repeat.
  $('#qt-wrap').innerHTML = `<form id="qe-form" class="add-task add-event" data-evgap="60" style="margin-bottom:22px">
    <input id="qe-title" class="ce-title" placeholder="Event title…" autocomplete="off" required>
    <div class="ce-when">
      <div class="ce-when-row"><span class="ce-when-lbl">Starts</span><span class="ce-when-fields">${dateFieldHtml('qe-date', today)}<input id="qe-time" type="time" class="sel ce-timefield" value="${start}"></span></div>
      <div class="ce-when-row"><span class="ce-when-lbl">Ends</span><span class="ce-when-fields">${dateFieldHtml('qe-enddate', endDate)}<input id="qe-endtime" type="time" class="sel ce-timefield" value="${endTime}"></span></div>
    </div>
    <label class="ce-allday"><input type="checkbox" id="qe-allday"> All day <span class="ce-allday-hint">(a trip can span several days)</span></label>
    <textarea id="qe-notes" class="sel ce-notes" placeholder="Notes (optional)" rows="2"></textarea>
    <div class="ce-foot">
      <input id="qe-loc" class="sel ce-loc" placeholder="Location (optional)" autocomplete="off">
      <select id="qe-repeat" class="sel ce-repeat" title="Repeat">
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekdays">Every weekday (Mon-Fri)</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option></select>
      <button class="add-btn wide ce-submit" type="submit">Add to calendar</button>
    </div></form>`;
  $('#qe-title').focus();
}
async function homeAddEvent(body) {
  try {
    await api('/api/events', { method: 'POST', body: JSON.stringify(body) });
    toast('Added to your calendar');
    $('#qt-wrap').innerHTML = '';
    // Pull it straight into the Today panel if it lands today.
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
  else if (v === 'goalcard') renderGoalCard(); else if (v === 'bucketcard') renderBucketCard();
  else if (v === 'reviewcard') renderReviewCard(); else if (v === 'goals') renderGoals();
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
  if (kind === 'journal') return openJournalEntry(id);
  return openTasks();
}

// ── view: tasks ──────────────────────────────────────
const hueOf = (a) => (a && a.props && Number.isFinite(a.props.hue) ? a.props.hue : 220);
const areaById = (id) => state.areas.find((a) => a.id === id);
// A note can belong to several life areas: props.areas is the list. props.area
// is kept as the first, for anything still reading a single area and for notes
// written before multi-area. blockAreas gives the list from whichever is set.
function blockAreas(b) { const p = (b && b.props) || {}; if (Array.isArray(p.areas)) return p.areas.filter(Boolean); return p.area ? [p.area] : []; }
function blockInArea(b, areaId) { return blockAreas(b).includes(areaId); }
const PRIO_ORDER = { P1: 1, P2: 2, P3: 3, P4: 4, '': 5 };
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MON3[d.getMonth()]}`; };
// With the year. Admin needs it: "free until 4 Sep" could be this year or three
// years away, and that difference is money. Day-to-day dates in the app stay
// short - a saved article from "28 Aug" doesn't want a year cluttering it.
const fmtDateY = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}`; };
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
// A task title for display, with any long URL shortened to host + trimmed path.
// Display only - inline edit reads the stored full title, so nothing is lost.
function taskTitleHtml(title) {
  const s = String(title || '');
  if (!s.trim()) return '<span class="t-untitled">(Untitled)</span>';   // never an invisible, un-findable row
  if (!/https?:\/\//i.test(s)) return esc(s);
  const re = /https?:\/\/\S+/g; let out = ''; let last = 0; let m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    out += `<span class="t-url" title="${esc(m[0])}">${esc(prettyLinkText(m[0]))}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}
// Snooze + repeat. A snoozed task hides from the open list until its date; a
// repeating task rolls that date forward each time it's ticked (see toggleTask).
const REPEATS = [['', 'Does not repeat'], ['daily', 'Daily'], ['every3d', 'Every 3 days'], ['weekly', 'Weekly'], ['fortnightly', 'Fortnightly'], ['monthly', 'Monthly'], ['quarterly', 'Every 3 months'], ['halfyearly', 'Every 6 months'], ['yearly', 'Yearly']];
// `every:<n>:<d|w|m>` is a custom cadence (the keep-in-touch picker writes these);
// everything else is one of the named periods. Mirrors addPeriod in the worker -
// the two must agree, or a task rolls to one date on the client and another on
// the server.
const CUSTOM_PERIOD = /^every:(\d{1,3}):([dwm])$/;
const CUSTOM_UNIT = { d: ['day', 'days'], w: ['week', 'weeks'], m: ['month', 'months'] };
function repeatShort(r) {
  const c = CUSTOM_PERIOD.exec(r || '');
  if (c) { const n = Math.max(1, Number(c[1])); return n === 1 ? `Every ${CUSTOM_UNIT[c[2]][0]}` : `Every ${n} ${CUSTOM_UNIT[c[2]][1]}`; }
  return { daily: 'Daily', every3d: 'Every 3 days', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Every 3 months', halfyearly: 'Every 6 months', yearly: 'Yearly' }[r] || '';
}
const isSnoozed = (t) => !!(t.props && t.props.snooze && t.props.snooze > todayISO());
function addMonthsUTC(dt, n, day) {
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, dim));
}
function taskAddPeriod(iso, repeat) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const cus = CUSTOM_PERIOD.exec(repeat || '');
  if (cus) {
    const n = Math.max(1, Number(cus[1]));
    if (cus[2] === 'd') dt.setUTCDate(dt.getUTCDate() + n);
    else if (cus[2] === 'w') dt.setUTCDate(dt.getUTCDate() + n * 7);
    else addMonthsUTC(dt, n, d);
  }
  else if (repeat === 'daily') dt.setUTCDate(dt.getUTCDate() + 1);
  else if (repeat === 'every3d') dt.setUTCDate(dt.getUTCDate() + 3);
  else if (repeat === 'weekly') dt.setUTCDate(dt.getUTCDate() + 7);
  else if (repeat === 'fortnightly') dt.setUTCDate(dt.getUTCDate() + 14);
  else if (repeat === 'monthly') addMonthsUTC(dt, 1, d);
  else if (repeat === 'quarterly') addMonthsUTC(dt, 3, d);
  else if (repeat === 'halfyearly') addMonthsUTC(dt, 6, d);
  else if (repeat === 'yearly') dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else return iso;
  return dt.toISOString().slice(0, 10);
}
function nextRepeat(repeat, anchorISO) {
  const today = todayISO();
  let next = taskAddPeriod(anchorISO, repeat);
  for (let i = 0; i < 500 && next <= today; i++) next = taskAddPeriod(next, repeat);
  return next;
}
function taskBadges(t) {
  const out = [];
  if (t.props.snooze && t.props.snooze > todayISO()) out.push(`<span class="tbadge snz">💤 ${esc(dpLabel(t.props.snooze))}</span>`);
  if (t.props.repeat) out.push(`<span class="tbadge rpt">🔁 ${esc(repeatShort(t.props.repeat))}</span>`);
  return out.length ? `<span class="tbadges">${out.join('')}</span>` : '';
}
function taskTableHtml(list, emptyMsg) {
  const arrow = (c) => state.taskSort.col === c ? `<span class="sarrow">${state.taskSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
  const th = (c, label, cls) => `<th class="${cls || ''} sortable" data-sort="${c}">${label}${arrow(c)}</th>`;
  const rows = sortTasks(list.slice()).map((t) => {
    const a = areaById(t.props.area); const p = t.props.priority;
    return `<tr class="tr-task ${t.props.done ? 'done' : ''}" style="--h:${hueOf(a)}" data-task-row="${t.id}">
      <td class="tc-done"><button class="check" data-check="${t.id}">✓</button></td>
      <td class="tc-title"><span class="t" data-edit-task="${t.id}">${taskTitleHtml(t.title)}</span>${taskBadges(t)}</td>
      <td class="tc-prio"><span class="ie" data-edit-prio="${t.id}">${p ? `<span class="prio ${p}">${p}</span>` : '<span class="ie-add">+</span>'}</span></td>
      <td class="tc-area"><span class="ie" data-edit-area="${t.id}">${a ? `<span class="tag">${esc(a.title)}</span>` : '<span class="ie-add ie-add-area">+ Area</span>'}</span></td>
      <td class="tc-date">${fmtDate(t.created_at)}</td>
      <td class="tc-act"><button class="row-open-btn" data-open-task="${t.id}" title="Open in focus">⤢</button><button class="star ${t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props.fav ? '★' : '☆'}</button><button class="x" data-del-task="${t.id}">×</button><button class="row-chev" data-open-task="${t.id}" title="Open" aria-label="Open task">›</button></td>
    </tr>`;
  }).join('');
  return `<div class="tbl-scroll tasks-scroll"><table class="ttable">
      <thead><tr><th class="tc-done"></th>${th('title', 'Task', 'tc-title')}${th('priority', 'Priority', 'tc-prio')}${th('area', 'Area', 'tc-area')}${th('created', 'Added', 'tc-date')}<th class="tc-act"></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty" style="padding:40px">${emptyMsg || 'No tasks here yet.'}</td></tr>`}</tbody>
    </table></div>`;
}
// ── Tasks: a build-your-own filter (by priority, area, date, duration…) ──
// Each filter is { field, op, value }; they AND together. Definitions are
// data-driven so a new filterable field is one entry here, not new UI code.
const TASK_FIELDS = {
  priority: { label: 'Priority', ops: ['is', 'isnot'], choices: () => [['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3'], ['P4', 'P4'], ['', 'None']], get: (t) => t.props.priority || '' },
  area: { label: 'Life area', ops: ['is', 'isnot'], choices: () => [['', 'None'], ...state.areas.map((a) => [a.id, a.title])], get: (t) => t.props.area || '' },
  duration: { label: 'Duration', ops: ['gte', 'lte', 'isset', 'notset'], kind: 'minutes', get: (t) => (t.props.duration != null && t.props.duration !== '' ? Number(t.props.duration) : null) },
  repeat: { label: 'Repeat', ops: ['isset', 'notset'], get: (t) => t.props.repeat || '' },
  snoozed: { label: 'Snoozed', ops: ['yes', 'no'], get: (t) => isSnoozed(t) },
  created: { label: 'Created', ops: ['after', 'before'], kind: 'date', get: (t) => (t.created_at || '').slice(0, 10) },
  updated: { label: 'Last updated', ops: ['after', 'before'], kind: 'date', get: (t) => (t.updated_at || '').slice(0, 10) },
};
const TASK_OP_LABEL = { is: 'is', isnot: 'is not', gte: 'at least', lte: 'at most', isset: 'is set', notset: 'is empty', yes: 'yes', no: 'no', after: 'on or after', before: 'before' };
function loadTaskFilters() {
  if (state.taskFilters == null) { try { state.taskFilters = JSON.parse(localStorage.getItem('life.tasks.filters')) || []; } catch { state.taskFilters = []; } }
}
function saveTaskFilters() {
  try { localStorage.setItem('life.tasks.filters', JSON.stringify(state.taskFilters || [])); } catch {}
}
function taskMatchesCond(t, c) {
  const f = TASK_FIELDS[c.field]; if (!f) return true;
  const v = f.get(t);
  switch (c.op) {
    case 'is': return String(v) === String(c.value);
    case 'isnot': return String(v) !== String(c.value);
    case 'gte': return v != null && c.value !== '' && Number(v) >= Number(c.value);
    case 'lte': return v != null && c.value !== '' && Number(v) <= Number(c.value);
    case 'isset': return v != null && v !== '';
    case 'notset': return v == null || v === '';
    case 'yes': return !!v;
    case 'no': return !v;
    case 'after': return v && c.value && v >= c.value;
    case 'before': return v && c.value && v < c.value;
    default: return true;
  }
}
function taskMatchesFilters(t) { return (state.taskFilters || []).every((c) => taskMatchesCond(t, c)); }
// The value control for one condition: a dropdown of choices, a number, a date,
// or nothing at all for operators that don't take a value.
function condValueCtrl(c, i) {
  const f = TASK_FIELDS[c.field]; if (!f) return '';
  if (['isset', 'notset', 'yes', 'no'].includes(c.op)) return '';
  if (f.choices) { const opts = f.choices().map(([v, l]) => `<option value="${esc(v)}" ${String(c.value) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join(''); return `<select class="sel tf-val" data-tf-val="${i}">${opts}</select>`; }
  if (f.kind === 'minutes') return `<input class="sel tf-val tf-num" type="number" min="0" step="5" data-tf-val="${i}" value="${esc(c.value || '')}" placeholder="min">`;
  if (f.kind === 'date') return `<input class="sel tf-val" type="date" data-tf-val="${i}" value="${esc(c.value || '')}">`;
  return `<input class="sel tf-val" data-tf-val="${i}" value="${esc(c.value || '')}">`;
}
function taskCondRow(c, i) {
  const f = TASK_FIELDS[c.field] || {};
  const fieldSel = `<select class="sel tf-field" data-tf-field="${i}">${Object.entries(TASK_FIELDS).map(([k, v]) => `<option value="${k}" ${k === c.field ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>`;
  const opSel = `<select class="sel tf-op" data-tf-op="${i}">${(f.ops || []).map((o) => `<option value="${o}" ${o === c.op ? 'selected' : ''}>${esc(TASK_OP_LABEL[o] || o)}</option>`).join('')}</select>`;
  return `<div class="tf-cond">${fieldSel}${opSel}${condValueCtrl(c, i)}<button class="tf-del" data-tf-del="${i}" title="Remove">×</button></div>`;
}
// A short human summary of one active condition, for the collapsed chip row.
function condChip(c, i) {
  const f = TASK_FIELDS[c.field]; if (!f) return '';
  let val = '';
  if (!['isset', 'notset', 'yes', 'no'].includes(c.op)) {
    if (f.choices) { const m = f.choices().find(([v]) => String(v) === String(c.value)); val = m ? m[1] : c.value; }
    else if (f.kind === 'minutes') val = `${c.value} min`;
    else val = c.value;
  }
  return `<span class="tf-chip">${esc(f.label)} ${esc(TASK_OP_LABEL[c.op] || c.op)}${val ? ' ' + esc(val) : ''}<button class="tf-chip-x" data-tf-del="${i}" title="Remove">×</button></span>`;
}
// A sensible default value when a field (or its operator) changes.
function defaultCondValue(field, op) {
  const f = TASK_FIELDS[field]; if (!f || ['isset', 'notset', 'yes', 'no'].includes(op)) return '';
  if (f.choices) return String(f.choices()[0][0]);
  return '';
}
// Write the live Tasks state (filters/sort/search) into the active tab's view,
// so it's remembered per tab and survives a switch or reload. Called on every
// renderTasks, i.e. after every filter/sort/search change.
function commitTaskView() {
  if (!state.view || state.view.type !== 'tasks') return;
  state.view.filters = state.taskFilters || [];
  state.view.sort = state.taskSort;
  state.view.q = state.taskQuery || '';
  state.view.filtersOpen = !!state.taskFiltersOpen;
  const tab = state.tabs && state.tabs.find((t) => t.id === state.activeTab);
  if (tab && tab.view && tab.view.type === 'tasks') {
    const label = labelForView(state.view); const labelChanged = tab.label !== label;
    tab.view = tabViewCopy(state.view); tab.label = label; saveTabs();
    if (labelChanged) renderTabs();   // keep the tab strip's title in step with the filter
  }
}
function renderTasks() {
  loadTaskFilters();
  commitTaskView();
  const conds = state.taskFilters || [];
  const filterBar = `<div class="task-filters">
    <div class="tf-head">
      <button class="tf-toggle" data-tf-toggle><span class="acw-chev">${state.taskFiltersOpen ? '▾' : '▸'}</span>Filters${conds.length ? `<span class="tf-count">${conds.length}</span>` : ''}</button>
      ${conds.length && !state.taskFiltersOpen ? `<div class="tf-chips">${conds.map((c, i) => condChip(c, i)).join('')}</div>` : ''}
    </div>
    ${state.taskFiltersOpen ? `<div class="tf-panel">
      ${conds.map((c, i) => taskCondRow(c, i)).join('') || '<div class="tf-empty">No filters yet. Add one to narrow the list.</div>'}
      <div class="tf-panel-acts"><button class="add-btn wide" data-tf-add>+ Add filter</button>${conds.length ? '<button class="ghost" data-tf-clear>Clear all</button>' : ''}</div>
    </div>` : ''}
  </div>`;
  const preArea = state.taskAddArea || '';   // set when + Task is used from a Life Area page
  const opts = `<option value="">No area</option>` + state.areas.map((a) => `<option value="${a.id}" ${a.id === preArea ? 'selected' : ''}>${esc(a.title)}</option>`).join('');
  const inFilter = (t) => taskMatchesFilters(t);
  const tq = (state.taskQuery || '').trim().toLowerCase();
  const matchesQ = (t) => !tq || (t.title || '').toLowerCase().includes(tq);
  const open = state.tasks.filter((t) => !t.props.done && !isSnoozed(t) && inFilter(t) && matchesQ(t));   // ticked or snoozed tasks vanish from view (taskTableHtml sorts via the column headers)
  const snoozed = state.tasks.filter((t) => !t.props.done && isSnoozed(t) && inFilter(t)).sort((a, b) => (a.props.snooze || '').localeCompare(b.props.snooze || ''));
  const snoozedSection = state.showSnoozed
    ? `<section class="completed-sec">
        <div class="completed-head"><h2>Snoozed · ${snoozed.length}</h2><button class="ghost" data-hide-snoozed>Hide</button></div>
        ${taskTableHtml(snoozed, 'Nothing snoozed.')}</section>`
    : (snoozed.length ? `<button class="ghost show-completed" data-show-snoozed>💤 Snoozed · ${snoozed.length}</button>` : '');
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
      ? `<form id="task-form" class="add-task expanded">
      <input id="task-title" type="text" placeholder="What needs doing?" autocomplete="off" required>
      <div class="atf-grid">
        <label class="atf"><span>Life area</span><select id="task-area" class="sel">${opts}</select></label>
        <label class="atf"><span>Priority</span><select id="task-prio" class="sel"><option value="">—</option><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option></select></label>
        <label class="atf"><span>Duration</span><select id="task-dur" class="sel">${DURATION_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="atf"><span>Snooze until</span>${dateFieldHtml('task-snooze', '')}</label>
        <label class="atf"><span>Repeat</span><select id="task-repeat" class="sel">${REPEATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      </div>
      <label class="atf atf-full"><span>Notes</span><textarea id="task-notes" class="sel" rows="3" placeholder="Any details, context or links…" autocomplete="off"></textarea></label>
      <div class="atf-actions">
        <button class="add-btn wide" type="submit">Add task</button>
        <button type="button" class="ghost" data-task-add-close>Done</button>
      </div>
    </form>`
      : ''}
    ${assignedSectionHtml()}
    ${filterBar}
    ${taskTableHtml(open, (conds.length || tq) ? 'No tasks match these filters.' : 'No open tasks here.')}
    ${snoozedSection}
    ${completedSection}`;
  // Put the cursor in the new-task title whenever the add form is freshly opened -
  // and keep it there. openTasks re-renders again when assigned tasks load, which
  // would otherwise steal the focus; the short arming window re-focuses on every
  // render until you start typing.
  if (state.taskAdding && state.taskFocusArm && Date.now() - state.taskFocusArm < 4000) {
    const focusIt = () => { const i = $('#task-title'); if (i && document.activeElement !== i && !i.value) i.focus(); };
    focusIt(); requestAnimationFrame(focusIt);
  }
}

// ── contacts ─────────────────────────────────────────
// Contacts are native blocks (kind='contact'): title = name; props hold email,
// phone, birthday, address. Deliberately simple. Feeds the Mail app (save a
// sender, autocomplete recipients) and imports Apple Contacts via vCard.
let contactsLoaded = false;
async function loadContacts(force) {
  if (contactsLoaded && !force) return state.contacts;
  state.contacts = await api('/api/blocks?kind=contact');
  contactsLoaded = true;
  return state.contacts;
}
const contactEmail = (c) => ((c.props && c.props.email) || '').toLowerCase();
const haveContact = (email) => !!email && (state.contacts || []).some((c) => contactEmail(c) === email.toLowerCase());
function sortContacts(list) { return list.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '')); }
// Groups are their own blocks (kind='contactgroup', title = name). Membership
// lives on the contact as props.groups (an array of group ids), so a contact's
// groups travel with it and are easy to show on the card and filter by.
let contactGroupsLoaded = false;
async function loadContactGroups(force) { if (contactGroupsLoaded && !force) return state.contactGroups; state.contactGroups = await api('/api/blocks?kind=contactgroup'); contactGroupsLoaded = true; return state.contactGroups; }
const findContact = (id) => (state.contacts || []).find((x) => x.id === id) || ((state.contact_open && state.contact_open.contact && state.contact_open.contact.id === id) ? state.contact_open.contact : null);
const groupsOf = (c) => (Array.isArray(c.props && c.props.groups) ? c.props.groups : []);
const groupById = (id) => (state.contactGroups || []).find((g) => g.id === id);
const contactsInGroup = (gid) => (state.contacts || []).filter((c) => groupsOf(c).includes(gid));
// Only groups that still exist, in name order - a deleted group's stale id on a
// contact is simply ignored.
const liveGroupsOf = (c) => groupsOf(c).map(groupById).filter(Boolean).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
// Address is structured. Old contacts (and simple imports) may hold a plain
// string; those read into the Street field and format as-is.
const ADDR_FIELDS = [['street', 'Street'], ['city', 'City'], ['postcode', 'Postcode'], ['country', 'Country']];
// One canonical list of country names, so every contact's country is spelled the
// same way. Picked from a dropdown rather than typed free-hand.
const COUNTRIES = ['Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Congo (DRC)', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'];
// A country dropdown. Any existing value not on the list is kept as its own
// selected option, so a legacy or imported spelling is never silently dropped.
function countrySelect(id, current, cls) {
  const cur = (current || '').trim();
  const extra = cur && !COUNTRIES.includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '';
  return `<select class="${cls}" id="${id}"><option value="">Country…</option>${extra}${COUNTRIES.map((c) => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
}
function formatAddress(a) { if (!a) return ''; if (typeof a === 'string') return a; return ADDR_FIELDS.map(([k]) => a[k]).filter(Boolean).join(', '); }
const addrField = (a, k) => (!a ? '' : typeof a === 'string' ? (k === 'street' ? a : '') : (a[k] || ''));
function cleanAddress(a) { const out = {}; let any = false; for (const [k] of ADDR_FIELDS) { const v = (a[k] || '').trim(); if (v) { out[k] = v; any = true; } } return any ? out : null; }
function readCardAddress() { const a = {}; for (const [k] of ADDR_FIELDS) { const el = $('#contactcard-' + k); if (el) a[k] = el.value; } return cleanAddress(a); }
// A contact may hold several emails and several phones, but starts with just one
// of each. The canonical store is props.emails / props.phones (arrays); props.email
// and props.phone mirror the first entry so every older reader - invite, mailto,
// datalist, dedupe - keeps working unchanged. A phone keeps its country code in
// its own field: { cc:'+351', number:'211 234 400' }.
function contactEmails(p) { return (Array.isArray(p.emails) ? p.emails : (p.email ? [p.email] : [])).filter((e) => e != null && String(e).trim()); }
function splitPhone(s) {
  const t = String(s || '').trim();
  if (!t) return { cc: '', number: '' };
  // A separator settles it. Without one (e.g. "+351927494927") a greedy \d match
  // would eat a digit of the number, so match the longest KNOWN dial code prefix.
  const sep = t.match(/^(\+\d{1,4})[\s-]+(.*)$/);
  if (sep) return { cc: sep[1], number: sep[2].trim() };
  if (t[0] === '+') {
    const digits = t.slice(1); let best = '';
    for (const [, code] of COUNTRY_DIAL) { const d = String(code).replace(/^\+/, ''); if (digits.startsWith(d) && d.length > best.length) best = d; }
    if (best) return { cc: '+' + best, number: digits.slice(best.length).trim() };
  }
  return { cc: '', number: t };
}
function contactPhones(p) {
  if (Array.isArray(p.phones)) return p.phones.map((x) => (typeof x === 'string' ? splitPhone(x) : { cc: String(x.cc || '').trim(), number: String(x.number || '').trim() }));
  return p.phone ? [splitPhone(p.phone)] : [];
}
const joinPhone = (ph) => `${String(ph.cc || '').trim()} ${String(ph.number || '').trim()}`.trim();
// Gather every email/phone row from the open card into normalised arrays plus the
// mirrored primaries, ready to save in one patch.
function readCardContacts() {
  const emails = [...document.querySelectorAll('.cc-email-in')].map((i) => i.value.trim()).filter(Boolean);
  const phones = [...document.querySelectorAll('.cc-phone-row')]
    .map((r) => ({ cc: (r.querySelector('.cc-phone-cc').value || '').trim(), number: (r.querySelector('.cc-phone-num').value || '').trim() }))
    .filter((p) => p.number || p.cc);
  return { emails, email: emails[0] || null, phones, phone: phones.length ? joinPhone(phones[0]) : null };
}
// The email/phone field blocks on the contact card: one row each to start, with
// a + to add more and an × to drop any but the first.
function contactEmailFields(p) {
  const emails = contactEmails(p); if (!emails.length) emails.push('');
  const rows = emails.map((em, i) => `<div class="cc-multi-row"><input class="sel cc-email-in" type="email" value="${esc(em)}" placeholder="name@example.com" autocomplete="off">${i === 0 ? '' : `<button type="button" class="cc-multi-x" data-cc-del-email="${i}" title="Remove">×</button>`}</div>`).join('');
  return `<div class="tf-field"><span class="tf-label">Email</span><div class="cc-multi">${rows}<button type="button" class="cc-multi-add" data-cc-add-email>+ Add email</button></div></div>`;
}
// Country dial codes for the phone picker: type a country name (or a code) and
// choose it clearly from the list; the field stores just the + code. One shared
// datalist serves every phone row on the card.
const COUNTRY_DIAL = [
  ['Portugal', '+351'], ['United Kingdom', '+44'], ['Ireland', '+353'], ['Spain', '+34'], ['France', '+33'],
  ['Germany', '+49'], ['Italy', '+39'], ['Netherlands', '+31'], ['Belgium', '+32'], ['Luxembourg', '+352'],
  ['Switzerland', '+41'], ['Austria', '+43'], ['Denmark', '+45'], ['Sweden', '+46'], ['Norway', '+47'],
  ['Finland', '+358'], ['Iceland', '+354'], ['Poland', '+48'], ['Czech Republic', '+420'], ['Slovakia', '+421'],
  ['Hungary', '+36'], ['Romania', '+40'], ['Bulgaria', '+359'], ['Greece', '+30'], ['Croatia', '+385'],
  ['Slovenia', '+386'], ['Serbia', '+381'], ['Estonia', '+372'], ['Latvia', '+371'], ['Lithuania', '+370'],
  ['Ukraine', '+380'], ['Russia', '+7'], ['Turkey', '+90'], ['Cyprus', '+357'], ['Malta', '+356'],
  ['United States', '+1'], ['Canada', '+1'], ['Mexico', '+52'], ['Brazil', '+55'], ['Argentina', '+54'],
  ['Chile', '+56'], ['Colombia', '+57'], ['Peru', '+51'], ['Venezuela', '+58'], ['Uruguay', '+598'],
  ['Australia', '+61'], ['New Zealand', '+64'], ['Japan', '+81'], ['China', '+86'], ['South Korea', '+82'],
  ['India', '+91'], ['Pakistan', '+92'], ['Bangladesh', '+880'], ['Indonesia', '+62'], ['Malaysia', '+60'],
  ['Singapore', '+65'], ['Thailand', '+66'], ['Vietnam', '+84'], ['Philippines', '+63'], ['Hong Kong', '+852'],
  ['United Arab Emirates', '+971'], ['Saudi Arabia', '+966'], ['Israel', '+972'], ['Qatar', '+974'], ['Kuwait', '+965'],
  ['South Africa', '+27'], ['Nigeria', '+234'], ['Kenya', '+254'], ['Egypt', '+20'], ['Morocco', '+212'],
  ['Ghana', '+233'], ['Angola', '+244'], ['Mozambique', '+258'], ['Cape Verde', '+238'], ['Tunisia', '+216'],
];
const ccDatalist = () => `<datalist id="cc-dial-list">${COUNTRY_DIAL.map(([n, c]) => `<option value="${c}">${esc(n)} (${c})</option>`).join('')}</datalist>`;
function contactPhoneFields(p) {
  const phones = contactPhones(p); if (!phones.length) phones.push({ cc: '', number: '' });
  const rows = phones.map((ph, i) => `<div class="cc-multi-row cc-phone-row"><input class="sel cc-phone-cc" type="tel" list="cc-dial-list" value="${esc(ph.cc || '')}" placeholder="+351" title="Country - type a name or code" autocomplete="off"><input class="sel cc-phone-num" type="tel" value="${esc(ph.number || '')}" placeholder="211 234 400" autocomplete="off">${i === 0 ? '' : `<button type="button" class="cc-multi-x" data-cc-del-phone="${i}" title="Remove">×</button>`}</div>`).join('');
  return `<div class="tf-field"><span class="tf-label">Phone</span><div class="cc-multi">${rows}<button type="button" class="cc-multi-add" data-cc-add-phone>+ Add phone</button></div>${ccDatalist()}</div>`;
}
async function openContacts() {
  state.view = { type: 'contacts' };
  renderNav();
  const [, , friends, shared] = await Promise.all([
    loadContacts(true), loadContactGroups(true),
    api('/api/friends').catch(() => ({ friends: [], incoming: [], outgoing: [], suggestions: [] })),
    api('/api/shared').then((r) => r.items || []).catch(() => []),
  ]);
  state.friends = friends; state.sharedWithMe = shared;
  renderContacts();
}
function contactCardHtml(c) {
  const p = c.props || {};
  const bits = [];
  if (p.email) bits.push(`<span class="cc-row">✉ ${esc(p.email)}</span>`);
  if (p.phone) bits.push(`<span class="cc-row">☎ ${esc(p.phone)}</span>`);
  if (p.birthday) bits.push(`<span class="cc-row">🎂 ${esc(dpLabel(p.birthday))}</span>`);
  if (formatAddress(p.address)) bits.push(`<span class="cc-row">📍 ${esc(formatAddress(p.address))}</span>`);
  const tags = liveGroupsOf(c);
  return `<button class="contact-card" data-open-contact="${c.id}" draggable="true" data-contact-drag="${c.id}" title="Drag onto a group to add">
    <span class="contact-av">${esc(initial(c.title || '?'))}</span>
    <span class="contact-info"><span class="contact-name">${esc(c.title || 'Unnamed')}</span>${bits.length ? `<span class="contact-sub">${bits.join('')}</span>` : ''}${tags.length ? `<span class="contact-tags">${tags.map((g) => `<span class="contact-tag">${esc(g.title)}</span>`).join('')}</span>` : ''}</span></button>`;
}
// The row of group chips: All, then each group (droppable + count), then + New.
function groupBarHtml() {
  const gs = (state.contactGroups || []).slice().sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const chip = (sel, gid, label, n) => `<button class="cg-chip ${sel ? 'on' : ''}" ${gid ? `data-contact-group="${gid}" data-group-drop="${gid}"` : 'data-contact-group=""'}>${esc(label)}${n != null ? ` <span class="cg-n">${n}</span>` : ''}</button>`;
  return `<div class="cg-bar">
    ${chip(!state.contactsGroup, '', 'All', (state.contacts || []).length)}
    ${gs.map((g) => chip(state.contactsGroup === g.id, g.id, g.title || 'Group', contactsInGroup(g.id).length)).join('')}
    <button class="cg-chip cg-new" data-new-contact-group title="Create a group">+ Group</button>
  </div>`;
}
// Right-click menu on a contact card: add to a group, remove from one, delete.
function contactMenuHtml() {
  const m = state.contactMenu; if (!m) return '';
  const c = findContact(m.id); if (!c) return '';
  const inIds = new Set(groupsOf(c));
  const addable = (state.contactGroups || []).filter((g) => !inIds.has(g.id)).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const current = liveGroupsOf(c);
  return `<div class="ctx-bg" data-ctx-close><div class="ctx-menu" style="top:${m.y}px;left:${m.x}px;max-height:${m.maxh}px" role="menu">
    <div class="ctx-h">${esc(c.title || 'Contact')}</div>
    ${addable.length ? `<div class="ctx-lbl">Add to group</div>${addable.map((g) => `<button class="ctx-item" data-ctx-add="${g.id}">${esc(g.title)}</button>`).join('')}` : ''}
    <button class="ctx-item ctx-new" data-ctx-newgroup>+ New group…</button>
    ${current.length ? `<div class="ctx-sep"></div>${current.map((g) => `<button class="ctx-item" data-ctx-remove="${g.id}">Remove from ${esc(g.title)}</button>`).join('')}` : ''}
    ${(c.props && c.props.email) ? `<div class="ctx-sep"></div><button class="ctx-item" data-ctx-invite="${esc(c.props.email)}">✦ Invite to Daybook</button>` : ''}
    <div class="ctx-sep"></div>
    <button class="ctx-item ctx-danger" data-ctx-delete>Delete contact</button>
  </div></div>`;
}
function openContactMenu(id, x, y) {
  const vh = window.innerHeight;
  // Don't let a low click pin the menu so far down it runs off the screen: keep
  // the top where there's room, then cap the height to the space below it so the
  // menu scrolls within the viewport rather than spilling past the bottom.
  const top = Math.min(y, Math.max(8, vh - 240));
  const maxh = Math.max(200, vh - top - 12);
  state.contactMenu = { id, x: Math.min(x, window.innerWidth - 232), y: top, maxh };
  renderContacts();
}
function renderContacts() {
  const q = (state.contactsQuery || '').trim().toLowerCase();
  // A deleted group can't stay selected.
  if (state.contactsGroup && !groupById(state.contactsGroup)) state.contactsGroup = null;
  const g = state.contactsGroup;
  const match = (c) => {
    if (g && !groupsOf(c).includes(g)) return false;
    if (!q) return true; const p = c.props || {}; return [c.title, p.email, p.phone].some((v) => (v || '').toLowerCase().includes(q));
  };
  const list = sortContacts((state.contacts || []).filter(match));
  const grp = g && groupById(g);
  const emptyMsg = q ? 'No contacts match.'
    : grp ? `No contacts in ${esc(grp.title)} yet. Drag a contact onto the group chip, or open a contact and add it here.`
    : 'No contacts yet. Add one, or import your Apple Contacts .vcf.';
  // Friends are Daybook contacts, so they lead the page. d holds the social data.
  const d = state.friends || { friends: [], incoming: [], outgoing: [], suggestions: [] };
  const fr = (f, action) => friendRow(f, action);
  // While searching, strip the page back to just the search box and the matching
  // contacts - no Add/Import, no "Contacts on Daybook", no group bar. Just results.
  const searching = !!q;
  $('#pane').innerHTML = `
    ${pageCrumb('Contacts')}
    <div class="pane-head"><h1>Contacts</h1></div>
    <div class="list-head">
      <input class="list-search sel" data-contacts-q placeholder="Search your contacts…" value="${esc(state.contactsQuery || '')}" autocomplete="off">
      ${searching ? '' : `${state.contactAdding ? '' : `<button class="add-btn wide" data-contact-add>+ Add contact</button>`}
      <button class="ghost contact-import-btn" data-contact-import title="Import a vCard (.vcf) exported from Apple Contacts">⤓ Import</button>
      <input type="file" id="contact-file" accept=".vcf,text/vcard,text/x-vcard" hidden>`}
    </div>
    ${searching ? `
    <section class="home-sec">
      <div class="contact-grid">${list.map(contactCardHtml).join('') || `<div class="empty">${emptyMsg}</div>`}</div>
    </section>` : `
    <section class="home-sec">
      <div class="home-sec-h">Contacts on Daybook<span class="muted">${d.friends.length + d.incoming.length + d.outgoing.length + ((d.suggestions && d.suggestions.length) || 0)}</span></div>
      <p class="fr-intro">Invite your friends to Daybook so you can share with them - a whole Life Area, a note, a table, or just a few tasks. What you share, and how you use it, is completely up to you.</p>
      ${(d.suggestions && d.suggestions.length) ? `<div class="fr-suggest"><div class="ppl-sub">Your contacts already on Daybook<button class="ghost fr-rescan" data-friends-rescan title="Check your contacts again">↻</button></div>${d.suggestions.map((f) => fr(f, `<button class="add-btn wide fr-act" data-friend-add="${f.id}">Connect on Daybook</button>`)).join('')}</div>` : ''}
      <div class="list-head fr-connect-row"><input class="sel fr-connect" id="friend-email" placeholder="Find someone on Daybook - name or email…" autocomplete="off" spellcheck="false"><button class="add-btn wide fr-connect-btn" data-friend-add-email>Connect</button><button class="add-btn wide fr-invite-btn" data-invite-daybook title="Invite someone to Daybook by email">✦ Invite to Daybook</button></div>
      <div id="friend-results" class="fr-results"></div>
      ${d.incoming.length ? `<div class="ppl-sub">Requests · ${d.incoming.length}</div>${d.incoming.map((f) => fr(f, `<span class="fr-acts"><button class="add-btn wide fr-act" data-friend-accept="${f.id}">Accept</button><button class="ghost fr-act" data-friend-remove="${f.id}">Ignore</button></span>`)).join('')}` : ''}
      ${d.friends.length ? d.friends.map((f) => fr(f, `<span class="fr-acts"><button class="ghost fr-act" data-friend-chat="${f.id}" data-friend-name="${esc(f.name)}" title="Chat">💬</button><button class="ghost fr-act" data-friend-notes="${f.id}" title="Shared meeting notes">📝</button><button class="ghost fr-act" data-friend-remove="${f.id}" title="Remove">×</button></span>`)).join('') : ((d.incoming.length || (d.suggestions && d.suggestions.length)) ? '' : '<div class="home-empty">No one yet - connect with a contact above, or invite someone to Daybook.</div>')}
      ${d.outgoing.length ? `<div class="ppl-sub">Pending</div>${d.outgoing.map((f) => fr(f, '<span class="fr-pending">requested</span>')).join('')}` : ''}
      ${(state.sharedWithMe && state.sharedWithMe.length) ? `<div class="ppl-sub">Shared with you · ${state.sharedWithMe.length}</div>${state.sharedWithMe.map((s) => { const ic = s.kind === 'task' ? (s.done ? '☑' : '☐') : s.kind === 'table' ? '▦' : s.kind === 'area' ? '◈' : '▤'; const lbl = s.kind === 'task' ? 'Task' : s.kind === 'table' ? 'Table' : s.kind === 'area' ? 'Life area' : 'Note'; return `<button class="shared-row" data-open-shared="${s.id}" data-shared-kind="${s.kind}"><span class="sh-ic">${ic}</span><span class="sh-body"><span class="sh-t">${esc(s.title || 'Untitled')}</span><span class="sh-meta">${lbl} · from ${esc(s.owner)}${s.canEdit ? '' : ' · view only'}</span></span></button>`; }).join('')}` : ''}
    </section>

    <section class="home-sec">
      <div class="home-sec-h">Contacts<span class="muted">${(state.contacts || []).length}</span></div>
      ${groupBarHtml()}
      ${grp ? `<div class="cg-head"><span class="cg-head-t">${esc(grp.title)} · ${contactsInGroup(g).length}</span><span class="cg-head-act"><button class="ghost" data-rename-contact-group="${g}">Rename</button><button class="ghost cg-del" data-del-contact-group="${g}">Delete group</button></span></div>` : ''}
      ${state.contactAdding ? contactAddForm() : ''}
      <div class="contact-grid">${list.map(contactCardHtml).join('') || `<div class="empty">${emptyMsg}</div>`}</div>
    </section>`}

    ${contactMenuHtml()}`;
  alignConnectRow();
}
// Line the connect row's right edge (the Invite button) up with the right edge
// of the "Search your contacts" box above it. The two rows carry different
// buttons, so the find box grows to fill and the row reserves right-padding equal
// to the gap, landing Invite exactly under the search box's edge. Desktop only;
// re-runs on resize.
function alignConnectRow() {
  const row = document.querySelector('.fr-connect-row');
  const find = document.querySelector('.fr-connect');
  const search = document.querySelector('[data-contacts-q]');
  const connect = document.querySelector('.fr-connect-btn');
  const invite = document.querySelector('.fr-invite-btn');
  if (!row || !find || !search || !connect || !invite) return;
  if (window.matchMedia('(max-width:820px)').matches) { find.style.width = ''; return; }
  // Solve for the find box width so the group [find + Connect + Invite] ends at
  // the search box's right edge: width = searchRight - rowLeft - buttons - gaps.
  // Absolute (not delta-based), so it's correct however wide the window is.
  // (Reading a rect forces the layout we need, so no requestAnimationFrame - and
  // rAF is paused when the tab isn't visible anyway.)
  const gap = parseFloat(getComputedStyle(row).columnGap) || 12;
  const w = search.getBoundingClientRect().right - row.getBoundingClientRect().left
    - connect.offsetWidth - invite.offsetWidth - 2 * gap;
  // Only force the alignment when the window is wide enough to leave a usable
  // find box; on a narrow desktop the buttons won't fit under the search edge, so
  // fall back to the natural width rather than a cramped (or overshooting) box.
  find.style.width = w >= 200 ? `${Math.round(w)}px` : '';
}
if (!window.__alignConnectBound) { window.__alignConnectBound = true; window.addEventListener('resize', () => { if (state.view && state.view.type === 'contacts') alignConnectRow(); }); }
function contactAddForm() {
  return `<form id="contact-form" class="add-task expanded">
    <input id="ct-name" type="text" placeholder="Name" autocomplete="off" required>
    <div class="atf-grid">
      <label class="atf"><span>Email</span><input id="ct-email" type="email" class="sel" placeholder="name@example.com" autocomplete="off"></label>
      <label class="atf"><span>Phone</span><input id="ct-phone" type="tel" class="sel" placeholder="+351…" autocomplete="off"></label>
      <label class="atf"><span>Birthday</span>${dateFieldHtml('ct-bday', '')}</label>
    </div>
    <div class="atf-grid">
      <label class="atf"><span>Street</span><input id="ct-street" class="sel" autocomplete="off"></label>
      <label class="atf"><span>City</span><input id="ct-city" class="sel" autocomplete="off"></label>
      <label class="atf"><span>Postcode</span><input id="ct-postcode" class="sel" autocomplete="off"></label>
      <label class="atf"><span>Country</span>${countrySelect('ct-country', '', 'sel')}</label>
    </div>
    <div class="atf-actions"><button class="add-btn wide" type="submit">Add contact</button><button type="button" class="ghost" data-contact-add-close>Done</button></div>
  </form>`;
}
async function addContact(o) {
  const props = { email: o.email || null, phone: o.phone || null, birthday: o.birthday || null, address: o.address || null };
  if (props.address && typeof props.address === 'object' && !Object.keys(props.address).length) props.address = null;
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'contact', title: o.name, props }) });
  state.contacts.push(b); renderContacts();
  if (state.contactAdding) { const i = $('#ct-name'); if (i) i.focus(); }
}
async function openContactCard(id) {
  const [c] = await Promise.all([api(`/api/blocks/${id}`), loadContacts(), loadContactGroups()]);
  // The keep-in-touch task holds the dates (next nudge, last contact). A missing
  // one just reads as "off": a contact whose task was deleted elsewhere shouldn't
  // fail to open, it should offer to start again.
  let kt = null;
  if (c && c.props && c.props.kitTask) { try { kt = await api(`/api/blocks/${c.props.kitTask}`); } catch {} }
  state.contact_open = { contact: c, kitTask: kt };
  state.view = { type: 'contactcard', id };
  renderNav(); renderContactCard();
}
// ── Keep in touch ─────────────────────────────────────────────────────
// A cadence on a contact: "I'd like to speak to this person every few months."
// The clock is an ordinary repeating task carrying props.kit, hidden behind its
// snooze until the day it comes due, so every bit of the repeat machinery
// already applies to it. The one difference lives in setTaskDone: it measures
// from the day you actually got in touch, not from the day it fell due.
//
// The contact keeps a copy of the cadence in props.kitEvery so a list can show
// the badge without loading tasks; the task is authoritative for the dates.
const KIT_EVERY = [
  ['weekly', 'Every week'], ['fortnightly', 'Every fortnight'], ['monthly', 'Every month'],
  ['quarterly', 'Every 3 months'], ['halfyearly', 'Every 6 months'], ['yearly', 'Once a year'],
];
const KIT_UNITS = [['w', 'weeks'], ['m', 'months'], ['d', 'days']];
const kitTitle = (name) => `Catch up with ${(name || '').trim() || 'them'}`;
// A nudge is a task by construction, not by intent: it has no priority, it isn't
// work you do at a desk, and it belongs to a person rather than to a board. So it
// is filtered out where tasks load, and every list downstream stays honest
// without having to know this feature exists.
const notKit = (list) => (list || []).filter((t) => !(t.props && t.props.kit));
const kitTaskOf = () => (state.contact_open && state.contact_open.kitTask) || null;
// "3 weeks ago", "in 2 months", "today". Relative reads better than a date here:
// the question is how long it's been, not which Tuesday it was.
function kitWhen(iso) {
  if (!iso) return '';
  const n = daysBetween(todayISO(), iso);
  const a = Math.abs(n);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  const unit = a >= 60 ? [Math.round(a / 30), 'month'] : a >= 14 ? [Math.round(a / 7), 'week'] : [a, 'day'];
  const span = `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`;
  return n > 0 ? `in ${span}` : `${span} ago`;
}
function keepInTouchSection(c) {
  const every = (c.props || {}).kitEvery || '';
  const tp = (kitTaskOf() || {}).props || {};
  const cus = CUSTOM_PERIOD.exec(every);
  const opts = KIT_EVERY.map(([v, l]) => `<option value="${v}" ${every === v ? 'selected' : ''}>${l}</option>`).join('')
    + `<option value="custom" ${cus ? 'selected' : ''}>Custom…</option>`;
  const customRow = cus ? `<div class="kit-custom">Every
      <input class="sel kit-n" type="number" min="1" max="999" value="${Math.max(1, Number(cus[1]))}" data-kit-n>
      <select class="sel kit-unit" data-kit-unit>${KIT_UNITS.map(([v, l]) => `<option value="${v}" ${cus[2] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>` : '';
  const due = tp.snooze && tp.snooze <= todayISO();
  // "Last in touch" is a date, not a button: you often remember a call days after
  // making it, and the cadence is only honest if it can be told the real day.
  // Today is one tap away inside the picker, so the common case stays quick.
  const status = every ? `<div class="kit-line kit-status">
      <label class="kit-row"><span class="tf-label">Last in touch</span>${dateFieldHtml('kit-last', tp.last || '')}${tp.last ? `<span class="kit-ago">${esc(kitWhen(tp.last))}</span>` : ''}</label>
      <p class="kit-next">Next nudge <b class="${due ? 'kit-due' : ''}">${due ? 'due now' : esc(kitWhen(tp.snooze) || 'once you have spoken')}</b></p>
    </div>` : '';
  return `<div class="tf-field cc-kit">
    <label class="kit-tick"><input type="checkbox" data-kit-toggle ${every ? 'checked' : ''}><span class="tf-label kit-tick-l">Keep in touch</span></label>
    <p class="kit-hint">A quiet nudge when it has been too long. The clock restarts the day you get in touch, so it never asks twice about a call you have just made.</p>
    ${every ? `<div class="kit-body">
      <div class="kit-line">
        <label class="kit-row"><span class="tf-label">How often</span><select class="sel kit-every" data-kit-every>${opts}</select></label>
        ${customRow}
      </div>
      ${status}
    </div>` : ''}
  </div>`;
}
// Turning it on mints the task; turning it off deletes it. There is nothing worth
// keeping in a nudge you have switched off, and leaving it archived would have it
// reappear the day somebody switched the cadence back on.
async function kitToggle(on) {
  const c = state.contact_open && state.contact_open.contact; if (!c) return;
  if (!on) {
    const t = kitTaskOf();
    state.contact_open.kitTask = null;
    await patchContact(c.id, { kitEvery: null, kitTask: null }, true);
    if (t) { try { await api(`/api/blocks/${t.id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); } }
    renderContactCard();
    return;
  }
  await kitSetEvery('quarterly');
}
// One door for "the cadence is now X": it makes the task if there isn't one, and
// otherwise re-times the existing one. The next nudge is always one interval on
// from the last real contact - or from today, if there hasn't been one yet.
// One interval on from the last real contact - and deliberately NOT skipped
// forward to the next future date. Somebody last spoken to a year ago on a
// quarterly cadence is overdue now, and rolling the date into the future would
// quietly forgive that. Only a tick (which anchors on today) lands ahead.
// With nothing to measure from yet, the first nudge is one interval from today.
function kitNextFrom(every, lastISO) {
  return lastISO ? taskAddPeriod(lastISO, every) : nextRepeat(every, todayISO());
}
async function kitSetEvery(every) {
  const c = state.contact_open && state.contact_open.contact; if (!c) return;
  let t = kitTaskOf();
  const snooze = kitNextFrom(every, (t && t.props && t.props.last) || null);
  try {
    if (!t) {
      const areas = blockAreas(c);
      const props = { kit: true, contact: c.id, repeat: every, snooze, done: false, area: areas[0] || null, areas: areas.slice(0, 1) };
      t = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title: kitTitle(c.title), props }) });
    } else {
      await api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ props: { repeat: every, snooze } }) });
      t.props = { ...t.props, repeat: every, snooze };
    }
    state.contact_open.kitTask = t;
    await patchContact(c.id, { kitEvery: every, kitTask: t.id }, true);
    renderContactCard();
  } catch (e) { toast(e.message); }
}
// Recording when you last spoke, which re-times the next nudge from that day.
// A future date is refused rather than silently accepted: you cannot have spoken
// to somebody tomorrow, and taking it would push the next nudge a whole interval
// past where it belongs.
async function kitSetLast(iso) {
  const t = kitTaskOf(); if (!t) return;
  const every = (t.props && t.props.repeat) || 'quarterly';
  let last = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : null;
  if (last && last > todayISO()) { last = todayISO(); toast('That is in the future — recorded as today.'); }
  const snooze = kitNextFrom(every, last);
  try {
    await api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ props: { last, snooze } }) });
    t.props = { ...t.props, last, snooze };
    renderContactCard();
  } catch (e) { toast(e.message); }
}
function renderContactCard() {
  const c = state.contact_open.contact; const p = c.props || {};
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-contacts>Contacts</button><span class="crumb-sep">›</span><span class="crumb cur">${esc(c.title || 'Unnamed')}</span>
      <span class="crumb-tools"><button class="note-del ghost" data-del-contact="${c.id}" title="Delete this contact">Delete</button></span></div>
    <div class="task-focus cc-focus">
      <span class="contact-av big">${esc(initial(c.title || '?'))}</span>
      <textarea class="note-title" id="contactcard-name" rows="1" placeholder="Name">${esc(c.title || '')}</textarea>
      ${p.email ? `<button class="add-btn wide cc-email-btn" data-contact-mail="${esc(p.email)}" title="Email ${esc(p.email)}">✉ Email</button>` : ''}
      <button class="cc-invite-link" data-cc-invite="${esc(p.email || '')}" title="Invite ${esc(c.title || 'them')} to Daybook">✦ Invite to Daybook</button>
    </div>
    <div class="tf-meta">
      ${contactEmailFields(p)}
      ${contactPhoneFields(p)}
      <label class="tf-field"><span class="tf-label">Birthday${p.birthday ? ` <button type="button" class="tf-clear" data-clear-bday="${c.id}">clear</button>` : ''}</span>${dateFieldHtml('contactcard-bday', p.birthday || '')}</label>
      <div class="tf-field"><span class="tf-label">Life areas</span>${blockAreasControl('contact', c)}</div>
      <div class="tf-field cc-addr"><span class="tf-label">Address</span><div class="cc-addr-row">${ADDR_FIELDS.map(([k, l]) => k === 'country' ? countrySelect('contactcard-' + k, addrField(p.address, k), 'sel contactcard-addr cc-addr-' + k) : `<input class="sel contactcard-addr cc-addr-${k}" id="contactcard-${k}" value="${esc(addrField(p.address, k))}" placeholder="${l}" autocomplete="off">`).join('')}</div></div>
    </div>
    ${keepInTouchSection(c)}
    ${contactGroupsSection(c)}
    ${notesSection(c.body, 'contact', c.id)}`;
  autoGrowSoon($('#contactcard-name'));
}
// Groups on the contact card: current groups as removable chips, plus a picker
// to add one (or make a new one). The universal, tap-friendly path (drag-drop
// is the desktop shortcut).
function contactGroupsSection(c) {
  const mine = liveGroupsOf(c);
  const mineIds = new Set(groupsOf(c));
  const others = (state.contactGroups || []).filter((g) => !mineIds.has(g.id)).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return `<div class="cc-groups">
    <span class="tf-label">Groups</span>
    <div class="cc-group-list">
      ${mine.map((g) => `<span class="cc-group-chip">${esc(g.title)}<button type="button" class="cc-group-x" data-contact-remove-group data-cid="${c.id}" data-gid="${g.id}" title="Remove from ${esc(g.title)}">×</button></span>`).join('')}
      <select class="sel cc-group-add" data-contact-add-group="${c.id}" title="Add to a group">
        <option value="">${mine.length ? '+ Add to group…' : 'Not in any group · add…'}</option>
        ${others.map((g) => `<option value="${g.id}">${esc(g.title)}</option>`).join('')}
        <option value="__new">New group…</option>
      </select>
    </div>
  </div>`;
}
async function patchContact(id, patch, isProps) {
  const c = state.contact_open && state.contact_open.contact;
  if (c && c.id === id) { if (isProps) { c.props = c.props || {}; Object.assign(c.props, patch); } else Object.assign(c, patch); }
  const inList = (state.contacts || []).find((x) => x.id === id);
  if (inList) { if (isProps) { inList.props = inList.props || {}; Object.assign(inList.props, patch); } else Object.assign(inList, patch); }
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify(isProps ? { props: patch } : patch) }); }
  catch (e) { toast(e.message); }
}
async function delContact(id) {
  // No confirm: the Delete button is a deliberate press on an open contact.
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
  state.contacts = (state.contacts || []).filter((x) => x.id !== id);
  toast('Contact deleted'); openContacts();
}
// New group: type a name, or spin one up from a life area. A group made from an
// area is linked to it (props.area) and pulls in every contact already tagged to
// that area, so "the Family group" and "the Family life area" line up.
async function newContactGroup() {
  await Promise.all([loadContacts(), loadContactGroups()]);
  if (!state.areas || !state.areas.length) { try { state.areas = await api('/api/blocks?kind=area'); } catch {} }
  const el = uiDialogHost();
  const haveNames = () => new Set((state.contactGroups || []).map((g) => (g.title || '').trim().toLowerCase()));
  const createNamed = async (name, select) => {
    name = (name || '').trim(); if (!name) return false;
    if (haveNames().has(name.toLowerCase())) { toast('A group with that name already exists.'); return false; }
    try {
      const g = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'contactgroup', title: name }) });
      state.contactGroups.push(g); if (select) state.contactsGroup = g.id; return true;
    } catch (e) { toast(e.message); return false; }
  };
  const createFromArea = async (area) => {
    if (haveNames().has((area.title || '').trim().toLowerCase())) { toast('A group with that name already exists.'); return; }
    try {
      const g = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'contactgroup', title: area.title || 'Untitled', props: { area: area.id } }) });
      state.contactGroups.push(g);
      const members = (state.contacts || []).filter((c) => (c.props && c.props.area) === area.id);
      for (const c of members) if (!groupsOf(c).includes(g.id)) setContactGroups(c, [...groupsOf(c), g.id], true);
      toast(members.length ? `“${area.title}” group created with ${members.length} contact${members.length === 1 ? '' : 's'}` : `“${area.title}” group created`);
    } catch (e) { toast(e.message); }
  };
  const render = () => {
    const have = haveNames();
    const chips = (state.areas || []).slice().sort((a, b) => (a.title || '').localeCompare(b.title || '')).map((a) => {
      const made = have.has((a.title || '').trim().toLowerCase());
      return `<button class="cgm-area${made ? ' made' : ''}" data-cgm-area="${a.id}" ${made ? 'disabled' : ''} style="--h:${hueOf(a)}"><span class="cgm-dot"></span>${esc(a.title || 'Untitled')}${made ? ' <span class="cgm-tick">✓</span>' : ''}</button>`;
    }).join('');
    el.innerHTML = `<div class="pal-bg"><div class="recur-dialog ui-dialog-box cgm-dialog">
      <div class="recur-h">New group</div>
      <input class="ui-dialog-input" id="cgm-input" placeholder="e.g. Family, Clients, Forró" autocomplete="off">
      <div class="cgm-or">Or create from a life area</div>
      <div class="cgm-areas">${chips || '<span class="muted">No life areas yet.</span>'}</div>
      <div class="ui-dialog-btns">
        <button class="ui-btn cancel" data-cgm-close>Done</button>
        <button class="ui-btn primary" data-cgm-create>Create</button>
      </div></div></div>`;
    setTimeout(() => { const i = el.querySelector('#cgm-input'); if (i) i.focus(); }, 20);
  };
  const close = () => { el.innerHTML = ''; el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKeyEl); document.removeEventListener('keydown', onKey, true); renderContacts(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const onKeyEl = (e) => { if (e.key === 'Enter' && e.target.id === 'cgm-input') { e.preventDefault(); createNamed(e.target.value, true).then((ok) => { if (ok) close(); }); } };
  const onClick = async (e) => {
    if (e.target.closest('[data-cgm-close]') || e.target.classList.contains('pal-bg')) { close(); return; }
    if (e.target.closest('[data-cgm-create]')) { const i = el.querySelector('#cgm-input'); const ok = await createNamed(i && i.value, true); if (ok) close(); return; }
    const ac = e.target.closest('[data-cgm-area]'); if (ac) { const a = areaById(ac.dataset.cgmArea); if (a) { await createFromArea(a); render(); } }
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKeyEl);
  document.addEventListener('keydown', onKey, true);
  render();
}
async function renameContactGroup(id) {
  const g = groupById(id); if (!g) return;
  const name = ((await uiPrompt('Rename group:', { title: 'Rename group', okLabel: 'Save', value: g.title || '' })) || '').trim();
  if (!name || name === g.title) return;
  g.title = name;
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ title: name }) }); } catch (e) { toast(e.message); }
  renderContacts();
}
async function delContactGroup(id) {
  const g = groupById(id); if (!g) return;
  if (!(await uiConfirm(`Delete the group "${g.title}"? The contacts stay; only the group is removed.`, { danger: true, okLabel: 'Delete group' }))) return;
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
  state.contactGroups = (state.contactGroups || []).filter((x) => x.id !== id);
  if (state.contactsGroup === id) state.contactsGroup = null;
  // Strip the now-dead id from any contact that carried it, so it doesn't linger.
  for (const c of (state.contacts || [])) { if (groupsOf(c).includes(id)) setContactGroups(c, groupsOf(c).filter((x) => x !== id), true); }
  toast('Group deleted'); renderContacts();
}
// Set a contact's group ids locally + on the server (quiet = don't re-render or toast).
function setContactGroups(c, groups, quiet) {
  c.props = c.props || {}; c.props.groups = groups;
  const open = state.contact_open && state.contact_open.contact;
  if (open && open.id === c.id) { open.props = open.props || {}; open.props.groups = groups; }
  api(`/api/blocks/${c.id}`, { method: 'PATCH', body: JSON.stringify({ props: { groups } }) }).catch((e) => toast(e.message));
  if (!quiet) { if (state.view.type === 'contactcard') renderContactCard(); else renderContacts(); }
}
async function addContactToGroup(contactId, groupId) {
  const c = findContact(contactId); const g = groupById(groupId);
  if (!c || !g) return;
  if (groupsOf(c).includes(groupId)) { toast(`${c.title || 'Contact'} is already in ${g.title}`); return; }
  setContactGroups(c, [...groupsOf(c), groupId]);
  toast(`Added ${c.title || 'contact'} to ${g.title}`);
}
function removeContactFromGroup(contactId, groupId) {
  const c = findContact(contactId); if (!c) return;
  setContactGroups(c, groupsOf(c).filter((x) => x !== groupId));
}
async function addContactViaNewGroup(contactId) {
  const name = ((await uiPrompt('New group name:', { title: 'New group', okLabel: 'Create', placeholder: 'e.g. Family, Clients, Forró' })) || '').trim();
  if (!name) return;
  try {
    const g = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'contactgroup', title: name }) });
    state.contactGroups.push(g); addContactToGroup(contactId, g.id);
  } catch (e) { toast(e.message); }
}
// Save an email sender straight into contacts (deduped by address).
async function saveSender(name, email) {
  if (!email) return;
  await loadContacts();
  if (haveContact(email)) { toast('Already in your contacts'); return; }
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'contact', title: (name || '').trim() || email, props: { email, phone: null, birthday: null, address: null } }) });
  state.contacts.push(b); toast(`Saved ${(name || '').trim() || email} to contacts`);
  if (state.view.type === 'mail') renderMail();
}
// Start a new email to a contact's address.
async function emailContact(email) {
  await openMail();
  state.mail.composing = { to: email };
  renderMail(); setTimeout(() => { const el = $('#mc-body'); if (el) el.focus(); }, 30);
}
// vCard (.vcf) parsing - Apple exports one file for all contacts.
function decodeVValue(v) { return String(v || '').replace(/\\n/gi, ', ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim(); }
function normBday(v) {
  const s = String(v || '');
  const full = s.match(/(\d{4})-?(\d{2})-?(\d{2})/);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;
  // vCard writes a yearless birthday as --MMDD or --MM-DD. Apple Contacts uses it
  // whenever you leave the year off, so this is a real import case, not a corner.
  const ny = s.match(/^--(\d{2})-?(\d{2})$/);
  return ny ? `--${ny[1]}-${ny[2]}` : '';
}
function parseVcards(text) {
  const cards = [];
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');   // unfold continuation lines
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^BEGIN:VCARD/i.test(line)) { cur = {}; continue; }
    if (/^END:VCARD/i.test(line)) { if (cur) cards.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':'); if (idx < 0) continue;
    const prop = line.slice(0, idx).split(';')[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (prop === 'FN') cur.name = decodeVValue(value);
    else if (prop === 'N' && !cur.name) { const parts = value.split(';'); cur.name = decodeVValue([parts[1], parts[0]].filter(Boolean).join(' ')); }
    else if (prop === 'EMAIL' && !cur.email) cur.email = decodeVValue(value);
    else if (prop === 'TEL' && !cur.phone) cur.phone = decodeVValue(value);
    else if (prop === 'BDAY' && !cur.birthday) cur.birthday = normBday(value);
    else if (prop === 'ADR' && !cur.address) { const parts = value.split(';').map((s) => decodeVValue(s)); cur.address = cleanAddress({ street: [parts[0], parts[1], parts[2]].filter(Boolean).join(' '), city: parts[3], postcode: parts[5], country: parts[6] }); }
  }
  return cards.filter((c) => c.name || c.email);
}
async function importVcf(file) {
  if (!file) return;
  let text = '';
  try { text = await file.text(); } catch { return toast('Could not read that file'); }
  const cards = parseVcards(text);
  if (!cards.length) return toast('No contacts found in that file');
  try {
    const r = await api('/api/contacts/import', { method: 'POST', body: JSON.stringify({ contacts: cards }) });
    const parts = [];
    if (r.added) parts.push(`${r.added} added`);
    if (r.updated) parts.push(`${r.updated} updated`);
    if (r.skipped) parts.push(`${r.skipped} unchanged`);
    toast(parts.length ? `Contacts: ${parts.join(' · ')}` : 'No changes to import');
    await loadContacts(true); renderContacts();
  } catch (e) { toast(e.message); }
}
const contactsDatalist = () => `<datalist id="contacts-dl">${(state.contacts || []).filter((c) => c.props && c.props.email).map((c) => `<option value="${esc(c.props.email)}">${esc(c.title || '')}</option>`).join('')}</datalist>`;

// ── goals & bucket list ──────────────────────────────
// Goals and bucket-list items are blocks (kind='goal'/'bucket') filed to a Life
// Area (props.area). A goal is Milestones / Habit / Number. Everything rides the
// same block core as notes and tasks.
const HORIZONS = [['quarter', 'This quarter'], ['year', 'This year'], ['longterm', 'Long-term']];
const GTYPES = [['achievement', 'Milestones'], ['number', 'Number']];
const GSTATUS = [['active', 'Active'], ['done', 'Done'], ['onhold', 'On hold'], ['dropped', 'Dropped']];
const BSTATUS = [['someday', 'Someday'], ['planning', 'Planning'], ['done', 'Done']];
const gp = (g) => (g && g.props) || {};
const goalArea = (g) => areaById(gp(g).area);
const gStatusLabel = (s) => (GSTATUS.find((x) => x[0] === (s || 'active')) || GSTATUS[0])[1];
const horizonLabel = (h) => (HORIZONS.find((x) => x[0] === h) || ['', ''])[1];
function goalProgress(g) {
  const p = gp(g); if (p.status === 'done') return 1;
  if (p.gtype === 'number') { const t = +p.target || 0, c = +p.current || 0; return t > 0 ? Math.max(0, Math.min(1, c / t)) : 0; }
  if (p.gtype === 'achievement') { const ms = Array.isArray(p.milestones) ? p.milestones : []; return ms.length ? ms.filter((m) => m.done).length / ms.length : 0; }
  return 0;
}
function goalMeasure(g) {
  const p = gp(g);
  if (p.gtype === 'number') return `${p.current || 0} / ${p.target || 0}${p.unit ? ' ' + p.unit : ''}`;
  if (p.gtype !== 'achievement') return '';
  const ms = Array.isArray(p.milestones) ? p.milestones : []; return `${ms.filter((m) => m.done).length}/${ms.length} milestones`;
}
// ── Financial (Portfolio · Advice · Spending) ────────────────────────────
// Portfolio moved across from portfolio.robski.uk: same data (shared D1), same
// pricing (silver valued at spot, never the KAG token). Advice + Spending are
// staged next.
const FIN_TABS = [['spending', 'Spending'], ['portfolio', 'Portfolio'], ['tracker', 'Tracker'], ['advice', 'Advice']];
async function openFinancial(tab) {
  // Remember the last tab across reloads (the in-memory default would otherwise
  // reset every session).
  let saved = null; try { saved = localStorage.getItem('life.fin.tab'); } catch {}
  state.financial.tab = tab || saved || state.financial.tab || 'spending';
  try { localStorage.setItem('life.fin.tab', state.financial.tab); } catch {}
  state.view = { type: 'financial', tab: state.financial.tab };
  renderNav();
  if (state.financial.tab === 'portfolio' && !state.financial.data) loadPortfolio();
  else if (state.financial.tab === 'advice') loadAdvice();
  else if (state.financial.tab === 'spending') { if (state.financial.txns == null) loadSpending(); else renderFinancial(); }
  else if (state.financial.tab === 'tracker') loadTracker();
  else renderFinancial();
}
async function loadTracker(force) {
  const f = state.financial;
  if (force) f.tracker = null;
  f.trackerLoading = true; renderFinancial();
  try { f.tracker = await api('/api/tracker'); } catch (e) { toast(e.message); f.tracker = f.tracker || { items: [] }; }
  f.trackerLoading = false; renderFinancial();
}
async function loadSpending() {
  const f = state.financial;
  renderFinancial();
  try {
    const [txns, catsRes, incRes, expRes, areas] = await Promise.all([
      api('/api/blocks?kind=txn'),
      api('/api/kv/spend_categories').catch(() => ({ value: null })),
      api('/api/kv/spend_cat_income').catch(() => ({ value: null })),
      api('/api/kv/spend_cat_expense').catch(() => ({ value: null })),
      (state.areas && state.areas.length) ? Promise.resolve(state.areas) : api('/api/blocks?kind=area').catch(() => []),
    ]);
    f.txns = txns;
    if ((!state.areas || !state.areas.length) && Array.isArray(areas)) state.areas = areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const parseArr = (r) => { try { const a = r && r.value ? JSON.parse(r.value) : null; return Array.isArray(a) ? a : []; } catch { return []; } };
    f.spendExtras = parseArr(catsRes);
    f.spendAlsoIncome = parseArr(incRes);   // non-income categories the user also counts as income
    f.spendAlsoExpense = parseArr(expRes);  // income categories the user also counts as an expense
  } catch (e) { toast(e.message); f.txns = f.txns || []; }
  renderFinancial();
}
// Only the EXTRAS are user-editable here; the Life Areas come from the Life Areas
// section, so renaming/removing one of those happens there, not on this page.
async function saveSpendExtras(extras) {
  state.financial.spendExtras = extras;
  renderFinancial();
  try { await api('/api/kv/spend_categories', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(extras) }) }); } catch (e) { toast(e.message); }
}
async function spendCatAdd() {
  const name = String(await uiPrompt('New spending category:', { placeholder: 'e.g. Savings' }) || '').trim();
  if (!name) return;
  if (spendCats().some((c) => c.toLowerCase() === name.toLowerCase())) { toast('That category already exists (Life Areas are categories too)'); return; }
  saveSpendExtras([...spendExtras(), name]);
}
async function spendCatRename(oldName) {
  if (spendIsArea(oldName)) { toast('This is a Life Area - rename it in the Life Areas section.'); return; }
  const name = String(await uiPrompt('Rename category:', { value: oldName }) || '').trim();
  if (!name || name === oldName) return;
  if (spendCats().some((c) => c.toLowerCase() === name.toLowerCase())) { toast('That category already exists'); return; }
  await saveSpendExtras(spendExtras().map((c) => (c === oldName ? name : c)));
  for (const t of (state.financial.txns || []).filter((x) => (x.props || {}).category === oldName)) {
    t.props.category = name; api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ props: { category: name } }) }).catch(() => {});
  }
  renderFinancial();
}
async function spendCatDel(cat) {
  if (cat === 'Uncategorised' || spendIsArea(cat)) return;
  if (!(await uiConfirm(`Delete "${cat}"? Transactions in it become Uncategorised.`, { danger: true, okLabel: 'Delete' }))) return;
  await saveSpendExtras(spendExtras().filter((c) => c !== cat));
  for (const t of (state.financial.txns || []).filter((x) => (x.props || {}).category === cat)) {
    t.props.category = 'Uncategorised'; api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ props: { category: 'Uncategorised' } }) }).catch(() => {});
  }
  renderFinancial();
}
async function loadAdvice(refreshTrends) {
  const f = state.financial;
  renderFinancial();
  try {
    const [channels, videos, trends] = await Promise.all([
      api('/api/blocks?kind=finchannel'),
      api('/api/blocks?kind=finvideo'),
      refreshTrends ? api('/api/fin/trends', { method: 'POST' }) : api('/api/fin/trends'),
    ]);
    f.channels = channels || []; f.videos = videos || []; f.trends = trends || { text: null };
  } catch (e) { toast(e.message); }
  renderFinancial();
}
async function loadPortfolio(force) {
  const f = state.financial;
  if (f.loading) return;
  f.loading = true; if (force) { f.data = null; f.error = null; }
  renderFinancial();
  try {
    const d = await api('/api/portfolio');
    f.data = d; f.error = null;
  } catch (e) { f.error = e.message; }
  f.loading = false; renderFinancial();
}
const eur0 = (n) => '€' + Math.round(Number(n) || 0).toLocaleString('en-IE');
const fmtQty = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 4 });
function renderFinancial() {
  const f = state.financial;
  const seg = `<div class="seg">${FIN_TABS.map(([k, l]) => `<button class="seg-b ${f.tab === k ? 'on' : ''}" data-fin-tab="${k}">${l}</button>`).join('')}</div>`;
  const body = f.tab === 'advice' ? adviceBody()
    : f.tab === 'spending' ? spendingBody()
    : f.tab === 'tracker' ? trackerBody()
    : portfolioBody();
  $('#pane').innerHTML = `${pageCrumb('Money')}<div class="pane-head"><h1>Money</h1></div>${seg}${body}`;
}
const finSoon = (ic, title, body, note) => `<div class="fin-soon"><div class="fin-soon-ic">${ic}</div><h2>${esc(title)}</h2><p>${esc(body)}</p><p class="fin-soon-note">${esc(note)}</p></div>`;
function portfolioBody() {
  const f = state.financial;
  if (f.loading && !f.data) return '<div class="fin-load">Fetching live prices…</div>';
  if (f.error && !f.data) return `<div class="fin-err"><p>Couldn't value the portfolio right now.</p><p class="fin-err-d">${esc(f.error)}</p><button class="add-btn wide" data-fin-refresh>Try again</button></div>`;
  const d = f.data; if (!d) return '<div class="fin-load">Loading…</div>';
  const total = d.total || 0;
  const pctOf = (v) => total ? Math.round(v / total * 100) : 0;
  const bar = (d.holdings || []).map((h) => `<span style="width:${total ? (h.value / total * 100) : 0}%;background:${h.swatch}"></span>`).join('');
  const legend = (d.holdings || []).map((h) => `<span><i style="background:${h.swatch}"></i>${esc(h.code)} · ${pctOf(h.value)}%</span>`).join('');
  const perf = (d.performance || []).map((p) => {
    if (p.pct == null) return `<div class="fin-chip"><span class="lab">${esc(p.label)}</span><span class="fin-na">—</span></div>`;
    const cls = p.pct > 0.05 ? 'up' : p.pct < -0.05 ? 'down' : 'flat'; const sign = p.pct >= 0 ? '+' : '';
    return `<div class="fin-chip"><span class="lab">${esc(p.label)}</span><span class="fin-cv ${cls}">${sign}${p.pct.toFixed(2)}%</span><span class="fin-abs">${sign}${eur0(p.abs)}</span></div>`;
  }).join('');
  const cards = (d.holdings || []).map((h) => `<div class="fin-card" style="--sw:${h.swatch}">
    <div class="fin-card-top"><span class="fin-name">${esc(h.name)}</span><button class="fin-edit-btn" data-fin-edit="${h.id}" title="Edit holding">✎</button></div>
    <span class="fin-venue">${esc(h.venue || h.code)}</span>
    <span class="fin-cv2">${eur0(h.value)}</span>
    <span class="fin-qty">${fmtQty(h.qty)} ${esc(h.unit)}${total ? ` · ${pctOf(h.value)}%` : ''}</span>
  </div>`).join('');
  const rates = (d.rates || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const asOf = d.ts ? new Date(d.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const gains = [];
  if (d.unrealisedTotal != null) gains.push(`<span class="fin-gain ${d.unrealisedTotal >= 0 ? 'up' : 'down'}">${d.unrealisedTotal >= 0 ? '▲' : '▼'} ${eurSigned(d.unrealisedTotal)} unrealised</span>`);
  if (d.realisedTotal) gains.push(`<span class="fin-gain ${d.realisedTotal >= 0 ? 'up' : 'down'}">${d.realisedTotal >= 0 ? '▲' : '▼'} ${eurSigned(d.realisedTotal)} realised</span>`);
  const anyCost = (d.holdings || []).some((h) => h.cost != null);
  const gainCell = (h) => h.gain == null ? '<td class="fh-r fh-gaincell">—</td>' : `<td class="fh-r fh-gaincell ${h.gain >= 0 ? 'up' : 'down'}">${eurSigned(h.gain)}</td>`;
  const sales = d.sales || [];
  return `<div class="fin-port">
    <div class="fin-head"><div class="fin-total-lab">Total value</div><div class="fin-total">${eur0(total)}</div>${gains.length ? `<div class="fin-gains">${gains.join('')}</div>` : ''}${asOf ? `<div class="fin-asof">Live as of <b>${esc(asOf)}</b> · <button class="fin-link" data-fin-refresh>refresh</button></div>` : ''}</div>
    ${bar ? `<div class="fin-bar">${bar}</div><div class="fin-legend">${legend}</div>` : ''}
    ${perf ? `<div class="fin-perf">${perf}</div>` : ''}
    <div class="fin-cards">${cards}</div>
    ${rates ? `<div class="fin-rates"><dl>${rates}</dl></div>` : ''}
    <div class="fin-sec-h"><span>What you hold</span></div>
    <div class="fh-wrap"><table class="fh-table">
      <thead><tr><th>Holding</th><th class="fh-r">Units held</th><th>Where held</th><th class="fh-r">Value</th>${anyCost ? '<th class="fh-r">Gain</th>' : ''}<th></th></tr></thead>
      <tbody>${(d.holdings || []).map((h) => `<tr>
        <td class="fh-name"><span class="fh-sw" style="background:${h.swatch}"></span>${esc(h.name)}</td>
        <td class="fh-r fh-units">${fmtQty(h.qty)} ${esc(h.unit)}</td>
        <td class="fh-where">${esc(h.venue || '—')}</td>
        <td class="fh-r fh-val">${eur0(h.value)}</td>
        ${anyCost ? gainCell(h) : ''}
        <td class="fh-act"><button class="fh-rowbtn" data-fin-sell="${h.id}" title="Record a sale">Sell</button><button class="fh-rowbtn" data-fin-edit="${h.id}" title="Edit holding">Edit</button><button class="fh-rowbtn fh-rowdel" data-fin-del="${h.id}" title="Remove holding">Remove</button></td>
      </tr>`).join('')}</tbody>
      ${total ? `<tfoot><tr><td>Total</td><td></td><td></td><td class="fh-r">${eur0(total)}</td>${anyCost ? `<td class="fh-r ${(d.unrealisedTotal || 0) >= 0 ? 'up' : 'down'}">${d.unrealisedTotal != null ? eurSigned(d.unrealisedTotal) : ''}</td>` : ''}<td></td></tr></tfoot>` : ''}
    </table></div>
    ${sales.length ? `<div class="fin-sec-h"><span>Sales</span></div>
    <div class="fh-wrap"><table class="fh-table">
      <thead><tr><th>Sold</th><th>When</th><th class="fh-r">Proceeds</th><th class="fh-r">Realised</th></tr></thead>
      <tbody>${sales.map((s) => `<tr>
        <td class="fh-name">${esc(s.name)}${s.units ? ` · ${fmtQty(s.units)}` : ''}</td>
        <td class="fh-where">${esc(new Date(s.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
        <td class="fh-r">${eur0(s.proceeds)}</td>
        <td class="fh-r ${s.realised == null ? '' : (s.realised >= 0 ? 'up' : 'down')}">${s.realised == null ? '—' : eurSigned(s.realised)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : ''}
    <div class="fin-sec-h"><span>Manage holdings</span>${(!f.adding && f.editId == null) ? '<button class="ghost" data-fin-add>+ Add holding</button>' : ''}</div>
    ${financialEditor()}
  </div>`;
}
function holdingFields(h, kinds) {
  const opts = Object.entries(kinds || {}).map(([k, v]) => `<option value="${k}" ${k === h.kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  return `<div class="fin-fields">
    <label class="fin-f"><span>Name</span><input class="sel" name="name" value="${esc(h.name || '')}" autocomplete="off" required></label>
    <label class="fin-f"><span>Code</span><input class="sel" name="code" value="${esc(h.code || '')}" placeholder="e.g. KAG" autocomplete="off" required></label>
    <label class="fin-f"><span>Venue</span><input class="sel" name="venue" value="${esc(h.venue || '')}" placeholder="e.g. Trading 212" autocomplete="off"></label>
    <label class="fin-f"><span>Quantity</span><input class="sel" name="qty" type="number" step="any" value="${h.qty != null ? h.qty : ''}" required></label>
    <label class="fin-f"><span>Priced as</span><select class="sel" name="kind">${opts}</select></label>
    <label class="fin-f"><span>Ticker (if listed)</span><input class="sel" name="symbol" value="${esc(h.symbol || '')}" placeholder="e.g. NUCG.L" autocomplete="off"></label>
    <label class="fin-f"><span>Cost — total € paid (optional)</span><input class="sel" name="cost" type="number" step="any" value="${h.cost != null ? h.cost : ''}" placeholder="what you paid, for gain tracking" autocomplete="off"></label>
  </div>`;
}
function financialEditor() {
  const f = state.financial; const d = f.data; if (!d) return '';
  if (f.adding) return `<form class="fin-editor" id="fin-add-form">${holdingFields({}, d.kinds)}<div class="fin-edit-act"><button class="add-btn wide" type="submit">Add holding</button><button type="button" class="ghost" data-fin-add-cancel>Cancel</button></div></form>`;
  if (f.editId != null) { const h = (d.holdings || []).find((x) => x.id === f.editId); if (!h) return ''; return `<form class="fin-editor" id="fin-edit-form" data-id="${h.id}">${holdingFields(h, d.kinds)}<div class="fin-edit-act"><button class="add-btn wide" type="submit">Save</button><button type="button" class="ghost" data-fin-edit-cancel>Cancel</button><button type="button" class="ghost fin-sell" data-fin-sell="${h.id}">Sold some…</button><button type="button" class="ghost fin-del" data-fin-del="${h.id}">Delete</button></div></form>`; }
  return '';
}
const finForm = (form) => { const g = (n) => (form.querySelector(`[name="${n}"]`) || {}).value || ''; return { code: g('code').trim(), name: g('name').trim(), venue: g('venue').trim(), qty: g('qty'), kind: g('kind'), symbol: g('symbol').trim(), cost: g('cost').trim() }; };
async function addHolding(form) {
  try { await api('/api/holdings', { method: 'POST', body: JSON.stringify(finForm(form)) }); toast('Holding added'); state.financial.adding = false; loadPortfolio(true); }
  catch (e) { toast(e.message); }
}
async function updateHolding(id, form) {
  const o = finForm(form); o.id = id;
  try { await api('/api/holdings', { method: 'PUT', body: JSON.stringify(o) }); toast('Saved'); state.financial.editId = null; loadPortfolio(true); }
  catch (e) { toast(e.message); }
}
async function deleteHolding(id) {
  if (!(await uiConfirm('Remove this holding?', { danger: true, okLabel: 'Remove' }))) return;
  try { await api('/api/holdings', { method: 'DELETE', body: JSON.stringify({ id }) }); toast('Removed'); state.financial.editId = null; loadPortfolio(true); }
  catch (e) { toast(e.message); }
}
// Record a (part-)sale: how many units, and what you got for it. Reduces the
// units (and cost basis pro-rata) and logs the realised gain. Sell all = removed.
async function sellHolding(id) {
  const h = ((state.financial.data || {}).holdings || []).find((x) => x.id === id); if (!h) return;
  const uAns = await uiPrompt(`How many ${h.unit || 'units'} of ${h.name} did you sell?`, { title: 'Record a sale', okLabel: 'Next', value: String(h.qty), placeholder: 'e.g. 500' });
  if (uAns == null) return;
  const units = Number(String(uAns).replace(/[^0-9.\-]/g, ''));
  if (!isFinite(units) || units <= 0) { toast('Enter how many units you sold'); return; }
  const est = h.value && h.qty ? Math.round(h.value * (Math.min(units, h.qty) / h.qty)) : '';
  const pAns = await uiPrompt(`What did you get for it, in €? (roughly €${est ? est.toLocaleString('en-IE') : '…'} at today's price)`, { title: 'Sale proceeds', okLabel: 'Record sale', value: est ? String(est) : '', placeholder: '€ received' });
  if (pAns == null) return;
  const proceeds = Number(String(pAns).replace(/[^0-9.\-]/g, ''));
  if (!isFinite(proceeds) || proceeds < 0) { toast('Enter what you got for the sale'); return; }
  try {
    const r = await api('/api/portfolio/sell', { method: 'POST', body: JSON.stringify({ id, units, proceeds }) });
    const gain = r.realised == null ? '' : ` · ${r.realised >= 0 ? 'gain' : 'loss'} ${eurSigned(r.realised)}`;
    toast(`${r.sellAll ? `Sold all of ${h.name}` : `Sold ${fmtQty(r.soldQty)} ${h.unit || ''}`}${gain}`);
    state.financial.editId = null; loadPortfolio(true);
  } catch (e) { toast(e.message); }
}
// ── Financial advice (YouTube tracker) ───────────────────────────────────
function adviceBody() {
  const f = state.financial;
  if (f.channels == null) return '<div class="fin-load">Loading…</div>';
  const chips = (f.channels || []).map((c) => `<span class="adv-chan"><a href="${esc((c.props || {}).url || '#')}" target="_blank" rel="noopener noreferrer">${esc(c.title || 'Channel')}</a><button class="adv-chan-x" data-adv-chan-del="${c.id}" title="Stop tracking">×</button></span>`).join('');
  const t = f.trends || {};
  const trends = t.text ? `<div class="adv-trends">
      <div class="adv-trends-h">📈 Long-term trends${t.ts ? `<span class="adv-trends-ts">across ${t.from || ''} videos · ${esc(new Date(t.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>` : ''}<button class="ghost adv-trends-r" data-adv-trends title="Regenerate">↻</button></div>
      <p class="adv-trends-t">${esc(t.text)}</p>
      ${(t.signals || []).length ? `<ul class="adv-signals">${t.signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    </div>` : '';
  const feed = (f.videos || []).map(adviceVideoCard).join('');
  const empty = !(f.videos || []).length ? `<div class="home-empty">${(f.channels || []).length ? 'No summaries yet. Hit “Check for new videos”, or wait for the next sweep.' : 'Add a finance channel above to start tracking it.'}</div>` : '';
  return `<div class="adv">
    <form class="adv-add" id="adv-add-form"><input class="sel" id="adv-input" placeholder="Add a channel - paste its URL or @handle…" autocomplete="off"><button class="add-btn wide" type="submit">Track</button></form>
    ${chips ? `<div class="adv-chans">${chips}</div>` : ''}
    <div class="adv-bar"><button class="ghost" data-adv-poll ${f.polling ? 'disabled' : ''}>${f.polling ? 'Watching new videos…' : '↻ Check for new videos'}</button>${(f.videos || []).length ? `<span class="adv-count">${f.videos.length} summarised</span>` : ''}</div>
    ${trends}
    <div class="adv-feed">${feed}${empty}</div>
  </div>`;
}
function adviceVideoCard(v) {
  const p = v.props || {};
  const when = p.published ? new Date(p.published).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const acts = (p.actions || []).map((a) => `<li>${esc(a)}</li>`).join('');
  const tops = (p.topics || []).map((tp) => `<span class="adv-topic">${esc(tp)}</span>`).join('');
  return `<div class="adv-card">
    <a class="adv-thumb" href="${esc(p.url || '#')}" target="_blank" rel="noopener noreferrer">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ''}<span class="adv-play">▶</span></a>
    <div class="adv-main">
      <div class="adv-meta"><span class="adv-ch">${esc(p.channelTitle || '')}</span>${when ? `<span class="adv-when">${esc(when)}</span>` : ''}</div>
      <a class="adv-title" href="${esc(p.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(v.title || 'Untitled')}</a>
      <p class="adv-sum">${esc(v.body || '')}</p>
      ${acts ? `<div class="adv-acts-h">Action points</div><ul class="adv-acts">${acts}</ul>` : ''}
      ${tops ? `<div class="adv-topics">${tops}</div>` : ''}
    </div>
  </div>`;
}
async function addAdviceChannel(input) {
  const v = (input || '').trim(); if (!v) return;
  toast('Finding channel…');
  try {
    const r = await api('/api/fin/channels', { method: 'POST', body: JSON.stringify({ input: v }) });
    const el = $('#adv-input'); if (el) el.value = '';
    toast(r.already ? 'Already tracking that channel' : `Tracking ${r.channel && r.channel.title || 'channel'}`);
    await loadAdvice();
    if (!r.already) advicePoll();   // fetch + summarise its latest right away
  } catch (e) { toast(e.message); }
}
async function delAdviceChannel(id) {
  try { await api(`/api/fin/channels/${id}`, { method: 'DELETE' }); await loadAdvice(); } catch (e) { toast(e.message); }
}
async function advicePoll() {
  const f = state.financial; if (f.polling) return;
  f.polling = true; renderFinancial();
  try {
    const r = await api('/api/fin/poll', { method: 'POST' });
    if (r.added) toast(`Summarised ${r.added} new video${r.added === 1 ? '' : 's'}`);
    else if (r.errors && r.errors.length) toast(r.errors[0]);
    else if (r.found) toast('Found videos but couldn’t summarise them');
    else toast('No new videos');
  } catch (e) { toast(e.message); }
  f.polling = false;
  await loadAdvice();
}
// ── Spending ─────────────────────────────────────────────────────────────
// Spending categories ARE the Life Areas by default: add a Life Area and it
// becomes a spending category automatically. A few money-only buckets (income,
// the catch-all) sit alongside, and the user can add extra one-off categories
// that don't map to an area (stored in settings.kv_spend_categories).
const SPEND_SPECIAL = ['Salary', 'Other income', 'Uncategorised'];
const spendAreaNames = () => (state.areas || []).map((a) => a.title).filter(Boolean);
const spendExtras = () => state.financial.spendExtras || [];
const spendIsArea = (c) => spendAreaNames().includes(c);
const spendCats = () => [...new Set([...spendAreaNames(), ...spendExtras(), ...SPEND_SPECIAL].filter(Boolean))];
const INCOME_CATS = new Set(['Salary', 'Other income']);
// A category can be an expense, an income, or both. Salary and Other income are
// income by default; everything else is an expense. The user can also mark any
// category for the other column - a category like Lisbon Sintra Tours can be
// both - and those overrides live in two settings lists.
const spendAlsoIncome = () => new Set(state.financial.spendAlsoIncome || []);
const spendAlsoExpense = () => new Set(state.financial.spendAlsoExpense || []);
const catIsIncome = (c) => INCOME_CATS.has(c) || spendAlsoIncome().has(c);
const catIsExpense = (c) => (!INCOME_CATS.has(c)) || spendAlsoExpense().has(c);
const expenseCatList = () => spendCats().filter(catIsExpense);
const incomeCatList = () => spendCats().filter(catIsIncome);
async function saveSpendCatType(kind, arr) {
  const key = kind === 'income' ? 'spendAlsoIncome' : 'spendAlsoExpense';
  const kvKey = kind === 'income' ? 'spend_cat_income' : 'spend_cat_expense';
  state.financial[key] = arr; renderFinancial();
  try { await api(`/api/kv/${kvKey}`, { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(arr) }) }); } catch (e) { toast(e.message); }
}
// Toggle whether a category also belongs to the other column. For a normal
// (expense) category that's the income list; for a built-in income category
// that's the expense list.
function spendCatToggleType(cat, col) {
  if (col === 'income') { const s = spendAlsoIncome(); s.has(cat) ? s.delete(cat) : s.add(cat); saveSpendCatType('income', [...s]); }
  else { const s = spendAlsoExpense(); s.has(cat) ? s.delete(cat) : s.add(cat); saveSpendCatType('expense', [...s]); }
}
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const eurSigned = (n) => (n < 0 ? '-' : '') + '€' + Math.abs(Math.round(n)).toLocaleString('en-IE');
function txnList() { return (state.financial.txns || []).map((t) => ({ id: t.id, ...(t.props || {}) })).filter((t) => t.date); }
function spendMonths() { return [...new Set(txnList().map((t) => t.date.slice(0, 7)))].sort().reverse(); }
function spendingBody() {
  const f = state.financial;
  if (f.spendImport) return spendImportView();
  if (f.txns == null) return '<div class="fin-load">Loading…</div>';
  const importBar = `<div class="sp-actions"><label class="add-btn wide sp-import-btn">Import statement (CSV or PDF)<input type="file" id="sp-file" accept=".csv,.pdf,text/csv,application/pdf" hidden></label><button class="ghost ${f.spendCatsOpen ? 'on' : ''}" data-sp-cat-manage title="Add, rename or delete your spending categories">⚙ Categories</button>${(f.txns || []).length ? '<button class="ghost" data-sp-clear>Clear all</button>' : ''}</div>`;
  // A chip carries its rename/delete (extras only) plus a cross-toggle to also
  // count it in the other column. Salary/Other income are income by nature and
  // toggle onto expenses; every other category is an expense and toggles onto
  // income - so Lisbon Sintra Tours can sit in both.
  const catChip = (c) => {
    const area = spendIsArea(c), special = SPEND_SPECIAL.includes(c), builtinIncome = INCOME_CATS.has(c);
    const tag = area ? '<span class="sp-cat-tag">area</span>' : '';
    const on = builtinIncome ? catIsExpense(c) : catIsIncome(c);
    const other = builtinIncome ? 'expense' : 'income', lbl = builtinIncome ? 'exp' : 'inc';
    const cross = `<button class="trk-cat-btn sp-cat-cross ${on ? 'on' : ''}" data-sp-cat-type="${esc(c)}:${other}" title="${on ? `Also counted as ${other} - tap to remove` : `Also count as ${other}`}">${on ? '✓' : '＋'} ${lbl}</button>`;
    const edit = (!area && !special) ? `<button class="trk-cat-btn" data-sp-cat-rename="${esc(c)}" title="Rename">✎</button><button class="trk-cat-btn trk-cat-del" data-sp-cat-del="${esc(c)}" title="Delete">×</button>` : '';
    return `<span class="trk-cat-chip ${area ? 'sp-cat-area' : ''}">${esc(c)}${tag}${cross}${edit}</span>`;
  };
  const catManage = f.spendCatsOpen ? `<div class="sp-catmanage"><div class="fin-sec-h"><span>Categories</span><button class="ghost" data-sp-cat-add>+ Extra category</button></div>
    <p class="sp-cat-note">Your <b>Life Areas</b> are your spending categories. A category can be an <b>expense</b>, <b>income</b>, or both - use <b>＋inc</b> / <b>＋exp</b> to add one to the other column.</p>
    <div class="sp-cat-cols">
      <div class="sp-cat-col sp-cat-col-exp"><div class="sp-cat-col-h">Expense categories</div><div class="trk-cats">${expenseCatList().map(catChip).join('') || '<span class="sp-cat-empty">None</span>'}</div></div>
      <div class="sp-cat-col sp-cat-col-inc"><div class="sp-cat-col-h">Income categories</div><div class="trk-cats">${incomeCatList().map(catChip).join('') || '<span class="sp-cat-empty">None</span>'}</div></div>
    </div></div>` : '';
  if (!(f.txns || []).length) return `${importBar}${catManage}<div class="fin-soon"><div class="fin-soon-ic">🧾</div><h2>Spending</h2><p>Import a bank statement - CSV (Wise: Statement → Download → CSV) or a PDF statement - to categorise your spending and see income vs outgoings over time.</p><p class="fin-soon-note">PDFs are read by Gemini to pull out the transactions; nothing is sent to a bank.</p></div>`;
  const months = spendMonths();
  if (!f.spendMonth || !months.includes(f.spendMonth)) f.spendMonth = months[0];
  const idx = months.indexOf(f.spendMonth);
  const rows = txnList().filter((t) => t.date.slice(0, 7) === f.spendMonth);
  const income = rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const out = rows.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = income - out;
  // spending by category
  const byCat = {}; rows.filter((t) => t.amount < 0).forEach((t) => { const c = t.category || 'Uncategorised'; byCat[c] = (byCat[c] || 0) + Math.abs(t.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;
  const catBars = cats.map(([c, v]) => `<div class="sp-catrow"><span class="sp-catname">${esc(c)}</span><div class="sp-cattrack"><i style="width:${Math.round(v / maxCat * 100)}%"></i></div><span class="sp-catval">${eur0(v)}</span></div>`).join('') || '<div class="home-empty">No spending this month.</div>';
  // transaction list
  const list = rows.slice().sort((a, b) => b.date.localeCompare(a.date)).map(spendRow).join('');
  // monthly trend (last 8)
  const trend = spendTrend(months.slice(0, 8).reverse());
  return `${importBar}${catManage}
    <div class="sp-monthnav"><button class="ghost" data-sp-month="prev" ${idx >= months.length - 1 ? 'disabled' : ''}>‹</button><span class="sp-month">${esc(monthLabel(f.spendMonth))}</span><button class="ghost" data-sp-month="next" ${idx <= 0 ? 'disabled' : ''}>›</button></div>
    <div class="sp-summary"><div class="sp-sum in"><span class="lab">In</span><span class="v">${eur0(income)}</span></div><div class="sp-sum out"><span class="lab">Out</span><span class="v">${eur0(out)}</span></div><div class="sp-sum net"><span class="lab">Net</span><span class="v ${net >= 0 ? 'up' : 'down'}">${eurSigned(net)}</span></div></div>
    ${trend}
    <div class="sp-sec-h">Where it went</div>
    <div class="sp-cats">${catBars}</div>
    <div class="sp-sec-h">Transactions · ${rows.length}</div>
    <div class="sp-txns">${list}</div>`;
}
function spendRow(t) {
  // Include the txn's current category even if it's not in the managed list, so
  // a renamed/removed category still shows rather than silently blanking.
  const list = t.category && !spendCats().includes(t.category) ? [t.category, ...spendCats()] : spendCats();
  const opts = list.map((c) => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
  return `<div class="sp-txn ${t.amount < 0 ? 'out' : 'in'}">
    <span class="sp-date">${esc(t.date.slice(8, 10))}/${esc(t.date.slice(5, 7))}</span>
    <span class="sp-desc" title="${esc(t.description || '')}">${esc(t.description || '—')}</span>
    <select class="sel sp-cat" data-sp-cat="${t.id}">${opts}</select>
    <span class="sp-amt">${eurSigned(t.amount)}</span>
  </div>`;
}
function spendTrend(months) {
  if (months.length < 2) return '';
  const all = txnList();
  const data = months.map((m) => { const r = all.filter((t) => t.date.slice(0, 7) === m); return { m, in: r.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0), out: r.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0) }; });
  const max = Math.max(1, ...data.map((d) => Math.max(d.in, d.out)));
  const bars = data.map((d) => `<div class="sp-tcol" data-sp-month-jump="${d.m}"><div class="sp-tbars"><i class="in" style="height:${Math.round(d.in / max * 100)}%" title="In ${eur0(d.in)}"></i><i class="out" style="height:${Math.round(d.out / max * 100)}%" title="Out ${eur0(d.out)}"></i></div><span class="sp-tlab">${esc(new Date(+d.m.slice(0, 4), +d.m.slice(5, 7) - 1).toLocaleDateString('en-GB', { month: 'short' }))}</span></div>`).join('');
  return `<div class="sp-trend"><div class="sp-trend-h">In vs out · last ${data.length} months <span class="sp-tkey"><i class="in"></i>in <i class="out"></i>out</span></div><div class="sp-trendbars">${bars}</div></div>`;
}
function spendImportView() {
  const im = state.financial.spendImport;
  if (im.loading) return `<div class="sp-import"><div class="sp-sec-h">Reading · ${esc(im.name || 'statement.pdf')}</div><div class="fin-load">Reading the statement with Gemini… this can take a moment for a long PDF.</div></div>`;
  // PDF rows come back already normalised (date/amount/description) - no column
  // mapping needed, just a preview and confirm.
  if (im.pdf) {
    const rows = im.rows || [];
    const preview = rows.slice(0, 8).map((r) => `<tr><td>${esc(r.date || '?')}</td><td class="sp-pv-desc">${esc(r.description || '')}</td><td class="${r.amount < 0 ? 'down' : 'up'}">${r.amount != null ? eurSigned(r.amount) : '?'}</td></tr>`).join('');
    return `<div class="sp-import">
      <div class="sp-sec-h">Import · ${esc(im.name || 'statement.pdf')}</div>
      <p class="sp-import-note">Gemini pulled ${rows.length} transaction${rows.length === 1 ? '' : 's'} out of this PDF. Have a quick look, then import.</p>
      <table class="sp-preview"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>${preview}</tbody></table>
      ${rows.length > 8 ? `<p class="sp-import-note">…and ${rows.length - 8} more.</p>` : ''}
      <div class="fin-edit-act"><button class="add-btn wide" data-sp-do-import ${rows.length ? '' : 'disabled'}>Import ${rows.length} transactions</button><button class="ghost" data-sp-import-cancel>Cancel</button></div>
    </div>`;
  }
  const H = im.headers;
  const sel = (field, val) => `<select class="sel" data-sp-map="${field}"><option value="">—</option>${H.map((h) => `<option value="${esc(h)}" ${h === val ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`;
  const norm = spendNormalize(im.rows.slice(0, 6), im.map);
  const preview = norm.map((r) => `<tr><td>${esc(r.date || '?')}</td><td class="sp-pv-desc">${esc(r.description || '')}</td><td class="${r.amount < 0 ? 'down' : 'up'}">${r.amount != null ? eurSigned(r.amount) : '?'}</td></tr>`).join('');
  const okCount = spendNormalize(im.rows, im.map).length;
  return `<div class="sp-import">
    <div class="sp-sec-h">Import · ${esc(im.name || 'statement.csv')}</div>
    <p class="sp-import-note">Check the columns are matched, then import. ${okCount} of ${im.rows.length} rows look valid.</p>
    <div class="sp-map">
      <label class="fin-f"><span>Date</span>${sel('date', im.map.date)}</label>
      <label class="fin-f"><span>Amount (signed)</span>${sel('amount', im.map.amount)}</label>
      <label class="fin-f"><span>…or Money in</span>${sel('inCol', im.map.inCol)}</label>
      <label class="fin-f"><span>…or Money out</span>${sel('outCol', im.map.outCol)}</label>
      <label class="fin-f"><span>Description</span>${sel('desc', im.map.desc)}</label>
      <label class="fin-f"><span>Currency</span>${sel('currency', im.map.currency)}</label>
    </div>
    <table class="sp-preview"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>${preview}</tbody></table>
    <div class="fin-edit-act"><button class="add-btn wide" data-sp-do-import ${okCount ? '' : 'disabled'}>Import ${okCount} transactions</button><button class="ghost" data-sp-import-cancel>Cancel</button></div>
  </div>`;
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => (c || '').trim() !== ''));
}
function spendDetect(headers) {
  const f = (re) => { const h = headers.find((x) => re.test(x)); return h || ''; };
  const amount = f(/^amount$/i) || f(/\bamount\b/i) || f(/\bvalue\b/i);
  return {
    date: f(/date|data\b/i), amount,
    inCol: amount ? '' : f(/money in|paid in|\bcredit\b|deposit|received|entrada/i),
    outCol: amount ? '' : f(/money out|paid out|\bdebit\b|withdrawal|spent|sa[ií]da/i),
    desc: f(/description|merchant|reference|details|narrative|payee|descri|memo|counterparty|\bname\b/i),
    currency: f(/currency|moeda/i),
  };
}
function spendNormDate(v) {
  v = String(v || '').trim(); if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) { let d = +m[1], mo = +m[2]; let y = +m[3]; if (y < 100) y += 2000; if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  const dt = new Date(v); if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  return '';
}
function spendNormAmount(v) {
  if (v == null) return null; let s = String(v).trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /-/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (s.includes(',') && s.includes('.')) { s = (s.lastIndexOf(',') > s.lastIndexOf('.')) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); }
  else if (s.includes(',')) { s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, ''); }
  let n = parseFloat(s); if (!isFinite(n)) return null; if (neg && n > 0) n = -n; return n;
}
function spendNormalize(rows, map) {
  return rows.map((o) => {
    const date = spendNormDate(o[map.date]);
    let amount = null;
    if (map.amount) amount = spendNormAmount(o[map.amount]);
    else { const i = spendNormAmount(o[map.inCol]); const ou = spendNormAmount(o[map.outCol]); if (i != null || ou != null) amount = (i || 0) - Math.abs(ou || 0); }
    return { date, amount, description: String(o[map.desc] || '').trim(), currency: map.currency ? String(o[map.currency] || '').trim() : '' };
  }).filter((r) => r.date && r.amount != null && r.amount !== 0);
}
function spendOpenFile(file) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (isPdf) { spendOpenPdf(file); return; }
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const grid = parseCSV(String(rd.result || ''));
      if (grid.length < 2) { toast('That CSV looks empty'); return; }
      const headers = grid[0].map((h) => (h || '').trim());
      const rows = grid.slice(1).map((r) => { const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o; });
      state.financial.spendImport = { name: file.name, headers, rows, map: spendDetect(headers) };
      renderFinancial();
    } catch (e) { toast('Could not read that file'); }
  };
  rd.readAsText(file);
}
// PDF: read as base64, hand it to Gemini on the worker to extract transactions.
function spendOpenPdf(file) {
  if (file.size > 18 * 1024 * 1024) { toast('That PDF is very large - try a shorter statement'); return; }
  state.financial.spendImport = { name: file.name, pdf: true, loading: true, rows: [] };
  renderFinancial();
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const buf = new Uint8Array(rd.result);
      let bin = ''; const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      const data = btoa(bin);
      const r = await api('/api/spend/parse-pdf', { method: 'POST', body: JSON.stringify({ data, name: file.name }) });
      if (!state.financial.spendImport || !state.financial.spendImport.pdf) return;   // cancelled
      if (!r.rows || !r.rows.length) { toast('No transactions found in that PDF'); state.financial.spendImport = null; renderFinancial(); return; }
      state.financial.spendImport = { name: file.name, pdf: true, rows: r.rows };
      renderFinancial();
    } catch (e) { toast(e.message); state.financial.spendImport = null; renderFinancial(); }
  };
  rd.onerror = () => { toast('Could not read that PDF'); state.financial.spendImport = null; renderFinancial(); };
  rd.readAsArrayBuffer(file);
}
async function spendDoImport() {
  const im = state.financial.spendImport; if (!im) return;
  const rows = im.pdf ? im.rows : spendNormalize(im.rows, im.map);
  if (!rows.length) { toast('No valid rows to import'); return; }
  toast('Importing…');
  try {
    const r = await api('/api/spend/import', { method: 'POST', body: JSON.stringify({ rows }) });
    toast(`Imported ${r.added}${r.skipped ? `, skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''}`);
    state.financial.spendImport = null; state.financial.txns = null; loadSpending();
  } catch (e) { toast(e.message); }
}
async function spendSetCat(id, category) {
  const t = (state.financial.txns || []).find((x) => x.id === id); if (t) { t.props = t.props || {}; t.props.category = category; }
  renderFinancial();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { category } }) }); } catch (e) { toast(e.message); }
}
async function spendClear() {
  if (!(await uiConfirm('Delete all imported transactions?', { danger: true, okLabel: 'Delete all' }))) return;
  try { await api('/api/spend/clear', { method: 'POST' }); toast('Cleared'); state.financial.txns = null; loadSpending(); } catch (e) { toast(e.message); }
}
// ── Tracker (market watchlist) ───────────────────────────────────────────
const trkPrice = (v, cur) => { if (v == null) return '—'; const n = Number(v); const s = n >= 100 ? Math.round(n).toLocaleString('en-IE') : n >= 1 ? n.toFixed(2) : n.toPrecision(4); return (cur === 'EUR' ? '€' + s : cur === 'USD' ? '$' + s : cur === 'GBP' ? '£' + s : `${s}${cur ? ' ' + cur : ''}`); };
function trkChange(v) {
  if (v == null) return '<span class="trk-ch flat">—</span>';
  const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat'; const sign = v >= 0 ? '+' : '';
  return `<span class="trk-ch ${cls}">${sign}${v.toFixed(1)}%</span>`;
}
const trkCats = () => (state.financial.tracker && state.financial.tracker.categories) || [];
const trkCatOpts = (sel) => `<option value="">No category</option>${trkCats().map((c) => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
function trackerBody() {
  const f = state.financial;
  const addForm = `<form class="trk-add" id="trk-add-form"><input class="sel" id="trk-input" placeholder="Add a symbol or name - BTC, XRP, AAPL, NUCG.L…" autocomplete="off"><select class="sel" id="trk-type"><option value="crypto">Crypto</option><option value="stock">Share / ETF</option></select><select class="sel" id="trk-cat">${trkCatOpts('')}</select><button class="add-btn wide" type="submit">Add</button></form>`;
  if (f.tracker == null) return `${addForm}<div class="fin-load">Loading prices…</div>`;
  const items = f.tracker.items || [];
  const cats = trkCats();
  const asOf = f.tracker.ts ? new Date(f.tracker.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  const cell = (lab, v) => `<span class="trk-cell"><span class="trk-lab">${lab}</span>${trkChange(v)}</span>`;
  const rowHtml = (it) => `<div class="trk-row">
    <span class="trk-name"><span class="trk-sym">${esc(it.symbol || '')}</span><span class="trk-nm">${esc(it.name || '')}</span></span>
    <span class="trk-changes">${cell('24h', it.ch24)}${cell('7d', it.ch7)}${cell('30d', it.ch30)}</span>
    <span class="trk-px">${esc(trkPrice(it.price, it.currency))}</span>
    <select class="sel trk-rowcat" data-trk-cat="${it.id}" title="Move to a category">${trkCatOpts(it.category || '')}</select>
    <button class="trk-x" data-trk-del="${it.id}" title="Remove">×</button>
  </div>`;
  // Group by category: named categories in the user's order, then any stray
  // category, then uncategorised last.
  const byCat = {}; for (const it of items) { const c = it.category || ''; (byCat[c] = byCat[c] || []).push(it); }
  const order = [...cats.filter((c) => byCat[c]), ...Object.keys(byCat).filter((c) => c && !cats.includes(c))];
  const grouped = order.map((c) => `<div class="trk-group"><div class="trk-group-h">${esc(c)}</div><div class="trk-list">${byCat[c].map(rowHtml).join('')}</div></div>`).join('');
  const uncat = byCat[''] ? `<div class="trk-group">${order.length ? '<div class="trk-group-h">Uncategorised</div>' : ''}<div class="trk-list">${byCat[''].map(rowHtml).join('')}</div></div>` : '';
  const manage = `<div class="fin-sec-h"><span>Categories</span><button class="ghost" data-trk-cat-add>+ Category</button></div>
    <div class="trk-cats">${cats.length ? cats.map((c) => `<span class="trk-cat-chip">${esc(c)}<button class="trk-cat-btn" data-trk-cat-rename="${esc(c)}" title="Rename">✎</button><button class="trk-cat-btn trk-cat-del" data-trk-cat-del="${esc(c)}" title="Delete">×</button></span>`).join('') : '<span class="trk-cats-empty">No categories yet - add one to group your watchlist.</span>'}</div>`;
  return `${addForm}
    <div class="trk-bar">${items.length ? `<button class="ghost" data-trk-refresh ${f.trackerLoading ? 'disabled' : ''}>${f.trackerLoading ? 'Refreshing…' : '↻ Refresh'}</button>${asOf ? `<span class="fin-asof">as of ${esc(asOf)}</span>` : ''}` : ''}</div>
    ${items.length ? `${grouped}${uncat}` : '<div class="home-empty">Add crypto, shares or ETFs above to watch their 24h / 7d / 30d moves.</div>'}
    ${manage}`;
}
async function addTracker(input, type, category) {
  const v = (input || '').trim(); if (!v) return;
  toast('Finding…');
  try {
    await api('/api/tracker', { method: 'POST', body: JSON.stringify({ input: v, type, category: category || '' }) });
    const el = $('#trk-input'); if (el) el.value = '';
    toast('Added'); loadTracker(true);
  } catch (e) { toast(e.message); }
}
async function saveTrkCats(cats) {
  if (state.financial.tracker) state.financial.tracker.categories = cats;
  renderFinancial();
  try { await api('/api/tracker/categories', { method: 'PUT', body: JSON.stringify({ categories: cats }) }); } catch (e) { toast(e.message); }
}
async function setTrackerCat(id, category) {
  const it = (state.financial.tracker.items || []).find((x) => x.id === id); if (it) it.category = category;
  renderFinancial();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { category } }) }); } catch (e) { toast(e.message); }
}
async function addTrkCat() {
  const name = ((await uiPrompt('New category name:', { title: 'New category', okLabel: 'Add', placeholder: 'e.g. Precious metals' })) || '').trim();
  if (!name) return; if (trkCats().includes(name)) { toast('That category already exists'); return; }
  saveTrkCats([...trkCats(), name]);
}
async function renameTrkCat(old) {
  const name = ((await uiPrompt('Rename category:', { title: 'Rename category', okLabel: 'Save', value: old })) || '').trim();
  if (!name || name === old) return;
  saveTrkCats(trkCats().map((c) => (c === old ? name : c)));
  for (const it of (state.financial.tracker.items || []).filter((x) => x.category === old)) { it.category = name; api(`/api/blocks/${it.id}`, { method: 'PATCH', body: JSON.stringify({ props: { category: name } }) }).catch(() => {}); }
  renderFinancial();
}
async function delTrkCat(name) {
  if (!(await uiConfirm(`Delete the category "${name}"? Items in it become uncategorised.`, { danger: true, okLabel: 'Delete' }))) return;
  saveTrkCats(trkCats().filter((c) => c !== name));
  for (const it of (state.financial.tracker.items || []).filter((x) => x.category === name)) { it.category = ''; api(`/api/blocks/${it.id}`, { method: 'PATCH', body: JSON.stringify({ props: { category: '' } }) }).catch(() => {}); }
  renderFinancial();
}
async function delTracker(id) {
  try { await api(`/api/tracker/${id}`, { method: 'DELETE' }); const f = state.financial; if (f.tracker) f.tracker.items = (f.tracker.items || []).filter((x) => x.id !== id); renderFinancial(); } catch (e) { toast(e.message); }
}
async function openGoals(tab) {
  state.view = { type: 'goals' };
  if (tab) state.goalsTab = tab;
  const [areas, goals, bucket, reviews] = await Promise.all([api('/api/blocks?kind=area'), api('/api/blocks?kind=goal'), api('/api/blocks?kind=bucket'), api('/api/blocks?kind=review')]);
  state.areas = areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  state.goals = goals; state.bucket = bucket; state.reviews = reviews;
  renderNav(); renderGoals();
  api('/api/review-reminders').then((r) => { if (state.view.type === 'goals') { state.reviewReminders = r.reminders || []; if (state.goalsTab === 'reviews') renderGoals(); } }).catch(() => {});
}
// Focus-list order (per device) and helpers, so you can drag the cards around.
function focusOrderIds() { try { const o = JSON.parse(localStorage.getItem('life.home.focusOrder')); return Array.isArray(o) ? o : []; } catch { return []; } }
function sortFocus(goals) { const o = focusOrderIds(); return goals.slice().sort((a, b) => { const ia = o.indexOf(a.id), ib = o.indexOf(b.id); return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib); }); }
function focusGoals() { return sortFocus((state.goals || []).filter((g) => gp(g).focus && (gp(g).status || 'active') === 'active')); }
function reorderFocus(dragged, before) {
  const ids = focusGoals().map((g) => g.id).filter((id) => id !== dragged);
  let i = before ? ids.indexOf(before) : ids.length; if (i < 0) i = ids.length;
  ids.splice(i, 0, dragged);
  try { localStorage.setItem('life.home.focusOrder', JSON.stringify(ids)); } catch {}
  renderHome();
}
function goalCardMini(g, drag) {
  const a = goalArea(g); const p = gp(g); const pct = Math.round(goalProgress(g) * 100);
  return `<button class="goal-card" data-open-goal="${g.id}" ${drag ? `draggable="true" data-focus-id="${g.id}"` : ''} style="--h:${hueOf(a)}">
    <div class="gc-top">${p.focus ? '<span class="gc-focus">★</span>' : ''}<span class="gc-title">${esc(g.title || 'Untitled goal')}</span><span class="gc-status s-${p.status || 'active'}">${gStatusLabel(p.status)}</span></div>
    <div class="gc-meta">${a ? `<span class="gc-area">${esc(a.title)}</span>` : ''}${p.horizon ? `<span class="gc-h">${esc(horizonLabel(p.horizon))}</span>` : ''}<span class="gc-measure">${esc(goalMeasure(g))}</span></div>
    <div class="gc-bar"><i style="width:${pct}%"></i></div></button>`;
}
function renderGoals() {
  const tab = state.goalsTab || 'goals';
  const seg = `<div class="seg"><button class="seg-b ${tab === 'bucket' ? 'on' : ''}" data-goals-tab="bucket">Bucket list</button><button class="seg-b ${tab === 'vision' ? 'on' : ''}" data-goals-tab="vision">Vision</button><button class="seg-b ${tab === 'goals' ? 'on' : ''}" data-goals-tab="goals">Goals</button><button class="seg-b ${tab === 'reviews' ? 'on' : ''}" data-goals-tab="reviews">Reviews</button></div>`;
  const body = tab === 'bucket' ? bucketBody() : tab === 'reviews' ? reviewsBody() : tab === 'vision' ? visionBody() : goalsBody();
  $('#pane').innerHTML = `${pageCrumb('Goals')}<div class="pane-head"><h1>Goals &amp; Reviews</h1></div>${seg}${body}`;
  if (tab === 'vision') loadVisionThumbs();
}
function goalsBody() {
  const active = state.goals.filter((g) => (gp(g).status || 'active') === 'active');
  const focus = active.filter((g) => gp(g).focus);
  const others = active.filter((g) => !gp(g).focus);
  const done = state.goals.filter((g) => gp(g).status === 'done');
  const byArea = {};
  others.forEach((g) => { const k = gp(g).area || '_'; (byArea[k] = byArea[k] || []).push(g); });
  const areaSection = Object.keys(byArea).map((k) => { const a = areaById(k); return `<div class="goal-group"><div class="goal-group-h">${a ? esc(a.title) : 'No area'}</div><div class="goal-grid">${byArea[k].map(goalCardMini).join('')}</div></div>`; }).join('');
  return `<div class="goals-actions"><button class="add-btn wide" data-new-goal>+ New goal</button></div>
    ${focus.length ? `<section class="home-sec"><div class="home-sec-h">★ This quarter's focus</div><div class="goal-grid">${focus.map(goalCardMini).join('')}</div></section>` : '<div class="empty" style="padding:28px">Add a goal, then ★ it to bring it into focus for this quarter.</div>'}
    ${areaSection ? `<section class="home-sec"><div class="home-sec-h">Active goals</div>${areaSection}</section>` : ''}
    ${done.length ? `<details class="goal-done"><summary>Done · ${done.length}</summary><div class="goal-grid">${done.map(goalCardMini).join('')}</div></details>` : ''}`;
}
async function newGoal(area) {
  // No type up front: a new goal is just a goal. The card then asks how you want
  // to track it (milestones or a number) - milestones is a kind of goal, not the
  // starting point, so we don't drop you straight into the milestone editor.
  const props = { area: area || null, why: '', horizon: 'quarter', gtype: '', status: 'active', focus: false, milestones: [] };
  // Start with no title so the "What do you want to achieve?" placeholder shows,
  // then drop the cursor into it - you can type your goal straight away.
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'goal', title: '', props }) });
  state.goals.push(b);
  await openGoalCard(b.id);
  const el = document.getElementById('goalcard-title');
  if (el) { el.focus(); try { el.setSelectionRange(0, 0); } catch {} }
}
async function openGoalCard(id) {
  const g = await api(`/api/blocks/${id}`);
  const all = await api('/api/blocks?kind=task');
  const tasks = all.filter((t) => t.props && t.props.goal === id);
  state.goal_open = { goal: g, tasks, allTasks: all, areaQuery: '' };
  state.view = { type: 'goalcard', id };
  renderNav(); renderGoalCard();
}
function renderGoalCard() {
  const g = state.goal_open.goal; const p = gp(g); const a = goalArea(g);
  const areaOpts = `<option value="">No area</option>` + state.areas.map((x) => `<option value="${x.id}" ${p.area === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
  const ms = Array.isArray(p.milestones) ? p.milestones : [];
  const gtasks = state.goal_open.tasks || [];
  const msIds = new Set(ms.map((m) => m.id));
  const loose = gtasks.filter((t) => !t.props.milestone || !msIds.has(t.props.milestone));
  const typeBody = !p.gtype
    ? `<div class="gtype-choose"><div class="tf-label">How do you want to track this goal?</div>
        <div class="gtype-opts">
          <button class="gtype-opt" data-set-gtype="achievement"><span class="gto-ic">📋</span><b>Milestones</b><small>Steps to tick off along the way</small></button>
          <button class="gtype-opt" data-set-gtype="number"><span class="gto-ic">🎯</span><b>Number</b><small>A target to reach, e.g. €2k/mo or 12kg</small></button>
        </div></div>`
    : p.gtype === 'number'
    ? `<label class="tf-field"><span class="tf-label">Progress</span><div class="gnum"><input class="sel" id="gc-current" type="number" value="${esc(p.current ?? '')}" placeholder="0"><span>of</span><input class="sel" id="gc-target" type="number" value="${esc(p.target ?? '')}" placeholder="100"><input class="sel gc-unit" id="gc-unit" value="${esc(p.unit || '')}" placeholder="unit"></div></label>`
    : `<div class="ms-block"><div class="tf-label">Milestones &amp; tasks</div>
        ${ms.map((m) => { const mt = gtasks.filter((t) => t.props.milestone === m.id); return `<div class="ms-group">
          <div class="ms-row ${m.done ? 'done' : ''}"><button class="ms-check" data-ms-toggle="${m.id}">✓</button><input class="ms-text" data-ms-text="${m.id}" value="${esc(m.text || '')}" placeholder="Milestone…">${mt.length ? `<span class="ms-count">${mt.filter((t) => t.props.done).length}/${mt.length}</span>` : ''}<button class="ms-x" data-ms-del="${m.id}">×</button></div>
          <div class="ms-tasks">${mt.map(goalTaskRow).join('')}<button class="ghost gt-add-btn" data-goal-addtask="${g.id}:${m.id}">+ task</button></div>
        </div>`; }).join('')}
        <button class="ghost ms-add" data-ms-add>+ Add milestone</button>
        <div class="gt-loose"><div class="tf-label gt-loose-h">Tasks not under a milestone</div><div class="ms-tasks">${loose.map(goalTaskRow).join('')}<button class="ghost gt-add-btn" data-goal-addtask="${g.id}:">+ task</button></div></div>
      </div>`;
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-goals>Goals</button><span class="crumb-sep">›</span><span class="crumb cur">${esc(g.title || 'Goal')}</span>
      <span class="crumb-tools"><button class="note-del ghost" data-del-goal="${g.id}">Delete</button></span></div>
    <div class="task-focus" style="--h:${hueOf(a)}">
      <button class="gc-focus-btn ${p.focus ? 'on' : ''}" data-toggle-focus="${g.id}" title="Focus this quarter">${p.focus ? '★' : '☆'}</button>
      <textarea class="note-title" id="goalcard-title" rows="1" placeholder="What do you want to achieve?">${esc(g.title || '')}</textarea>
    </div>
    ${(() => { const m = focusMinsFor('goal', g.id); return m ? `<div class="focus-stat">🍅 ${fmtMins(m)} of focus logged on this goal</div>` : ''; })()}
    <label class="tf-field goal-why"><span class="tf-label">Why this matters</span><textarea class="sel" id="goalcard-why" rows="2" placeholder="The reason that carries it through the hard weeks…">${esc(p.why || '')}</textarea></label>
    <div class="tf-meta">
      <div class="tf-field"><span class="tf-label">Life areas</span>${blockAreasControl('goal', g)}</div>
      <label class="tf-field"><span class="tf-label">Horizon</span><select class="sel" id="goalcard-horizon">${HORIZONS.map(([v, l]) => `<option value="${v}" ${p.horizon === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="tf-field"><span class="tf-label">Type</span><select class="sel" id="goalcard-gtype"><option value="" ${!p.gtype ? 'selected' : ''} disabled hidden>Choose…</option>${GTYPES.map(([v, l]) => `<option value="${v}" ${p.gtype === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="tf-field"><span class="tf-label">Status</span><select class="sel" id="goalcard-status">${GSTATUS.map(([v, l]) => `<option value="${v}" ${(p.status || 'active') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="tf-field"><span class="tf-label">By when</span>${dateFieldHtml('goalcard-target', p.targetDate || '')}</label>
    </div>
    <div class="goal-measure-block">${typeBody}</div>
    ${p.gtype !== 'achievement' ? `<div class="goal-actions-sec">
      <div class="tf-label gt-loose-h">Actions<span class="gt-hint">real tasks to move this forward - they show up in Tasks &amp; Today too</span></div>
      <div class="ms-tasks">${loose.map(goalTaskRow).join('')}<button class="ghost gt-add-btn" data-goal-addtask="${g.id}:">+ Add task</button></div>
    </div>` : ''}
    ${goalAreaTasksHtml()}
    ${notesSection(g.body, 'goal', g.id)}`;
  autoGrowSoon($('#goalcard-title'));
}
// Every task already sitting in this goal's life area, so you can pull an
// existing one in rather than only ever adding fresh tasks. Linked tasks and
// done ones drop out; a search narrows it.
function goalAreaTasksHtml() {
  const go = state.goal_open; if (!go) return '';
  const p = gp(go.goal); if (!p.area) return '';
  const a = areaById(p.area); const aname = a ? esc(a.title) : 'this area';
  return `<div class="goal-arealist" style="--h:${hueOf(a)}">
    <div class="tf-label gt-loose-h">Tasks in ${aname}<span class="gt-hint">link an existing task into this goal</span></div>
    <input class="sel gal-search" data-gal-q placeholder="Search ${aname} tasks…" value="${esc(go.areaQuery || '')}">
    <div class="gal-list">${goalAreaListInner()}</div></div>`;
}
function goalAreaListInner() {
  const go = state.goal_open; const p = gp(go.goal);
  const q = (go.areaQuery || '').trim().toLowerCase();
  const linked = new Set((go.tasks || []).map((t) => t.id));
  let list = (go.allTasks || []).filter((t) => t.props && t.props.area === p.area && !t.props.done && !linked.has(t.id));
  if (q) list = list.filter((t) => (t.title || '').toLowerCase().includes(q));
  if (!list.length) return `<div class="home-empty" style="padding:8px 0 0">No ${q ? 'matching ' : 'unlinked '}tasks in this area${q ? '' : ' yet'}.</div>`;
  return list.slice(0, 60).map((t) => `<div class="gal-row"><span class="ga-t" data-open-task="${t.id}">${esc(t.title)}</span><button class="ghost gal-link" data-goal-link="${t.id}" title="Link to this goal">＋ Link</button></div>`).join('')
    + (list.length > 60 ? `<div class="home-empty" style="padding:8px 0 0">Showing first 60 - search to narrow.</div>` : '');
}
function renderGoalAreaList() { const el = $('.gal-list'); if (el) el.innerHTML = goalAreaListInner(); }
// Link an existing area task into this goal: it keeps its place in Tasks/Today
// and now also shows under the goal (props.goal). No copy is made.
async function linkTaskToGoal(taskId) {
  const go = state.goal_open; if (!go) return;
  const t = (go.allTasks || []).find((x) => x.id === taskId); if (!t) return;
  t.props = t.props || {}; t.props.goal = go.goal.id;
  go.tasks.push(t);
  renderGoalCard();
  try { await api(`/api/blocks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ props: { goal: go.goal.id } }) }); toast('Linked to goal'); }
  catch (e) { toast(e.message); }
}
async function patchGoal(id, patch, isProps) {
  const g = state.goal_open && state.goal_open.goal;
  if (g && g.id === id) { if (isProps) { g.props = g.props || {}; Object.assign(g.props, patch); } else Object.assign(g, patch); }
  const inList = state.goals.find((x) => x.id === id);
  if (inList) { if (isProps) { inList.props = inList.props || {}; Object.assign(inList.props, patch); } else Object.assign(inList, patch); }
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify(isProps ? { props: patch } : patch) }); } catch (e) { toast(e.message); }
}
async function delGoal(id) {
  if (!(await uiConfirm('Delete this goal?', { danger: true, okLabel: 'Delete' }))) return;
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
  state.goals = state.goals.filter((x) => x.id !== id); toast('Goal deleted'); openGoals('goals');
}
function toggleGoalFocus(id) { const g = state.goal_open && state.goal_open.goal; patchGoal(id, { focus: !gp(g).focus }, true).then(renderGoalCard); }
function goalMs() { const g = state.goal_open.goal; g.props = g.props || {}; if (!Array.isArray(g.props.milestones)) g.props.milestones = []; return g.props.milestones; }
function saveMs() { const g = state.goal_open.goal; patchGoal(g.id, { milestones: goalMs() }, true); }
function msAdd() { goalMs().push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: '', done: false }); saveMs(); renderGoalCard(); setTimeout(() => { const els = document.querySelectorAll('[data-ms-text]'); if (els.length) els[els.length - 1].focus(); }, 0); }
function msToggle(mid) { const m = goalMs().find((x) => x.id === mid); if (m) { m.done = !m.done; saveMs(); renderGoalCard(); } }
function msDel(mid) { const g = state.goal_open.goal; g.props.milestones = goalMs().filter((x) => x.id !== mid); saveMs(); renderGoalCard(); }
function msText(mid, v) { const m = goalMs().find((x) => x.id === mid); if (m) { m.text = v; saveMs(); } }
// A goal's task = a real task (kind='task') tagged to the goal (and a milestone).
// It shows here AND in Tasks/Today - the same task, in context, never a copy.
const goalTaskRow = (t) => `<div class="ga-row ${t.props.done ? 'done' : ''}"><button class="check" data-check="${t.id}">✓</button><span class="ga-t" data-open-task="${t.id}">${esc(t.title)}</span></div>`;
async function addGoalTask(goalId, milestoneId) {
  const title = await uiPrompt('Task for this ' + (milestoneId ? 'milestone' : 'goal') + ':', { placeholder: 'e.g. Draft the opening section' }); if (!title) return;
  const g = state.goal_open.goal;
  const t = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title, props: { area: gp(g).area || null, priority: null, done: false, goal: goalId, milestone: milestoneId || null } }) });
  state.goal_open.tasks.push(t); renderGoalCard();
}
// bucket list
function bucketBody() {
  const byArea = {};
  state.bucket.forEach((b) => { const k = (b.props && b.props.area) || '_'; (byArea[k] = byArea[k] || []).push(b); });
  const order = Object.keys(byArea).sort((x, y) => (x === '_' ? 1 : y === '_' ? -1 : (areaById(x) || {}).title?.localeCompare((areaById(y) || {}).title || '') || 0));
  const groups = order.map((k) => { const a = areaById(k); return `<div class="goal-group"><div class="goal-group-h">${a ? esc(a.title) : 'Unfiled'}</div><div class="bucket-grid">${byArea[k].map(bucketCard).join('')}</div></div>`; }).join('');
  return `<div class="goals-actions"><button class="add-btn wide" data-new-bucket>+ Add to bucket list</button></div>${groups || '<div class="empty" style="padding:40px">Your bucket list is empty. What do you want to do before you die?</div>'}`;
}
function bucketCard(b) {
  const p = b.props || {}; const a = areaById(p.area);
  return `<button class="bucket-card ${p.status === 'done' ? 'done' : ''}" data-open-bucket="${b.id}" style="--h:${hueOf(a)}"><span class="bk-check">${p.status === 'done' ? '✓' : ''}</span><span class="bk-body"><span class="bk-title">${esc(b.title || 'Untitled')}</span>${(a || p.targetYear) ? `<span class="bk-meta">${a ? esc(a.title) : ''}${p.targetYear ? `${a ? ' · ' : ''}by ${esc(p.targetYear)}` : ''}</span>` : ''}</span></button>`;
}
async function newBucket() {
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'bucket', title: '', props: { area: null, status: 'someday' } }) });
  state.bucket.push(b); openBucketCard(b.id);
}
async function openBucketCard(id) { const b = await api(`/api/blocks/${id}`); state.bucket_open = { item: b }; state.view = { type: 'bucketcard', id }; renderNav(); renderBucketCard(); }
function renderBucketCard() {
  const b = state.bucket_open.item; const p = b.props || {};
  const areaOpts = `<option value="">No area</option>` + state.areas.map((x) => `<option value="${x.id}" ${p.area === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
  migrateCards(b);
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-bucketlist>Bucket list</button><span class="crumb-sep">›</span><span class="crumb cur">${esc(b.title || 'Bucket list')}</span>
      <span class="crumb-tools"><button class="ghost" data-bucket-to-goal="${b.id}" title="Turn this into a goal you're actively working towards">🎯 Make a goal</button><button class="note-del ghost" data-del-bucket="${b.id}">Delete</button></span></div>
    <div class="task-focus">
      <button class="bk-done-btn ${p.status === 'done' ? 'on' : ''}" data-bucket-done="${b.id}" title="Mark as done">${p.status === 'done' ? '✓' : '○'}</button>
      <textarea class="note-title" id="bucketcard-title" rows="1" placeholder="Something to do before you die…">${esc(b.title || '')}</textarea>
    </div>
    <div class="tf-meta">
      <div class="tf-field"><span class="tf-label">Life areas</span>${blockAreasControl('bucket', b)}</div>
      <label class="tf-field"><span class="tf-label">Stage</span><select class="sel" id="bucketcard-status">${BSTATUS.map(([v, l]) => `<option value="${v}" ${(p.status || 'someday') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="tf-field"><span class="tf-label">Target year</span><input class="sel" id="bucketcard-year" value="${esc(p.targetYear || '')}" placeholder="e.g. 2030"></label>
    </div>
    ${notesSection(b.body, 'bucket', b.id)}
    ${attachSection(b)}`;
  autoGrowSoon($('#bucketcard-title')); loadThumbs();
}
async function patchBucket(id, patch, isProps) {
  const b = state.bucket_open && state.bucket_open.item;
  if (b && b.id === id) { if (isProps) { b.props = b.props || {}; Object.assign(b.props, patch); } else Object.assign(b, patch); }
  const inList = state.bucket.find((x) => x.id === id); if (inList) { if (isProps) { inList.props = inList.props || {}; Object.assign(inList.props, patch); } else Object.assign(inList, patch); }
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify(isProps ? { props: patch } : patch) }); } catch (e) { toast(e.message); }
}
async function delBucket(id) {
  if (!(await uiConfirm('Remove from your bucket list?', { danger: true, okLabel: 'Remove' }))) return;
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
  state.bucket = state.bucket.filter((x) => x.id !== id); toast('Removed'); openGoals('bucket');
}
function bucketToggleDone(id) { const b = state.bucket_open.item; const done = (b.props || {}).status === 'done'; patchBucket(id, { status: done ? 'someday' : 'done', doneDate: done ? null : new Date().toISOString().slice(0, 10) }, true).then(renderBucketCard); }
// Promote a bucket-list dream into an actively-pursued goal. The bucket item
// stays (the dream), and the new goal links back to it (props.fromBucket); a
// long-term horizon fits a lifetime ambition. Opens the fresh goal to shape it.
async function bucketToGoal() {
  const b = state.bucket_open && state.bucket_open.item; if (!b) return;
  const p = b.props || {};
  const props = { area: p.area || null, why: '', horizon: 'longterm', gtype: '', status: 'active', focus: false, milestones: [], fromBucket: b.id };
  try {
    const goal = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'goal', title: b.title || 'New goal', props }) });
    if (state.goals) state.goals.push(goal);
    toast('🎯 Goal created from this bucket item');
    openGoalCard(goal.id);
  } catch (e) { toast(e.message); }
}

// ── reviews & Wheel of Life ──────────────────────────
// A review (kind='review') opens with a mirror of the period drawn from your
// own data (ticked tasks, kept practices, undone P1s, quiet areas), a Wheel of
// Life pulse per area, and guided writing. Deeper reviews widen the window.
const REVIEWS = {
  weekly: { label: 'Weekly', sub: 'The glance', days: 7, prompts: ['A win or two from this week', 'What did I neglect?', 'The one thing to carry into next week'] },
  monthly: { label: 'Monthly', sub: 'The check-in', days: 30, prompts: ['What actually moved this month?', 'Is each goal still the right one?', 'What needs re-prioritising or letting go?'] },
  quarterly: { label: 'Quarterly', sub: 'The cycle', days: 91, prompts: ['Score each goal — what worked, what got in the way?', 'What did I learn about myself?', "Next quarter's one-to-three goals"] },
  yearly: { label: 'Yearly', sub: 'The wide view', days: 365, prompts: ['The year across every area — the highs and the lows', 'What am I most proud of?', 'What do I want next year to be about?', 'Anything to add to the bucket list?'] },
};
const RTYPE_ORDER = ['weekly', 'monthly', 'quarterly', 'yearly'];
function localISO(d) { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function reviewPeriod(rtype) { const days = (REVIEWS[rtype] || REVIEWS.weekly).days; return { from: localISO(new Date(Date.now() - (days - 1) * 86400000)), to: localISO() }; }
function reviewTaskStats(from) {
  const fromT = new Date(from + 'T00:00:00').getTime();
  const done = state.tasks.filter((t) => t.props && t.props.done && t.updated_at && new Date(t.updated_at).getTime() >= fromT);
  const openP1 = state.tasks.filter((t) => t.props && !t.props.done && t.props.priority === 'P1');
  const activeAreas = new Set(done.map((t) => t.props.area).filter(Boolean));
  const quiet = state.areas.filter((a) => !activeAreas.has(a.id));
  return { done, openP1, quiet };
}
function reviewsBody() {
  const starts = RTYPE_ORDER.map((k, i) => `<button class="rv-start" data-start-review="${k}"><span class="rv-depth" data-d="${i + 1}"><i></i><i></i><i></i><i></i></span><span class="rv-start-l">${REVIEWS[k].label}</span><span class="rv-start-s">${REVIEWS[k].sub}</span></button>`).join('');
  const past = state.reviews.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const list = past.map((r) => { const p = r.props || {}; const wv = wheelAvg(p.wheel); return `<button class="rv-row" data-open-review="${r.id}"><span class="rv-row-l"><b>${esc((REVIEWS[p.rtype] || {}).label || 'Review')}</b> · ${esc(dpLabel(p.to || localISO(new Date(r.created_at))))}</span><span class="rv-row-m">${p.tasksDone != null ? `${p.tasksDone} done` : ''}${wv ? ` · wheel ${wv}` : ''}</span></button>`; }).join('');
  return `<div class="rv-starts">${starts}</div>${reviewRemindersHtml()}${past.length ? `<section class="home-sec"><div class="home-sec-h">Past reviews</div><div class="rv-list">${list}</div></section>` : '<div class="empty" style="padding:30px">No reviews yet. Start with a weekly — it takes ten minutes.</div>'}`;
}
const REM_REPEATS = [['once', 'Once'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
function fmtReminder(at) { try { const d = new Date(at); return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return at; } }
function reviewRemindersHtml() {
  const rem = (state.reviewReminders || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const list = rem.map((r) => `<div class="rv-rem"><span class="rv-rem-t">⏰ <b>${esc((REVIEWS[r.rtype] || {}).label || 'Review')}</b> · ${esc(fmtReminder(r.at))}${r.repeat && r.repeat !== 'once' ? ` · repeats ${esc(r.repeat)}` : ''}</span><button class="rv-rem-x" data-rem-del="${esc(r.id)}" title="Remove reminder">×</button></div>`).join('');
  const notifOff = (typeof Notification !== 'undefined' && Notification.permission !== 'granted');
  return `<section class="home-sec"><div class="home-sec-h">⏰ Reminders</div>
    ${list ? `<div class="rv-rems">${list}</div>` : ''}
    <form class="rv-rem-add" id="rv-rem-form">
      <select class="sel" name="rtype">${RTYPE_ORDER.map((k) => `<option value="${k}">${REVIEWS[k].label}</option>`).join('')}</select>
      <input class="sel" type="date" name="date" required>
      <input class="sel" type="time" name="time" value="09:00" required>
      <select class="sel" name="repeat">${REM_REPEATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button class="add-btn wide" type="submit">Add reminder</button>
    </form>
    ${notifOff ? '<div class="rv-rem-note">Turn on notifications so a reminder can reach you: <button class="ghost" data-push-enable>Enable notifications</button></div>' : ''}
  </section>`;
}
async function saveReviewReminders() {
  try { await api('/api/review-reminders', { method: 'PUT', body: JSON.stringify({ reminders: state.reviewReminders || [] }) }); } catch (e) { toast(e.message); }
}
function addReviewReminder(form) {
  const g = (n) => (form.querySelector(`[name="${n}"]`) || {}).value || '';
  const date = g('date'), time = g('time') || '09:00';
  if (!date) { toast('Pick a date'); return; }
  state.reviewReminders = state.reviewReminders || [];
  state.reviewReminders.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rtype: g('rtype') || 'weekly', at: `${date}T${time}`, repeat: g('repeat') || 'once' });
  saveReviewReminders(); renderGoals(); toast('Reminder set');
}
function delReviewReminder(id) {
  state.reviewReminders = (state.reviewReminders || []).filter((r) => r.id !== id);
  saveReviewReminders(); renderGoals();
}
const wheelAvg = (w) => { const v = Object.values(w || {}).map(Number).filter((n) => n > 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : 0; };
async function startReview(rtype) {
  const { from, to } = reviewPeriod(rtype);
  const [tasks, mir] = await Promise.all([api('/api/blocks?kind=task'), api(`/api/review-mirror?from=${from}&to=${to}`).catch(() => ({ practices: [], total: 0 }))]);
  state.tasks = notKit(tasks);
  const s = reviewTaskStats(from);
  const snapshot = state.goals.filter((g) => (gp(g).status || 'active') === 'active').map((g) => ({ id: g.id, title: g.title, area: gp(g).area, measure: goalMeasure(g), progress: Math.round(goalProgress(g) * 100) }));
  const lastWheel = state.reviews.map((r) => r.props && r.props.wheel).reverse().find((w) => w && Object.keys(w).length) || {};
  const mirror = {
    practices: mir.practices || [],
    tasksDone: s.done.slice(0, 60).map((t) => ({ title: t.title, area: t.props.area })),
    openP1: s.openP1.slice(0, 60).map((t) => ({ title: t.title, area: t.props.area })),
    quietAreas: s.quiet.map((a) => a.id),
  };
  const props = { rtype, from, to, wheel: { ...lastWheel }, snapshot, mirror, tasksDone: s.done.length, openP1: s.openP1.length };
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'review', title: `${REVIEWS[rtype].label} review · ${dpLabel(to)}`, props }) });
  state.reviews.push(b); openReviewCard(b.id);
}
async function openReviewCard(id) { const r = await api(`/api/blocks/${id}`); state.review_open = { review: r }; state.view = { type: 'reviewcard', id }; renderNav(); renderReviewCard(); }
function renderReviewCard() {
  const r = state.review_open.review; const p = r.props || {}; const cfg = REVIEWS[p.rtype] || REVIEWS.weekly; const m = p.mirror || {};
  const areaName = (id) => { const a = areaById(id); return a ? a.title : 'No area'; };
  const pill = (label, n, cls) => `<span class="rv-stat ${cls || ''}"><b>${n}</b> ${label}</span>`;
  const practiceStr = (m.practices || []).map((x) => `${esc(x.title)}${x.count > 1 ? ` ×${x.count}` : ''}`).join(' · ');
  const quiet = (m.quietAreas || []).map(areaName);
  const wheel = state.areas.map((a) => {
    const sc = (p.wheel || {})[a.id] || 0;
    const pips = Array.from({ length: 10 }, (_, i) => `<button class="wp ${i < sc ? 'on' : ''}" data-wheel="${a.id}:${i + 1}" style="--h:${hueOf(a)}"></button>`).join('');
    return `<div class="wheel-row"><span class="wheel-a">${esc(a.title)}</span><span class="wheel-pips">${pips}</span><span class="wheel-v">${sc || '–'}</span></div>`;
  }).join('');
  const snap = (p.snapshot || []).map((g) => `<div class="rv-snap"><span class="rv-snap-t">${esc(g.title)}</span><span class="rv-snap-m">${esc(g.measure || '')}${g.progress != null ? ` · ${g.progress}%` : ''}</span></div>`).join('');
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-reviews>Reviews</button><span class="crumb-sep">›</span><span class="crumb cur">${esc(cfg.label)} review</span>
      <span class="crumb-tools"><button class="note-del ghost" data-del-review="${r.id}">Delete</button></span></div>
    <div class="pane-head"><h1>${esc(cfg.label)} review</h1></div>
    <div class="rv-period">${esc(cfg.sub)} · ${esc(dpLabel(p.from))} – ${esc(dpLabel(p.to))}</div>

    <section class="rv-mirror">
      <div class="home-sec-h">Your ${p.rtype === 'weekly' ? 'week' : 'period'}, from the record</div>
      <div class="rv-stats">
        ${pill('ticked off', (m.tasksDone || []).length, 'good')}
        ${pill('P1 still open', (m.openP1 || []).length, (m.openP1 || []).length ? 'warn' : '')}
        ${pill('practices kept', (m.practices || []).reduce((a, x) => a + x.count, 0), 'good')}
        ${pill('quiet areas', quiet.length, quiet.length ? 'warn' : '')}
      </div>
      ${practiceStr ? `<div class="rv-line"><span class="rv-line-k">Practices</span> ${esc(practiceStr)}</div>` : ''}
      ${quiet.length ? `<div class="rv-line"><span class="rv-line-k">Went quiet</span> ${quiet.map(esc).join(', ')}</div>` : ''}
      ${(m.openP1 || []).length ? `<details class="rv-det"><summary>P1s still open · ${(m.openP1 || []).length}</summary><ul>${(m.openP1 || []).map((t) => `<li>${esc(t.title)}</li>`).join('')}</ul></details>` : ''}
      ${(m.tasksDone || []).length ? `<details class="rv-det"><summary>Ticked off · ${(m.tasksDone || []).length}</summary><ul>${(m.tasksDone || []).map((t) => `<li>${esc(t.title)}</li>`).join('')}</ul></details>` : ''}
    </section>

    <section class="wheel">
      <div class="home-sec-h">Wheel of Life <span class="wheel-avg">${wheelAvg(p.wheel) ? `avg ${wheelAvg(p.wheel)}/10` : ''}</span></div>
      <div class="wheel-rows">${wheel || '<div class="muted">Add some Life Areas to rate them here.</div>'}</div>
    </section>

    ${snap ? `<section class="rv-snapshot"><div class="home-sec-h">Goals, snapshotted</div>${snap}</section>` : ''}

    <section class="rv-prompts">
      <div class="home-sec-h">Reflect</div>
      <ul class="rv-prompt-list">${cfg.prompts.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
      ${notesSection(r.body, 'review', r.id)}
    </section>`;
}
async function patchReview(id, patch, isProps) {
  const r = state.review_open && state.review_open.review;
  if (r && r.id === id) { if (isProps) { r.props = r.props || {}; Object.assign(r.props, patch); } else Object.assign(r, patch); }
  const inList = state.reviews.find((x) => x.id === id); if (inList) { if (isProps) { inList.props = inList.props || {}; Object.assign(inList.props, patch); } else Object.assign(inList, patch); }
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify(isProps ? { props: patch } : patch) }); } catch (e) { toast(e.message); }
}
async function delReview(id) {
  if (!(await uiConfirm('Delete this review?', { danger: true, okLabel: 'Delete' }))) return;
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
  state.reviews = state.reviews.filter((x) => x.id !== id); toast('Review deleted'); openGoals('reviews');
}
function setWheel(areaId, score) {
  const r = state.review_open.review; const w = { ...(r.props.wheel || {}) };
  w[areaId] = w[areaId] === score ? 0 : score;   // tap the same pip to clear
  patchReview(r.id, { wheel: w }, true).then(renderReviewCard);
}

// ── vision board ─────────────────────────────────────
// A written vision + images per Life Area (stored on the area block: props.vision
// + its attachments), and a whole-life 'wall' gathering every vision image and
// the bucket-list moments you've lived.
function visionBody() {
  const cards = state.areas.map((a) => {
    const p = a.props || {}; const imgs = (p.attachments || []).filter((x) => isImgType(x.type)).slice(0, 4);
    return `<button class="vision-card" data-open-vision="${a.id}" style="--h:${hueOf(a)}">
      <div class="vc-head"><span class="vc-dot"></span><span class="vc-title">${esc(a.title)}</span></div>
      ${(p.vision || '').trim() ? `<div class="vc-text">${esc(p.vision)}</div>` : '<div class="vc-empty">Picture this area at its best…</div>'}
      ${imgs.length ? `<div class="vc-thumbs">${imgs.map((im) => `<img data-vimg="${a.id}:${im.id}" alt="">`).join('')}</div>` : ''}
    </button>`;
  }).join('');
  return `<div class="vision-grid">${cards || '<div class="empty" style="padding:30px">Add Life Areas to build your vision.</div>'}</div>`;
}
async function loadVisionThumbs() {
  for (const a of state.areas) for (const im of ((a.props && a.props.attachments) || [])) {
    if (!isImgType(im.type)) continue;
    const el = document.querySelector(`img[data-vimg="${a.id}:${im.id}"]`);
    if (!el || el.dataset.loaded) continue;
    try { el.src = await attUrl(a.id, im); el.dataset.loaded = '1'; } catch {}
  }
}
async function openVisionCard(id) { const a = await api(`/api/blocks/${id}`); state.vision_open = { area: a }; state.view = { type: 'visioncard', id }; renderNav(); renderVisionCard(); }
function renderVisionCard() {
  const a = state.vision_open.area; const p = a.props || {};
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-vision-tab>Vision</button><span class="crumb-sep">›</span><span class="crumb cur">${esc(a.title)}</span></div>
    <div class="task-focus" style="--h:${hueOf(a)}"><span class="vc-dot big"></span><h1 class="vision-h1">${esc(a.title)}</h1></div>
    <label class="tf-field goal-why"><span class="tf-label">Your vision for this area</span><textarea class="sel" id="visioncard-text" rows="4" placeholder="Picture this part of your life at its best — write it in the present tense…">${esc(p.vision || '')}</textarea></label>
    ${attachSection(a)}`;
  loadThumbs();
}
async function openVisionWall() {
  const [areas, bucket] = await Promise.all([api('/api/blocks?kind=area'), api('/api/blocks?kind=bucket')]);
  state.areas = areas.sort((x, y) => (x.title || '').localeCompare(y.title || '')); state.bucket = bucket;
  state.view = { type: 'visionwall' };
  renderNav(); renderVisionWall();
}
function renderVisionWall() {
  const tiles = [];
  state.areas.forEach((a) => ((a.props && a.props.attachments) || []).forEach((im) => { if (isImgType(im.type)) tiles.push({ block: a.id, att: im, hue: hueOf(a), cap: a.title }); }));
  (state.bucket || []).forEach((b) => { const p = b.props || {}; if (p.status === 'done') (p.attachments || []).forEach((im) => { if (isImgType(im.type)) tiles.push({ block: b.id, att: im, hue: hueOf(areaById(p.area)), cap: b.title, lived: true }); }); });
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-open-vision-tab>Vision</button><span class="crumb-sep">›</span><span class="crumb cur">The wall</span></div>
    <div class="pane-head"><h1>The wall</h1></div>
    <p class="rv-period">The life you're reaching for — and the moments you've lived.</p>
    ${tiles.length ? `<div class="wall-grid">${tiles.map((x) => `<figure class="wall-tile ${x.lived ? 'lived' : ''}" style="--h:${x.hue}"><img data-wimg="${x.block}:${x.att.id}" alt=""><figcaption>${x.lived ? '✓ ' : ''}${esc(x.cap)}</figcaption></figure>`).join('')}</div>` : '<div class="empty" style="padding:50px">Add images to your areas’ visions and to bucket-list moments you’ve lived — they gather here on one wall.</div>'}`;
  loadWallThumbs(tiles);
}
async function loadWallThumbs(tiles) { for (const x of tiles) { const el = document.querySelector(`img[data-wimg="${x.block}:${x.att.id}"]`); if (!el || el.dataset.loaded) continue; try { el.src = await attUrl(x.block, x.att); el.dataset.loaded = '1'; } catch {} } }
function patchVisionText(id, text) {
  const a = state.vision_open && state.vision_open.area; if (a && a.id === id) { a.props = a.props || {}; a.props.vision = text; }
  const inList = state.areas.find((x) => x.id === id); if (inList) { inList.props = inList.props || {}; inList.props.vision = text; }
  api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { vision: text } }) }).catch((e) => toast(e.message));
}

// ── view: note ───────────────────────────────────────
// Title fields are textareas so a long title wraps instead of cropping; grow
// them to fit their content. Measuring right after innerHTML can catch a
// pre-layout width (wrapping one line into many), so size on the next frame.
function autoGrow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
function autoGrowSoon(el) { if (!el) return; requestAnimationFrame(() => autoGrow(el)); }
// Tasks linked to a note: the associated tasks, plus a search to link an
// existing one and a button to make a new one. A task carries props.note.
function noteTasksHtml(noteId) {
  const all = state.allTasks || [];
  const linked = all.filter((t) => t.props && t.props.note === noteId && !t.props.done);
  const q = ((state.note && state.note.taskQuery) || '').trim().toLowerCase();
  const results = q ? all.filter((t) => t.props && t.props.note !== noteId && !t.props.done && (t.title || '').toLowerCase().includes(q)).slice(0, 6) : [];
  return `<div class="note-tasks"><div class="sub-h">Tasks</div>
    <div class="nt-linked">${linked.map((t) => `<div class="nt-row"><span class="nt-dot"></span><span class="ga-t" data-open-task="${t.id}">${esc(t.title || 'Untitled')}</span><button class="ghost nt-unlink" data-note-task-unlink="${t.id}" title="Unlink">×</button></div>`).join('') || '<div class="home-empty" style="padding:6px 0 2px">No tasks linked yet.</div>'}</div>
    <input class="sel nt-search" data-note-task-q placeholder="Search a task to link…" value="${esc((state.note && state.note.taskQuery) || '')}">
    ${results.length ? `<div class="nt-results">${results.map((t) => `<button class="nt-result" data-note-task-link="${t.id}"><span class="ga-t">${esc(t.title || 'Untitled')}</span><span class="nt-link-ic">＋ Link</span></button>`).join('')}</div>` : ''}
    <button class="ghost nt-new" data-note-new-task>+ New task for this note</button></div>`;
}
function renderNoteTasks() { const el = document.querySelector('.note-tasks'); if (el && state.note) el.outerHTML = noteTasksHtml(state.note.current.id); }
async function linkTaskToNote(taskId, noteId) {
  const noteTitle = (state.note && state.note.current && state.note.current.title) || '';
  const t = (state.allTasks || []).find((x) => x.id === taskId); if (t) { t.props = t.props || {}; t.props.note = noteId; t.props.noteTitle = noteTitle; }
  if (state.note) state.note.taskQuery = '';
  renderNoteTasks();
  try { await api(`/api/blocks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ props: { note: noteId, noteTitle } }) }); toast('Task linked'); } catch (e) { toast(e.message); }
}
async function unlinkTaskFromNote(taskId) {
  const t = (state.allTasks || []).find((x) => x.id === taskId); if (t && t.props) t.props.note = null;
  renderNoteTasks();
  try { await api(`/api/blocks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ props: { note: null } }) }); } catch (e) { toast(e.message); }
}
async function newNoteTask(noteId) {
  const title = await uiPrompt('New task for this note:', { placeholder: 'e.g. Follow up on…' }); if (!title) return;
  const note = state.note && state.note.current;
  const area = (note && note.props && note.props.area) || null;
  const noteTitle = (note && note.title) || '';
  try {
    const t = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title, props: { area, priority: null, done: false, note: noteId, noteTitle } }) });
    state.allTasks = state.allTasks || []; state.allTasks.push(t); renderNoteTasks();
  } catch (e) { toast(e.message); }
}
// Related notes: other notes that share any life area with the one you're
// viewing. Collapsed by default; nothing at all if this note has no life area.
// Up to 12, with a link through to the first shared area.
function relatedNotesHtml(note) {
  const areas = blockAreas(note); if (!areas.length) return '';
  const list = (state.noteTops || []).filter((x) => x.id !== note.id && blockAreas(x).some((id) => areas.includes(id)));
  if (!list.length) return '';
  const a = areaById(areas[0]);
  const open = localStorage.getItem('life.note.relatedOpen') === '1';
  const shown = list.slice(0, 12);
  return `<div class="note-related"><div class="sub-h note-related-h" data-related-toggle><span class="hs-chev">${open ? '▾' : '▸'}</span>Related notes<span class="muted"> · ${list.length}</span></div>
    ${open ? `<div class="star-grid">${shown.map((f) => `<button class="star-note" data-open-note="${f.id}"><span class="sn-ic">${NOTE_ICO}</span><span class="sp-t">${esc(f.title || 'Untitled')}</span></button>`).join('')}</div>${list.length > 12 && a ? `<button class="rel-more" data-open-area="${a.id}">See all ${list.length} in ${esc(a.title)} →</button>` : ''}` : ''}</div>`;
}
// A Share button for an owned note/task; the count shows when it's already out.
function shareBtn(block, kind) {
  if (block.sharedBy) return '';   // a borrowed block: only its owner can share it
  const n = block.sharedWith || 0;
  return `<button class="note-share ghost ${n ? 'on' : ''}" data-share-open="${block.id}" data-share-kind="${kind}" data-share-title="${esc(block.title || '')}" title="Share with a friend">🤝 Share${n ? ` · ${n}` : ''}</button>`;
}
// A banner on a block someone shared with me, noting who and whether I can edit.
function sharedBanner(block) {
  if (!block.sharedBy) return '';
  return `<div class="shared-banner">🤝 Shared with you by <b>${esc(block.sharedBy)}</b>${block.canEdit ? '' : ' · view only'}</div>`;
}
function renderNote() {
  const n = state.note.current;
  migrateCards(n);
  const sep = '<span class="crumb-sep">›</span>';
  const crumbs = state.note.path.map((a, i) => i === state.note.path.length - 1
    ? `<span class="crumb cur">${esc(a.title || 'Untitled')}</span>`
    : `<button class="crumb" data-open-note="${a.id}">${esc(a.title || 'Untitled')}</button>`).join(sep);
  const kids = state.note.children.map((c) => { const isT = isTableNote(c); return `<button class="subpage" data-open-${isT ? 'table' : 'note'}="${c.id}" draggable="true" data-sub-id="${c.id}"><span class="sp-grip" title="Drag to reorder">⠿</span><span class="sp-ico">${isT ? TBL_ICO : NOTE_ICO}</span><span class="sp-t">${esc(c.title || 'Untitled')}</span></button>`; }).join('');
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button>${sep}<button class="crumb" data-open-notes>Notes</button>${sep}${crumbs}
      <span class="crumb-tools">${noteAreasControl(n)}
      <button class="star ${n.props && n.props.fav ? 'on' : ''}" data-fav="${n.id}" title="Favourite">${n.props && n.props.fav ? '★' : '☆'}</button>
      ${noteTypeToggle(n.id, 'note')}
      ${shareBtn(n, 'note')}
      ${n.sharedBy ? '' : `<button class="note-move ghost" data-move-note title="Move this note inside another">Move</button>
      <button class="note-del ghost" data-del-note title="Delete this note">Delete</button>`}</span></div>
    <div class="note-layout">
      <div class="note-main">
        ${sharedBanner(n)}
        <textarea class="note-title" id="note-title" rows="1" placeholder="Untitled" ${n.sharedBy && !n.canEdit ? 'readonly' : ''}>${esc(n.title || '')}</textarea>
        <div class="note-body">${proseEditor(n.body, 'note', n.id, n.sharedBy && !n.canEdit)}</div>
        ${embedsHtml(n.body)}
      </div>
      <aside class="note-side">
        <div class="subpages" data-subpages><div class="sub-h">Notes inside${state.note.children.length ? ` · ${state.note.children.length}` : ''}</div>
          ${kids}<button class="subpage add" data-new-sub><span class="sp-ico">+</span><span class="sp-t">New note inside</span></button></div>
        ${noteTasksHtml(n.id)}
        ${relatedNotesHtml(n)}
      </aside>
      <div class="note-attach">${attachSection(n)}</div>
    </div>`;
  autoGrowSoon($('#note-title')); loadThumbs(); hydrateEmbeds(); setupFolds();
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
const TYPES = [['text', 'Text'], ['url', 'URL'], ['number', 'Number'], ['currency', 'Currency'], ['date', 'Date'], ['checkbox', 'Tick box'], ['select', 'Select'], ['area', 'Life area'], ['attach', 'Attachments']];
// The currency symbols a Currency column can carry (blank = a plain number with
// two decimals). Stored on the column as `col.currency`.
const CURRENCIES = [['€', '€ Euro'], ['$', '$ Dollar'], ['£', '£ Pound'], ['', 'No symbol']];
const curSym = (col) => (col && typeof col.currency === 'string') ? col.currency : '';
const fmtMoney = (v) => (v === '' || v == null || isNaN(Number(v))) ? '' : Number(v).toFixed(2);
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
  // Currency: a plain number shown to two decimals, with an optional symbol. The
  // change handler parses what's typed back to a number and reformats on blur.
  if (col.type === 'currency') { const sym = curSym(col); return `<span class="cell-cur">${sym ? `<span class="cur-sym">${esc(sym)}</span>` : ''}<input type="text" class="cell cur-in" data-cell="${k}" inputmode="decimal" value="${esc(fmtMoney(v))}"></span>`; }
  if (col.type === 'date') return `<input type="date" class="cell" data-cell="${k}" value="${esc(v ?? '')}">`;
  if (col.type === 'select') return `<select class="cell" data-cell="${k}"><option value=""></option>${(col.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  // Life area: a select whose options are the live Life Areas. Stores the area
  // id, shows its name; new areas appear automatically on the next render.
  if (col.type === 'area') return `<select class="cell cell-area" data-cell="${k}"><option value=""></option>${state.areas.map((a) => `<option value="${esc(a.id)}" ${a.id === v ? 'selected' : ''}>${esc(a.title || 'Untitled')}</option>`).join('')}</select>`;
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
    const norm = (v) => (col.type === 'number' || col.type === 'currency') ? Number(v) : col.type === 'checkbox' ? (v ? 1 : 0) : col.type === 'attach' ? (Array.isArray(v) ? v.length : 0) : col.type === 'date' ? String(v) : col.type === 'area' ? ((areaById(v) || {}).title || '').toLowerCase() : String(v).toLowerCase();
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
const DIR_LABELS = (type) => (type === 'number' || type === 'currency') ? ['1 → 9', '9 → 1'] : type === 'date' ? ['Old → New', 'New → Old'] : type === 'checkbox' ? ['Unticked first', 'Ticked first'] : ['A → Z', 'Z → A'];
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
  area: [['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['nempty', 'is not empty']],
  checkbox: [['checked', 'is checked'], ['unchecked', 'is unchecked']],
};
FILTER_OPS.currency = FILTER_OPS.number;   // currency filters numerically
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
    if (col.type === 'area') { const a = areaById(vals[col.id]); return !!a && (a.title || '').toLowerCase().includes(q); }
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
  const rows = visibleRows().map((r) => `<tr><td class="row-open" data-open-row="${r.id}" title="Open this row"><span class="ro-ic">⤢</span></td>${c.map((col) => `<td class="${col.type === 'checkbox' ? 'check' : (col.type === 'number' || col.type === 'currency') ? 'num' : ''}">${cellInput(r, col)}</td>`).join('')}<td class="row-del"><button data-del-row="${r.id}">×</button></td></tr>`).join('');
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
      else if (col.type === 'area') val = `<select class="sel fv" data-filt-val="${i}"><option value=""></option>${state.areas.map((a) => `<option value="${esc(a.id)}" ${a.id === f.value ? 'selected' : ''}>${esc(a.title || 'Untitled')}</option>`).join('')}</select>`;
      else val = `<input class="sel fv" data-filt-val="${i}" type="${(col.type === 'number' || col.type === 'currency') ? 'number' : col.type === 'date' ? 'date' : 'text'}" value="${esc(f.value || '')}" placeholder="value">`;
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
      $('#pane').innerHTML = `${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Notes', attr: 'data-open-notes' }, { label: t.title || 'table', attr: 'data-back-table' }, { label: title }], (r.props && r.props.area) || (t.props && t.props.area))}
        <div class="card">
        <h1 class="card-title">${esc(title)}</h1><div class="card-fields">${c.map((col) => `<label class="crow"><span class="clabel">${esc(col.name)}<em>${esc(col.type)}</em></span><span class="cval">${cellInput(r, col)}</span></label>`).join('')}</div>
        ${notesSection(r.body, 'row', r.id)}
        ${attachSection(r)}</div>`;
      loadThumbs(); hydrateEmbeds(); setupFolds();
      return;
    }
  }
  const vc = visibleCols();
  const colWidth = (col, first) => col.width || (first ? 230 : 170);
  // The trailing column holds the "+" (46px), or the add-column form while it's
  // open - which needs real room, or the form spills out past the table.
  const colgroup = `<colgroup><col style="width:46px">${vc.map((col, i) => `<col data-cw="${col.id}" style="width:${colWidth(col, i === 0)}px">`).join('')}<col style="width:${vw.addingCol ? 340 : 46}px"></colgroup>`;
  const addCol = vw.addingCol
    ? `<th class="th-add" style="text-align:left"><form class="colnew" id="colnew"><input id="cn-name" placeholder="Column" autocomplete="off"><select id="cn-type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="add-btn wide" type="submit">Add</button></form></th>`
    : `<th class="th-add"><button data-add-col title="Add column">+</button></th>`;
  const sortSpec = vw.sorts || [];
  const sortOf = (id) => { const i = sortSpec.findIndex((s) => s.colId === id); return i < 0 ? null : { dir: sortSpec[i].dir, badge: sortSpec.length > 1 ? i + 1 : '' }; };
  const head = vc.map((col) => { const sd = sortOf(col.id); return `<th><div class="thh"><button class="th-name" data-sort-col="${col.id}" title="Sort by ${esc(col.name)}">${esc(col.name)}${col.type === 'select' ? '<span class="th-type">select</span>' : col.type === 'area' ? '<span class="th-type">life area</span>' : col.type === 'currency' ? `<span class="th-type">${esc(curSym(col) || 'currency')}</span>` : ''}${sd ? `<span class="sarrow">${sd.dir === 'asc' ? '↑' : '↓'}${sd.badge ? `<b>${sd.badge}</b>` : ''}</span>` : ''}</button><button class="th-menu" data-col-menu="${col.id}" title="Column options — rename, type, options, sort, delete">▾</button></div><span class="resizer" data-resize="${col.id}"></span></th>`; }).join('');
  const nFilt = (vw.filters || []).length, nSort = sortSpec.length;
  $('#pane').innerHTML = `
    ${crumbNav([{ label: 'Home', attr: 'data-view-home' }, { label: 'Notes', attr: 'data-open-notes' }, { label: t.title || 'Untitled' }], t.props && t.props.area)}
    <div class="tbl-head"><input class="rename" value="${esc(t.title || '')}" data-rename ${t.sharedBy && !t.canEdit ? 'readonly' : ''}>
      ${noteTypeToggle(t.id, 'table')}
      ${blockAreasControl('table', t)}
      ${shareBtn(t, 'table')}
      <button class="star ${t.props && t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props && t.props.fav ? '★' : '☆'}</button>
      ${t.sharedBy ? '' : '<button class="ghost" data-del-cur>Delete</button>'}</div>
    ${sharedBanner(t)}
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
// iOS only raises the keyboard for a focus() that happens inside the tap that
// triggered it. Creating a note is async, so by the time the title exists the
// gesture is spent. Park focus on a throwaway input during the tap to summon the
// keyboard, then hand focus to the real title once it renders (font-size:16px
// keeps iOS from zooming). Returns the temp input to clean up, or null on desktop.
function primeMobileKeyboard() {
  if (!matchMedia('(pointer:coarse)').matches) return null;
  const tmp = document.createElement('input');
  tmp.type = 'text';
  tmp.setAttribute('aria-hidden', 'true');
  tmp.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;z-index:-1;';
  document.body.appendChild(tmp);
  tmp.focus();
  return tmp;
}
async function newNote(parentId) {
  const primer = primeMobileKeyboard();
  const note = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title: 'Untitled', body: '', parent_id: parentId || null }) });
  if (!parentId) { state.noteTops.push(note); }
  await openNote(note.id);
  const ti = $('#note-title');
  if (ti) { ti.focus(); ti.select(); }   // keyboard carries over from the primer
  if (primer) primer.remove();
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
  { kind: 'action', title: 'Keyboard shortcuts', run: () => openShortcuts() },
  { kind: 'action', title: 'New note', run: () => newNote(null) },
  { kind: 'action', title: 'New reflection', run: () => quickAdd('journal') },
  { kind: 'action', title: 'Go to Reflection', run: () => openJournal() },
  { kind: 'action', title: 'Settings', run: () => openSettings() },
  { kind: 'action', title: 'Change accent colour', run: () => openSettings() },
  { kind: 'action', title: 'Save a link', run: () => quickAdd('save') },
  { kind: 'action', title: 'Go to Read & Watch', run: () => openReadwatch() },
  { kind: 'action', title: 'New table', run: () => newTable() },
  { kind: 'action', title: 'Go to Tasks', run: () => openTasks() },
  { kind: 'action', title: 'Go to Calendar', run: () => openCalendar() },
  { kind: 'action', title: 'Go to Mail', run: () => openMail() },
  { kind: 'action', title: 'Go to Today', run: () => openToday() },
  { kind: 'action', title: 'Go to Contacts', run: () => openContacts() },
  { kind: 'action', title: 'New contact', run: () => quickAdd('contact') },
  { kind: 'action', title: 'Go to Goals', run: () => openGoals('goals') },
  { kind: 'action', title: 'Money · Portfolio', run: () => openFinancial('portfolio') },
  { kind: 'action', title: 'New goal', run: () => quickAdd('goal') },
  { kind: 'action', title: 'Bucket list', run: () => openGoals('bucket') },
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
  if (it.kind === 'contact') return openContactCard(it.id).catch((e) => toast(e.message));
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
  if (state.dp && e.key === 'Escape') { e.preventDefault(); closeDatePicker(); return; }
  if (state.contactMenu && e.key === 'Escape') { e.preventDefault(); state.contactMenu = null; renderContacts(); return; }
  if (state.linkpick) { if (e.key === 'Escape') { e.preventDefault(); closeLinkPicker(); return; } if (e.key === 'Enter' && e.target.id === 'linkpick-input') { e.preventDefault(); linkPickUrl(); return; } }
  if (state.shortcutsOpen && e.key === 'Escape') { e.preventDefault(); closeShortcuts(); return; }
  if (e.key === 'Enter' && e.target.id === 'adm-area-new') { e.preventDefault(); adminAreaAdd(); return; }
  if (e.key === 'Enter' && (e.target.id === 'timer-min' || e.target.id === 'timer-sec')) { e.preventDefault(); timerSetCustom(); return; }
  // Tab in the rich prose editor indents rather than leaving the field. In a
  // bullet/numbered list it nests the item (up to ~7 levels); Shift+Tab pulls it
  // back out; in plain free-writing it inserts an indent at the caret.
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const ed = e.target.closest && e.target.closest('.prose[contenteditable="true"]');
    if (ed) {
      e.preventDefault();
      const sel = window.getSelection();
      const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
      const li = node && node.closest ? node.closest('li') : null;
      if (li) {
        if (e.shiftKey) { document.execCommand('outdent'); }
        else {
          let depth = 0; for (let n = li; n && ed.contains(n); n = n.parentElement) if (n.tagName === 'UL' || n.tagName === 'OL') depth++;
          if (depth < 8) document.execCommand('indent');   // cap the nesting
        }
      } else if (!e.shiftKey) {
        document.execCommand('insertText', false, '    ');
      }
      ed.dispatchEvent(new Event('input', { bubbles: true }));   // trigger autosave
      return;
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); state.pal.open ? closePalette() : openPalette(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); state.shortcutsOpen ? closeShortcuts() : openShortcuts(); return; }
  // In a Brave installed web app (standalone PWA) there's no tab strip, so ⌘T
  // and ⌘N reach the page: ⌘T = new in-app tab, ⌘N = new note. ⌥ variants stay
  // as a fallback for any window that still reserves the plain keys. ⌘W closes
  // a tab only with ⌥ held, so the plain ⌘W keeps closing the app window.
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyT') { e.preventDefault(); newTab(); return; }
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyW') { e.preventDefault(); closeTab(state.activeTab); return; }
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyN') { e.preventDefault(); quickAdd('task'); return; }   // ⌥⌘N = new task
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyN') { e.preventDefault(); newNote(null).catch((x) => toast(x.message)); return; }
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
      const active = (m.open && m.open._key) || m.sel;   // reading wins, else the list cursor
      const triage = active || m.hoverThread;            // may be a whole collapsed thread
      if (e.key === '?') { e.preventDefault(); m.shortcuts = !m.shortcuts; renderMail(); return; }
      if (e.key === 'Escape') { e.preventDefault(); if (m.shortcuts) m.shortcuts = false; else m.open = null; renderMail(); return; }
      if (e.key === '/') { e.preventDefault(); const el = $('[data-mail-q]'); if (el) el.focus(); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); startCompose(); return; }
      // Robin's mapping: j steps back to the previous message, k forward to the
      // next. (The reverse of Gmail's j-down/k-up; his call, he's the only user.)
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); mailSelMove(-1); return; }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); mailSelMove(1); return; }
      // Enter / o: open the message under the mouse, or expand the thread under it, else open the j/k selection.
      if ((e.key === 'Enter' || e.key === 'o' || e.key === 'O') && !m.open) {
        if (m.hoverThread) { e.preventDefault(); m.expanded = m.expanded || {}; m.expanded[m.hoverThread] = !m.expanded[m.hoverThread]; renderMail(); return; }
        if (m.sel) { e.preventDefault(); openMessage(m.sel); return; }
      }
      if (active && (e.key === 'r' || e.key === 'R')) { if (m.open) { e.preventDefault(); mailReplyStart(false); } return; }
      if (active && (e.key === 'a' || e.key === 'A')) { if (m.open) { e.preventDefault(); mailReplyStart(true); } return; }
      if (active && (e.key === 'f' || e.key === 'F')) { if (m.open) { e.preventDefault(); mailForwardStart(); } return; }
      // Archive/Spam/Trash act on the whole conversation when the target is a thread.
      if (triage && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); mailMoveTo(triage, 'Archive', 'Archived'); return; }
      if (active && (e.key === 's' || e.key === 'S')) { e.preventDefault(); mailStar(active); return; }
      if (active && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); mailSeen(active, false); return; }
      if (triage && e.key === '!') { e.preventDefault(); mailMoveTo(triage, 'Junk', 'Marked as spam'); return; }
      if (triage && (e.key === 'Backspace' || e.key === 'Delete' || e.key === '#')) { e.preventDefault(); mailMoveTo(triage, 'Trash', 'Moved to Trash'); return; }
    }
  }
  if (state.move && e.key === 'Escape') { closeMove(); return; }
  if (!state.pal.open) return;
  if (e.key === 'Escape') { closePalette(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); state.pal.sel = Math.min(state.pal.items.length - 1, state.pal.sel + 1); renderPalItems(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); state.pal.sel = Math.max(0, state.pal.sel - 1); renderPalItems(); }
  if (e.key === 'Enter') { e.preventDefault(); execItem(state.pal.items[state.pal.sel]); }
});
document.addEventListener('pointerdown', (e) => { const h = e.target.closest && e.target.closest('[data-scan-corner]'); if (h) scanCornerDown(+h.dataset.scanCorner, e); });
// Never lose a half-written email: flush the draft the instant the app is
// backgrounded / hidden / closed (iOS suspends a web app without firing the
// debounce), as well as on the normal debounce while typing.
document.addEventListener('visibilitychange', () => { if (document.hidden && state.mail && state.mail.composing) saveDraft(); });
window.addEventListener('pagehide', () => { if (state.mail && state.mail.composing) saveDraft(); });
window.addEventListener('blur', () => { if (state.mail && state.mail.composing) saveDraft(); });
// ── markdown paste ───────────────────────────────────
// Paste Markdown text into any prose editor and it renders: headings, bold,
// italic, lists, links, code, blockquotes and tables. Only plain-text pastes
// that actually look like Markdown are converted; rich (HTML) pastes and
// ordinary text are left alone.
function mdInline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>').replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, txt, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
  return t;
}
const mdSplitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
const mdIsBlock = (l) => /^(#{1,3}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|```)/.test(l);
function mdPasteHtml(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^```/.test(line)) { i++; const buf = []; while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; } i++; out.push(`<p><code>${buf.join('<br>')}</code></p>`); continue; }
    if (/^>\s?/.test(line)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; } out.push(`<blockquote>${mdInline(buf.join(' '))}</blockquote>`); continue; }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      const header = mdSplitRow(line); i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(mdSplitRow(lines[i])); i++; }
      out.push(`<table><thead><tr>${header.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) { const buf = []; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; } out.push(`<ul>${buf.map((li) => `<li>${mdInline(li)}</li>`).join('')}</ul>`); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { const buf = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; } out.push(`<ol>${buf.map((li) => `<li>${mdInline(li)}</li>`).join('')}</ol>`); continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !mdIsBlock(lines[i])) { buf.push(lines[i]); i++; }
    out.push(`<p>${buf.map(mdInline).join('<br>')}</p>`);
  }
  return out.join('').replace(/<\/ul>\s*<ul>/g, '').replace(/<\/ol>\s*<ol>/g, '');   // merge adjacent lists
}
function looksMarkdown(t) {
  return /(^|\n)#{1,6}\s/.test(t) || /(^|\n)\s*[-*+]\s+\S/.test(t) || /(^|\n)\s*\d+\.\s+\S/.test(t) || /(^|\n)>\s/.test(t) || /\*\*[^*\n]+\*\*/.test(t) || /`[^`\n]+`/.test(t) || /\[[^\]\n]+\]\(https?:\/\//.test(t) || /(^|\n)\s*\|[^\n]*\|[^\n]*\n\s*\|?[\s:|-]*-/.test(t) || /(^|\n)```/.test(t);
}
// Auto-bullet: typing "- " at the very start of a line turns it into a bullet
// list, like a Markdown editor. Done on `input` (fires reliably on every phone
// and desktop keyboard, and outside the beforeinput dispatch where execCommand
// is inert), detecting the moment the line reads exactly "- ".
document.addEventListener('input', (e) => {
  const ed = e.target && e.target.closest && e.target.closest('.prose[contenteditable="true"]');
  if (!ed || ed.__autobullet) return;   // guard: our own execCommands re-fire input
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  let block = range.endContainer; if (block.nodeType === 3) block = block.parentElement;
  block = block && block.closest ? block.closest('p, div, h1, h2, h3, li') : null;
  if (!block || block === ed || !ed.contains(block) || block.tagName === 'LI') return;   // not already a bullet
  // The line so far (block start → caret) is exactly a hyphen and a space. A
  // contenteditable turns a trailing space into &nbsp; ( ), so match either.
  const pre = document.createRange(); pre.selectNodeContents(block); pre.setEnd(range.endContainer, range.endOffset);
  if (pre.toString().replace(/\u00a0/g, ' ') !== '- ') return;
  ed.__autobullet = true;
  const del = document.createRange(); del.selectNodeContents(block); del.setEnd(range.endContainer, range.endOffset);
  sel.removeAllRanges(); sel.addRange(del); document.execCommand('delete');   // drop the "- "
  document.execCommand('insertUnorderedList');                                // make it a bullet
  // execCommand can leave the new <ul> wrapped in the old empty <p>; lift it out.
  let n = window.getSelection().anchorNode;
  while (n && n !== ed && n.tagName !== 'UL' && n.tagName !== 'OL') n = n.parentElement;
  const par = n && n.parentElement;
  if (n && par && par.tagName === 'P' && par !== ed && par.childNodes.length === 1) par.replaceWith(n);
  ed.__autobullet = false;
});
// Keep the per-section indentation in step as headings and content are typed,
// pasted or deleted. Cheap (a handful of elements) and caret-safe - it only sets
// a left margin, never restructures the DOM.
document.addEventListener('input', (e) => {
  const ed = e.target && e.target.closest && e.target.closest('.prose[data-block-id][contenteditable="true"]');
  if (ed) applyProseIndent(ed);
});
document.addEventListener('paste', (e) => {
  const prose = e.target && e.target.closest && e.target.closest('.prose[contenteditable="true"]');
  if (!prose) return;
  const cd = e.clipboardData; if (!cd) return;
  // Paste is always driven off the plain-text copy. Markdown is converted to
  // rich HTML; anything else is inserted as plain text. We deliberately do NOT
  // fall through to the browser's default rich paste: that drops inline tags
  // like <strong>/&nbsp; into the body with no block wrapper, and bodyToHtml
  // (which only treats block-wrapped HTML as HTML) then re-renders them as
  // literal, escaped tag text on the next load. Plain text keeps the note clean.
  const text = cd.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  if (looksMarkdown(text)) document.execCommand('insertHTML', false, mdPasteHtml(text));
  else document.execCommand('insertText', false, text);
  prose.dispatchEvent(new Event('input', { bubbles: true }));   // trigger the debounced save
});
document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('note-title')) autoGrow(e.target);
  if (e.target.id === 'pal-input') { state.pal.q = e.target.value; buildPalette(); }
  if (e.target.id === 'friend-email') { clearTimeout(window.__frST); window.__frST = setTimeout(peopleSearch, 250); }
  if (e.target.id === 'move-input') { state.move.q = e.target.value; renderMoveList(); }
  if (e.target.id === 'linkpick-input' && state.linkpick) { state.linkpick.q = e.target.value; renderLinkPickerList(); }
  if (e.target.matches('[data-completed-q]')) { const pos = e.target.selectionStart; state.completedQuery = e.target.value; renderTasks(); const i = $('[data-completed-q]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch {} } }
  // Page search boxes (Tasks / Notes / Calendar): keep focus + caret across the re-render.
  const liveSearch = (sel, set, render) => { if (!e.target.matches(sel)) return; const pos = e.target.selectionStart; set(e.target.value); render(); const i = $(sel); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch {} } };
  liveSearch('[data-task-q]', (v) => (state.taskQuery = v), renderTasks);
  liveSearch('[data-contacts-q]', (v) => (state.contactsQuery = v), renderContacts);
  liveSearch('[data-notes-q]', (v) => (state.notesQuery = v), renderNotesList);
  liveSearch('[data-cal-q]', (v) => (state.calQuery = v), renderCalendar);
  // Table search + filter value inputs: only the tbody re-renders, so the input keeps focus.
  if (e.target.matches('[data-tbl-q]')) { state.tables_view.query = e.target.value; renderTableBody(); }
  if (e.target.matches('[data-gal-q]') && state.goal_open) { state.goal_open.areaQuery = e.target.value; renderGoalAreaList(); }
  if (e.target.matches('[data-pomo-target]')) { const v = e.target.value; pomo.target = v ? { kind: v.split(':')[0], id: v.split(':').slice(1).join(':'), label: e.target.selectedOptions[0].textContent } : null; savePomo(); }
  if (e.target.matches('[data-note-task-q]') && state.note) { const pos = e.target.selectionStart; state.note.taskQuery = e.target.value; renderNoteTasks(); const i = document.querySelector('[data-note-task-q]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch {} } }
  if (e.target.matches('[data-account-name]')) { clearTimeout(window.__acctNT); const v = e.target.value; window.__acctNT = setTimeout(() => saveAccount({ name: v }).then(() => { if (state.account && state.account.name) { if (state.me) state.me.name = state.account.name; renderNav(); } }), 700); }
  if (e.target.matches('[data-account-username]')) {
    const pos = e.target.selectionStart; const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (e.target.value !== v) { e.target.value = v; try { e.target.setSelectionRange(pos - 1, pos - 1); } catch {} }
    const prev = document.querySelector('.js-username-preview'); if (prev) prev.textContent = v || 'username';
    clearTimeout(window.__acctUN); window.__acctUN = setTimeout(async () => {
      if (!v || v === state.account.subdomain) return;
      try { state.account = await api('/api/account', { method: 'PATCH', body: JSON.stringify({ subdomain: v }) }); if (state.me) state.me.subdomain = v; toast(`Username updated - you're now at ${v}.daybook.fyi`); }
      catch (x) { toast(x.message); }
    }, 800); }
  if (e.target.matches('.acct-phone-cc, .acct-phone-num')) { clearTimeout(window.__acctPT); const cc = (document.querySelector('.acct-phone-cc') || {}).value; const number = (document.querySelector('.acct-phone-num') || {}).value; window.__acctPT = setTimeout(() => saveAccount({ phone: joinPhone({ cc, number }) }), 700); }
  if (e.target.matches('[data-account-sms]')) { api('/api/lanes', { method: 'PUT', body: JSON.stringify({ smsAlerts: e.target.checked }) }).catch(() => {}); }
  if (e.target.matches('[data-account-brief]')) { saveAccount({ briefEmail: e.target.checked }); toast(e.target.checked ? 'Morning brief on' : 'Morning brief off'); }
  if (e.target.matches('[data-account-quote]')) { saveAccount({ dailyQuote: e.target.checked }); toast(e.target.checked ? 'Daily quote on' : 'Daily quote off'); }
  if (e.target.matches('[data-account-ai]')) { const off = !e.target.checked; if (state.account) state.account.aiOff = off; saveAccount({ aiOff: off }); toast(off ? 'AI turned off' : 'AI turned on'); renderSettings(); }
  if (e.target.matches('[data-mod-toggle]')) { state.modules = state.modules || {}; const k = e.target.dataset.modToggle; state.modules[k] = e.target.checked; saveModules(); renderNav(); if (state.view && state.view.type === 'home') renderHome(); }
  if (e.target.matches('[data-msec-show]')) { const key = e.target.dataset.msecShow; const cfg = mobileHomeCfg(); const set = new Set(cfg.hidden); if (e.target.checked) set.delete(key); else set.add(key); cfg.hidden = [...set]; saveMobileHomeCfg(cfg); toast(e.target.checked ? 'Shown on mobile' : 'Hidden on mobile'); }
  if (e.target.matches('[data-people-toggle]')) { const on = e.target.checked; try { localStorage.setItem('life.home.people', on ? '1' : '0'); } catch {} api('/api/kv/home_people', { method: 'PUT', body: JSON.stringify({ value: on ? '1' : '0' }) }).catch(() => {}); toast(on ? 'People shown on Home' : 'People hidden from Home'); if (state.view && state.view.type === 'home') renderHome(); }
  // Mail search hits IMAP, so debounce and re-focus the box after results land
  // (a full re-render recreates the input) rather than re-rendering per keystroke.
  if (e.target.matches('[data-home-notepad]')) { state.home.notepad = e.target.value; const v = e.target.value; clearTimeout(window.__padT); window.__padT = setTimeout(() => { api('/api/kv/home_scratchpad', { method: 'PUT', body: JSON.stringify({ value: v }) }).catch(() => {}); }, 700); }
  if (e.target.matches('[data-timer-label]')) { timerState.label = e.target.value; saveTimer(); }
  // Live search: refresh only the list (quiet), so the box you're typing in is
  // never rebuilt and keeps focus. Debounced so it fires when you pause.
  if (e.target.matches('[data-mail-q]')) { state.mail.query = e.target.value; clearTimeout(window.__mailSearchT); window.__mailSearchT = setTimeout(() => { state.mail.limit = 40; loadMessages(true); }, 500); }
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
  if (e.target.dataset && e.target.dataset.prose) { const pe = e.target; clearTimeout(proseT); proseT = setTimeout(() => saveProse(pe.dataset.prose, pe.innerHTML, pe.dataset.blockId), 800); }
});
let proseT;
// The info icon's hover tip. mouseover/out bubble (mouseenter/leave don't), so
// one pair of document listeners covers the button however the tabs re-render.
document.addEventListener('mouseover', (e) => { const b = e.target.closest && e.target.closest('.help-btn'); if (b) showHelpPop(b); });
document.addEventListener('mouseout', (e) => { const b = e.target.closest && e.target.closest('.help-btn'); if (b && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.help-btn'))) hideHelpPop(); });
document.addEventListener('click', (e) => {
  const t = e.target;
  // Bottom-nav tab: tapping it jumps to the top of that page. If you're already
  // on it, just scroll up; otherwise navigate (fall through) and scroll after.
  const tabb = t.closest('.tab-b');
  if (tabb) {
    const toTop = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); const p = document.getElementById('pane'); if (p) p.scrollTop = 0; };
    if (tabb.classList.contains('on')) { e.preventDefault(); toTop(); return; }
    requestAnimationFrame(toTop);   // navigating: scroll once the new page has rendered
  }
  // Any http(s) link opens in a new tab / the default browser, even from inside
  // an always-editable prose region (where a plain click would just set the caret).
  const alink = t.closest('a[href]');
  // Internal links jump within Robski Life instead of opening a browser tab.
  if (alink) {
    // Match the #rl- fragment anywhere in the href, so a link stored as an
    // absolute URL still routes in-app rather than opening a browser tab.
    const rl = (alink.getAttribute('href') || '').match(/#rl-(note|table|area|row)-([\w-]+)/i);
    if (rl) {
      e.preventDefault(); const kind = rl[1].toLowerCase(); const id = rl[2];
      // A row link carries both ids: #rl-row-<tableId>_<rowId>.
      let nav;
      if (kind === 'row') { const u = id.indexOf('_'); nav = openRowResult(id.slice(0, u), id.slice(u + 1)); }
      else nav = kind === 'note' ? openNote(id) : kind === 'table' ? openTable(id) : openArea(id);
      nav.catch((x) => toast(x.message)); return;
    }
  }
  // Our own synthesised open-in-browser click - let it proceed, don't re-handle
  // it (that would loop forever, since this listener is on document).
  if (alink && alink.dataset && alink.dataset.extOpen) return;
  if (alink && /^https?:/i.test(alink.getAttribute('href') || '')) {
    e.preventDefault();
    openExternal(alink.href);
    return;
  }
  const ate = t.closest('[data-add-table-entry]'); if (ate) { e.stopPropagation(); openTableEntryPicker(); return; }
  const tpk = t.closest('[data-tblpick]'); if (tpk) { addTableEntry(tpk.dataset.tblpick); return; }
  if (t.closest('[data-tblpick-bg]') && !t.closest('.pal')) { closeTableEntryPicker(); return; }
  if (t.closest('[data-open-shortcuts]')) { openShortcuts(); return; }
  if (t.closest('[data-close-shortcuts]')) { closeShortcuts(); return; }
  if (t.closest('[data-shortcuts-bg]') && !t.closest('.sc-panel')) { closeShortcuts(); return; }
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
  if (t.closest('[data-open-guide]')) { openHelp('index'); return; }
  const hlp = t.closest('[data-help-open]'); if (hlp) { hideHelpPop(); if (window.matchMedia('(max-width:820px)').matches) openHelp(hlp.dataset.helpOpen); else openHelpTab(hlp.dataset.helpOpen); return; }
  const tpin = t.closest('[data-tab-pin]'); if (tpin) { togglePin(tpin.dataset.tabPin); return; }
  const tclose = t.closest('[data-tab-close]'); if (tclose) { closeTab(tclose.dataset.tabClose); return; }
  const tsw = t.closest('[data-tab]'); if (tsw) { switchTab(tsw.dataset.tab); return; }
  if (t.closest('[data-tab-new]')) { newTab(); return; }
  if (t.closest('[data-util-toggle]')) { toggleNavUtil(); return; }
  if (t.closest('[data-theme-toggle]')) { cycleTheme(); return; }
  const st = t.closest('[data-sec-toggle]'); if (st && !t.closest('.nav-add')) { toggleSec(st.dataset.secToggle); return; }

  const on = t.closest('[data-open-note]'); if (on) { openNote(on.dataset.openNote).catch((x) => toast(x.message)); return; }
  const ot = t.closest('[data-open-table]'); if (ot) { openTable(ot.dataset.openTable).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-view-home]')) { openHome().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-tables]')) { openNotesList(); return; }   // Tables folded into Notes
  if (t.closest('[data-open-notes]')) { openNotesList(); return; }
  const ntchip = t.closest('[data-notes-type]'); if (ntchip) { state.notesType = ntchip.dataset.notesType; try { localStorage.setItem('life.notesType', state.notesType); } catch {} renderNotesList(); return; }
  const snt = t.closest('[data-set-note-type]'); if (snt) { const [id, type] = snt.dataset.setNoteType.split(':'); setNoteType(id, type); return; }
  if (t.closest('[data-open-journal]')) { openJournal().catch((x) => toast(x.message)); return; }
  const oje = t.closest('[data-open-jentry]'); if (oje) { openJournalEntry(oje.dataset.openJentry).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-journal-start]')) { startJournalEntry(); return; }
  if (t.closest('[data-journal-coaching]')) { newCoachingSession(); return; }
  if (t.closest('[data-journal-dream]')) { newJournalEntry('dreams', 'Describe the dream in as much detail as I can remember - people, places, what happened, and how it ended.'); return; }
  const delIns = t.closest('[data-del-insight]'); if (delIns) { delInsight(delIns.dataset.delInsight); return; }
  const readIns = t.closest('[data-read-insight]'); if (readIns) { if (state.journal) { state.journal.readingInsight = readIns.dataset.readInsight; renderJournalList(); } return; }
  if (t.closest('[data-journal-insights-read]')) { if (state.journal) { const l = state.journal.insightsList || []; if (l.length) { state.journal.readingInsight = l[0].id; renderJournalList(); } } return; }
  if (t.closest('[data-journal-insights-close]')) { if (state.journal) { state.journal.readingInsight = null; renderJournalList(); } return; }
  if (t.closest('[data-journal-insights]')) { journalInsights(); return; }
  if (t.closest('[data-journal-insights-toggle]')) { if (state.journal) { state.journal.insightsOpen = !state.journal.insightsOpen; renderJournalList(); } return; }
  const jnew = t.closest('[data-journal-new]'); if (jnew) { newJournalEntry(jnew.dataset.journalNew, jnew.dataset.journalPrompt); return; }
  if (t.closest('[data-journal-pick-cancel]')) { if (state.journal) state.journal.picking = false; renderJournalList(); return; }
  if (t.closest('[data-journal-deeper]')) { journalDeepen(); return; }
  if (t.closest('[data-journal-empathy]')) { journalEmpathise(); return; }
  if (t.closest('[data-journal-coach]')) { journalCoach(); return; }
  if (t.closest('[data-del-journal]')) { delJournalEntry(); return; }
  if (t.closest('[data-open-readwatch]')) { openReadwatch().catch((x) => toast(x.message)); return; }
  const rwf = t.closest('[data-rw-filter]'); if (rwf) { if (state.rw) { state.rw.filter = rwf.dataset.rwFilter; renderReadwatch(); } return; }
  const rwt = t.closest('[data-rw-type]'); if (rwt) { if (state.rw) { state.rw.addType = state.rw.addType === rwt.dataset.rwType ? null : rwt.dataset.rwType; renderReadwatch(); const i = $('#rw-url'); if (i) i.focus(); } return; }
  const rwd = t.closest('[data-rw-done]'); if (rwd) { const b = (state.rw.items || []).find((x) => x.id === rwd.dataset.rwDone); rwSetDone(rwd.dataset.rwDone, !(b && b.props && b.props.status === 'done')); return; }
  const rwx = t.closest('[data-rw-del]'); if (rwx) { rwDelete(rwx.dataset.rwDel); return; }
  if (t.closest('[data-rw-setup]')) { rwToggleSetup(); return; }
  if (t.closest('[data-rw-bm]')) { e.preventDefault(); toast('Drag this button up to your bookmarks bar to install it'); return; }
  if (t.closest('[data-open-areas]')) { openAreasList(); return; }
  { const ar = t.closest('[data-area-remove]'); if (ar) { const p = ar.dataset.areaRemove.split(':'); removeBlockArea(p[0], p[1], p[2]); return; } }
  const oa = t.closest('[data-open-area]'); if (oa) { openArea(oa.dataset.openArea).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-contacts]')) { openContacts().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-goals]')) { openGoals('goals').catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-financial]')) { openFinancial().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-settings]')) { openSettings(); return; }
  if (t.closest('[data-home-quote-x]')) { const today = new Date().toISOString().slice(0, 10); api('/api/kv/quote_dismissed', { method: 'PUT', body: JSON.stringify({ value: today }) }).catch(() => {}); if (state.home) state.home.quote = null; renderHome(); return; }
  { const ax = t.closest('[data-alert-x]'); if (ax) { try { localStorage.setItem('life.home.alert.' + ax.dataset.alertX, todayISO()); } catch {} renderHome(); return; } }
  if (t.closest('[data-pomo-collapse]')) { const o = localStorage.getItem('life.home.pomoOpen') === '1'; localStorage.setItem('life.home.pomoOpen', o ? '0' : '1'); renderHome(); return; }
  { const pcat = t.closest('[data-pomo-cat]'); if (pcat) { state.pomoPickType = pcat.dataset.pomoCat; renderHome();
    if (state.pomoPickType === 'task' && !state.pomoTasks) { api('/api/blocks?kind=task').then((ts) => { state.pomoTasks = (ts || []).filter((x) => !(x.props && x.props.done)).sort((a, b) => (PRIO_ORDER[(a.props && a.props.priority) || ''] || 5) - (PRIO_ORDER[(b.props && b.props.priority) || ''] || 5)).slice(0, 80).map((x) => ({ id: x.id, title: x.title })); if (state.view && state.view.type === 'home') renderHome(); }).catch(() => { state.pomoTasks = []; }); }
    return; } }
  if (t.closest('[data-pomo-toggle]')) { pomoToggle(); return; }
  if (t.closest('[data-pomo-reset]')) { pomoReset(); return; }
  { const pm = t.closest('[data-pomo-mode]'); if (pm) { pomoSetMode(pm.dataset.pomoMode); return; } }
  // Toolbox: collapse a tool, drive the plain timer, tick practices.
  { const tb = t.closest('[data-tbx-tool]'); if (tb) { tbxToolToggle(tb.dataset.tbxTool); return; } }
  if (t.closest('[data-timer-toggle]')) { timerToggle(); return; }
  if (t.closest('[data-timer-reset]')) { timerReset(); return; }
  { const ts = t.closest('[data-timer-set]'); if (ts) { timerSet(Number(ts.dataset.timerSet)); return; } }
  if (t.closest('[data-timer-custom]')) { timerSetCustom(); return; }
  { const tk = t.closest('[data-prc-tick]'); if (tk) { practiceToggle(tk.dataset.prcTick, dayKey(new Date())); return; } }
  { const td = t.closest('[data-prc-day]'); if (td) { const [pid, day] = td.dataset.prcDay.split(':'); practiceToggle(pid, day); return; } }
  { const tx = t.closest('[data-prc-del]'); if (tx) { practiceDelete(tx.dataset.prcDel); return; } }
  { const na = t.closest('[data-prc-new-area]'); if (na) { openPracticeEditor(null, na.dataset.prcNewArea); return; } }
  if (t.closest('[data-prc-new]')) { openPracticeEditor(null); return; }
  { const pe = t.closest('[data-prc-edit]'); if (pe) { openPracticeEditor(pe.dataset.prcEdit); return; } }
  if (t.closest('[data-prc-close]')) { closePracticeEditor(); return; }
  if (t.closest('[data-prc-save]')) { savePractice(); return; }
  { const pt = t.closest('[data-pe-timed]'); if (pt) { const panel = pt.closest('.pe-panel'); if (panel) panel.classList.toggle('timed-on', pt.checked); return; } }
  // Today (native) view
  { const tb = t.closest('[data-t2-tab]'); if (tb) { state.today.tab = tb.dataset.t2Tab; renderToday(); return; } }
  { const pr = t.closest('[data-t2-prio]'); if (pr) { const s = state.today.taskPrios instanceof Set ? state.today.taskPrios : (state.today.taskPrios = new Set()); const p = pr.dataset.t2Prio; if (s.has(p)) s.delete(p); else s.add(p); renderToday(); return; } }
  { const td = t.closest('[data-t2-day]'); if (td) { const dd = new Date(state.today.day + 'T00:00'); dd.setDate(dd.getDate() + Number(td.dataset.t2Day)); loadToday(dd.toISOString().slice(0, 10)); return; } }
  if (t.closest('[data-t2-today]')) { loadToday(todayISO()); return; }
  { const pp = t.closest('[data-t2-place-prac]'); if (pp) { t2PlacePractice(pp.dataset.t2PlacePrac); return; } }
  { const pk = t.closest('[data-t2-place-task]'); if (pk) { t2PlaceTask(pk.dataset.t2PlaceTask); return; } }
  { const st = t.closest('[data-t2-slot-tick]'); if (st) { t2SlotTick(st.dataset.t2SlotTick); return; } }
  { const sd = t.closest('[data-t2-del-slot]'); if (sd) { e.stopPropagation(); t2DelSlot(sd.dataset.t2DelSlot); return; } }
  { const ce = t.closest('[data-t2-count-ev]'); if (ce) { e.stopPropagation(); t2CountEvent(ce.dataset.t2CountEv); return; } }
  { const uc = t.closest('[data-t2-uncount]'); if (uc) { e.stopPropagation(); t2UncountEvent(uc.dataset.t2Uncount); return; } }
  { const ov = t.closest('[data-t2-open-slot]'); if (ov) { const s = (state.today.data.slots || []).find((x) => String(x.id) === String(ov.dataset.t2OpenSlot)); const a = s && (state.practices.activities || []).find((x) => String(x.id) === String(s.activity_id)); if (a && a.video) window.open(a.video, '_blank', 'noopener'); return; } }
  if (t.closest('[data-task-close]')) { closeTaskPopover(); return; }
  if (t.closest('[data-task-save]')) { saveTaskPopover(); return; }
  { const tdel = t.closest('[data-task-del]'); if (tdel) { deleteTaskFromPopover(tdel.dataset.taskDel); return; } }
  { const tr = t.closest('.t2-trow[data-t2-drag]'); if (tr) { if (Date.now() - t2SuppressClick < 350) return; openTaskPopover(tr.dataset.t2DragId); return; } }
  // Today section day-stepper. These live inside the collapse header, so they must
  // be handled (and return) before the sec-collapse toggle below, or a tap on an
  // arrow would also collapse the section.
  { const ds = t.closest('[data-home-day-set]'); if (ds) { homeDaySet(Number(ds.dataset.homeDaySet)); return; } }
  { const dd = t.closest('[data-home-day]'); if (dd) { homeDaySet((state.home.dayOffset || 0) + Number(dd.dataset.homeDay)); return; } }
  { const sc = t.closest('[data-sec-collapse]'); if (sc) { if (Date.now() - suppressSecClick < 400) return; const c = homeCollapsed(); const k = sc.dataset.secCollapse; c[k] = secOpen(k); try { localStorage.setItem('life.home.collapsed', JSON.stringify(c)); } catch {} renderHome(); return; } }
  { const st = t.closest('[data-set-tab]'); if (st) { state.settings = state.settings || {}; state.settings.tab = st.dataset.setTab; renderSettings(); return; } }
  if (t.closest('[data-alias-add]')) { addAlias(); return; }
  { const aks = t.closest('[data-ai-key-save]'); if (aks) { saveAiKey(aks.dataset.aiKeySave); return; } }
  { const akc = t.closest('[data-ai-key-clear]'); if (akc) { clearAiKey(akc.dataset.aiKeyClear); return; } }
  // First-run onboarding guide.
  if (t.closest('[data-onb-finish]')) { finishOnboarding(); return; }
  if (t.closest('[data-onb-back]')) { onbGo((state.onb ? state.onb.step : 0) - 1); return; }
  if (t.closest('[data-onb-next]')) { if (state.onb && state.onb.step >= ONB_STEPS.length - 1) finishOnboarding(); else onbGo((state.onb ? state.onb.step : 0) + 1); return; }
  { const oas = t.closest('[data-onb-ai-save]'); if (oas) { onbSaveAi(oas.dataset.onbAiSave); return; } }
  if (t.closest('[data-onb-mail-connect]')) { onbConnectGmail(); return; }
  if (t.closest('[data-onb-phone-save]')) { onbSavePhone(); return; }
  { const oad = t.closest('[data-onb-area-del]'); if (oad) { onbDelArea(oad.dataset.onbAreaDel); return; } }
  if (t.closest('[data-onb-replay]')) { showOnboarding(0); return; }
  { const av = t.closest('[data-alias-verify]'); if (av) { verifyAlias(av.dataset.aliasVerify); return; } }
  { const ar = t.closest('[data-alias-resend]'); if (ar) { resendAlias(ar.dataset.aliasResend); return; } }
  { const ad = t.closest('[data-alias-del]'); if (ad) { delAlias(ad.dataset.aliasDel); return; } }
  if (t.closest('[data-account-export]')) { downloadExport(); return; }
  if (t.closest('[data-account-close]')) { closeMyAccount(); return; }
  if (t.closest('[data-account-signout]')) { signOut(); return; }
  if (t.closest('[data-create-invite]')) { inviteToDaybook(); return; }
  { const rs = t.closest('[data-invite-resend]'); if (rs) { resendInvitation(rs.dataset.inviteResend); return; } }
  { const at = t.closest('[data-adm-tab]'); if (at) { state.admin = state.admin || {}; state.admin.tab = at.dataset.admTab; renderAdmin(); return; } }
  const cpc = t.closest('[data-copy-code]'); if (cpc) { try { navigator.clipboard.writeText(cpc.dataset.copyCode); toast('Invite code copied'); } catch { toast(cpc.dataset.copyCode); } return; }
  { const cpi = t.closest('[data-copy-invite]'); if (cpi) { const link = `https://daybook.fyi/join/${cpi.dataset.copyInvite}`; try { navigator.clipboard.writeText(link); toast('Invite link copied - share it with anyone'); } catch { uiPrompt('Copy this invite link:', { title: 'Invite link', value: link, okLabel: 'Done' }); } return; } }
  { const cxi = t.closest('[data-cancel-invite]'); if (cxi) { cancelInviteAction(cxi.dataset.cancelInvite); return; } }
  if (t.closest('[data-open-mailaccounts]')) { openMailAccounts().catch((x) => toast(x.message)); return; }
  const accBtn = t.closest('[data-accent]'); if (accBtn) { setAccent(accBtn.dataset.accent); return; }
  const sgoto = t.closest('[data-settings-goto]'); if (sgoto) { if (sgoto.dataset.settingsGoto === 'spending') openFinancial('spending').catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-spendcats]')) { state.financial = state.financial || {}; state.financial.spendCatsOpen = true; openFinancial('spending').catch((x) => toast(x.message)); return; }
  const fseg = t.closest('[data-fin-tab]'); if (fseg) { openFinancial(fseg.dataset.finTab).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-fin-refresh]')) { loadPortfolio(true); return; }
  if (t.closest('[data-fin-add]')) { state.financial.adding = true; state.financial.editId = null; renderFinancial(); return; }
  if (t.closest('[data-fin-add-cancel]')) { state.financial.adding = false; renderFinancial(); return; }
  const fed = t.closest('[data-fin-edit]'); if (fed) { state.financial.editId = Number(fed.dataset.finEdit); state.financial.adding = false; renderFinancial(); return; }
  if (t.closest('[data-fin-edit-cancel]')) { state.financial.editId = null; renderFinancial(); return; }
  const fhs = t.closest('[data-fin-sell]'); if (fhs) { sellHolding(Number(fhs.dataset.finSell)); return; }
  const fhd = t.closest('[data-fin-del]'); if (fhd) { deleteHolding(Number(fhd.dataset.finDel)); return; }
  const acd = t.closest('[data-adv-chan-del]'); if (acd) { delAdviceChannel(acd.dataset.advChanDel); return; }
  if (t.closest('[data-adv-poll]')) { advicePoll(); return; }
  if (t.closest('[data-adv-trends]')) { loadAdvice(true); return; }
  const spm = t.closest('[data-sp-month]'); if (spm) { const ms = spendMonths(); let i = ms.indexOf(state.financial.spendMonth); i += spm.dataset.spMonth === 'prev' ? 1 : -1; if (ms[i]) { state.financial.spendMonth = ms[i]; renderFinancial(); } return; }
  const spj = t.closest('[data-sp-month-jump]'); if (spj) { state.financial.spendMonth = spj.dataset.spMonthJump; renderFinancial(); return; }
  if (t.closest('[data-sp-do-import]')) { spendDoImport(); return; }
  if (t.closest('[data-sp-import-cancel]')) { state.financial.spendImport = null; renderFinancial(); return; }
  if (t.closest('[data-sp-clear]')) { spendClear(); return; }
  if (t.closest('[data-sp-cat-manage]')) { state.financial.spendCatsOpen = !state.financial.spendCatsOpen; renderFinancial(); return; }
  { const sct = t.closest('[data-sp-cat-type]'); if (sct) { const ds = sct.dataset.spCatType; const i = ds.lastIndexOf(':'); spendCatToggleType(ds.slice(0, i), ds.slice(i + 1)); return; } }
  if (t.closest('[data-sp-cat-add]')) { spendCatAdd(); return; }
  const scr = t.closest('[data-sp-cat-rename]'); if (scr) { spendCatRename(scr.dataset.spCatRename); return; }
  const scx = t.closest('[data-sp-cat-del]'); if (scx) { spendCatDel(scx.dataset.spCatDel); return; }
  if (t.closest('[data-trk-refresh]')) { loadTracker(true); return; }
  const tkd = t.closest('[data-trk-del]'); if (tkd) { delTracker(tkd.dataset.trkDel); return; }
  if (t.closest('[data-trk-cat-add]')) { addTrkCat(); return; }
  const tcr = t.closest('[data-trk-cat-rename]'); if (tcr) { renameTrkCat(tcr.dataset.trkCatRename); return; }
  const tcx = t.closest('[data-trk-cat-del]'); if (tcx) { delTrkCat(tcx.dataset.trkCatDel); return; }
  if (t.closest('[data-open-bucketlist]')) { openGoals('bucket').catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-reviews]')) { openGoals('reviews').catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-practices]')) { openPractices().catch((x) => toast(x.message)); return; }
  const gtb = t.closest('[data-goals-tab]'); if (gtb) { state.goalsTab = gtb.dataset.goalsTab; renderGoals(); return; }
  const srv = t.closest('[data-start-review]'); if (srv) { startReview(srv.dataset.startReview).catch((x) => toast(x.message)); return; }
  const remd = t.closest('[data-rem-del]'); if (remd) { delReviewReminder(remd.dataset.remDel); return; }
  const orv = t.closest('[data-open-review]'); if (orv) { openReviewCard(orv.dataset.openReview).catch((x) => toast(x.message)); return; }
  const drv = t.closest('[data-del-review]'); if (drv) { delReview(drv.dataset.delReview); return; }
  const whp = t.closest('[data-wheel]'); if (whp) { const [aid, sc] = whp.dataset.wheel.split(':'); setWheel(aid, +sc); return; }
  if (t.closest('[data-open-vision-tab]')) { openGoals('vision').catch((x) => toast(x.message)); return; }
  const ovi = t.closest('[data-open-vision]'); if (ovi) { openVisionCard(ovi.dataset.openVision).catch((x) => toast(x.message)); return; }
  const ogl = t.closest('[data-open-goal]'); if (ogl) { openGoalCard(ogl.dataset.openGoal).catch((x) => toast(x.message)); return; }
  const obk = t.closest('[data-open-bucket]'); if (obk) { openBucketCard(obk.dataset.openBucket).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-goal]')) { newGoal(null).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-bucket]')) { newBucket().catch((x) => toast(x.message)); return; }
  const dgl = t.closest('[data-del-goal]'); if (dgl) { delGoal(dgl.dataset.delGoal); return; }
  const dbk = t.closest('[data-del-bucket]'); if (dbk) { delBucket(dbk.dataset.delBucket); return; }
  if (t.closest('[data-bucket-to-goal]')) { bucketToGoal().catch((x) => toast(x.message)); return; }
  const glink = t.closest('[data-goal-link]'); if (glink) { linkTaskToGoal(glink.dataset.goalLink); return; }
  const tgf = t.closest('[data-toggle-focus]'); if (tgf) { toggleGoalFocus(tgf.dataset.toggleFocus); return; }
  const bkd = t.closest('[data-bucket-done]'); if (bkd) { bucketToggleDone(bkd.dataset.bucketDone); return; }
  const sgt = t.closest('[data-set-gtype]'); if (sgt) { const g = state.goal_open && state.goal_open.goal; if (g) { patchGoal(g.id, { gtype: sgt.dataset.setGtype }, true); renderGoalCard(); } return; }
  if (t.closest('[data-ms-add]')) { msAdd(); return; }
  const mst = t.closest('[data-ms-toggle]'); if (mst) { msToggle(mst.dataset.msToggle); return; }
  const msx = t.closest('[data-ms-del]'); if (msx) { msDel(msx.dataset.msDel); return; }
  const gat = t.closest('[data-goal-addtask]'); if (gat) { const [gid, mid] = gat.dataset.goalAddtask.split(':'); addGoalTask(gid, mid || null).catch((x) => toast(x.message)); return; }
  const oc = t.closest('[data-open-contact]'); if (oc) { openContactCard(oc.dataset.openContact).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-contact-add]')) { state.contactAdding = true; renderContacts(); $('#ct-name')?.focus(); return; }
  if (t.closest('[data-contact-add-close]')) { state.contactAdding = false; renderContacts(); return; }
  if (t.closest('[data-contact-import]')) { $('#contact-file')?.click(); return; }
  const delc = t.closest('[data-del-contact]'); if (delc) { delContact(delc.dataset.delContact); return; }
  const svc = t.closest('[data-save-contact]'); if (svc) { saveSender(svc.dataset.cName, svc.dataset.cEmail); return; }
  const kitd = t.closest('[data-kit-done]'); if (kitd) { homeKitTouched(kitd.dataset.kitDone); return; }
  const cml = t.closest('[data-contact-mail]'); if (cml) { emailContact(cml.dataset.contactMail).catch((x) => toast(x.message)); return; }
  const clrb = t.closest('[data-clear-bday]'); if (clrb) { patchContact(clrb.dataset.clearBday, { birthday: null }, true).then(renderContactCard); return; }
  if (t.closest('[data-cc-add-email]')) { const btn = t.closest('[data-cc-add-email]'); btn.insertAdjacentHTML('beforebegin', '<div class="cc-multi-row"><input class="sel cc-email-in" type="email" placeholder="name@example.com" autocomplete="off"><button type="button" class="cc-multi-x" data-cc-del-email title="Remove">×</button></div>'); btn.previousElementSibling.querySelector('.cc-email-in')?.focus(); return; }
  if (t.closest('[data-cc-add-phone]')) { const btn = t.closest('[data-cc-add-phone]'); btn.insertAdjacentHTML('beforebegin', '<div class="cc-multi-row cc-phone-row"><input class="sel cc-phone-cc" type="tel" placeholder="+351" title="Country code"><input class="sel cc-phone-num" type="tel" placeholder="211 234 400" autocomplete="off"><button type="button" class="cc-multi-x" data-cc-del-phone title="Remove">×</button></div>'); btn.previousElementSibling.querySelector('.cc-phone-num')?.focus(); return; }
  const dce = t.closest('[data-cc-del-email]'); if (dce && state.contact_open) { dce.closest('.cc-multi-row').remove(); patchContact(state.contact_open.contact.id, readCardContacts(), true); return; }
  const dcp = t.closest('[data-cc-del-phone]'); if (dcp && state.contact_open) { dcp.closest('.cc-multi-row').remove(); patchContact(state.contact_open.contact.id, readCardContacts(), true); return; }
  const cgc = t.closest('[data-contact-group]'); if (cgc) { state.contactsGroup = cgc.dataset.contactGroup || null; renderContacts(); return; }
  if (t.closest('[data-new-contact-group]')) { newContactGroup(); return; }
  const rng = t.closest('[data-rename-contact-group]'); if (rng) { renameContactGroup(rng.dataset.renameContactGroup); return; }
  const dcg = t.closest('[data-del-contact-group]'); if (dcg) { delContactGroup(dcg.dataset.delContactGroup); return; }
  const rmg = t.closest('[data-contact-remove-group]'); if (rmg) { removeContactFromGroup(rmg.dataset.cid, rmg.dataset.gid); return; }
  // Contact right-click menu
  const ctxAdd = t.closest('[data-ctx-add]'); if (ctxAdd) { const id = state.contactMenu && state.contactMenu.id; state.contactMenu = null; if (id) addContactToGroup(id, ctxAdd.dataset.ctxAdd); else renderContacts(); return; }
  if (t.closest('[data-ctx-newgroup]')) { const id = state.contactMenu && state.contactMenu.id; state.contactMenu = null; renderContacts(); if (id) addContactViaNewGroup(id); return; }
  const ctxRm = t.closest('[data-ctx-remove]'); if (ctxRm) { const id = state.contactMenu && state.contactMenu.id; state.contactMenu = null; if (id) removeContactFromGroup(id, ctxRm.dataset.ctxRemove); else renderContacts(); return; }
  if (t.closest('[data-ctx-delete]')) { const id = state.contactMenu && state.contactMenu.id; state.contactMenu = null; if (id) delContact(id); else renderContacts(); return; }
  if (t.closest('[data-ctx-close]') && !t.closest('.ctx-menu')) { state.contactMenu = null; renderContacts(); return; }
  if (t.closest('[data-open-p1]')) { openP1Tasks(); return; }
  if (t.closest('[data-view-tasks]')) { openTasks().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-calendar]')) { openCalendar().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-open-today]')) { openToday(); return; }
  if (t.closest('[data-open-mail]')) {
    const onList = state.view.type === 'mail' && state.mail && !state.mail.open && !state.mail.composing;
    const top = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); const p = document.getElementById('pane'); if (p) p.scrollTop = 0; };
    if (onList) top();                                   // already on the inbox -> jump to the top
    else openMail().then(top).catch((x) => toast(x.message));  // from a message/elsewhere -> back to the list, at the top
    return;
  }
  // attachments (delete wins over open since the × sits inside the tile)
  const cdel = t.closest('[data-card-del]'); if (cdel) { e.preventDefault(); e.stopPropagation(); removeCardEl(cdel); return; }
  const lcard = t.closest('.link-card[data-linkcard]'); if (lcard && lcard.closest('.prose')) { e.preventDefault(); openExternal(lcard.dataset.linkcard); return; }
  const adel = t.closest('[data-att-del]'); if (adel) { e.preventDefault(); e.stopPropagation(); const z = adel.closest('[data-att-zone]'); deleteAttachment(z.dataset.attZone, adel.dataset.attDel); return; }
  const aop = t.closest('[data-att-open]'); if (aop) { const z = aop.closest('[data-att-zone]'); openAttachment(z.dataset.attZone, aop.dataset.attOpen); return; }
  const tad = t.closest('[data-tatt-del]'); if (tad) { e.preventDefault(); e.stopPropagation(); const [rid, cid, aid] = tad.dataset.tattDel.split(':'); delCellAttachment(rid, cid, aid); return; }
  const tao = t.closest('[data-tatt-open]'); if (tao) { const [rid, aid] = tao.dataset.tattOpen.split(':'); openTableAttachment(rid, aid, tao.dataset.tattName, tao.dataset.tattType); return; }
  // document scanner
  const scn = t.closest('[data-scan]'); if (scn) { openScanner(scn.dataset.scan); return; }
  if (t.closest('[data-scan-close]')) { closeScanner(); return; }
  if (t.closest('[data-scan-capture]')) { scanCapture(); return; }
  if (t.closest('[data-scan-save]')) { scanSave(); return; }
  if (t.closest('[data-scan-retake]')) { scan.src = null; scanStartCamera(); return; }
  if (t.closest('[data-scan-mode]')) { const order = ['auto', 'bw', 'colour']; scan.mode = order[(order.indexOf(scan.mode || 'auto') + 1) % 3]; scanStage('adjust'); return; }
  if (t.closest('[data-scan-add]')) { scanAddPage(); return; }
  // mail interactions
  const macc = t.closest('[data-mail-acct]'); if (macc) { state.mail.account = macc.dataset.mailAcct; state.mail.limit = 40; loadMessages(); return; }
  const ddel = t.closest('[data-del-draft]'); if (ddel) { e.preventDefault(); e.stopPropagation(); delDraft(ddel.dataset.delDraft); return; }
  const dres = t.closest('[data-resume-draft]'); if (dres) { resumeDraft(dres.dataset.resumeDraft); return; }
  const mfld = t.closest('[data-mail-folder]'); if (mfld) { setMailFolder(mfld.dataset.mailFolder); return; }
  if (t.closest('[data-mail-empty]')) { mailEmptyFolder(); return; }
  if (t.closest('[data-mail-refresh]')) { loadMessages(false, true); return; }
  if (t.closest('[data-mail-more]')) { state.mail.limit = (state.mail.limit || 40) + 60; loadMessages(); return; }
  if (t.closest('[data-mail-thread-toggle]')) { state.mail.threaded = !state.mail.threaded; try { localStorage.setItem('life.mail.threaded', state.mail.threaded ? '1' : '0'); } catch {} renderMail(); return; }
  const mat = t.closest('[data-mail-arch-thread]'); if (mat) { e.preventDefault(); e.stopPropagation(); mailMoveTo(mat.dataset.mailArchThread, 'Archive', 'Archived'); return; }
  const mth = t.closest('[data-mail-thread]'); if (mth) { const k = mth.dataset.mailThread; state.mail.expanded = state.mail.expanded || {}; state.mail.expanded[k] = !state.mail.expanded[k]; renderMail(); return; }
  if (t.closest('[data-mail-shortcuts]')) { state.mail.shortcuts = !state.mail.shortcuts; renderMail(); return; }
  if (t.closest('[data-mail-sc-close]')) { state.mail.shortcuts = false; renderMail(); return; }
  const mjoin = t.closest('[data-mail-join]'); if (mjoin) { openExternal(mjoin.dataset.mailJoin); return; }
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
  if (t.closest('[data-mail-back]')) { state.mail.open = null; state.view = { type: 'mail' }; syncActiveTab(); renderMail(); return; }
  if (t.closest('[data-mail-compose]')) { startCompose(); return; }
  if (t.closest('[data-mail-stray-hide]')) { state.mail.strayHidden = state.mail._stray || 0; renderMail(); return; }
  if (t.closest('[data-mail-reconcile]')) { mailReconcileUnread(); return; }
  if (t.closest('[data-mail-cancel]')) { saveDraft(); state.mail.composing = false; renderMail(); return; }
  if (t.closest('[data-mail-attach]')) { const f = $('#mc-file'); if (f) f.click(); return; }
  const madel = t.closest('[data-mail-att-del]'); if (madel) { mailRemoveAttachment(madel.dataset.mailAttDel); return; }
  if (t.closest('[data-mail-discard]')) { clearDraft(); (state.mail.composing && state.mail.composing.attachments || []).forEach((a) => mailApi(`/attach/${a.id}?account=${encodeURIComponent(composeAcctId())}`, { method: 'DELETE' }).catch(() => {})); state.mail.composing = false; renderMail(); toast('Draft discarded'); return; }
  if (t.closest('[data-mail-claudius]')) { mailClaudius(); return; }
  if (t.closest('[data-mail-reply]')) { mailReplyStart(false); return; }
  if (t.closest('[data-mail-reply-all]')) { mailReplyStart(true); return; }
  { const mt = t.closest('[data-mail-task]'); if (mt) { openMailTaskMenu(mt); return; } }
  if (t.closest('[data-mail-task-add]')) { mailTaskCreate(); return; }
  if (t.closest('[data-mail-task-close]') || t.matches('[data-mail-task-bg]')) { state.mail.taskMenu = null; renderMail(); return; }
  { const ma = t.closest('[data-mail-area]'); if (ma) { openMailAreaMenu(ma); return; } }
  { const mat = t.closest('[data-mail-area-to]'); if (mat) { mailToArea(mat.dataset.mailAreaTo); return; } }
  if (t.closest('[data-mail-area-close]')) { state.mail.areaMenu = null; renderMail(); return; }
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
  const smi = t.closest('[data-mail-show-imgs]'); if (smi) { const addr = smi.dataset.mailShowImgs; if (addr) { trustSender(addr); } else if (state.mail.open) { state.mail.showImgKey = state.mail.open._key; renderMail(); } return; }
  const mtr = t.closest('[data-mail-trust]'); if (mtr) { trustSender(mtr.dataset.mailTrust); return; }
  const mdl = t.closest('[data-mail-del]'); if (mdl) { mailDelete(mdl.dataset.mailDel); return; }
  if (t.closest('[data-mail-accounts]')) { openMailAccounts().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-push-enable]')) { enablePush(); return; }
  if (t.closest('[data-push-test]')) { pushTest(); return; }
  if (t.closest('[data-mail-handler]')) { if (navigator.registerProtocolHandler) { registerMailHandler(); toast('Allow it in the prompt, then set Robski Life as your default in the browser’s handler settings.'); } else toast('This browser doesn’t support setting a mail handler (Safari/iOS don’t).'); return; }
  const dpo = t.closest('[data-dp-open]'); if (dpo) { openDatePicker(dpo.dataset.dpOpen); return; }
  const dpp = t.closest('[data-dp-pick]'); if (dpp) { datePick(dpp.dataset.dpPick); return; }
  const dpst = t.closest('[data-dp-step]'); if (dpst) { dpStep(+dpst.dataset.dpStep); return; }
  if (t.closest('[data-dp-jump-today]')) { datePick(todayISO()); return; }
  if (t.closest('[data-dp-close]') && !t.closest('.dp-cal')) { closeDatePicker(); return; }
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
  if (t.closest('[data-gcal-connect]')) { gcalConnect(); return; }
  if (t.closest('[data-gcal-disconnect]')) { gcalDisconnect(); return; }
  if (t.closest('[data-cal-add]')) { state.cal.adding = true; state.cal.editing = null; renderCalendar(); return; }
  if (t.closest('[data-cal-del]')) { const f = $('#cal-ev-form'); if (f && f.dataset.ev) calDeleteEvent(f.dataset.ev); return; }
  const cmode = t.closest('[data-cal-mode]'); if (cmode) { setCalMode(cmode.dataset.calMode); return; }
  if (t.closest('[data-cal-today]')) { state.cal.selected = todayISO(); state.cal.weekAnchor = todayISO(); const d = new Date(); state.cal.y = d.getFullYear(); state.cal.m = d.getMonth(); state.cal.adding = false; state.cal.editing = null; renderCalendar(); loadCalendar(); return; }
  if (t.closest('[data-cal-prev]')) { stepCal(-1); return; }
  if (t.closest('[data-cal-next]')) { stepCal(1); return; }
  const fo = t.closest('[data-fav-open]'); if (fo) { openFav(fo.dataset.favOpen).catch((x) => toast(x.message)); return; }
  const fv = t.closest('[data-fav]'); if (fv) { toggleFav(fv.dataset.fav); return; }
  const uf = t.closest('[data-unfav]'); if (uf) { unfav(uf.dataset.unfav); return; }
  if (t.closest('[data-task-add]')) { state.taskAddArea = null; state.taskAdding = true; state.taskFocusArm = Date.now(); renderTasks(); return; }
  if (t.closest('[data-task-add-close]')) { state.taskAdding = false; state.taskAddArea = null; renderTasks(); return; }
  if (t.closest('[data-quick-task]')) { showQuickTask(); return; }
  if (t.closest('[data-quick-event]')) { showQuickEvent(); return; }
  if (t.closest('[data-home-cal]')) { openCalendar(todayISO()).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-note]')) { newNote(null).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-table]')) { newTable().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-area]')) { newArea().catch((x) => toast(x.message)); return; }
  if (t.closest('[data-area-color]')) { openAreaColor(); return; }
  if (t.closest('[data-area-add-task]')) { areaAddTask(); return; }
  if (t.closest('[data-area-add-note]')) { areaAddNote(); return; }
  if (t.closest('[data-area-add-goal]')) { const a = state.area_open && state.area_open.area; if (a) newGoal(a.id).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-area-add-bucket]')) { const a = state.area_open && state.area_open.area; if (a) api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'bucket', title: '', props: { area: a.id, status: 'someday' } }) }).then((b) => { state.bucket = state.bucket || []; state.bucket.push(b); openBucketCard(b.id); }).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-new-sub]')) { newNote(state.note.current.id).catch((x) => toast(x.message)); return; }
  { const ntl = t.closest('[data-note-task-link]'); if (ntl) { linkTaskToNote(ntl.dataset.noteTaskLink, state.note.current.id); return; } }
  { const ntu = t.closest('[data-note-task-unlink]'); if (ntu) { unlinkTaskFromNote(ntu.dataset.noteTaskUnlink); return; } }
  if (t.closest('[data-note-new-task]')) { newNoteTask(state.note.current.id); return; }
  if (t.closest('[data-open-admin]')) { openAdmin(); return; }
  if (t.closest('[data-adm-area-add]')) { adminAreaAdd(); return; }
  { const ax = t.closest('[data-adm-area-del]'); if (ax) { adminAreaDel(ax.dataset.admAreaDel); return; } }
  if (t.closest('[data-open-friends]')) { openFriends(); return; }
  if (t.closest('[data-invite-daybook]')) { inviteToDaybook(); return; }
  { const cvi = t.closest('[data-cc-invite]'); if (cvi) { inviteToDaybook(cvi.dataset.ccInvite || undefined); return; } }
  { const ci = t.closest('[data-ctx-invite]'); if (ci) { const email = ci.dataset.ctxInvite; state.contactMenu = null; renderContacts(); inviteToDaybook(email); return; } }
  if (t.closest('[data-friend-add-email]')) { friendAddEmail(); return; }
  { const fa = t.closest('[data-friend-add]'); if (fa) { friendAdd(fa.dataset.friendAdd); return; } }
  { const fac = t.closest('[data-friend-accept]'); if (fac) { friendAccept(fac.dataset.friendAccept); return; } }
  { const frm = t.closest('[data-friend-remove]'); if (frm) { friendRemove(frm.dataset.friendRemove); return; } }
  { const fch = t.closest('[data-friend-chat]'); if (fch) { openChat(fch.dataset.friendChat, fch.dataset.friendName); return; } }
  { const fno = t.closest('[data-friend-notes]'); if (fno) { openMeetingNote(Number(fno.dataset.friendNotes)); return; } }
  { const ar = t.closest('[data-note-area-remove]'); if (ar && state.note && state.note.current) { removeNoteArea(state.note.current.id, ar.dataset.noteAreaRemove); return; } }
  if (t.closest('[data-related-toggle]')) { const o = localStorage.getItem('life.note.relatedOpen') === '1'; try { localStorage.setItem('life.note.relatedOpen', o ? '0' : '1'); } catch {} if (state.note) renderNote(); return; }
  { const ft = t.closest('.fold-toggle'); if (ft) { e.preventDefault(); e.stopPropagation(); const head = ft.parentElement; const prose = ft.closest('.prose'); if (head && prose && HLVL[head.tagName]) { const heads = [...prose.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')]; const i = heads.indexOf(head); const folded = !head.classList.contains('folded'); applyFold(head, folded); ft.textContent = folded ? '▸' : '▾'; setFold(prose.dataset.blockId, i, folded); } return; } }
  if (t.closest('[data-friends-rescan]')) { toast('Checking your contacts…'); openFriends().then(() => { const n = ((state.friends && state.friends.suggestions) || []).length; toast(n ? `${n} of your contacts ${n === 1 ? 'is' : 'are'} on Daybook` : 'No contacts on Daybook yet'); }); return; }
  if (t.closest('[data-chat-close]')) { closeChat(); return; }
  { const so = t.closest('[data-share-open]'); if (so) { openShare(so.dataset.shareOpen, so.dataset.shareTitle || '', so.dataset.shareKind || 'note'); return; } }
  if (t.closest('[data-share-close]')) { closeShare(); return; }
  if (t.closest('[data-share-invite]')) { closeShare(); openContacts().then(() => inviteToDaybook()).catch(() => {}); return; }
  { const son = t.closest('[data-share-on]'); if (son) { shareSet(Number(son.dataset.shareOn), true); return; } }
  { const sof = t.closest('[data-share-off]'); if (sof) { shareOff(Number(sof.dataset.shareOff)); return; } }
  { const ao = t.closest('[data-assign-open]'); if (ao) { openAssign(ao.dataset.assignOpen, ao.dataset.assignTitle || ''); return; } }
  if (t.closest('[data-assign-close]')) { closeAssign(); return; }
  { const aon = t.closest('[data-assign-on]'); if (aon) { assignTo(Number(aon.dataset.assignOn)); return; } }
  { const aof = t.closest('[data-assign-off]'); if (aof) { unassignFrom(Number(aof.dataset.assignOff)); return; } }
  { const aac = t.closest('[data-assign-accept]'); if (aac) { acceptAssign(aac.dataset.assignAccept); return; } }
  { const adc = t.closest('[data-assign-decline]'); if (adc) { declineAssign(adc.dataset.assignDecline); return; } }
  { const atk = t.closest('[data-assign-tick]'); if (atk) { sharedToggleDone(atk.dataset.assignTick, atk.dataset.done !== '1'); return; } }
  { const sc = t.closest('[data-shared-check]'); if (sc) { sharedToggleDone(sc.dataset.sharedCheck, sc.dataset.done !== '1'); return; } }
  { const sw = t.closest('[data-open-shared]'); if (sw) { openView({ type: sw.dataset.sharedKind, id: sw.dataset.openShared }); return; } }
  if (t.closest('[data-quote-add]')) { addQuote(); return; }
  { const qd = t.closest('[data-quote-del]'); if (qd) { delQuote(qd.dataset.quoteDel); return; } }
  { const as = t.closest('[data-admin-status]'); if (as) { setUserStatus(as.dataset.adminStatus, as.dataset.status); return; } }
  if (t.closest('[data-spirit-dismiss]')) { dismissSpirit(); return; }
  if (t.closest('[data-spirit-open]')) { openSpiritCards(); return; }
  if (t.closest('[data-spirit-draw]')) { drawSpiritCard(); return; }
  if (t.closest('[data-spirit-close]') || (t.classList && t.classList.contains('spirit-bg'))) { closeSpirit(); return; }
  if (t.closest('[data-del-note]')) { delNote(); return; }
  if (t.closest('[data-note-to-table]')) { noteToTable(); return; }

  // tasks
  const sh = t.closest('[data-sort]');
  if (sh) { const c = sh.dataset.sort; if (state.taskSort.col === c) state.taskSort.dir = state.taskSort.dir === 'asc' ? 'desc' : 'asc'; else state.taskSort = { col: c, dir: c === 'created' ? 'desc' : 'asc' }; try { localStorage.setItem('life.taskSort', JSON.stringify(state.taskSort)); } catch {} rerenderCurrent(); return; }
  if (t.closest('[data-show-completed]')) { state.showCompleted = true; renderTasks(); return; }
  if (t.closest('[data-hide-completed]')) { state.showCompleted = false; state.completedQuery = ''; renderTasks(); return; }
  if (t.closest('[data-show-snoozed]')) { state.showSnoozed = true; renderTasks(); return; }
  if (t.closest('[data-hide-snoozed]')) { state.showSnoozed = false; renderTasks(); return; }
  const clrSnz = t.closest('[data-clear-snooze]'); if (clrSnz) { patchTaskProps(clrSnz.dataset.clearSnooze, { snooze: null }); return; }
  if (t.closest('[data-tf-toggle]')) { state.taskFiltersOpen = !state.taskFiltersOpen; renderTasks(); return; }
  if (t.closest('[data-tf-add]')) { loadTaskFilters(); state.taskFilters.push({ field: 'priority', op: 'is', value: 'P1' }); state.taskFiltersOpen = true; saveTaskFilters(); renderTasks(); return; }
  if (t.closest('[data-tf-clear]')) { state.taskFilters = []; saveTaskFilters(); renderTasks(); return; }
  { const td = t.closest('[data-tf-del]'); if (td) { loadTaskFilters(); state.taskFilters.splice(Number(td.dataset.tfDel), 1); saveTaskFilters(); renderTasks(); return; } }
  const ck = t.closest('[data-check]'); if (ck) { toggleTask(ck.dataset.check); return; }
  // On the narrow task cards the whole card opens - only the checkbox (handled
  // just above) and the × are special. Star/priority/area are display-only here;
  // you edit them inside the card. Desktop keeps its inline-edit table.
  const tcard = t.closest('.tasks-scroll .tr-task[data-task-row]');
  if (tcard && !t.closest('[data-del-task]') && window.matchMedia('(max-width:820px)').matches) { openTaskCard(tcard.dataset.taskRow).catch((x) => toast(x.message)); return; }
  const dt = t.closest('[data-del-task]'); if (dt) { delTask(dt.dataset.delTask); return; }
  const et = t.closest('[data-edit-task]'); if (et) { editTaskTitle(et); return; }
  const ep = t.closest('[data-edit-prio]'); if (ep) { editPrio(ep); return; }
  const ea = t.closest('[data-edit-area]'); if (ea) { editArea(ea); return; }
  const htt = t.closest('[data-home-task-tick]'); if (htt) { e.stopPropagation(); homeTaskTick(htt.dataset.homeTaskTick); return; }
  const htd = t.closest('[data-home-task-dismiss]'); if (htd) { e.stopPropagation(); homeTaskDismiss(htd.dataset.homeTaskDismiss); return; }
  const ota = t.closest('[data-open-task]'); if (ota) { openTaskCard(ota.dataset.openTask).catch((x) => toast(x.message)); return; }
  if (t.closest('[data-del-task-cur]')) { delTaskCard().catch((x) => toast(x.message)); return; }
  // Click anywhere on a task row that isn't an editable field / control -> open it.
  const trow = t.closest('.tr-task[data-task-row]');
  if (trow && !t.closest('input,select,textarea,button,a,[contenteditable],.ie,[data-edit-task],[data-edit-prio],[data-edit-area],[data-fav]')) { openTaskCard(trow.dataset.taskRow).catch((x) => toast(x.message)); return; }

  // The ▾ on a column header opens the same menu as right-click (toggles it).
  const cmb = t.closest('[data-col-menu]');
  if (cmb && state.tables_view) {
    const id = cmb.dataset.colMenu, open = state.tables_view.colMenu;
    if (open && open.colId === id) state.tables_view.colMenu = null;
    else {
      const r = cmb.getBoundingClientRect();
      const x = Math.min(r.left, window.innerWidth - 232);
      // Open below by default, but flip above when the button sits low on the
      // screen; either way cap the height to the space available and let it
      // scroll, so a long menu never runs off the bottom.
      const below = window.innerHeight - r.bottom - 10, above = r.top - 10;
      const up = below < 300 && above > below;
      state.tables_view.colMenu = up
        ? { colId: id, x, bottom: window.innerHeight - r.top + 4, maxH: Math.max(180, above) }
        : { colId: id, x, y: r.bottom + 4, maxH: Math.max(180, below) };
    }
    renderTable(); return;
  }
  // table column menu (right-click) actions
  if (state.tables_view && state.tables_view.colMenu) {
    const cmId = state.tables_view.colMenu.colId;
    if (t.closest('[data-cm-rename]')) { state.tables_view.colMenu = null; renderTable(); editColName(cmId); return; }
    const cmv = t.closest('[data-cm-move]'); if (cmv) { moveColumn(cmId, cmv.dataset.cmMove); return; }
    const ctp = t.closest('[data-cm-type]'); if (ctp) { setColType(cmId, ctp.dataset.cmType); return; }
    const ccu = t.closest('[data-cm-cur]'); if (ccu) { setColCurrency(cmId, ccu.dataset.cmCur); return; }
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
    return;
  }
  const cc = e.target.closest('.contact-card[data-open-contact]');
  if (cc && state.view.type === 'contacts') { e.preventDefault(); openContactMenu(cc.dataset.openContact, e.clientX, e.clientY); return; }
  // Right-click a link inside note/task prose: offer to open it in a new tab.
  // Internal Daybook links (#rl-…) open in a fresh in-app tab; web links open in
  // a new browser tab.
  const alink = e.target.closest('a[href]');
  if (alink && alink.closest('.prose, .note-body')) {
    const href = alink.getAttribute('href') || '';
    const rl = href.match(/#rl-(note|table|area)-([\w-]+)/i);
    const view = rl ? { type: rl[1].toLowerCase(), id: rl[2] } : null;
    if (view || /^https?:/i.test(href)) { e.preventDefault(); openLinkMenu(e.clientX, e.clientY, href, view); }
  }
});
// A tiny context menu for a link in prose. `view` is set for internal links.
function closeLinkMenu() { const el = document.getElementById('linkmenu'); if (el) el.remove(); document.removeEventListener('keydown', linkMenuKey, true); }
function linkMenuKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeLinkMenu(); } }
function openLinkMenu(x, y, href, view) {
  closeLinkMenu();
  const items = view
    ? ['<button class="ctx-item" data-lm="newtab">↗ Open in new Daybook tab</button>', '<button class="ctx-item" data-lm="here">Open here</button>']
    : ['<button class="ctx-item" data-lm="browser">↗ Open in new browser tab</button>', '<button class="ctx-item" data-lm="copy">Copy link</button>'];
  const mx = Math.min(x, window.innerWidth - 232), my = Math.min(y, window.innerHeight - 110);
  const el = document.createElement('div'); el.id = 'linkmenu'; el.className = 'ctx-bg';
  el.innerHTML = `<div class="ctx-menu" style="top:${my}px;left:${mx}px" role="menu">${items.join('')}</div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lm]'); const act = b && b.dataset.lm; closeLinkMenu();
    if (act === 'newtab') openInNewTab(view);
    else if (act === 'here') Promise.resolve(openView(view)).catch((x) => toast(x.message));
    else if (act === 'browser') window.open(href, '_blank', 'noopener,noreferrer');
    else if (act === 'copy') { (navigator.clipboard ? navigator.clipboard.writeText(href) : Promise.reject()).then(() => toast('Link copied')).catch(() => toast('Could not copy')); }
  });
  document.addEventListener('keydown', linkMenuKey, true);
}
// change: cells + selects
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-t2-taskfilter]')) { state.today.taskArea = e.target.value || ''; renderToday(); return; }
  if (e.target.matches('[data-trk-area-cad]')) { const v = e.target.value; if (v === '__custom') { promptAreaCadence(e.target.dataset.trkAreaCad); } else { setAreaCadence(e.target.dataset.trkAreaCad, v || ''); } return; }
  if (e.target.id === 'pe-cadence') { const sel = e.target; if (sel.value === '__custom') { promptPracticeCadence(sel); } else { sel.dataset.prev = sel.value; } return; }
  if (e.target.id === 'kit-last') { kitSetLast(e.target.value); return; }
  if (e.target.matches('[data-dp-month]')) { if (state.dp) { state.dp.m = Number(e.target.value); renderDatePicker(); } return; }
  if (e.target.matches('[data-dp-year]')) {
    if (state.dp) {
      const v = e.target.value;
      state.dp.noYear = v === '';          // "" is the No year option, birthdays only
      if (v !== '') state.dp.y = Number(v);
      renderDatePicker();
    }
    return;
  }
  if (e.target.matches('[data-kit-toggle]')) { kitToggle(e.target.checked); return; }
  if (e.target.matches('[data-kit-every]')) {
    // "Custom…" isn't a cadence, it's a request for the two extra fields - so it
    // seeds a real one (every 3 months) that those fields then edit.
    const v = e.target.value;
    kitSetEvery(v === 'custom' ? 'every:3:m' : v);
    return;
  }
  if (e.target.matches('[data-kit-n], [data-kit-unit]')) {
    const n = Math.min(999, Math.max(1, Number(($('[data-kit-n]') || {}).value) || 1));
    const u = (($('[data-kit-unit]') || {}).value) || 'm';
    kitSetEvery(`every:${n}:${u}`);
    return;
  }
  if (e.target.id === 'mc-file' && e.target.files && e.target.files.length) { mailAttachFiles([...e.target.files]); e.target.value = ''; return; }
  const sm = e.target.closest('[data-share-mode]'); if (sm) { shareSet(Number(sm.dataset.shareMode), e.target.value === 'edit'); return; }
  if (e.target.matches('[data-admin-signup]')) { toggleAdminSignup(e.target.checked); return; }
  if (e.target.matches('[data-adm-area]')) { saveDefaultAreas(adminAreaListFromDom()); return; }
  { const ap = e.target.closest('[data-admin-plan]'); if (ap) { setUserPlan(ap.dataset.adminPlan, e.target.value); return; } }
  { const af = e.target.closest('[data-admin-free]'); if (af) { if (e.target.value !== '') setUserFree(af.dataset.adminFree, Number(e.target.value)); return; } }
  const cag = e.target.closest('[data-contact-add-group]'); if (cag) { const cid = cag.dataset.contactAddGroup, v = e.target.value; e.target.value = ''; if (v === '__new') addContactViaNewGroup(cid); else if (v) addContactToGroup(cid, v); return; }
  if (e.target.id === 'sp-file' && e.target.files && e.target.files[0]) { spendOpenFile(e.target.files[0]); e.target.value = ''; return; }
  const spc = e.target.closest('[data-sp-cat]'); if (spc) { spendSetCat(spc.dataset.spCat, e.target.value); return; }
  const tcc = e.target.closest('[data-trk-cat]'); if (tcc) { setTrackerCat(tcc.dataset.trkCat, e.target.value); return; }
  const spmap = e.target.closest('[data-sp-map]'); if (spmap && state.financial.spendImport) { state.financial.spendImport.map[spmap.dataset.spMap] = e.target.value; renderFinancial(); return; }
  // Pick which account this message sends from. Snapshot the in-progress fields
  // first so the re-render (which refreshes the signature note) keeps them.
  if (e.target.id === 'mc-from' && state.mail && state.mail.composing) {
    const c = state.mail.composing, g = (id) => document.getElementById(id);
    if (g('mc-to')) c.to = g('mc-to').value; if (g('mc-cc')) c.cc = g('mc-cc').value;
    if (g('mc-bcc')) c.bcc = g('mc-bcc').value; if (g('mc-subject')) c.subject = g('mc-subject').value;
    if (g('mc-body')) c.body = g('mc-body').innerHTML;
    c._acct = e.target.value; renderMail(); return;
  }
  const c = e.target.closest('[data-cell]'); if (c) {
    const [rid, cid] = c.dataset.cell.split(':');
    const col = tcols().find((x) => x.id === cid);
    let val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (col && col.type === 'currency') {
      const n = parseFloat(String(val).replace(/[^0-9.,-]/g, '').replace(',', '.'));
      val = isNaN(n) ? '' : n;
      e.target.value = fmtMoney(val);   // reformat to 00.00 on blur
    }
    setCell(rid, cid, val);
  }
  { const aa = e.target.closest('[data-area-add]'); if (aa) { const p = aa.dataset.areaAdd.split(':'); const v = e.target.value; e.target.value = ''; addBlockArea(p[0], p[1], v); return; } }
  { const tff = e.target.closest('[data-tf-field]'); if (tff) { loadTaskFilters(); const i = Number(tff.dataset.tfField); const c = state.taskFilters[i]; c.field = e.target.value; c.op = (TASK_FIELDS[c.field].ops || [])[0]; c.value = defaultCondValue(c.field, c.op); saveTaskFilters(); renderTasks(); return; } }
  { const tfo = e.target.closest('[data-tf-op]'); if (tfo) { loadTaskFilters(); const i = Number(tfo.dataset.tfOp); const c = state.taskFilters[i]; c.op = e.target.value; c.value = defaultCondValue(c.field, c.op); saveTaskFilters(); renderTasks(); return; } }
  { const tfv = e.target.closest('[data-tf-val]'); if (tfv) { loadTaskFilters(); const i = Number(tfv.dataset.tfVal); state.taskFilters[i].value = e.target.value; saveTaskFilters(); renderTasks(); return; } }
  if (e.target.matches('[data-notes-sort]')) { state.notesSort = e.target.value; try { localStorage.setItem('life.notesSort', e.target.value); } catch {} renderNotesList(); }
  if (e.target.matches('[data-rw-sort]')) { if (state.rw) { state.rw.sort = e.target.value; try { localStorage.setItem('life.rwSort', e.target.value); } catch {} renderReadwatch(); } }
  if (e.target.matches('[data-accent-custom]')) { setAccent(e.target.value); }
  if (e.target.matches('[data-mail-acct-sel]')) { state.mail.account = e.target.value; state.mail.limit = 40; loadMessages(); }
  if (e.target.matches('[data-prio-task]')) patchTaskProps(e.target.dataset.prioTask, { priority: e.target.value || null });
  if (e.target.matches('[data-area-task]')) patchTaskProps(e.target.dataset.areaTask, { area: e.target.value || null });
  if (e.target.matches('[data-dur-task]')) patchTaskProps(e.target.dataset.durTask, { duration: e.target.value ? Number(e.target.value) : null });
  if (e.target.id === 'taskcard-snooze' && state.task_open) patchTaskProps(state.task_open.task.id, { snooze: e.target.value || null });
  if (e.target.matches('[data-repeat-task]')) patchTaskProps(e.target.dataset.repeatTask, { repeat: e.target.value || null });
  if (e.target.id === 'contact-file' && e.target.files && e.target.files[0]) { importVcf(e.target.files[0]); e.target.value = ''; }
  if (state.contact_open) {
    const cid = state.contact_open.contact.id;
    if (e.target.id === 'contactcard-name') { const v = e.target.value.trim(); if (v) patchContact(cid, { title: v }, false); }
    if (e.target.classList.contains('cc-email-in') || e.target.classList.contains('cc-phone-cc') || e.target.classList.contains('cc-phone-num')) patchContact(cid, readCardContacts(), true);
    if (e.target.classList.contains('contactcard-addr')) patchContact(cid, { address: readCardAddress() }, true);
    if (e.target.id === 'contactcard-bday') patchContact(cid, { birthday: e.target.value || null }, true);
  }
  if (state.goal_open && state.view.type === 'goalcard') {
    const gid = state.goal_open.goal.id; const id = e.target.id;
    if (id === 'goalcard-title') { const v = e.target.value.trim(); if (v) patchGoal(gid, { title: v }, false); }
    else if (id === 'goalcard-why') patchGoal(gid, { why: e.target.value }, true);
    else if (id === 'goalcard-area') patchGoal(gid, { area: e.target.value || null }, true);
    else if (id === 'goalcard-horizon') patchGoal(gid, { horizon: e.target.value }, true);
    else if (id === 'goalcard-gtype') patchGoal(gid, { gtype: e.target.value }, true).then(renderGoalCard);
    else if (id === 'goalcard-status') patchGoal(gid, { status: e.target.value }, true);
    else if (id === 'goalcard-target') patchGoal(gid, { targetDate: e.target.value || null }, true);
    else if (id === 'gc-current') patchGoal(gid, { current: e.target.value === '' ? null : +e.target.value }, true);
    else if (id === 'gc-target') patchGoal(gid, { target: e.target.value === '' ? null : +e.target.value }, true);
    else if (id === 'gc-unit') patchGoal(gid, { unit: e.target.value.trim() || null }, true);
    else if (e.target.matches('[data-ms-text]')) msText(e.target.dataset.msText, e.target.value);
  }
  if (state.bucket_open && state.view.type === 'bucketcard') {
    const bid = state.bucket_open.item.id; const id = e.target.id;
    if (id === 'bucketcard-title') { const v = e.target.value.trim(); if (v) patchBucket(bid, { title: v }, false); }
    else if (id === 'bucketcard-area') patchBucket(bid, { area: e.target.value || null }, true);
    else if (id === 'bucketcard-status') patchBucket(bid, { status: e.target.value }, true).then(renderBucketCard);
    else if (id === 'bucketcard-year') patchBucket(bid, { targetYear: e.target.value.trim() || null }, true);
  }
  if (state.view.type === 'visioncard' && e.target.id === 'visioncard-text') patchVisionText(state.vision_open.area.id, e.target.value);
  const fi = e.target.closest('[data-att-input]'); if (fi && fi.files && fi.files.length) { uploadFiles(fi.dataset.attInput, fi.files); fi.value = ''; }
  const tfi = e.target.closest('[data-tatt-input]'); if (tfi && tfi.files && tfi.files.length) { uploadCellFiles(tfi.dataset.tattInput, tfi.files); tfi.value = ''; }
  if (e.target.classList && e.target.classList.contains('note-title')) autoGrow(e.target);
  if (e.target.id === 'ce-allday') { const f = $('#cal-ev-form'); if (f) f.classList.toggle('allday-on', e.target.checked); }
  if (e.target.id === 'qe-allday') { const f = $('#qe-form'); if (f) f.classList.toggle('allday-on', e.target.checked); }
  // An event's end follows its start. Changing the start date/time slides the end
  // along, preserving the length; editing the end sets a new length. So the end is
  // never left before the start (which looked silly), and a multi-day trip still
  // works. Handles both the calendar (ce) and Home quick-event (qe) forms.
  { const m = e.target.id && e.target.id.match(/^(ce|qe)-(date|time|enddate|endtime)$/);
    if (m) { if (m[2] === 'date' || m[2] === 'time') syncEventEnd(m[1]); else onEventEndEdit(m[1]); } }
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
  // Not while the link picker is open: it stole focus on purpose, and a save
  // here would re-render the prose and detach the selection we're about to link.
  if (e.target.dataset && e.target.dataset.prose && !state.linkpick) saveProse(e.target.dataset.prose, e.target.innerHTML, e.target.dataset.blockId);
  if (e.target.dataset && e.target.dataset.rename !== undefined) renameTable(e.target.value.trim());
  if (e.target.id === 'area-title') renameArea(e.target.value.trim());
  const cn = e.target.dataset && e.target.dataset.colname; if (cn !== undefined && cn) renameColumn(cn, e.target.value.trim());
}, true);
// Track the mail row under the mouse so Return opens it (no re-render: CSS :hover
// already shows the highlight).
document.addEventListener('mouseover', (e) => {
  if (!state.mail || state.view.type !== 'mail') return;
  const row = e.target.closest && e.target.closest('[data-mail-open],[data-mail-thread]');
  // The mouse and j/k share ONE cursor (state.mail.sel). Pointing at a row moves
  // the cursor there and it STAYS when the mouse rests off the list - so E/S/R
  // always have a target, even with a hand on the keyboard. CSS :hover shows the
  // live pointer; the cursor is the shortcut target.
  if (!row) return;
  if (row.dataset.mailOpen !== undefined) {
    const key = row.dataset.mailOpen;
    if (state.mail.sel !== key) {
      state.mail.sel = key; state.mail.hoverThread = null;
      // Move the cursor ring to follow the mouse (cheap class swap, no re-render),
      // so the ring always marks exactly what E/S/R will act on.
      document.querySelectorAll('.mail-list-col .mail-row.ksel').forEach((el) => el.classList.remove('ksel'));
      if (!row.classList.contains('csel')) row.classList.add('ksel');
    }
    // Prefetch after the mouse rests a moment (not on every row swept over).
    clearTimeout(window.__mailPrefetchT); window.__mailPrefetchT = setTimeout(() => prefetchMsg(key), 180);
  } else { state.mail.hoverThread = row.dataset.mailThread; state.mail.sel = null; }
});
document.addEventListener('keydown', (e) => {
  // Enter in the note title drops the caret into the note body (at its start),
  // so you can carry straight on writing - like Notion. Falls back to blur if
  // there's no body to land in.
  if (e.target.id === 'note-title' && e.key === 'Enter') {
    e.preventDefault();
    const prose = document.querySelector('.note-body .prose[data-prose="note"]');
    if (prose) caretToProseStart(prose); else e.target.blur();
    return;
  }
  if ((e.target.id === 'taskcard-title' || e.target.id === 'area-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
// Put the caret at the very start of a contenteditable prose region and focus it.
function caretToProseStart(prose) {
  prose.focus();
  const sel = window.getSelection(); if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(prose);
  range.collapse(true);   // to the start
  sel.removeAllRanges(); sel.addRange(range);
}
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.matches && e.target.matches('[data-prc-add-form]')) { const ar = $('#prc-area'), i = $('#prc-new'); practiceAdd(ar && ar.value, i && i.value); return; }
  if (e.target.matches && e.target.matches('[data-t2-taskadd]')) { t2AddTask(); return; }
  if (e.target.id === 'task-form') { const v = $('#task-title').value.trim(); if (v) addTask({ title: v, area: $('#task-area').value, priority: $('#task-prio').value, duration: $('#task-dur').value, snooze: $('#task-snooze').value, repeat: $('#task-repeat').value, notes: $('#task-notes') ? $('#task-notes').value : '' }); }
  if (e.target.id === 'contact-form') { const v = $('#ct-name').value.trim(); if (v) addContact({ name: v, email: $('#ct-email').value.trim(), phone: $('#ct-phone').value.trim(), birthday: $('#ct-bday').value, address: cleanAddress({ street: $('#ct-street').value, city: $('#ct-city').value, postcode: $('#ct-postcode').value, country: $('#ct-country').value }) }); }
  if (e.target.id === 'qt-form') {
    const i = $('#qt-title'); const v = i.value.trim();
    if (v) {
      homeAddTask({ title: v, area: $('#qt-area').value, priority: $('#qt-prio').value, duration: ($('#qt-dur') || {}).value, snooze: ($('#qt-snooze') || {}).value, repeat: ($('#qt-repeat') || {}).value, notes: ($('#qt-notes') || {}).value });
      if (matchMedia('(max-width:820px)').matches) {
        // On mobile, act like "Done" too: drop focus so the keyboard dismisses,
        // then close the form - one task, done, out of the way.
        try { i.blur(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
        $('#qt-wrap').innerHTML = '';
      } else {
        // On desktop, keep the form open for a run of tasks; clear only the per-task fields.
        i.value = ''; const n = $('#qt-notes'); if (n) n.value = ''; const s = $('#qt-snooze'); if (s) s.value = ''; i.focus();
      }
    }
  }
  if (e.target.id === 'qe-form') {
    const v = $('#qe-title').value.trim();
    if (v) homeAddEvent(buildEventBody({ title: v, startDate: $('#qe-date').value, startTime: ($('#qe-time') || {}).value, endDate: ($('#qe-enddate') || {}).value, endTime: ($('#qe-endtime') || {}).value, location: $('#qe-loc').value.trim(), allDay: $('#qe-allday').checked, repeat: ($('#qe-repeat') || {}).value, notes: ($('#qe-notes') || {}).value, isNew: true }));
  }
  if (e.target.id === 'cal-ev-form') { const v = $('#ce-title').value.trim(); const rp = $('#ce-repeat'); const dt = $('#ce-date'); const ed = $('#ce-enddate'); const nt = $('#ce-notes'); if (v) calSaveEvent(e.target.dataset.ev || null, v, dt ? dt.value : '', ($('#ce-time') || {}).value, ed ? ed.value : '', ($('#ce-endtime') || {}).value, $('#ce-loc').value.trim(), $('#ce-allday').checked, rp ? rp.value : 'none', nt ? nt.value.trim() : ''); }
  if (e.target.id === 'mail-acct-form-el') { addMailAccount({ email: $('#ma-email').value.trim(), imapHost: $('#ma-imaphost').value.trim(), imapPort: $('#ma-imapport').value.trim(), smtpHost: $('#ma-smtphost').value.trim(), smtpPort: $('#ma-smtpport').value.trim(), username: $('#ma-user').value.trim(), pass: $('#ma-pass').value }); }
  if (e.target.dataset && e.target.dataset.acctEditForm) {
    const f = e.target, g = (c) => (f.querySelector(c) || {}).value || '';
    saveMailAccount(f.dataset.acctEditForm, { email: g('.ae-email').trim(), imapHost: g('.ae-imaphost').trim(), imapPort: g('.ae-imapport').trim(), smtpHost: g('.ae-smtphost').trim(), smtpPort: g('.ae-smtpport').trim(), username: g('.ae-user').trim(), pass: g('.ae-pass') });
  }
  if (e.target.id === 'rv-rem-form') { addReviewReminder(e.target); return; }
  if (e.target.id === 'adv-add-form') { const el = $('#adv-input'); addAdviceChannel(el ? el.value : ''); return; }
  if (e.target.id === 'trk-add-form') { addTracker($('#trk-input') ? $('#trk-input').value : '', $('#trk-type') ? $('#trk-type').value : 'crypto', $('#trk-cat') ? $('#trk-cat').value : ''); return; }
  if (e.target.id === 'fin-add-form') { addHolding(e.target); return; }
  if (e.target.id === 'fin-edit-form') { updateHolding(Number(e.target.dataset.id), e.target); return; }
  if (e.target.id === 'mail-compose-form') { const toEl = $('#mc-to'); const to = toEl ? toEl.value.trim() : ''; if (to) { const be = $('#mc-body'); mailSend(to, $('#mc-cc').value.trim(), $('#mc-bcc').value.trim(), $('#mc-subject').value.trim(), be ? be.innerHTML : '', state.mail.composing && state.mail.composing.inReplyTo); } else { toast('Add a recipient first'); if (toEl) { toEl.scrollIntoView({ block: 'center' }); toEl.focus(); } } }
  if (e.target.id === 'colnew') { const name = $('#cn-name').value.trim(); const type = $('#cn-type').value; addColumn(name, type); }
  if (e.target.id === 'rw-add-form') { const i = $('#rw-url'); if (i && i.value.trim()) rwSave(i.value); }
  if (e.target.matches('[data-cm-addopt]')) { const i = $('#cm-opt-input'); if (i && state.tables_view && state.tables_view.colMenu) addColOption(state.tables_view.colMenu.colId, i.value); }
  if (e.target.matches('[data-onb-area-add]')) { const i = $('#onb-area-in'); if (i) { onbAddArea(i.value); i.value = ''; } }
});
// drag to reorder favourites on the home, and to reorder the sidebar sections.
// A dragged item dims; the item it would land next to shows an accent insertion
// line (above or below, following the pointer) so the drop target is obvious.
let dragFav = null, dragSec = null, dragSub = null, dragContact = null, dragFocus = null, dragHomeSec = null, dragP1 = null;
// Pointer-based drag reorder for the Settings → Mobile section list. Pointer
// events (not HTML5 drag) so it works with touch on the phone as well as a mouse.
let msecDrag = null;
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('[data-msec-grip]');
  if (!grip) return;
  const row = grip.closest('.msec-row'); const list = grip.closest('#msec-list'); if (!row || !list) return;
  e.preventDefault();
  msecDrag = { row, list, id: e.pointerId };
  row.classList.add('msec-dragging');
  try { grip.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', (e) => {
  if (!msecDrag || e.pointerId !== msecDrag.id) return;
  const { row, list } = msecDrag;
  const others = [...list.querySelectorAll('.msec-row:not(.msec-dragging)')];
  let placed = false;
  for (const sib of others) { const r = sib.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { list.insertBefore(row, sib); placed = true; break; } }
  if (!placed) list.appendChild(row);
});
function msecDragEnd(e) {
  if (!msecDrag || (e && e.pointerId !== msecDrag.id)) return;
  const { row, list } = msecDrag; row.classList.remove('msec-dragging');
  const order = [...list.querySelectorAll('.msec-row')].map((el) => el.dataset.msec);
  const cfg = mobileHomeCfg(); cfg.order = order; saveMobileHomeCfg(cfg);
  msecDrag = null;
}
document.addEventListener('pointerup', msecDragEnd);
document.addEventListener('pointercancel', msecDragEnd);

// Drag a section up or down IN PLACE on the mobile Home. Pointer events (touch +
// mouse); reorders the same saved arrangement as Settings → Mobile, so the two
// stay in lockstep. Only the dragged card moves - a coloured line shows where it
// will land - and everything snaps to the new order on release.
let homeSecDrag = null;
let suppressSecClick = 0;
const msecEl = (k) => document.querySelector('.' + MSEC_CLASS[k]);
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('[data-hsec-mgrip]');
  if (!grip) return;
  const sec = grip.closest('[data-hsec]'); if (!sec) return;
  e.preventDefault(); e.stopPropagation();
  const cfg = mobileHomeCfg();
  const order = cfg.order.filter((k) => !cfg.hidden.includes(k) && msecEl(k));
  homeSecDrag = { key: grip.dataset.hsecMgrip, sec, grip, id: e.pointerId, startY: e.clientY, moved: false, order, newOrder: order.slice() };
  sec.classList.add('mdragging');
  try { grip.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', (e) => {
  const d = homeSecDrag; if (!d || e.pointerId !== d.id) return;
  e.preventDefault();
  const dy = e.clientY - d.startY;
  if (Math.abs(dy) > 4) d.moved = true;
  d.sec.style.transform = `translateY(${dy}px)`;
  const others = d.order.filter((k) => k !== d.key);
  let ins = others.length;
  for (let i = 0; i < others.length; i++) { const el = msecEl(others[i]); if (!el) continue; const r = el.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { ins = i; break; } }
  d.newOrder = [...others.slice(0, ins), d.key, ...others.slice(ins)];
  d.order.forEach((k) => { const el = msecEl(k); if (el) el.classList.remove('mdrop-top', 'mdrop-bottom'); });
  if (ins < others.length) { const el = msecEl(others[ins]); if (el) el.classList.add('mdrop-top'); }
  else if (others.length) { const el = msecEl(others[others.length - 1]); if (el) el.classList.add('mdrop-bottom'); }
  // Edge auto-scroll so you can reach far positions in a long Home.
  const vh = window.innerHeight;
  if (e.clientY < 80) window.scrollBy(0, -14); else if (e.clientY > vh - 80) window.scrollBy(0, 14);
});
function homeSecDragEnd(e) {
  const d = homeSecDrag; if (!d || (e && e.pointerId !== d.id)) return;
  homeSecDrag = null;
  d.sec.style.transform = ''; d.sec.classList.remove('mdragging');
  d.order.forEach((k) => { const el = msecEl(k); if (el) el.classList.remove('mdrop-top', 'mdrop-bottom'); });
  suppressSecClick = Date.now();   // don't let the release toggle the header's collapse
  if (d.moved && d.newOrder && d.newOrder.join() !== d.order.join()) {
    const cfg = mobileHomeCfg();
    // Refill only the visible-section slots of the saved order, leaving hidden
    // sections where they sit, so a later un-hide reappears sensibly.
    const visible = new Set(d.newOrder);
    let vi = 0;
    cfg.order = cfg.order.map((k) => visible.has(k) ? d.newOrder[vi++] : k);
    saveMobileHomeCfg(cfg); applyMobileHomeOrder();
    toast('Moved');
  }
}
document.addEventListener('pointerup', homeSecDragEnd);
document.addEventListener('pointercancel', homeSecDragEnd);
function reorderHomeSec(dragged, before, cur) {
  const arr = cur.filter((k) => k !== dragged);
  let i = before ? arr.indexOf(before) : arr.length; if (i < 0) i = arr.length;
  arr.splice(i, 0, dragged);
  const val = JSON.stringify(arr);
  try { localStorage.setItem('life.home.mainOrder', val); } catch {}
  // Persist to the account too, so the arrangement follows you to other desktops.
  api('/api/kv/home_order', { method: 'PUT', body: JSON.stringify({ value: val }) }).catch(() => {});
  renderHome();
}
const HOME_SIDE_KEYS = new Set(['recent', 'notepad', 'people']);
function reorderHomeSide(dragged, before, cur) {
  const arr = cur.filter((k) => k !== dragged);
  let i = before ? arr.indexOf(before) : arr.length; if (i < 0) i = arr.length;
  arr.splice(i, 0, dragged);
  const val = JSON.stringify(arr);
  try { localStorage.setItem('life.home.sideOrder', val); } catch {}
  api('/api/kv/home_side_order', { method: 'PUT', body: JSON.stringify({ value: val }) }).catch(() => {});
  renderHome();
}
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
// Favourites drop: snap to the NEAREST card by position and insert on whichever
// side the cursor is on, so an imprecise drop (on a card, or in the gap) lands
// where you meant - never dumped to the bottom. Marks the indicator as a side
// effect and returns the id to insert before (null = end). The sidebar list is
// vertical; the home strip flows horizontally, so pick the axis per container.
function favDrop(container, x, y, draggedId) {
  clearDropMarks();
  const cards = [...container.querySelectorAll('[data-fav-id]')].filter((el) => el.dataset.favId !== draggedId);
  if (!cards.length) return null;
  const horizontal = container.classList.contains('home-sec-favs');
  let best = null, bestD = Infinity;
  for (const el of cards) { const r = el.getBoundingClientRect(); const d = (x - (r.left + r.width / 2)) ** 2 + (y - (r.top + r.height / 2)) ** 2; if (d < bestD) { bestD = d; best = el; } }
  const r = best.getBoundingClientRect();
  const after = horizontal ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
  best.classList.add(after ? 'drop-after' : 'drop-before');
  const list = state.favs.map((f) => f.id);
  if (!after) return best.dataset.favId;
  for (let j = list.indexOf(best.dataset.favId) + 1; j < list.length; j++) if (list[j] !== draggedId) return list[j];
  return null;
}
document.addEventListener('dragstart', (e) => {
  const f = e.target.closest('[data-fav-id]'); if (f) { dragFav = f.dataset.favId; f.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const fo = e.target.closest('[data-focus-id]'); if (fo) { dragFocus = fo.dataset.focusId; fo.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const pr = e.target.closest('[data-p1-id]'); if (pr) { dragP1 = pr.dataset.p1Id; pr.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const hg = e.target.closest('[data-hsec-grip]'); if (hg) { dragHomeSec = hg.dataset.hsecGrip; const s = e.target.closest('[data-hsec]'); if (s) s.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const sub = e.target.closest('[data-sub-id]'); if (sub) { dragSub = sub.dataset.subId; sub.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const s = e.target.closest('.nav-sec-h'); if (s) { const sec = s.closest('[data-nav-sec]'); dragSec = sec.dataset.navSec; sec.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; return; }
  const cc = e.target.closest('[data-contact-drag]'); if (cc) { dragContact = cc.dataset.contactDrag; cc.classList.add('dragging'); e.dataTransfer.effectAllowed = 'copy'; try { e.dataTransfer.setData('text/plain', cc.dataset.contactDrag); } catch {} }
});
document.addEventListener('dragover', (e) => {
  if (dragFav) { const c = e.target.closest('#favs') || e.target.closest('.home-sec-favs'); if (c) { e.preventDefault(); favDrop(c, e.clientX, e.clientY, dragFav); } return; }
  if (dragFocus && e.target.closest('.home-sec-focus')) { e.preventDefault(); const o = e.target.closest('[data-focus-id]'); markDrop(o && o.dataset.focusId !== dragFocus ? o : null, e, 'h'); return; }
  if (dragP1 && e.target.closest('.home-sec-p1')) { e.preventDefault(); const o = e.target.closest('[data-p1-id]'); markDrop(o && o.dataset.p1Id !== dragP1 ? o : null, e, 'h'); return; }
  if (dragHomeSec && (e.target.closest('.home-main') || e.target.closest('.home-side'))) { e.preventDefault(); const o = e.target.closest('[data-hsec]'); markDrop(o && o.dataset.hsec !== dragHomeSec ? o : null, e, 'v'); return; }
  if (dragSec && e.target.closest('#nav-secs')) { e.preventDefault(); const o = e.target.closest('[data-nav-sec]'); markDrop(o && o.dataset.navSec !== dragSec ? o : null, e, 'v'); return; }
  if (dragSub && e.target.closest('[data-subpages]')) { e.preventDefault(); const o = e.target.closest('[data-sub-id]'); markDrop(o && o.dataset.subId !== dragSub ? o : null, e, 'v'); return; }
  if (dragContact) { const gd = e.target.closest('[data-group-drop]'); document.querySelectorAll('.cg-chip.cg-over').forEach((el) => el.classList.remove('cg-over')); if (gd) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; gd.classList.add('cg-over'); } return; }
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
    e.preventDefault();
    const c = e.target.closest('#favs') || e.target.closest('.home-sec-favs');
    if (c) { const before = favDrop(c, e.clientX, e.clientY, dragFav); reorderFavs(dragFav, before); }
    clearDropMarks(); dragFav = null; return;   // dropped off the list: leave it where it was
  }
  if (dragFocus) {
    e.preventDefault(); const over = e.target.closest('[data-focus-id]');
    const ids = focusGoals().map((g) => g.id);
    const before = over && over.dataset.focusId !== dragFocus ? dropBefore(over, ids, (el) => el.dataset.focusId) : null;
    clearDropMarks(); reorderFocus(dragFocus, before); dragFocus = null; return;
  }
  if (dragP1) {
    e.preventDefault(); const over = e.target.closest('[data-p1-id]');
    const ids = priorityTasks().map((t) => t.id);
    const before = over && over.dataset.p1Id !== dragP1 ? dropBefore(over, ids, (el) => el.dataset.p1Id) : null;
    clearDropMarks(); reorderP1(dragP1, before); dragP1 = null; return;
  }
  if (dragHomeSec) {
    e.preventDefault();
    const side = HOME_SIDE_KEYS.has(dragHomeSec);
    const cur = [...document.querySelectorAll(`${side ? '.home-side' : '.home-main'} [data-hsec]`)].map((el) => el.dataset.hsec);
    const over = e.target.closest('[data-hsec]');
    const overKey = over && over.dataset.hsec;
    clearDropMarks();
    // Ignore a drop over the other column - each column reorders on its own.
    if (overKey && !cur.includes(overKey)) { dragHomeSec = null; return; }
    const before = (overKey && overKey !== dragHomeSec) ? dropBefore(over, cur, (el) => el.dataset.hsec) : null;
    (side ? reorderHomeSide : reorderHomeSec)(dragHomeSec, before, cur);
    dragHomeSec = null; return;
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
    clearDropMarks(); reorderSubs(dragSub, before); dragSub = null; return;
  }
  if (dragContact) {
    const gd = e.target.closest('[data-group-drop]');
    document.querySelectorAll('.cg-chip.cg-over').forEach((el) => el.classList.remove('cg-over'));
    if (gd) { e.preventDefault(); addContactToGroup(dragContact, gd.dataset.groupDrop); }
    dragContact = null;
  }
});
document.addEventListener('dragend', () => { clearDropMarks(); document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging')); document.querySelectorAll('.cg-chip.cg-over').forEach((el) => el.classList.remove('cg-over')); dragFav = null; dragSec = null; dragSub = null; dragContact = null; dragFocus = null; dragHomeSec = null; dragP1 = null; });

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
  if (prose && prose.dataset.prose) saveProse(prose.dataset.prose, prose.innerHTML, prose.dataset.blockId);
});

// ── task/note/table helpers ──────────────────────────
// Plain typed text -> prose HTML (one paragraph per line), for bodies seeded from
// a simple textarea. Returns '' for empty input so callers can omit the body.
function textToProse(text) {
  const t = String(text || '').trim(); if (!t) return '';
  return t.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `<p>${esc(line)}</p>`).join('');
}
async function addTask(o) {
  const props = { area: o.area || null, priority: o.priority || null, done: false };
  if (o.duration) props.duration = Number(o.duration);
  if (o.snooze) props.snooze = o.snooze;
  if (o.repeat) props.repeat = o.repeat;
  // Free-form notes typed on the add form become the task's prose body, so they
  // show straight away in the card's Notes section.
  const body = textToProse(o.notes);
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'task', title: o.title, props, ...(body ? { body } : {}) }) });
  state.tasks.push(b); renderTasks();
  // Keep the form open for adding several in a row.
  if (state.taskAdding) { const i = $('#task-title'); if (i) i.focus(); }
}
// A task can be held in more than one place at once - the Tasks list, an open
// area page, the task focus view, the favourites - each a separate object.
// Gather every copy so a change updates the one on screen, not just one of them.
function taskCopies(id) {
  const out = [state.tasks, state.area_open && state.area_open.blocks, state.favs, state.goal_open && state.goal_open.tasks]
    .filter(Boolean).flatMap((arr) => arr.filter((b) => b.id === id));
  if (state.task_open && state.task_open.task.id === id) out.push(state.task_open.task);
  return out;
}
async function patchTaskProps(id, patch) {
  const copies = taskCopies(id); if (!copies.length) return;
  // Keep the area/areas mirror in step: a quick single-area set (the inline cell)
  // replaces the whole list, so a task is never left with a stale props.areas.
  if ('area' in patch && !('areas' in patch)) patch = { ...patch, areas: patch.area ? [patch.area] : [] };
  const prev = copies.map((b) => ({ ...b.props }));
  copies.forEach((b) => Object.assign(b.props, patch)); rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: patch }) }); }
  catch (e) { copies.forEach((b, i) => (b.props = prev[i])); rerenderCurrent(); toast(e.message); }
}
async function patchTaskTitle(id, title) {
  const copies = taskCopies(id); if (!copies.length || !title) return;
  copies.forEach((b) => (b.title = title)); updateRecentTitle('task', id, title); rerenderCurrent();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); } catch (e) { toast(e.message); }
}
function toggleTask(id) {
  const t = taskCopies(id)[0]; if (!t) return;
  // Completing a repeating task doesn't finish it - it rolls forward to the next
  // occurrence and hides until then (mirrors setTaskDone on the server).
  if (!t.props.done && t.props.repeat) {
    const next = nextRepeat(t.props.repeat, t.props.kit ? todayISO() : (t.props.snooze || todayISO()));
    patchTaskProps(id, { snooze: next, done: false, ...(t.props.kit ? { last: todayISO() } : {}) });
    toast(`Repeats ${repeatShort(t.props.repeat).toLowerCase()} — back ${dpLabel(next)}`);
    return;
  }
  patchTaskProps(id, { done: !t.props.done });
}
// Tick a surfaced task straight from Home's Today section. state.tasks isn't
// loaded on Home, so this talks to the task endpoint directly (the same door as
// every other tick: /api/tasks/:id routes through setTaskDone) and drops the
// task from the surfaced list optimistically.
async function homeTaskTick(id) {
  const arr = (state.home.alerts && state.home.alerts.surfaced) || [];
  const idx = arr.findIndex((t) => t.id === id); if (idx < 0) return;
  const [removed] = arr.splice(idx, 1);
  renderHome();
  try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) }); toast('Done ✓'); }
  catch (e) { arr.splice(idx, 0, removed); renderHome(); toast(e.message); }
}
// Tick a keep-in-touch nudge from Home. Same door as everywhere else
// (/api/tasks/:id -> setTaskDone), which rolls it forward from today.
async function homeKitTouched(taskId) {
  const arr = (state.home.alerts && state.home.alerts.keepInTouch) || [];
  const idx = arr.findIndex((k) => k.taskId === taskId); if (idx < 0) return;
  const [removed] = arr.splice(idx, 1);
  renderHome();
  try { await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ done: true }) }); toast(`Noted — ${removed.name} is back on the list in due course`); }
  catch (e) { arr.splice(idx, 0, removed); renderHome(); toast(e.message); }
}
// Remove a surfaced task from Today WITHOUT completing it: clear its snooze so
// it stops surfacing. The task stays open on the Tasks board.
async function homeTaskDismiss(id) {
  const arr = (state.home.alerts && state.home.alerts.surfaced) || [];
  const idx = arr.findIndex((t) => t.id === id); if (idx < 0) return;
  const [removed] = arr.splice(idx, 1);
  renderHome();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { snooze: null } }) }); toast('Removed from Today'); }
  catch (e) { arr.splice(idx, 0, removed); renderHome(); toast(e.message); }
}
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
  span.replaceWith(sel); sel.focus(); try { sel.showPicker(); } catch {}   // open the dropdown straight away - one click, not two
  let d = false;
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
  recordRecent('task', id, task.title, blockAreas(task)[0]);
  renderNav(); renderTaskCard();
}
// Duration presets (minutes) for the task card. Free-form isn't needed - these
// cover the useful range; '—' clears it.
const DURATION_OPTS = [['', '—'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1 hr 30 min'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [480, '8 hours']];
function renderTaskCard() {
  const t = state.task_open.task; migrateCards(t); const a = areaById(t.props.area); const p = t.props.priority;
  $('#pane').innerHTML = `
    <div class="note-crumbs">${navHist.length ? '<button class="crumb-back" data-nav-back title="Back">←</button>' : ''}<button class="crumb" data-view-home>Home</button><span class="crumb-sep">›</span><button class="crumb" data-view-tasks>Tasks</button><span class="crumb-sep">›</span><span class="crumb cur">${esc(t.title || 'Untitled')}</span>
      <span class="crumb-tools">${areaLinkHtml(t.props.area)}<button class="star ${t.props.fav ? 'on' : ''}" data-fav="${t.id}" title="Favourite">${t.props.fav ? '★' : '☆'}</button>
      ${shareBtn(t, 'task')}
      ${t.sharedBy ? '' : `<button class="note-share ghost ${t.assignedCount ? 'on' : ''}" data-assign-open="${t.id}" data-assign-title="${esc(t.title || '')}" title="Assign to a friend">👤 Assign${t.assignedCount ? ` · ${t.assignedCount}` : ''}</button>`}
      ${t.sharedBy ? '' : '<button class="note-del ghost" data-del-task-cur title="Delete this task">Delete</button>'}</span></div>
    ${sharedBanner(t)}
    <div class="task-focus">
      <button class="tf-check ${t.props.done ? 'done' : ''}" ${t.sharedBy ? `data-shared-check="${t.id}" data-done="${t.props.done ? 1 : 0}"` : `data-check="${t.id}"`} title="${t.props.done ? 'Done' : 'Mark done'}">✓</button>
      <textarea class="note-title ${t.props.done ? 'struck' : ''}" id="taskcard-title" rows="1" placeholder="Untitled task" ${t.sharedBy && !t.canEdit ? 'readonly' : ''}>${esc(t.title || '')}</textarea>
    </div>
    ${(() => { const m = focusMinsFor('task', t.id); return m ? `<div class="focus-stat">🍅 ${fmtMins(m)} of focus logged on this task</div>` : ''; })()}
    ${t.props.note ? `<div class="task-source"><button class="task-source-link" data-open-note="${t.props.note}" title="Open the note this task came from">${NOTE_ICO}<span>From note: ${esc(t.props.noteTitle || 'View note')}</span></button></div>` : ''}
    <div class="tf-meta">
      <label class="tf-field"><span class="tf-label">Priority</span>
        <select class="sel" data-prio-task="${t.id}"><option value="">—</option>${['P1', 'P2', 'P3', 'P4'].map((x) => `<option ${p === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <div class="tf-field"><span class="tf-label">Life areas</span>
        ${blockAreasControl('task', t)}</div>
      <label class="tf-field"><span class="tf-label">Duration</span>
        <select class="sel" data-dur-task="${t.id}">${DURATION_OPTS.map(([v, l]) => `<option value="${v}" ${String(t.props.duration || '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="tf-field"><span class="tf-label">Snooze until${t.props.snooze ? ` <button type="button" class="tf-clear" data-clear-snooze="${t.id}">clear</button>` : ''}</span>
        ${dateFieldHtml('taskcard-snooze', t.props.snooze || '')}</label>
      <label class="tf-field"><span class="tf-label">Repeat</span>
        <select class="sel" data-repeat-task="${t.id}">${REPEATS.map(([v, l]) => `<option value="${v}" ${(t.props.repeat || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${notesSection(t.body, 'task', t.id, t.sharedBy && !t.canEdit)}
    ${attachSection(t)}`;
  autoGrowSoon($('#taskcard-title')); loadThumbs(); hydrateEmbeds(); setupFolds();
}

// A prose Notes section, reused by the task card and the row card. Backed by
// the block's `body`, edited inline via the shared rich-text editor.
function notesSection(body, key, id, readOnly) {
  return `<section class="focus-notes"><div class="fn-h">Notes</div>${proseEditor(body, key, id, readOnly)}${embedsHtml(body)}</section>`;
}

// ── attachments (R2-backed files on a block) ─────────
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const isImgType = (t) => /^image\//.test(t || '');
const attIcon = (t) => (t === 'application/pdf' ? '📄' : isImgType(t) ? '🖼' : /^audio\//.test(t) ? '🎵' : /^video\//.test(t) ? '🎬' : '📎');

// The block whose props.attachments the current view is showing.
function attHost() {
  if (state.view.type === 'note') return state.note && state.note.current;
  if (state.view.type === 'taskcard') return state.task_open && state.task_open.task;
  if (state.view.type === 'bucketcard') return state.bucket_open && state.bucket_open.item;
  if (state.view.type === 'visioncard') return state.vision_open && state.vision_open.area;
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
  if (prose.dataset.prose) saveProse(prose.dataset.prose, prose.innerHTML, prose.dataset.blockId);
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
  else if (state.view.type === 'bucketcard') renderBucketCard();
  else if (state.view.type === 'visioncard') renderVisionCard();
  else if (state.view.type === 'table') renderTable();
}
function attachSection(block) {
  const list = (block && block.props && block.props.attachments) || [];
  const tiles = list.map((a) => (isImgType(a.type)
    ? `<div class="att att-img" data-att-open="${a.id}" data-att-type="${esc(a.type)}" data-att-name="${esc(a.name)}" title="${esc(a.name)}"><img data-att-thumb="${a.id}" alt="${esc(a.name)}"><button class="att-x" data-att-del="${a.id}" title="Remove">×</button></div>`
    : `<div class="att att-file" data-att-open="${a.id}" data-att-type="${esc(a.type)}" data-att-name="${esc(a.name)}" title="${esc(a.name)}"><span class="att-ic">${attIcon(a.type)}</span><span class="att-info"><span class="att-name">${esc(a.name)}</span><span class="att-size">${fmtBytes(a.size)}</span></span><button class="att-x" data-att-del="${a.id}" title="Remove">×</button></div>`)).join('');
  return `<section class="attachments" data-att-zone="${block.id}">
    <div class="att-h">Attachments${list.length ? ` · ${list.length}` : ''}</div>
    <div class="att-grid">${tiles}
      <label class="att-add"><input type="file" multiple hidden data-att-input="${block.id}"><span class="att-add-ic">+</span><span>Add file</span></label>
      <button type="button" class="att-add" data-scan="${block.id}"><span class="att-add-ic">🖨</span><span>Scan</span></button>
    </div></section>`;
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
// Before an image goes to storage, shrink it: a note wants a legible picture,
// not a 12-megapixel original. We cap the longest edge and re-encode as JPEG,
// which turns a multi-megabyte phone photo into a few hundred KB. Anything that
// isn't a decodable raster photo - a PDF, an animated GIF, an SVG, or a format
// the browser can't read such as HEIC - passes straight through untouched, so
// this never breaks an upload that would otherwise have worked.
// This is a place for small photos, not raw camera files. Cap the longest edge
// hard and re-encode as JPEG, so a 12-megapixel phone photo lands as a couple of
// hundred KB. Only an already-small file (under 180 KB, i.e. nothing to gain) is
// left alone; anything the browser can't decode (PDF, GIF, SVG, HEIC) passes
// through untouched so this never breaks an upload that would otherwise work.
const IMG_MAX_EDGE = 1280;
async function shrinkImage(file) {
  if (!isImgType(file.type) || /gif|svg/i.test(file.type) || file.size <= 180 * 1024) return file;
  let url;
  try {
    let bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) { url = URL.createObjectURL(file); bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; }); }
    const w = bmp.width, h = bmp.height; if (!w || !h) return file;
    const scale = Math.min(1, IMG_MAX_EDGE / Math.max(w, h));
    const dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
    const cv = document.createElement('canvas'); cv.width = dw; cv.height = dh;
    cv.getContext('2d').drawImage(bmp, 0, 0, dw, dh);
    if (bmp.close) bmp.close();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.78));
    if (!blob || blob.size >= file.size) return file;   // no real saving - keep the original
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; } finally { if (url) URL.revokeObjectURL(url); }
}
// Read the file's bytes into memory FIRST, then upload the buffer - never stream
// the File straight to fetch. A photo picked from Photos is often a lazy handle
// to a file macOS is still materialising; fetching it directly fails with the
// opaque "Failed to fetch". Reading it up front turns that into a clear message
// and lets us check the size before the round-trip.
const MAX_UPLOAD = 25 * 1024 * 1024;
async function postAttachment(url, file) {
  let buf;
  try { buf = await file.arrayBuffer(); }
  catch { throw new Error('could not read that file. If it came from Photos, use Export / Save a copy first, then add it.'); }
  if (!buf.byteLength) throw new Error('that file came through empty. Try exporting it from Photos first.');
  if (buf.byteLength > MAX_UPLOAD) throw new Error(`that image is ${Math.round(buf.byteLength / 1048576)} MB - too big for a note. Export a smaller copy and try again.`);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': file.type || 'application/octet-stream' }, body: buf });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.json();
}
async function uploadFiles(blockId, files) {
  const host = attHost(); if (!host || host.id !== blockId) return;
  let ok = 0;
  for (const f0 of Array.from(files)) {
    try {
      const f = await shrinkImage(f0);
      const att = await postAttachment(`/api/blocks/${blockId}/attachments?name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || 'application/octet-stream')}`, f);
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
  for (const f0 of Array.from(files)) {
    try {
      const f = await shrinkImage(f0);
      const att = await postAttachment(`/api/blocks/${rowId}/attachments?col=${encodeURIComponent(colId)}&name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || 'application/octet-stream')}`, f);
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
// ── document scanner ─────────────────────────────────
// Camera capture → drag the four corners onto the page → perspective-correct
// + enhance (adaptive B&W or colour) → multi-page PDF into the note. Pure JS
// (a small homography warp + integral-image threshold, no heavy WASM engine),
// so it opens instantly and never crashes the mobile web view.
// Solve the 3x3 homography mapping the dst rectangle corners onto the src quad
// (so we can inverse-sample). 4 point pairs -> an 8x8 system, Gauss-Jordan.
function solveHomography(src, dst) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const x = dst[i].x, y = dst[i].y, u = src[i].x, v = src[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    const ta = A[i]; A[i] = A[p]; A[p] = ta; const tb = B[i]; B[i] = B[p]; B[p] = tb;
    const piv = A[i][i] || 1e-9;
    for (let r = 0; r < n; r++) { if (r === i) continue; const f = A[r][i] / piv; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; B[r] -= f * B[i]; }
  }
  return A.map((row, i) => B[i] / (row[i] || 1e-9));
}
// Assemble JPEG pages into a single PDF (DCTDecode, one image per page).
function jpegsToPdf(pages) {
  const enc = new TextEncoder(); const chunks = []; let len = 0;
  const push = (u8) => { chunks.push(u8); len += u8.length; };
  const S = (s) => push(enc.encode(s));
  const n = 2 + pages.length * 3; const xref = new Array(n + 1).fill(0);
  const obj = (i, body) => { xref[i] = len; S(i + ' 0 obj\n' + body + '\nendobj\n'); };
  S('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  pages.forEach((p, i) => {
    const pageN = 3 + i * 3, contentN = pageN + 1, imgN = pageN + 2;
    obj(pageN, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + p.w + ' ' + p.h + '] /Resources << /XObject << /Im0 ' + imgN + ' 0 R >> >> /Contents ' + contentN + ' 0 R >>');
    const content = 'q ' + p.w + ' 0 0 ' + p.h + ' 0 0 cm /Im0 Do Q';
    obj(contentN, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    xref[imgN] = len;
    S(imgN + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.bytes.length + ' >>\nstream\n');
    push(p.bytes); S('\nendstream\nendobj\n');
  });
  const xrefOff = len;
  let x = 'xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= n; i++) x += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  S(x); S('trailer\n<< /Size ' + (n + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOff + '\n%%EOF');
  const out = new Uint8Array(len); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const scan = { block: null, stage: null, pages: [], bw: true, corners: null, drag: null };
function openScanner(blockId) {
  scan.block = blockId; scan.pages = []; scan.mode = 'auto'; scan.corners = null;
  let el = document.getElementById('scanner');
  if (!el) { el = document.createElement('div'); el.id = 'scanner'; document.body.appendChild(el); }
  scanStartCamera();
}
function scanStage(stage) {
  scan.stage = stage;
  const el = document.getElementById('scanner'); if (!el) return;
  const count = scan.pages.length;
  const badge = count ? `<span class="scan-count">${count} page${count > 1 ? 's' : ''}</span>` : '';
  if (stage === 'loading') {
    el.innerHTML = `<div class="scan-shell"><div class="scan-load"><div class="scan-spin"></div><p>Warming up the scanner…</p><p class="scan-sub">First scan only — loading the image engine.</p></div><button class="scan-x" data-scan-close>✕</button></div>`;
  } else if (stage === 'camera') {
    el.innerHTML = `<div class="scan-shell">
      <div class="scan-view"><video id="scan-video" playsinline autoplay muted></video><div class="scan-frame"></div></div>
      <div class="scan-bar"><button class="scan-btn ghost" data-scan-close>Cancel</button>${badge}<button class="scan-shutter" data-scan-capture aria-label="Capture"></button>${count ? `<button class="scan-btn primary" data-scan-save>Save PDF</button>` : '<span class="scan-hint">Fill the frame with the page</span>'}</div>
      <input type="file" id="scan-file" accept="image/*" capture="environment" hidden></div>`;
  } else if (stage === 'adjust') {
    el.innerHTML = `<div class="scan-shell">
      <div class="scan-view scan-adjust"><canvas id="scan-canvas"></canvas><div id="scan-handles"></div></div>
      <div class="scan-bar">
        <button class="scan-btn ghost" data-scan-retake>Retake</button>
        <button class="scan-btn tog on" data-scan-mode title="Tap to change enhancement">${SCAN_MODES[scan.mode || 'auto']}</button>
        <button class="scan-btn primary" data-scan-add>Add page</button>
      </div></div>`;
    scanDrawAdjust();
  }
}
async function scanStartCamera() {
  scanStage('camera');
  const video = document.getElementById('scan-video');
  try {
    scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = scan.stream; await video.play();
  } catch (e) {
    // No camera permission / not available: fall back to the OS camera picker.
    const f = document.getElementById('scan-file');
    if (f) { f.onchange = () => { if (f.files && f.files[0]) scanFromFile(f.files[0]); }; f.click(); }
    else { toast('Camera unavailable'); closeScanner(); }
  }
}
function stopCam() { if (scan.stream) { scan.stream.getTracks().forEach((t) => t.stop()); scan.stream = null; } }
function scanCapture() {
  const video = document.getElementById('scan-video'); if (!video || !video.videoWidth) return;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  stopCam(); scanToAdjust(c);
}
function scanFromFile(file) {
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(img.src); scanToAdjust(c); };
  img.onerror = () => { toast('Could not read that image'); scanStartCamera(); };
  img.src = URL.createObjectURL(file);
}
function scanToAdjust(srcCanvas) {
  scan.src = srcCanvas;
  scan.corners = defaultCorners(srcCanvas);   // start as a rectangle; you drag the handles onto the page
  scanStage('adjust');
}
function defaultCorners(c) { const w = c.width, h = c.height, m = 0.06; return [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }]; }
function orderCorners(p) {
  const s = p.map((q) => q.x + q.y), d = p.map((q) => q.y - q.x);
  return [p[s.indexOf(Math.min(...s))], p[d.indexOf(Math.min(...d))], p[s.indexOf(Math.max(...s))], p[d.indexOf(Math.max(...d))]];
}
// Perspective-correct the quad the user framed into a flat rectangle, then
// enhance. Pure JS: inverse-map each output pixel through the homography and
// bilinear-sample the source.
const SCAN_MODES = { auto: 'Enhance', bw: 'B&W', colour: 'Colour' };
function warpPage(srcCanvas, corners, mode) {
  const [tl, tr, br, bl] = corners; const D = (a, z) => Math.hypot(a.x - z.x, a.y - z.y);
  let W = Math.max(8, Math.round(Math.max(D(br, bl), D(tr, tl))));
  let H = Math.max(8, Math.round(Math.max(D(tr, br), D(tl, bl))));
  const cap = 1600, sc = Math.min(1, cap / Math.max(W, H)); W = Math.round(W * sc); H = Math.round(H * sc);
  const h = solveHomography([tl, tr, br, bl], [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]);
  const sctx = srcCanvas.getContext('2d'); const sw = srcCanvas.width, sh = srcCanvas.height;
  const sd = sctx.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'); const oImg = octx.createImageData(W, H); const od = oImg.data;
  const [a, b, c, d, e, f, g, hh] = h;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dn = g * x + hh * y + 1, u = (a * x + b * y + c) / dn, v = (d * x + e * y + f) / dn, oi = (y * W + x) * 4;
      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) { od[oi] = od[oi + 1] = od[oi + 2] = od[oi + 3] = 255; continue; }
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) { const top = sd[i00 + k] * (1 - fx) + sd[i10 + k] * fx, bot = sd[i01 + k] * (1 - fx) + sd[i11 + k] * fx; od[oi + k] = top * (1 - fy) + bot * fy; }
      od[oi + 3] = 255;
    }
  }
  enhancePage(od, W, H, mode);
  octx.putImageData(oImg, 0, 0);
  return { out, W, H };
}
// Default "Enhance": grayscale + auto levels - stretch the paper to white and
// the ink to dark from the image's own histogram, so uneven phone lighting is
// flattened while photos stay legible (no 1-bit destruction). 'colour' keeps
// hue with a contrast lift; 'bw' is the hard threshold for pure-text pages.
function enhancePage(od, W, H, mode) {
  if (mode === 'colour') { for (let i = 0; i < od.length; i += 4) for (let k = 0; k < 3; k++) { const v = (od[i + k] - 128) * 1.22 + 128 + 8; od[i + k] = v < 0 ? 0 : v > 255 ? 255 : v; } return; }
  if (mode === 'bw') { adaptiveBW(od, W, H); return; }
  const N = W * H; const gray = new Uint8Array(N); const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < N; i++, p += 4) { const gv = (0.299 * od[p] + 0.587 * od[p + 1] + 0.114 * od[p + 2]) | 0; gray[i] = gv; hist[gv]++; }
  let acc = 0, black = 0, white = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= N * 0.03) { black = i; break; } }
  acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= N * 0.12) { white = i; break; } }   // paper ≈ upper 12%
  if (white <= black + 8) white = Math.min(255, black + 40);
  const range = white - black, lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { let t = (i - black) / range; t = t < 0 ? 0 : t > 1 ? 1 : t; t = Math.pow(t, 1.35); lut[i] = (t * 255) | 0; }   // gamma darkens ink
  for (let i = 0, p = 0; i < N; i++, p += 4) { const v = lut[gray[i]]; od[p] = od[p + 1] = od[p + 2] = v; }
}
// Local-mean adaptive threshold (integral image) - the crisp "scanned" B&W look
// that survives uneven lighting far better than a single global cutoff.
function adaptiveBW(od, W, H) {
  const N = W * H, gray = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) gray[i] = 0.299 * od[p] + 0.587 * od[p + 1] + 0.114 * od[p + 2];
  const iw = W + 1, integ = new Float64Array(iw * (H + 1));
  for (let y = 0; y < H; y++) { let rs = 0; for (let x = 0; x < W; x++) { rs += gray[y * W + x]; integ[(y + 1) * iw + (x + 1)] = integ[y * iw + (x + 1)] + rs; } }
  const rad = Math.max(14, Math.floor(Math.min(W, H) / 24)), C = 16;   // bigger window + higher offset = far less speckle
  for (let y = 0; y < H; y++) {
    const y0 = y - rad < 0 ? 0 : y - rad, y1 = y + rad >= H ? H - 1 : y + rad;
    for (let x = 0; x < W; x++) {
      const x0 = x - rad < 0 ? 0 : x - rad, x1 = x + rad >= W ? W - 1 : x + rad;
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integ[(y1 + 1) * iw + (x1 + 1)] - integ[y0 * iw + (x1 + 1)] - integ[(y1 + 1) * iw + x0] + integ[y0 * iw + x0];
      const val = gray[y * W + x] < sum / area - C ? 0 : 255;
      const p = (y * W + x) * 4; od[p] = od[p + 1] = od[p + 2] = val;
    }
  }
}
// Render the frozen frame + draggable corner handles into the adjust view.
function scanDrawAdjust() {
  const view = document.querySelector('.scan-adjust'); const canvas = document.getElementById('scan-canvas'); const layer = document.getElementById('scan-handles');
  if (!view || !canvas || !scan.src) return;
  const box = view.getBoundingClientRect();
  const sc = Math.min(box.width / scan.src.width, box.height / scan.src.height);
  const dw = scan.src.width * sc, dh = scan.src.height * sc;
  canvas.width = dw; canvas.height = dh; canvas.getContext('2d').drawImage(scan.src, 0, 0, dw, dh);
  scan.disp = sc;
  const svg = `<svg class="scan-quad" width="${dw}" height="${dh}"><polygon points="${scan.corners.map((c) => `${c.x * sc},${c.y * sc}`).join(' ')}"/></svg>`;
  const handles = scan.corners.map((c, i) => `<span class="scan-h" data-scan-corner="${i}" style="left:${c.x * sc}px;top:${c.y * sc}px"></span>`).join('');
  layer.style.width = dw + 'px'; layer.style.height = dh + 'px';
  layer.innerHTML = svg + handles;
}
function scanCornerDown(i, e) {
  e.preventDefault(); scan.drag = i;
  const move = (ev) => {
    const p = ev.touches ? ev.touches[0] : ev; const layer = document.getElementById('scan-handles'); if (!layer) return;
    const r = layer.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, p.clientX - r.left)), y = Math.max(0, Math.min(r.height, p.clientY - r.top));
    scan.corners[i] = { x: x / scan.disp, y: y / scan.disp };
    scanDrawAdjust();
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); scan.drag = null; };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function scanAddPage() {
  let res; try { res = warpPage(scan.src, scan.corners, scan.mode || 'auto'); } catch (e) { toast('Could not process page'); return; }
  res.out.toBlob(async (blob) => {
    if (!blob) { toast('Could not process page'); return; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    scan.pages.push({ bytes, w: res.W, h: res.H });
    scanStartCamera();
  }, 'image/jpeg', 0.85);
}
async function scanSave() {
  if (!scan.pages.length) return;
  const blockId = scan.block;
  const pdf = jpegsToPdf(scan.pages);
  const name = `Scan ${new Date().toISOString().slice(0, 10)}.pdf`;
  const file = new File([pdf], name, { type: 'application/pdf' });
  closeScanner();
  toast('Saving scan…');
  await uploadFiles(blockId, [file]);
}
function closeScanner() { stopCam(); const el = document.getElementById('scanner'); if (el) el.remove(); scan.src = null; scan.pages = []; }

// Save a rich-text region back to whichever block it belongs to.
async function saveProse(key, rawHtml, blockId) {
  const html = linkifyHtml(sanitizeProse(rawHtml));
  // The object currently open for this key (may be a different block than the
  // one this save is for, if we've since navigated away).
  const cur = key === 'note' ? (state.note && state.note.current)
    : key === 'task' ? (state.task_open && state.task_open.task)
    : key === 'goal' ? (state.goal_open && state.goal_open.goal)
    : key === 'bucket' ? (state.bucket_open && state.bucket_open.item)
    : key === 'review' ? (state.review_open && state.review_open.review)
    : key === 'contact' ? (state.contact_open && state.contact_open.contact)
    : key === 'row' ? (state.tables_rows && state.tables_rows.find((x) => x.id === (state.tables_view && state.tables_view.openRow)))
    : key === 'journal' ? (state.journal && state.journal.current) : null;
  // The block this prose belongs to. The explicit id is authoritative: it is
  // what stops a stale/queued save from clobbering whatever is open now.
  const id = blockId || (cur && cur.id);
  if (!id) return;
  const isCurrent = !!(cur && cur.id === id);
  const prev = isCurrent ? (cur.body || '') : '';
  if (isCurrent) cur.body = html;
  // Only touch the DOM when this save is for the block on screen: a stale save
  // must persist quietly, never re-render the note you're now looking at.
  const el = isCurrent ? document.querySelector(`.prose[data-prose="${key}"][data-block-id="${id}"]`) : null;
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
  if (isCurrent && ytChanged && !focused) rerenderHost();
  try { const upd = await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ body: html }) }); if (isCurrent && cur && upd && upd.updated_at) cur.updated_at = upd.updated_at; } catch (e) { toast(e.message); }
}
async function delTaskCard() {
  const t = state.task_open.task; if (!(await uiConfirm(`Delete “${t.title || 'Untitled'}”?`, { title: 'Delete task', okLabel: 'Delete', danger: true }))) return;
  await delTask(t.id); await openTasks();
}
async function saveNoteTitle(v) {
  const n = state.note.current; if (!n || v === n.title) return; n.title = v;
  const top = state.noteTops.find((t) => t.id === n.id); if (top) top.title = v;
  const cr = $('.note-crumbs .crumb.cur'); if (cr) cr.textContent = v || 'Untitled';
  updateRecentTitle('note', n.id, v);
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
// The extra fields a column of a given type needs: a default currency symbol, or
// a Select's options seeded from the values already in that column. Shared by
// addColumn and setColType so a type chosen when the column is CREATED behaves
// exactly like one set later from the menu (a currency added via the + form used
// to have no symbol - its header read "currency" and cells lost the € sign).
function colTypeSeed(id, type) {
  const existing = tcols().find((c) => c.id === id);
  if (type === 'select') {
    if (!existing || !existing.options || !existing.options.length) {
      try { return { options: [...new Set((state.tables_rows || []).map((r) => ((r && r.props && r.props.values) || {})[id]).filter((x) => x != null && x !== '').map(String))] }; }
      catch { return { options: [] }; }
    }
  } else if (type === 'currency') {
    if (!existing || typeof existing.currency !== 'string') return { currency: '€' };   // default to Euro; changeable in the menu
  }
  return {};
}
async function addColumn(name, type) { const id = uid(); const col = { id, name: name || 'Column', type, ...colTypeSeed(id, type) }; state.tables_view.addingCol = false; await saveTableColumns([...tcols(), col]); renderTable(); }
async function renameTable(v) { const t = state.tables_open; if (!t || v === t.title) return; t.title = v; const s = state.tables.find((x) => x.id === t.id); if (s) s.title = v; updateRecentTitle('table', t.id, v); try { await api(`/api/blocks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); } }
async function renameArea(v) {
  const a = state.area_open && state.area_open.area; if (!a || !v || v === a.title) return;
  a.title = v; const s = state.areas.find((x) => x.id === a.id); if (s) s.title = v;
  updateRecentTitle('area', a.id, v);
  try { await api(`/api/blocks/${a.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderNav(); } catch (e) { toast(e.message); }
}
async function renameColumn(id, v) { const cols = tcols().map((c) => c.id === id ? { ...c, name: v } : c); await saveTableColumns(cols).catch((x) => toast(x.message)); }
async function setColType(id, type) {
  const seed = colTypeSeed(id, type);
  const cols = tcols().map((c) => c.id === id ? { ...c, type, ...seed } : c);
  try { await saveTableColumns(cols); } catch (e) { toast(`Couldn't change column type: ${e.message}`); }
  renderTable();
}
async function setColCurrency(id, sym) {
  const cols = tcols().map((c) => c.id === id ? { ...c, currency: sym } : c);
  try { await saveTableColumns(cols); } catch (e) { toast(e.message); }
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
// Shift a column one place left or right in the table's column order. The menu
// stays open on the moved column, so you can nudge it several places in a row.
async function moveColumn(colId, dir) {
  const cols = tcols().slice();
  const i = cols.findIndex((c) => c.id === colId); if (i < 0) return;
  const j = dir === 'left' ? i - 1 : i + 1;
  if (j < 0 || j >= cols.length) return;
  [cols[i], cols[j]] = [cols[j], cols[i]];
  await saveTableColumns(cols);
  renderTable();
}
// A right-click menu on a column header: rename, change type (incl. Select and
// its options), sort, delete.
function colMenuHtml(cm) {
  const col = tcols().find((c) => c.id === cm.colId); if (!col) return '';
  const cols = tcols(); const ci = cols.findIndex((c) => c.id === cm.colId);
  const moveItems = [
    ci > 0 ? '<button class="cm-item" data-cm-move="left">← Move left</button>' : '',
    ci >= 0 && ci < cols.length - 1 ? '<button class="cm-item" data-cm-move="right">Move right →</button>' : '',
  ].filter(Boolean).join('');
  const pos = cm.bottom != null ? `bottom:${cm.bottom}px` : `top:${cm.y}px`;
  return `<div class="colmenu" data-colmenu style="${pos};left:${cm.x}px;max-height:${cm.maxH || 480}px">
    <button class="cm-item" data-cm-rename>Rename column</button>
    ${moveItems ? `<div class="cm-sep"></div>${moveItems}` : ''}
    <div class="cm-sep"></div><div class="cm-label">Type</div>
    ${TYPES.map(([v, l]) => `<button class="cm-item cm-type ${col.type === v ? 'on' : ''}" data-cm-type="${v}">${l}${col.type === v ? ' ✓' : ''}</button>`).join('')}
    ${col.type === 'select' ? `<div class="cm-sep"></div><div class="cm-label">Options</div>
      ${(col.options || []).map((o) => `<div class="cm-opt"><span>${esc(o)}</span><button data-cm-rmopt="${esc(o)}" title="Remove">×</button></div>`).join('') || '<div class="cm-empty">None yet</div>'}
      <form class="cm-addopt" data-cm-addopt><input id="cm-opt-input" placeholder="Add option…" autocomplete="off"><button type="submit">Add</button></form>` : ''}
    ${col.type === 'currency' ? `<div class="cm-sep"></div><div class="cm-label">Symbol</div>
      ${CURRENCIES.map(([s, l]) => `<button class="cm-item cm-cur ${curSym(col) === s ? 'on' : ''}" data-cm-cur="${esc(s)}">${esc(l)}${curSym(col) === s ? ' ✓' : ''}</button>`).join('')}` : ''}
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
  b.innerHTML = `<button data-fmt="normal" title="Normal text - clear formatting" class="bub-h bub-normal">¶</button>
    <button data-fmt="bold" title="Bold  ⌘B"><b>B</b></button>
    <button data-fmt="italic" title="Italic  ⌘I"><i>I</i></button>
    <span class="bub-sep"></span>
    <button data-fmt="h1" title="Heading 1" class="bub-h">H1</button>
    <button data-fmt="h2" title="Heading 2" class="bub-h">H2</button>
    <button data-fmt="h3" title="Heading 3" class="bub-h">H3</button>
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
    const [notes, tables, areas, rows] = await Promise.all([
      api('/api/blocks?kind=note').catch(() => []),
      api('/api/blocks?kind=table').catch(() => []),
      api('/api/blocks?kind=area').catch(() => []),
      api('/api/blocks?kind=row').catch(() => []),
    ]);
    const map = (arr, kind, icon) => (arr || []).map((b) => ({ id: b.id, kind, icon, title: b.title || 'Untitled' }));
    // Table rows are cards in a table-style note. Include the ones that carry a
    // label so you can link straight to a card; note which table it lives in.
    const tblName = {}; (tables || []).forEach((t) => { tblName[t.id] = t.title || 'Table'; });
    const rowOpts = (rows || []).map((b) => ({ b, label: b.title || rowLabel(b) }))
      .filter((x) => x.label && x.label !== 'Row')
      .map((x) => ({ id: `${x.b.parent_id}_${x.b.id}`, kind: 'row', icon: TBL_ICO, title: x.label + (tblName[x.b.parent_id] ? ` · ${tblName[x.b.parent_id]}` : '') }));
    if (!state.linkpick) return;
    state.linkpick.opts = [...map(notes, 'note', ''), ...map(tables, 'table', TBL_ICO), ...rowOpts, ...map(areas, 'area', '◈')];
    state.linkpick.loaded = true;
    renderLinkPickerList();
  } catch {}
}
function renderLinkPicker() {
  let el = document.getElementById('linkpick-overlay');
  if (!el) { el = document.createElement('div'); el.id = 'linkpick-overlay'; document.body.appendChild(el); }
  el.innerHTML = `<div class="pal-bg" data-linkpick-bg><div class="pal">
    <input id="linkpick-input" placeholder="Paste a URL, or search notes, tables, cards & areas…" value="${esc(state.linkpick.q)}" autocomplete="off" spellcheck="false">
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
  saveProse(prose.dataset.prose, prose.innerHTML, prose.dataset.blockId);
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
  if (cmd === 'normal') {
    // Back to plain body text: strip inline styling, drop any link, and turn a
    // heading or quote back into a paragraph.
    document.execCommand('removeFormat');
    document.execCommand('unlink');
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      let bl = sel.getRangeAt(0).startContainer; bl = bl.nodeType === 1 ? bl : bl.parentElement;
      bl = bl && bl.closest && bl.closest('h1,h2,h3,blockquote');
      // Swap the element directly - formatBlock is unreliable when the heading
      // carries our non-editable grip/chevron spans. Strip those first so they
      // don't survive into the new paragraph.
      if (bl && prose.contains(bl)) {
        bl.querySelectorAll('.head-grip, .fold-toggle').forEach((x) => x.remove());
        const p = document.createElement('p'); p.innerHTML = bl.innerHTML; bl.replaceWith(p);
      }
    }
    normalizeProseLists(prose);
  }
  else if (cmd === 'bold') document.execCommand('bold');
  else if (cmd === 'italic') document.execCommand('italic');
  else if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3') { const tag = cmd.toUpperCase(); document.execCommand('formatBlock', false, currentBlockTag() === tag ? '<p>' : `<${cmd}>`); }
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
  saveProse(prose.dataset.prose, prose.innerHTML, prose.dataset.blockId);
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
  clearTimeout(window.__detToggleT); window.__detToggleT = setTimeout(() => saveProse(prose.dataset.prose, prose.innerHTML, prose.dataset.blockId), 300);
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
    saveProse(prose.dataset.prose, prose.innerHTML, prose.dataset.blockId);
  }, 0);
});

// ── sign-in gate (self-contained; life.robski.uk is its own origin) ──
let gateStep = 'email', gateEmail = '';
// daybook.fyi itself belongs to nobody: an invitee landing there is not signing
// in to Robin's Daybook, so the wordmark drops the owner's name and reads just
// "Daybook". On a tenant subdomain it stays whose it is.
const onApex = () => location.hostname === 'daybook.fyi' || location.hostname === 'www.daybook.fyi';
function showGate(sub) {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="gate2" id="gate2"><form class="gate2-card" id="gate-form">
      <div class="gate2-mark"><span class="mark-lockup">${MARK}<em>${esc(BRAND.app)}</em></span><span class="gate2-tag">For a life well lived</span></div>
      <p class="gate2-sub" id="gate-sub">${sub || "New here or coming back? Enter your email and we'll send you a sign-in code."}</p>
      <input class="gate2-input" id="gate-email" type="email" placeholder="you@example.com" autocomplete="email" required>
      <input class="gate2-input gate2-code" id="gate-code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" hidden>
      <button class="gate2-btn" id="gate-btn" type="submit">Email me a code</button>
      <button class="gate2-smslink" id="gate-sms" type="button" title="For when your email lives inside Daybook and you can't open it to read the code">Use Daybook for your email? <b>Text me the code instead</b></button>
      <p class="gate2-err" id="gate-err" hidden></p>
    </form></div>`);
  $('#gate-email').focus();
}
// Onboarding gate: a signed-in email with no account yet claims its space here
// (name + subdomain + invite). Only reached on the multi-tenant build, where
// /api/me returns needsSignup; on the single-tenant app /api/me 404s and this
// never shows.
const storedInvite = () => { try { return localStorage.getItem('life.invite') || ''; } catch { return ''; } };
function showSignup(email, inviteRequired, invited) {
  // Prefill the username from the subdomain they arrived on (name.daybook.fyi),
  // else from their email, so most people only have to agree with it.
  let presub = '';
  try { const h = location.hostname; if (h.endsWith('.daybook.fyi')) { const f = h.split('.')[0]; if (f && f !== 'www') presub = f; } } catch {}
  if (!presub) presub = (email.split('@')[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 30);
  const preInvite = storedInvite();
  // Only ask for a code when we haven't already got one. An invitation addressed
  // to this email (invited) or a code carried in by the /join link covers almost
  // everyone - and being asked for a code they had no way to produce is exactly
  // where the first invitations died.
  const needCode = inviteRequired && !invited && !preInvite;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="gate2" id="signup"><form class="gate2-card signup-card" id="signup-form">
      <div class="gate2-mark"><em>${esc(BRAND.app)}</em><span class="gate2-tag">For a life well lived</span></div>
      <p class="gate2-sub">${invited || preInvite ? 'Your invitation is accepted - now make it yours.' : "Welcome - let's set up your Daybook."}</p>
      <label class="signup-l">Your name<input class="gate2-input" id="su-name" placeholder="e.g. Tara" autocomplete="name" required></label>
      <label class="signup-l">Choose a username
        <span class="su-sub"><input class="gate2-input su-sub-in" id="su-sub" placeholder="tara" value="${esc(presub)}" autocomplete="off" spellcheck="false" required><span class="su-sub-suffix">.daybook.fyi</span></span>
        <span class="su-username-note">Your Daybook will live at <b><span id="su-preview">${esc(presub || 'username')}</span>.daybook.fyi</b></span>
      </label>
      ${needCode ? `<label class="signup-l">Invite code<input class="gate2-input" id="su-invite" placeholder="From your invitation" autocomplete="off" spellcheck="false" required>
        <span class="su-username-note">The code in the email that invited you.</span></label>` : ''}
      <button class="gate2-btn" id="su-btn" type="submit">Create my Daybook</button>
      <p class="gate2-err" id="su-err" hidden></p>
      <p class="gate2-alt su-foot">Signed in as ${esc(email)} · <button type="button" class="su-signout" id="su-signout">sign out</button></p>
    </form></div>`);
  $('#signup-form').addEventListener('submit', signupSubmit);
  $('#su-signout').addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch {} location.reload(); });
  $('#su-sub').addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const pv = $('#su-preview'); if (pv) pv.textContent = e.target.value || 'username';
  });
  $('#su-name').focus();
}
// Their Daybook lives on its own subdomain - a different origin, with its own
// empty localStorage. Carry the session over in the fragment (never sent to a
// server, never logged) so the new origin is signed in on arrival. Reloading the
// apex instead used to land the newcomer back on the marketing page, which is
// what made a completed signup look like a failed one.
function goToMyDaybook(sub) {
  const host = sub ? `${sub}.daybook.fyi` : '';
  if (!host || location.hostname === host) { location.reload(); return; }
  location.replace(`https://${host}/#t=${encodeURIComponent(token())}`);
}
async function signupSubmit(e) {
  e.preventDefault();
  const err = $('#su-err'), btn = $('#su-btn'), inv = $('#su-invite');
  err.hidden = true; btn.disabled = true;
  try {
    const d = await api('/api/signup', { method: 'POST', body: JSON.stringify({
      name: $('#su-name').value.trim(),
      subdomain: $('#su-sub').value.trim(),
      invite: inv ? inv.value.trim() : storedInvite(),
    }) });
    if (d && d.user) { try { localStorage.removeItem('life.invite'); } catch {} goToMyDaybook(d.user.subdomain); return; }
    throw new Error('Could not create your account.');
  } catch (e2) { err.textContent = e2.message || 'Could not create your account.'; err.hidden = false; btn.disabled = false; }
}
// Ask for a code by email (default) or SMS. SMS is the way in once the mailbox
// you would fetch the email from lives behind this very gate.
async function gateSend(channel) {
  const err = $('#gate-err'), btn = $('#gate-btn'), sms = $('#gate-sms');
  gateEmail = $('#gate-email').value.trim();
  if (!gateEmail) { err.textContent = 'Enter your email first.'; err.hidden = false; return; }
  err.hidden = true; btn.disabled = true; if (sms) sms.disabled = true;
  try {
    const r = await fetch('/auth/request-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: gateEmail, channel }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Could not send a code. Try again.');
    gateStep = 'code';
    $('#gate-sub').textContent = d.channel === 'sms' ? 'Code texted to your phone.'
      : (channel === 'sms' && d.smsUnavailable) ? `No phone saved on your account, so we've emailed your code to ${gateEmail}. Add a phone in Settings to get it by text next time.`
      : `Code sent to ${gateEmail}.`;
    $('#gate-email').hidden = true; if (sms) sms.hidden = true;
    { const or = $('.gate2-or'); if (or) or.hidden = true; }
    $('#gate-code').hidden = false; $('#gate-code').focus();
    btn.textContent = 'Sign in';
  } catch (e2) { err.textContent = e2.message; err.hidden = false; }
  btn.disabled = false; if (sms) sms.disabled = false;
}
async function gateSubmit(e) {
  e.preventDefault();
  if (gateStep === 'email') return gateSend('email');
  const err = $('#gate-err'), btn = $('#gate-btn');
  err.hidden = true; btn.disabled = true;
  try {
    const r = await fetch('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: gateEmail, code: $('#gate-code').value.trim() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) throw new Error(d.error || 'That code did not work.');
    localStorage.setItem(KEY, d.token); location.reload();
  } catch (e2) { err.textContent = e2.message; err.hidden = false; }
  btn.disabled = false;
}
document.addEventListener('submit', (e) => { if (e.target.id === 'gate-form') gateSubmit(e); });
document.addEventListener('click', (e) => { if (e.target.id === 'gate-sms') gateSend('sms'); });

// ── boot ─────────────────────────────────────────────
// Parse a mailto: URI (to + ?subject/body/cc/bcc) into compose fields.
function parseMailto(s) {
  const raw = String(s || '').replace(/^mailto:/i, '');
  const qi = raw.indexOf('?');
  let addr = qi >= 0 ? raw.slice(0, qi) : raw;
  try { addr = decodeURIComponent(addr); } catch {}
  const q = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
  return { to: addr, cc: q.get('cc') || '', bcc: q.get('bcc') || '', subject: q.get('subject') || '', body: q.get('body') || '' };
}
async function openMailCompose(c) {
  await openMail();
  state.mail.composing = { _draftId: newDraftId(), to: c.to || '', cc: c.cc || '', bcc: c.bcc || '', subject: c.subject || '', body: esc(c.body || '').replace(/\n/g, '<br>') };
  renderMail();
  setTimeout(() => { const el = document.getElementById(c.to ? 'mc-body' : 'mc-to'); if (el) el.focus(); }, 40);
}
// Offer Robski Life as the browser's mailto handler (Chromium/Firefox). The
// browser then asks the user to allow it, and to make it the default.
function registerMailHandler() { try { if (navigator.registerProtocolHandler) navigator.registerProtocolHandler('mailto', location.origin + '/?mailto=%s'); } catch {} }

// ── First-run onboarding ──────────────────────────────────────────────
// A gentle, skippable guide shown once when a new account first opens: orient
// them, offer AI (optional), offer email (optional). Persisted per-user via
// /api/kv/onboarded so it shows exactly once and never nags an existing member.
const ONB_STEPS = ['Welcome', 'Life areas', 'Add AI', 'Connect email', 'Backup phone', 'Done'];
async function maybeOnboard() {
  if (!state.me || !state.me.subdomain) return;   // multi-tenant own account only
  let seen = true;
  try { const r = await api('/api/kv/onboarded'); seen = !!(r && r.value); } catch { return; }
  if (!seen) showOnboarding(0);
}
async function finishOnboarding() {
  try { await api('/api/kv/onboarded', { method: 'PUT', body: JSON.stringify({ value: '1' }) }); } catch {}
  const el = document.getElementById('onb'); if (el) el.remove();
  state.onb = null;
}
function showOnboarding(step) {
  state.onb = { step: step || 0, account: state.account || null, mailDone: false, areas: null };
  if (!document.getElementById('onb')) { const d = document.createElement('div'); d.id = 'onb'; document.body.appendChild(d); }
  // Pull current key state so the AI step can show what's already added.
  if (!state.onb.account) api('/api/account').then((a) => { if (state.onb) { state.onb.account = a; renderOnboarding(); } }).catch(() => {});
  // Load the starter life areas so the Life areas step can list them.
  api('/api/blocks?kind=area').then((areas) => {
    if (!state.onb) return;
    const sorted = (areas || []).sort((x, y) => (x.title || '').localeCompare(y.title || ''));
    state.onb.areas = sorted; state.areas = sorted;
    if (state.onb.step === 1) renderOnboarding();
  }).catch(() => { if (state.onb) state.onb.areas = []; });
  renderOnboarding();
}
function onbAreas() {
  const areas = state.onb.areas;
  const chips = areas === null
    ? '<p class="onb-p onb-muted">Loading your areas…</p>'
    : areas.length
      ? `<div class="onb-areas">${areas.map((a) => `<span class="onb-area" style="--h:${hueOf(a)}"><span class="onb-area-dot"></span><span class="onb-area-t">${esc(a.title || 'Untitled')}</span><button class="onb-area-x" data-onb-area-del="${a.id}" title="Remove this area" aria-label="Remove">×</button></span>`).join('')}</div>`
      : '<p class="onb-p onb-muted">No life areas yet - add a few below.</p>';
  return `<h2 class="onb-h">Your life areas</h2>
    <p class="onb-p">Life areas are the few parts of your life Daybook is built around - Work, Health, Family, and so on. Your tasks, notes, goals and spending all attach to an area, so each area gathers everything about that part of your life in one place.</p>
    <p class="onb-p onb-muted">Here's a starter set. Remove any that don't fit you, and add your own - you can always change these later in Life areas.</p>
    ${chips}
    <form class="onb-area-add" data-onb-area-add><input id="onb-area-in" class="sel" placeholder="Add a life area…" autocomplete="off" maxlength="60" spellcheck="false"><button class="add-btn wide" type="submit">Add</button></form>`;
}
async function onbDelArea(id) {
  if (!state.onb) return;
  state.onb.areas = (state.onb.areas || []).filter((a) => a.id !== id);
  state.areas = (state.areas || []).filter((a) => a.id !== id);
  renderOnboarding();
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); }
}
async function onbAddArea(name) {
  name = (name || '').trim(); if (!name || !state.onb) return;
  // Golden-angle hues keep a new area visually distinct from its neighbours.
  const hue = Math.round(((state.areas || []).length * 137.5) % 360);
  try {
    const a = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'area', title: name, props: { hue } }) });
    const push = (arr) => { arr.push(a); arr.sort((x, y) => (x.title || '').localeCompare(y.title || '')); };
    state.areas = state.areas || []; push(state.areas);
    state.onb.areas = state.onb.areas || []; push(state.onb.areas);
    renderOnboarding();
    const i = document.getElementById('onb-area-in'); if (i) i.focus();
  } catch (e) { toast(e.message); }
}
function onbGo(n) { if (!state.onb) return; state.onb.step = Math.max(0, Math.min(ONB_STEPS.length - 1, n)); renderOnboarding(); }
function onbWelcome() {
  const name = (state.me && state.me.name) ? esc(state.me.name.split(' ')[0]) : '';
  const sub = esc((state.me && state.me.subdomain) || 'you');
  return `<h2 class="onb-h">Welcome to Daybook${name ? `, ${name}` : ''}</h2>
    <p class="onb-p">Your own private space for tasks, notes, tables, your calendar, email, and a place to reflect - all on one screen.</p>
    <p class="onb-p">It lives at <b>${sub}.daybook.fyi</b>. You can change your username anytime in <b>Settings → Account</b>.</p>
    <p class="onb-p onb-muted">The next two steps are optional - skip them and set anything up later.</p>`;
}
function onbAiProv(provider, name, why, host, url, ph, isSet) {
  return `<div class="onb-prov">
    <div class="onb-prov-h"><b>${name}</b>${isSet ? '<span class="ai-set">✓ added</span>' : ''}</div>
    <div class="onb-prov-why">${why}</div>
    <div class="onb-prov-in"><input class="sel" type="password" data-onb-ai="${provider}" placeholder="${isSet ? '•••••• — paste a new key to replace' : ph}" autocomplete="off" spellcheck="false"><button class="add-btn wide" data-onb-ai-save="${provider}">Save</button></div>
    <a class="ai-get" href="${url}" target="_blank" rel="noopener">Get a key at ${host} ↗</a></div>`;
}
function onbAi() {
  const a = state.onb.account || {};
  return `<h2 class="onb-h">Add AI <span class="onb-opt">optional</span></h2>
    <p class="onb-p">Daybook has a few AI helpers. Bring your own key and you stay in control of the cost - or skip and add one later in Settings.</p>
    ${aiUsesHtml()}
    <div class="onb-provs">
      ${onbAiProv('anthropic', 'Claude (Anthropic)', 'Powers Reflection coaching and Email Scribe replies. Pay-as-you-go, usually a few pennies - there is no free tier, so add a little credit first.', 'console.anthropic.com', 'https://console.anthropic.com/settings/keys', 'sk-ant-…', a.aiAnthropicSet)}
      ${onbAiProv('gemini', 'Gemini (Google)', 'Powers money-advice summaries and bank-statement import. Google gives a genuinely free tier - a free Google account is fine.', 'aistudio.google.com', 'https://aistudio.google.com/apikey', 'AIza…', a.aiGeminiSet)}
    </div>
    <div class="ai-managed">Prefer not to deal with keys? <b>Premium Plus</b> runs the AI for you - no keys, nothing to set up. See Settings → Plan.</div>`;
}
function onbEmail() {
  if (state.onb.mailDone) return `<h2 class="onb-h">Connect your email <span class="onb-opt">optional</span></h2>
    <div class="onb-ok">✓ Mailbox connected. Add more anytime in <b>Settings → Mail accounts</b>.</div>`;
  return `<h2 class="onb-h">Connect your email <span class="onb-opt">optional</span></h2>
    <p class="onb-p">Read and send your email inside Daybook. Most people use Gmail.</p>
    <div class="onb-gpw">${GMAIL_APP_PW}</div>
    <div class="onb-mailform">
      <input id="onb-mail-email" class="sel" type="email" placeholder="you@gmail.com" autocomplete="off" spellcheck="false">
      <input id="onb-mail-pass" class="sel" type="password" placeholder="16-character app password" autocomplete="off" spellcheck="false">
      <button class="add-btn wide" data-onb-mail-connect>Connect Gmail</button>
    </div>
    <p class="onb-p onb-muted">Not Gmail? You can set up Outlook, iCloud, Purelymail and others in <b>Settings → Mail accounts</b>.</p>`;
}
function onbPhone() {
  const a = state.onb.account || {};
  const saved = (a.phone || '').trim();
  return `<h2 class="onb-h">A backup way in <span class="onb-opt">optional</span></h2>
    <p class="onb-p">Daybook signs you in with a code sent to your email. But once Daybook <b>is</b> your email, that code lands in an inbox you can't open until you're signed in - a chicken-and-egg.</p>
    <p class="onb-p">Add your phone now and you'll always have a way in: if you ever can't reach your email, we can <b>text your sign-in code</b> instead. (It's also used for any reminders you switch on.)</p>
    ${saved ? `<div class="onb-ok">✓ Phone saved. Change it anytime in <b>Settings → Account</b>.</div>` : ''}
    <div class="onb-mailform">
      <input id="onb-phone" class="sel" type="tel" inputmode="tel" placeholder="+351 912 345 678" value="${esc(saved)}" autocomplete="tel">
      <button class="add-btn wide" data-onb-phone-save>${saved ? 'Update phone' : 'Save phone'}</button>
    </div>
    <p class="onb-p onb-muted">Only ever for sign-in codes and reminders you turn on - never marketing.</p>`;
}
async function onbSavePhone() {
  const el = document.getElementById('onb-phone'); const v = (el && el.value || '').trim();
  if (!v) { toast('Enter your phone number first'); return; }
  const btn = document.querySelector('[data-onb-phone-save]'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try { state.onb.account = await api('/api/account', { method: 'PATCH', body: JSON.stringify({ phone: v }) }); state.account = state.onb.account; toast('Phone saved - that\'s your backup way in'); renderOnboarding(); }
  catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Save phone'; } }
}
function onbDone() {
  return `<h2 class="onb-h">You're all set 🎉</h2>
    <p class="onb-p">A few ways to start:</p>
    <ul class="onb-tips">
      <li><b>+ Task</b>, <b>+ Note</b> and <b>+ Event</b> on Home capture things fast.</li>
      <li>Press <b>⌘K</b> or the search box to jump anywhere.</li>
      <li><b>Invite your friends</b> from <b>Contacts</b>, then share whatever you like - a Life Area, a note, a table, or a few tasks. Completely up to you.</li>
      <li>Change anything later in <b>Settings</b> - AI, mail, appearance and more.</li>
    </ul>
    <p class="onb-p onb-muted">You can reopen this guide anytime from Settings → Account.</p>`;
}
function renderOnboarding() {
  const s = state.onb; if (!s) return;
  const last = ONB_STEPS.length - 1;
  const dots = ONB_STEPS.map((_, i) => `<span class="onb-dot ${i === s.step ? 'on' : ''} ${i < s.step ? 'done' : ''}"></span>`).join('');
  const content = s.step === 0 ? onbWelcome() : s.step === 1 ? onbAreas() : s.step === 2 ? onbAi() : s.step === 3 ? onbEmail() : s.step === 4 ? onbPhone() : onbDone();
  document.getElementById('onb').innerHTML = `<div class="onb-bg"><div class="onb-card" role="dialog" aria-modal="true" aria-label="Welcome to Daybook">
    <button class="onb-skip" data-onb-finish>${s.step === last ? '' : 'Skip setup'}</button>
    <div class="onb-dots">${dots}</div>
    <div class="onb-body">${content}</div>
    <div class="onb-foot">${s.step > 0 ? '<button class="ghost" data-onb-back>← Back</button>' : '<span></span>'}<button class="add-btn wide" data-onb-next>${s.step === last ? 'Open Daybook' : 'Next →'}</button></div>
  </div></div>`;
  const f = document.getElementById('onb-mail-email'); if (f) f.focus();
}
async function onbSaveAi(provider) {
  const el = document.querySelector(`[data-onb-ai="${provider}"]`); const value = (el && el.value || '').trim();
  if (!value) { toast('Paste a key first'); return; }
  try { state.onb.account = await api('/api/account/ai-key', { method: 'POST', body: JSON.stringify({ provider, value }) }); toast('Key saved'); renderOnboarding(); }
  catch (e) { toast(e.message); }
}
async function onbConnectGmail() {
  const email = (document.getElementById('onb-mail-email') || {}).value; const pass = (document.getElementById('onb-mail-pass') || {}).value;
  if (!email || !email.trim() || !pass) { toast('Enter your Gmail address and app password'); return; }
  const p = MAIL_PRESETS.google;
  const btn = document.querySelector('[data-onb-mail-connect]'); if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    await mailApi('/accounts', { method: 'POST', body: JSON.stringify({ email: email.trim(), username: email.trim(), imapHost: p.imap, imapPort: p.imapPort, smtpHost: p.smtp, smtpPort: p.smtpPort, pass }) });
    state.onb.mailDone = true; toast('Mailbox connected'); renderOnboarding();
  } catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Connect Gmail'; } }
}

// While a text field is focused the soft keyboard is up, and on iOS a
// position:fixed bottom bar floats awkwardly above it. Hide the mobile tab bar
// while typing (body.kb-open); restore it once focus leaves all text fields.
(function () {
  const isText = (el) => {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes((el.type || 'text').toLowerCase());
    return false;
  };
  document.addEventListener('focusin', (e) => { if (isText(e.target)) document.body.classList.add('kb-open'); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!isText(document.activeElement)) document.body.classList.remove('kb-open'); }, 60); });
})();

(async function boot() {
  initTheme();
  // Session hand-off from the apex (see goToMyDaybook): #t=<jwt> signs this
  // origin in on arrival, then the fragment is wiped from the URL.
  let preEmail = '';
  try {
    const h = location.hash.match(/^#t=([A-Za-z0-9._~%-]+)$/);
    if (h) { localStorage.setItem(KEY, decodeURIComponent(h[1])); history.replaceState(null, '', location.pathname + location.search); }
    // Arriving from the marketing page's sign-in box, which asks for an email and
    // nothing else. Consumed once and wiped from the URL, so a reload lands on a
    // plain gate rather than re-sending a code into the resend cooldown.
    const e = location.hash.match(/^#e=(.+)$/);
    if (e) { preEmail = decodeURIComponent(e[1]).trim(); history.replaceState(null, '', location.pathname + location.search); }
  } catch {}
  // Invite link: /join/CODE (or ?invite=CODE) stashes the code so the signup
  // never has to ask for it, then tidies the URL.
  let invited = false;
  try {
    const m = location.pathname.match(/^\/join\/([A-Za-z0-9-]{4,24})$/);
    const code = (m && m[1]) || new URLSearchParams(location.search).get('invite');
    // Tidy the code out of the URL but stay on /join: that path still serves the
    // app shell, so refreshing mid-signup doesn't dump them on the marketing page.
    if (code) { localStorage.setItem('life.invite', code.toUpperCase()); history.replaceState(null, '', '/join'); }
    invited = !!storedInvite();
  } catch {}
  if (!token()) {
    showGate(invited ? "You've been invited to Daybook. Sign in with your email to accept." : null);
    // They already typed it and pressed Continue; asking again would be a second
    // click for the same intent.
    if (preEmail) { const el = $('#gate-email'); if (el) { el.value = preEmail; gateSend('email'); } }
    return;
  }
  // Multi-tenant only: a signed-in email with no account yet must claim one
  // first. On the single-tenant app /api/me 404s, so this is a no-op.
  try {
    const me = await api('/api/me');
    if (me && me.needsSignup) { showSignup(me.email, me.inviteRequired, invited || me.invited); return; }
    // daybook.fyi is the marketing site, not anybody's Daybook. Someone who
    // arrived on a join link and already has an account belongs on their own
    // subdomain, signed in - not staring at "Request an invite".
    if (me && me.user && onApex() && me.user.subdomain) { goToMyDaybook(me.user.subdomain); return; }
    if (me && me.user) state.me = me.user;
  } catch {}
  try {
    let modKv;
    [state.noteTops, state.tables, state.areas, state.favs, modKv] = await Promise.all([
      api('/api/blocks?kind=note&parent_id='), api('/api/blocks?kind=table'), api('/api/blocks?kind=area'),
      api('/api/favorites').catch(() => []),
      api('/api/kv/modules').catch(() => null),
    ]);
    try { state.modules = JSON.parse((modKv && modKv.value) || '{}') || {}; } catch { state.modules = {}; }
    state.tables.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    state.areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    // Deep link: a home-screen icon pinned to /calendar opens straight there.
    const savedTabs = readLS('life.tabs', null);
    if (savedTabs && Array.isArray(savedTabs.tabs) && savedTabs.tabs.length) {
      state.tabs = savedTabs.tabs.map((t) => ({ id: uid(), view: t.view || { type: 'home' }, label: t.label || 'Home', pinned: !!t.pinned }));
      state.activeTab = (state.tabs[savedTabs.active] || state.tabs[0]).id;
    } else { state.tabs = [{ id: uid(), view: { type: 'home' }, label: 'Home' }]; state.activeTab = state.tabs[0].id; }
    const route = location.pathname.replace(/\/$/, '');
    const mailtoParam = new URLSearchParams(location.search).get('mailto');
    if (mailtoParam) { history.replaceState(null, '', location.pathname); await openMailCompose(parseMailto(mailtoParam)).catch(() => openHome()); }
    else if (route === '/calendar') await openCalendar();
    else if (route === '/mail') await openMail();
    else if (route === '/journal') await openJournal();
    // The morning email links here. /dreams opens Reflection with the prompt
    // picker up, where the dream prompts are waiting - it deliberately does NOT
    // create an entry, because a link in an email must not write anything.
    else if (route === '/dreams') { await openJournal(); if (state.journal) { state.journal.picking = true; renderJournalList(); } }
    else if (route === '/goals') await openGoals();
    else if (route === '/today') await openToday();
    else if (route === '/tasks') { if (new URLSearchParams(location.search).get('p1') === '1') openP1Tasks(); else await openTasks(); }
    else if (route === '/saved' || route === '/read') await openReadwatch();
    else await Promise.resolve(openView(state.tabs.find((t) => t.id === state.activeTab).view)).catch(() => openHome());
    startMailUnreadPoll();   // show the Mail unread badge from the moment the app loads
    startPresence();         // heartbeat so friends can see you're online
    startFriendStatusPoll(); // Contacts badge + Home "People" section
    // The "People on Home" preference follows the account across devices.
    api('/api/kv/home_people').then((r) => { if (r && (r.value === '0' || r.value === '1')) { try { localStorage.setItem('life.home.people', r.value); } catch {} if (state.view && state.view.type === 'home') renderHome(); } }).catch(() => {});
    initPush();              // register the SW; refresh the push subscription if already granted
    registerMailHandler();   // offer Robski Life as the browser's mailto: handler
    syncAccentFromServer();  // pick up a custom accent colour saved on another device
    maybeOnboard();          // first-run welcome guide, once per new account
  } catch (e) { toast(e.message); renderNav(); }
})();
