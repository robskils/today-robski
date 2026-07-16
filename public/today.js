// today.robski.uk

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'today.key';
const THEME_STORE = 'today.theme';

const state = {
  key: localStorage.getItem(KEY_STORE) || '',
  day: null,          // YYYY-MM-DD being viewed
  today: null,
  data: null,         // last /api/day payload
  lanes: [],
  tasks: [],
  counts: {},
  filter: 'all',
  search: '',
  editing: null,      // slot being edited, or a task being placed
};

// ── util ──────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const minOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function humanMin(m) {
  if (!m) return '0m';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

function laneMeta(key) {
  return state.lanes.find((l) => l.key === key) || { key, label: key, hue: 0 };
}

// Serialising a text node escapes & < >, but not quotes, which is not enough
// inside a quoted attribute. Task titles and field values come from Tana, so
// escape for both positions.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function localToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function shiftDay(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd + n));
  return dt.toISOString().slice(0, 10);
}

// ── api ───────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.key}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (res.status === 401) { gateOut('That key was not accepted.'); throw new Error('unauthorized'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── gate ──────────────────────────────────────────────────────────────

function gateOut(msg) {
  state.key = '';
  localStorage.removeItem(KEY_STORE);
  $('app').hidden = true;
  $('gate').hidden = false;
  if (msg) { $('gate-err').textContent = msg; $('gate-err').hidden = false; }
}

$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.key = $('gate-key').value.trim();
  $('gate-err').hidden = true;
  try {
    await api('/api/day');
    localStorage.setItem(KEY_STORE, state.key);
    $('gate').hidden = true;
    $('app').hidden = false;
    boot();
  } catch {
    $('gate-err').textContent = 'That key was not accepted.';
    $('gate-err').hidden = false;
  }
});

// ── render: rail ──────────────────────────────────────────────────────

const R = 15;
const CIRC = 2 * Math.PI * R;

function renderRail() {
  const { progress, settings } = state.data;

  $('rail').innerHTML = state.lanes.map((l) => {
    const p = progress[l.key] || { planned: 0, done: 0 };
    const target = Number(settings[`target_${l.key}`] || 0);

    // Untracked lanes (Other) have no target, so show a plain count.
    if (!target) {
      if (!p.planned) return '';
      return `<button class="lane" style="--h:${l.hue}" data-lane-add="${l.key}">
        <div class="lane-txt">
          <span class="lane-name">${esc(l.label)}</span>
          <span class="lane-min">${humanMin(p.done)} done</span>
        </div></button>`;
    }

    const pct = Math.min(1, p.done / target);
    const planPct = Math.min(1, Math.max(p.planned, p.done) / target);
    const hit = p.done >= target;
    const stretch = Number(settings[`stretch_${l.key}`] || 0);

    // Kept short so all seven lanes fit without scrolling. The planned arc
    // carries what the text used to say.
    let sub = `${humanMin(p.done)} / ${humanMin(target)}`;
    if (hit && stretch && p.done < stretch) sub = `${humanMin(p.done)} · ${humanMin(stretch)}?`;
    else if (hit) sub = `${humanMin(p.done)} ✓`;

    const planned = p.planned > p.done ? `, ${humanMin(p.planned - p.done)} more planned` : '';
    const opt = l.optional ? ' (optional)' : '';

    return `<button class="lane ${hit ? 'hit' : ''} ${l.optional ? 'optional' : ''}"
        style="--h:${l.hue}" data-lane-add="${l.key}"
        title="${esc(l.label)}${opt}: ${humanMin(p.done)} of ${humanMin(target)} done${planned}. Click to add a block.">
      <svg class="lane-ring" viewBox="0 0 34 34" aria-hidden="true">
        <circle class="track" cx="17" cy="17" r="${R}"></circle>
        <circle class="plan" cx="17" cy="17" r="${R}"
          stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC * (1 - planPct)}"></circle>
        <circle class="fill" cx="17" cy="17" r="${R}"
          stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC * (1 - pct)}"></circle>
      </svg>
      <div class="lane-txt">
        <span class="lane-name">${esc(l.label)}</span>
        <span class="lane-min">${sub}</span>
      </div>
    </button>`;
  }).join('');
}

// ── render: timeline ──────────────────────────────────────────────────

