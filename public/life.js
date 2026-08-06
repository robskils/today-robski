// Robski Life — tasks + areas on the block core, sharing Today's login.

const $ = (s, r = document) => r.querySelector(s);
const KEY = 'today.token';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { areas: [], tasks: [], filter: null, query: '', results: null };
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
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}

const areaById = (id) => state.areas.find((a) => a.id === id);
const hueOf = (a) => (a && a.props && Number.isFinite(a.props.hue) ? a.props.hue : 220);

// ── load ─────────────────────────────────────────────
async function load() {
  const [areas, tasks] = await Promise.all([
    api('/api/blocks?kind=area'),
    api('/api/blocks?kind=task'),
  ]);
  state.areas = areas.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  state.tasks = tasks;
  renderAreas(); renderAreaSelect(); renderList();
}

// ── areas ────────────────────────────────────────────
function openCount(areaId) {
  return state.tasks.filter((t) => !t.props.done && (areaId ? t.props.area === areaId : true)).length;
}

function renderAreas() {
  const rows = state.areas.map((a) => `
    <button class="area ${state.filter === a.id ? 'on' : ''}" style="--h:${hueOf(a)}" data-area="${a.id}">
      <span class="swatch"></span>
      <span class="n">${esc(a.title)}</span>
      <span class="count">${openCount(a.id) || ''}</span>
      <span class="x" data-del-area="${a.id}" title="Delete area">×</span>
    </button>`).join('');
  $('#areas').innerHTML = `
    <button class="area ${state.filter === null ? 'on' : ''}" style="--h:220" data-area="">
      <span class="swatch" style="background:var(--ink-3)"></span>
      <span class="n">All tasks</span><span class="count">${openCount(null) || ''}</span>
    </button>${rows}`;
}

function renderAreaSelect() {
  $('#task-area').innerHTML = `<option value="">No area</option>` +
    state.areas.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
  if (state.filter) $('#task-area').value = state.filter;
}

// ── task list ────────────────────────────────────────
function taskRow(t) {
  const a = areaById(t.props.area);
  const tag = a ? `<span class="tag" style="--h:${hueOf(a)}">${esc(a.title)}</span>` : '';
  const p = t.props.priority;
  const prio = p && p !== 'P3' ? `<span class="prio ${p}">${p}</span>` : '';
  return `<div class="task ${t.props.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check" data-check="${t.id}" aria-label="Complete">✓</button>
    <span class="t" data-edit="${t.id}">${esc(t.title)}</span>
    ${prio}${tag}
    <button class="x" data-del="${t.id}" aria-label="Delete">×</button>
  </div>`;
}

function renderList() {
  // Search mode: show whatever the server matched, across every kind.
  if (state.results !== null) {
    $('#scope').innerHTML = `<b>${state.results.length}</b> result${state.results.length === 1 ? '' : 's'} for “${esc(state.query)}”`;
    const rows = state.results.map((b) => b.kind === 'task' ? taskRow(b)
      : `<div class="task" data-id="${b.id}"><span class="t" style="cursor:default">${esc(b.title || '(untitled)')}</span><span class="tag" style="--h:200">${esc(b.kind)}</span></div>`).join('');
    $('#list').innerHTML = rows;
    $('#empty').hidden = state.results.length > 0;
    $('#empty').textContent = 'Nothing found.';
    return;
  }

  let ts = state.tasks.slice();
  if (state.filter) ts = ts.filter((t) => t.props.area === state.filter);
  // Open first (newest at top), done last.
  ts.sort((a, b) => (a.props.done ? 1 : 0) - (b.props.done ? 1 : 0)
    || (b.created_at || '').localeCompare(a.created_at || ''));

  const a = areaById(state.filter);
  $('#scope').innerHTML = a ? `In <b>${esc(a.title)}</b>` : `<b>${ts.filter((t) => !t.props.done).length}</b> open`;
  $('#list').innerHTML = ts.map(taskRow).join('');
  $('#empty').hidden = ts.length > 0;
  $('#empty').textContent = a ? `Nothing in ${a.title} yet.` : 'No tasks yet. Add one above.';
}

