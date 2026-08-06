// Robski Life — Notes. Nested pages (parent_id), prose Markdown bodies, no bullets.

const $ = (s, r = document) => r.querySelector(s);
const KEY = 'today.token';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { tops: [], current: null, path: [], children: [], editingBody: false };
const token = () => localStorage.getItem(KEY) || '';

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (res.status === 401) { localStorage.removeItem(KEY); location.replace('/'); throw new Error('unauthorized'); }
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.status === 204 ? null : res.json();
}
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

// ── a small, safe Markdown renderer (prose, deliberately no bullet lists) ──
function mdToHtml(md) {
  let s = esc(md || '');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const out = [];
  let para = [];
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

// ── load ─────────────────────────────────────────────
async function loadTops() {
  state.tops = await api('/api/blocks?kind=note&parent_id=');
  renderTops();
}
function renderTops() {
  $('#tops').innerHTML = state.tops.map((n) => `
    <button class="note-top ${state.path[0] && state.path[0].id === n.id ? 'on' : ''}" data-open="${n.id}">
      ${esc(n.title || 'Untitled')}
    </button>`).join('') || `<p class="note-empty">No notes yet.</p>`;
}

async function open(id) {
  const note = await api(`/api/blocks/${id}`);
  const path = [note];
  let p = note;
  while (p.parent_id) { p = await api(`/api/blocks/${p.parent_id}`); path.unshift(p); }
  state.current = note;
  state.path = path;
  state.editingBody = false;
  state.children = await api(`/api/blocks?kind=note&parent_id=${id}`);
  renderMain();
  renderTops();
}

// ── render the open note ─────────────────────────────
function renderMain() {
  const n = state.current;
  if (!n) {
    $('#main').innerHTML = `<div class="note-blank">Pick a note, or start a new one.</div>`;
    return;
  }
  const crumbs = state.path.map((a, i) =>
    i === state.path.length - 1
      ? `<span class="crumb cur">${esc(a.title || 'Untitled')}</span>`
      : `<button class="crumb" data-open="${a.id}">${esc(a.title || 'Untitled')}</button>`
  ).join('<span class="crumb-sep">/</span>');

  const kids = state.children.map((c) => `
    <button class="subpage" data-open="${c.id}">
      <span class="sp-ico">▸</span><span class="sp-t">${esc(c.title || 'Untitled')}</span>
    </button>`).join('');

  $('#main').innerHTML = `
    <div class="note-crumbs"><button class="crumb" data-home>Notes</button><span class="crumb-sep">/</span>${crumbs}
      <button class="note-del ghost" data-del title="Delete this note">Delete</button>
    </div>
    <input class="note-title" id="note-title" value="${esc(n.title || '')}" placeholder="Untitled" aria-label="Note title">
    <div class="note-body" id="note-body">${state.editingBody
      ? `<textarea id="body-edit" placeholder="Write in Markdown…"># heading, **bold**, *italic*, [link](https://…)">${esc(n.body || '')}</textarea>`
      : mdToHtml(n.body)}</div>
    <div class="subpages">
      <div class="sub-h">Pages inside${state.children.length ? ` · ${state.children.length}` : ''}</div>
      ${kids}
      <button class="subpage add" data-new-sub><span class="sp-ico">+</span><span class="sp-t">New page inside</span></button>
    </div>`;

  if (state.editingBody) { const t = $('#body-edit'); t.focus(); autoGrow(t); }
}

function autoGrow(t) { t.style.height = 'auto'; t.style.height = `${Math.max(160, t.scrollHeight)}px`; }

// ── actions ──────────────────────────────────────────
async function newNote(parentId) {
  const note = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'note', title: 'Untitled', body: '', parent_id: parentId || null }) });
  if (!parentId) state.tops.push(note);
  await open(note.id);
  const ti = $('#note-title'); if (ti) { ti.focus(); ti.select(); }
}

async function saveTitle(v) {
  const n = state.current; if (!n || v === n.title) return;
  n.title = v;
  const top = state.tops.find((t) => t.id === n.id); if (top) top.title = v;
  const crumb = state.path.find((p) => p.id === n.id); if (crumb) crumb.title = v;
  const cur = $('.note-crumbs .crumb.cur'); if (cur) cur.textContent = v || 'Untitled';
  try { await api(`/api/blocks/${n.id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); renderTops(); } catch (e) { toast(e.message); }
}
async function saveBody(v) {
  const n = state.current; if (!n) return;
  n.body = v; state.editingBody = false; renderMain();
  try { await api(`/api/blocks/${n.id}`, { method: 'PATCH', body: JSON.stringify({ body: v }) }); } catch (e) { toast(e.message); }
}
async function deleteNote() {
  const n = state.current; if (!n) return;
  const kids = state.children.length ? ` Its ${state.children.length} sub-page${state.children.length === 1 ? '' : 's'} will move up a level.` : '';
  if (!confirm(`Delete “${n.title || 'Untitled'}”?${kids}`)) return;
  const parent = state.path.length > 1 ? state.path[state.path.length - 2].id : null;
  try {
    await api(`/api/blocks/${n.id}`, { method: 'DELETE' });
    state.tops = state.tops.filter((t) => t.id !== n.id);
    if (parent) await open(parent); else { state.current = null; state.path = []; await loadTops(); renderMain(); }
  } catch (e) { toast(e.message); }
}

// ── search (shared box) ──────────────────────────────
let searchT;
function onSearch(v) {
  const q = v.trim();
  clearTimeout(searchT);
  if (!q) { renderMain(); return; }
  searchT = setTimeout(async () => {
    try {
      const hits = await api(`/api/search?q=${encodeURIComponent(q)}`);
      $('#main').innerHTML = `<div class="note-crumbs"><span class="crumb cur">${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}”</span></div>
        <div class="results">${hits.map((b) => `<button class="result" ${b.kind === 'note' ? `data-open="${b.id}"` : 'disabled'}>
          <span class="r-kind">${esc(b.kind)}</span><span class="r-t">${esc(b.title || '(untitled)')}</span></button>`).join('') || '<p class="note-empty">Nothing found.</p>'}</div>`;
    } catch (e) { toast(e.message); }
  }, 180);
}

// ── events ───────────────────────────────────────────
document.addEventListener('click', (e) => {
  const op = e.target.closest('[data-open]'); if (op) { open(op.dataset.open).catch((x) => toast(x.message)); return; }
  if (e.target.closest('[data-home]')) { state.current = null; state.path = []; renderMain(); renderTops(); return; }
  if (e.target.closest('[data-new-sub]')) { newNote(state.current.id).catch((x) => toast(x.message)); return; }
  if (e.target.closest('[data-del]')) { deleteNote(); return; }
  // Click the rendered body to edit it.
  if (e.target.closest('#note-body') && !state.editingBody) { state.editingBody = true; renderMain(); return; }
});
$('#new-top').addEventListener('click', () => newNote(null).catch((x) => toast(x.message)));
$('#q').addEventListener('input', (e) => onSearch(e.target.value));
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('today.theme', dark ? 'dark' : 'light');
});
// Title save + body save/grow, delegated (elements are re-rendered).
document.addEventListener('blur', (e) => {
  if (e.target.id === 'note-title') saveTitle(e.target.value.trim());
  if (e.target.id === 'body-edit') saveBody(e.target.value);
}, true);
document.addEventListener('input', (e) => { if (e.target.id === 'body-edit') autoGrow(e.target); });
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'note-title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.target.id === 'body-edit' && e.key === 'Escape') { state.editingBody = false; renderMain(); }
});

loadTops().then(() => renderMain()).catch((e) => toast(e.message));