// Blocks with no time yet. They still count toward a lane's planned arc, but
// nothing about them is late, because they were never due.
function renderTray() {
  const floating = state.data.slots.filter((s) => s.start_min === null);
  $('tray').hidden = !floating.length;
  if (!floating.length) return;

  const left = floating.filter((s) => !s.done).length;
  $('tray-label').textContent = left
    ? `Any time today · ${left} waiting`
    : 'Any time today · all done';

  $('tray-items').innerHTML = floating.map((s) => {
    const l = laneMeta(s.lane);
    return `<div class="float ${s.done ? 'done' : ''}" style="--h:${l.hue}" data-slot="${s.id}">
      <div class="slot-check" data-check="${s.id}">✓</div>
      <div class="slot-body">
        <div class="slot-t">${esc(s.title)}</div>
        <div class="slot-m">${esc(l.label)} · ${humanMin(s.duration)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderTimeline() {
  const { events, settings } = state.data;
  const slots = state.data.slots.filter((s) => s.start_min !== null);
  const PPM = 1.5;

  // Widen the window if anything falls outside the configured day.
  let start = Number(settings.day_start || 360);
  let end = Number(settings.day_end || 1380);
  for (const x of [...slots, ...events.filter((e) => !e.allDay)]) {
    start = Math.min(start, Math.floor(x.start_min / 60) * 60);
    end = Math.max(end, Math.ceil((x.start_min + x.duration) / 60) * 60);
  }

  const top = (m) => (m - start) * PPM;
  const el = $('timeline');
  el.style.height = `${(end - start) * PPM + 20}px`;

  const parts = [];

  for (let m = start; m <= end; m += 30) {
    const half = m % 60 !== 0;
    parts.push(`<div class="hour ${half ? 'half' : ''}" style="top:${top(m)}px">
      <span>${half ? '' : hhmm(m)}</span></div>`);
  }

  // All-day events read as banners, not blocks.
  const allDay = events.filter((e) => e.allDay);
  for (const e of allDay) {
    parts.push(`<div class="ev" style="top:${top(start) - 4}px;height:30px;z-index:2">
      <div class="ev-t">${esc(e.title)} <span class="ev-m">all day</span></div></div>`);
  }

  for (const e of events.filter((x) => !x.allDay)) {
    const h = Math.max(26, e.duration * PPM - 3);
    parts.push(`<div class="ev" style="top:${top(e.start_min)}px;height:${h}px">
      <div class="ev-t">${esc(e.title)}</div>
      ${h > 44 ? `<div class="ev-m">${hhmm(e.start_min)}–${hhmm(e.start_min + e.duration)}${e.location ? ' · ' + esc(e.location) : ''}</div>` : ''}
    </div>`);
  }

  for (const s of slots) {
    const l = laneMeta(s.lane);
    const h = Math.max(30, s.duration * PPM - 3);
    parts.push(`<div class="slot ${s.done ? 'done' : ''} ${h < 44 ? 'tiny' : ''}"
        style="--h:${l.hue};top:${top(s.start_min)}px;height:${h}px" data-slot="${s.id}">
      <div class="slot-check" data-check="${s.id}">✓</div>
      <div class="slot-body">
        <div class="slot-t">${esc(s.title)}</div>
        ${h >= 44 ? `<div class="slot-m">${hhmm(s.start_min)}–${hhmm(s.start_min + s.duration)} · ${esc(l.label)}${s.tana_id ? ' · Tana' : ''}</div>` : ''}
      </div>
    </div>`);
  }

  if (state.day === state.today) {
    const now = new Date();
    const nowMin = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now).split(':').reduce((h, m) => Number(h) * 60 + Number(m)));
    if (nowMin >= start && nowMin <= end) {
      parts.push(`<div class="now" style="top:${top(nowMin)}px" aria-label="now"></div>`);
    }
  }

  el.innerHTML = parts.join('');
}

// ── render: tasks ─────────────────────────────────────────────────────

function renderFilter() {
  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  const chips = [`<button class="chip ${state.filter === 'all' ? 'on' : ''}" style="--h:0" data-lane="all">All<span class="chip-n">${total}</span></button>`];
  for (const l of state.lanes) {
    const n = state.counts[l.key] || 0;
    if (!n) continue;
    chips.push(`<button class="chip ${state.filter === l.key ? 'on' : ''}" style="--h:${l.hue}" data-lane="${l.key}">${esc(l.label)}<span class="chip-n">${n}</span></button>`);
  }
  $('lane-filter').innerHTML = chips.join('');
}

function renderTasks() {
  $('task-count').textContent = state.tasks.length ? `${state.tasks.length}` : '';

  if (!state.tasks.length) {
    $('task-list').innerHTML = `<p class="empty">Nothing here.</p>`;
    return;
  }

  $('task-list').innerHTML = state.tasks.map((t) => {
    const l = laneMeta(t.lane);
    const meta = [esc(l.label)];
    if (t.duration) meta.push(humanMin(t.duration));
    if (t.area && t.area !== l.label) meta.push(esc(t.area));

    return `<button class="task" style="--h:${l.hue}" data-task="${esc(t.tana_id)}">
      <div class="task-body">
        <div class="task-t">${esc(t.title)}</div>
        <div class="task-m">${meta.map((m) => `<span>${m}</span>`).join('')}</div>
      </div>
      ${t.priority ? `<span class="prio ${esc(t.priority)}">${esc(t.priority)}</span>` : ''}
    </button>`;
  }).join('');
}

// ── sheet ─────────────────────────────────────────────────────────────

function nextFreeSlot() {
  // Start from the next half hour, or the day start when looking at another day.
  if (state.day !== state.today) return Number(state.data.settings.day_start || 540);
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  return Math.ceil(minOf(now) / 30) * 30;
}

function syncFloatUI() {
  const floating = $('sheet-float').checked;
  $('sheet-start-field').style.visibility = floating ? 'hidden' : 'visible';
  $('sheet-push').hidden = floating || !state.editing?.slot;
}

function openSheet({ slot, task, lane }) {
  state.editing = { slot, task };

  $('sheet-title').textContent = slot ? 'Edit block' : 'Add to the day';
  $('sheet-save').textContent = slot ? 'Save' : 'Add';
  $('sheet-delete').hidden = !slot;

  const label = slot?.title || task?.title || '';
  $('sheet-task').textContent = label;
  $('sheet-task').hidden = !label;

  $('sheet-lane').innerHTML = state.lanes
    .map((l) => `<option value="${l.key}">${esc(l.label)}</option>`).join('');
  $('sheet-lane').value = slot?.lane || task?.lane || lane || 'zazen';

  const floating = slot ? slot.start_min === null : false;
  $('sheet-float').checked = floating;
  $('sheet-start').value = hhmm(slot && slot.start_min !== null ? slot.start_min : nextFreeSlot());

  // Tana Duration is set on only ~9% of tasks, so fall back to 30 minutes.
  $('sheet-duration').value = slot?.duration || task?.duration || defaultDuration(slot?.lane || task?.lane || lane);

  $('sheet-quick').innerHTML = [15, 25, 30, 45, 60, 90]
    .map((m) => `<button type="button" data-min="${m}">${m}m</button>`).join('');

  syncFloatUI();
  $('sheet-bg').hidden = false;
  if (!floating) $('sheet-start').focus();
}

// A siesta is an hour by default; everything else is 30 minutes.
function defaultDuration(lane) {
  return lane === 'rest' ? 60 : 30;
}

function closeSheet() {
  $('sheet-bg').hidden = true;
  state.editing = null;
}

$('sheet-quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-min]');
  if (b) $('sheet-duration').value = b.dataset.min;
});

$('sheet-cancel').addEventListener('click', closeSheet);
$('sheet-bg').addEventListener('click', (e) => { if (e.target === $('sheet-bg')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet-bg').hidden) closeSheet(); });

$('sheet-float').addEventListener('change', syncFloatUI);

// Push moves the block later without unpicking it. For when it's going well.
$('sheet-push').addEventListener('click', (e) => {
  const b = e.target.closest('[data-push]');
  if (!b) return;
  const shifted = Math.min(1440, minOf($('sheet-start').value) + Number(b.dataset.push));
  $('sheet-start').value = hhmm(shifted);
});

$('sheet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { slot, task } = state.editing;
  const floating = $('sheet-float').checked;
  const body = {
    lane: $('sheet-lane').value,
    start_min: floating ? null : minOf($('sheet-start').value),
    duration: Number($('sheet-duration').value),
  };
  if (!floating && !$('sheet-start').value) { toast('Pick a start time'); return; }

  try {
    if (slot) {
      await api(`/api/slots/${slot.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast('Updated');
    } else {
      await api('/api/slots', {
        method: 'POST',
        body: JSON.stringify({
          ...body, day: state.day,
          title: task?.title || laneMeta(body.lane).label,
          tana_id: task?.tana_id || null,
        }),
      });
      toast('Added to the day');
    }
    closeSheet();
    await loadDay();
  } catch (e2) {
    toast(e2.message);
  }
});