// ── actions ──────────────────────────────────────────
async function addArea(title) {
  const hue = (state.areas.length * 47) % 360;
  const b = await api('/api/blocks', { method: 'POST', body: JSON.stringify({ kind: 'area', title, props: { hue } }) });
  state.areas.push(b); state.areas.sort((x, y) => (x.title || '').localeCompare(y.title || ''));
  renderAreas(); renderAreaSelect();
}

async function addTask(title, area, priority) {
  const b = await api('/api/blocks', {
    method: 'POST',
    body: JSON.stringify({ kind: 'task', title, props: { area: area || null, priority: priority || null, done: false } }),
  });
  state.tasks.push(b); renderAreas(); renderList();
}

async function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const done = !t.props.done; t.props.done = done;               // optimistic
  renderAreas(); renderList();
  try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ props: { done, done_at: done ? new Date().toISOString() : null } }) }); }
  catch (e) { t.props.done = !done; renderList(); toast(e.message); }
}

async function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id); renderAreas(); renderList();
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); load(); }
}

async function deleteArea(id) {
  const a = areaById(id); if (!a) return;
  if (openCount(id) && !confirm(`Delete “${a.title}”? Its tasks stay, just without an area.`)) return;
  state.areas = state.areas.filter((x) => x.id !== id);
  if (state.filter === id) state.filter = null;
  renderAreas(); renderAreaSelect(); renderList();
  try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); load(); }
}

// Inline rename: click the title, edit, Enter or blur to save.
function editTitle(span, id) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const input = document.createElement('input');
  input.type = 'text'; input.value = t.title; input.className = 'inline-edit';
  input.style.cssText = 'flex:1;font:inherit;font-size:17px;padding:2px 6px;border:1px solid var(--accent);border-radius:6px;background:var(--card);color:var(--ink)';
  span.replaceWith(input); input.focus(); input.select();
  let done = false;
  const save = async () => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (v && v !== t.title) { t.title = v; try { await api(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify({ title: v }) }); } catch (e) { toast(e.message); } }
    renderList();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { done = true; renderList(); } });
  input.addEventListener('blur', save);
}

// ── search ───────────────────────────────────────────
let searchT;
function onSearch(v) {
  state.query = v.trim();
  clearTimeout(searchT);
  if (!state.query) { state.results = null; renderList(); return; }
  searchT = setTimeout(async () => {
    try { state.results = await api(`/api/search?q=${encodeURIComponent(state.query)}`); renderList(); }
    catch (e) { toast(e.message); }
  }, 180);
}

// ── events ───────────────────────────────────────────
$('#areas').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del-area]');
  if (del) { e.stopPropagation(); deleteArea(del.dataset.delArea); return; }
  const a = e.target.closest('[data-area]');
  if (a) { state.filter = a.dataset.area || null; $('#q').value = ''; state.results = null; state.query = ''; renderAreas(); renderAreaSelect(); renderList(); }
});

$('#list').addEventListener('click', (e) => {
  const c = e.target.closest('[data-check]'); if (c) return toggleTask(c.dataset.check);
  const d = e.target.closest('[data-del]'); if (d) return deleteTask(d.dataset.del);
  const ed = e.target.closest('[data-edit]'); if (ed) return editTitle(ed, ed.dataset.edit);
});

$('#area-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#area-name'); const v = inp.value.trim();
  if (v) { addArea(v).catch((err) => toast(err.message)); inp.value = ''; }
});

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#task-title'); const v = inp.value.trim(); if (!v) return;
  addTask(v, $('#task-area').value, $('#task-prio').value).catch((err) => toast(err.message));
  inp.value = ''; inp.focus();
});

$('#q').addEventListener('input', (e) => onSearch(e.target.value));

$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('today.theme', dark ? 'dark' : 'light');
});

load().catch((e) => toast(e.message));