$('sheet-delete').addEventListener('click', async () => {
  const { slot } = state.editing;
  if (!slot) return;
  try {
    await api(`/api/slots/${slot.id}`, { method: 'DELETE' });
    closeSheet();
    toast('Removed');
    await loadDay();
  } catch (e) { toast(e.message); }
});

// ── events ────────────────────────────────────────────────────────────

async function onSlotAreaClick(e) {
  const check = e.target.closest('[data-check]');
  if (check) {
    e.stopPropagation();
    const slot = state.data.slots.find((s) => s.id === Number(check.dataset.check));
    if (!slot) return;
    try {
      await api(`/api/slots/${slot.id}`, { method: 'PATCH', body: JSON.stringify({ done: !slot.done }) });
      // Write-back to Tana is queued, not immediate: only the Mac can talk to Tana.
      if (slot.tana_id && !slot.done) toast('Done. Will tick in Tana on next sync.');
      await loadDay();
      if (slot.tana_id) await loadTasks();
    } catch (e2) { toast(e2.message); }
    return;
  }

  const el = e.target.closest('[data-slot]');
  if (el) {
    const slot = state.data.slots.find((s) => s.id === Number(el.dataset.slot));
    if (slot) openSheet({ slot });
  }
}

$('timeline').addEventListener('click', onSlotAreaClick);
$('tray-items').addEventListener('click', onSlotAreaClick);

$('task-list').addEventListener('click', (e) => {
  const el = e.target.closest('[data-task]');
  if (!el) return;
  const task = state.tasks.find((t) => t.tana_id === el.dataset.task);
  if (task) openSheet({ task });
});

$('lane-filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lane]');
  if (!b) return;
  state.filter = b.dataset.lane;
  renderFilter();
  loadTasks();
});

let searchTimer;
$('task-search').addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTasks, 220);
});

$('add-block').addEventListener('click', () => openSheet({}));

// Clicking a lane's ring drops a block straight into that lane.
$('rail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lane-add]');
  if (b) openSheet({ lane: b.dataset.laneAdd });
});
$('prev-day').addEventListener('click', () => go(shiftDay(state.day, -1)));
$('next-day').addEventListener('click', () => go(shiftDay(state.day, 1)));
$('today-btn').addEventListener('click', () => go(state.today));

$('theme-btn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_STORE, next);
});

// ── load ──────────────────────────────────────────────────────────────

function renderHead() {
  const [y, m, d] = state.day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const fmt = (o) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'UTC' }).format(dt);

  const isToday = state.day === state.today;
  $('day-title').textContent = isToday ? 'Today' : fmt({ weekday: 'long' });
  $('day-sub').textContent = fmt({ weekday: isToday ? 'long' : undefined, day: 'numeric', month: 'long' });
  $('today-btn').hidden = isToday;

  const last = state.data.last_sync;
  const el = $('sync-status');
  if (!last) {
    el.textContent = 'never synced';
    el.classList.add('stale');
  } else {
    const mins = Math.round((Date.now() - new Date(last)) / 60000);
    const stale = mins > 120;
    el.textContent = mins < 2 ? 'synced just now'
      : mins < 60 ? `synced ${mins}m ago`
      : `synced ${Math.round(mins / 60)}h ago`;
    el.classList.toggle('stale', stale);
  }
}

async function loadDay() {
  state.data = await api(`/api/day?date=${state.day}`);
  state.lanes = state.data.lanes;
  state.today = state.data.today;
  renderHead();
  renderRail();
  renderTray();
  renderTimeline();

  if (state.data.calendar_error === 'not_configured') {
    $('sync-status').textContent = 'calendar not connected';
    $('sync-status').classList.add('stale');
  }
}

async function loadTasks() {
  const p = new URLSearchParams();
  if (state.filter !== 'all') p.set('lane', state.filter);
  if (state.search) p.set('q', state.search);
  const res = await api(`/api/tasks?${p}`);
  state.tasks = res.tasks;
  state.counts = res.counts;
  renderFilter();
  renderTasks();
}

function go(day) {
  state.day = day;
  loadDay().catch((e) => toast(e.message));
}

async function boot() {
  state.day = state.day || localToday();
  try {
    await loadDay();
    await loadTasks();
  } catch (e) {
    if (e.message !== 'unauthorized') toast(e.message);
  }
}

// Keep the now-line honest without hammering the API.
setInterval(() => { if (state.data && state.day === state.today) renderTimeline(); }, 60_000);

const savedTheme = localStorage.getItem(THEME_STORE);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

if (state.key) {
  $('app').hidden = false;
  boot();
} else {
  $('gate').hidden = false;
}
