// today.robski.uk

// Lives in public/, not shared/, because the browser has to be able to fetch
// it: only public/ is served as an asset.
import { laneForEvent } from './event-lane.js';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'today.token';
const EMAIL_STORE = 'today.email';
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

// action = { label, fn }. Given an undo has to be reachable before the toast
// goes, it lingers longer than a plain message.
function toast(msg, action) {
  const t = $('toast');
  t.textContent = '';
  t.append(msg);

  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.hidden = true; action.fn(); }, { once: true });
    t.append(b);
  }

  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, action ? 7000 : 2600);
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
  // Sessions last 7 days, so this is nearly always a natural expiry.
  if (res.status === 401) { gateOut('Your session has expired. Sign in again.'); throw new Error('unauthorized'); }
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
  showStep('email');
  if (msg) gateErr(msg);
}

function gateErr(msg) {
  $('gate-err').textContent = msg || '';
  $('gate-err').hidden = !msg;
}

function showStep(step) {
  $('gate-email-form').hidden = step !== 'email';
  $('gate-code-form').hidden = step !== 'code';
  gateErr('');
}

// The API returns the same shape for both, so one helper covers both steps.
async function authPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

$('gate-email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('gate-email').value.trim().toLowerCase();
  const btn = $('gate-send');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    await authPost('/auth/request-code', { email });
    localStorage.setItem(EMAIL_STORE, email);
    $('gate-sent-to').textContent = email;
    showStep('code');
    $('gate-code').focus();
  } catch (e2) {
    gateErr(e2.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send me a code';
  }
});

$('gate-code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('gate-verify');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const { token } = await authPost('/auth/verify', {
      email: localStorage.getItem(EMAIL_STORE),
      code: $('gate-code').value.trim(),
    });
    state.key = token;
    localStorage.setItem(KEY_STORE, token);
    $('gate').hidden = true;
    $('app').hidden = false;
    boot();
  } catch (e2) {
    gateErr(e2.message);
    $('gate-code').select();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

$('gate-back').addEventListener('click', () => {
  $('gate-code').value = '';
  showStep('email');
  $('gate-email').focus();
});

// Pre-fill the address so signing in again is one tap.
{
  const last = localStorage.getItem(EMAIL_STORE);
  if (last) $('gate-email').value = last;
}

// ── render: rail ──────────────────────────────────────────────────────

const R = 15;
const CIRC = 2 * Math.PI * R;

function renderRail() {
  const { progress, settings } = state.data;

  $('rail').innerHTML = state.lanes.map((l) => {
    const p = progress[l.key] || { planned: 0, done: 0 };
    const target = Number(settings[`target_${l.key}`] || 0);

    // No-target lanes show a plain count, no ring. The catch-all (Other) only
    // appears once it holds something; a named lane like Maya is always there,
    // just without a goal - a relationship owes no daily quota of minutes.
    if (!target) {
      if (l.untracked && !p.planned) return '';
      const sub = p.done ? `${humanMin(p.done)} done` : 'no set time';
      return `<button class="lane" style="--h:${l.hue}" data-lane-add="${l.key}" draggable="true"
          title="${esc(l.label)}: no daily target. Click to add a block, or drag it onto the schedule.">
        <div class="lane-txt">
          <span class="lane-name">${esc(l.label)}</span>
          <span class="lane-min">${sub}</span>
        </div></button>`;
    }

    const pct = Math.min(1, p.done / target);
    const planPct = Math.min(1, Math.max(p.planned, p.done) / target);
    const hit = p.done >= target;

    // Kept short so all the lanes fit without scrolling. The planned arc
    // carries what the text used to say.
    const sub = hit ? `${humanMin(p.done)} ✓` : `${humanMin(p.done)} / ${humanMin(target)}`;

    const planned = p.planned > p.done ? `, ${humanMin(p.planned - p.done)} more planned` : '';
    const opt = l.optional ? ' (optional)' : '';

    return `<button class="lane ${hit ? 'hit' : ''} ${l.optional ? 'optional' : ''}"
        style="--h:${l.hue}" data-lane-add="${l.key}" draggable="true"
        title="${esc(l.label)}${opt}: ${humanMin(p.done)} of ${humanMin(target)} done${planned}. Click to add a block, or drag it onto the schedule.">
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

// ── adopting calendar events ──────────────────────────────────────────

// The matcher itself lives in shared/event-lane.js, pure and tested.
const eventLane = (title) =>
  laneForEvent(title, state.lanes, state.data.activities || []);

// The block standing in for a given calendar event, if it's been adopted.
const slotForEvent = (id) =>
  state.data.slots.find((s) => s.event_id === id);

// ── render: timeline ──────────────────────────────────────────────────

// Blocks with no time yet. They still count toward a lane's planned arc, but
// nothing about them is late, because they were never due.
function renderTray() {
  const floating = state.data.slots.filter((s) => s.start_min === null);
  $('tray').hidden = !floating.length;
  if (!floating.length) return;

  // Category blocks already count, so only task blocks can be "waiting".
  const left = floating.filter((s) => !s.practice && !s.done).length;
  $('tray-label').textContent = left
    ? `Any time today · ${left} waiting`
    : 'Any time today';

  $('tray-items').innerHTML = floating.map((s) => {
    const l = laneMeta(s.lane);
    return `<div class="float ${!s.practice && s.done ? 'done' : ''} ${s.practice ? 'practice' : ''}" style="--h:${l.hue}" data-slot="${s.id}">
      ${s.practice ? '' : `<div class="slot-check" data-check="${s.id}">✓</div>`}
      <div class="slot-body">
        <div class="slot-t">${esc(s.title)}</div>
        <div class="slot-m">${esc(l.label)} · ${humanMin(s.duration)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── render: what the day held ─────────────────────────────────────────

// A record of the day, not a scoreboard. Time per category, because that's
// what the practice actually is, and the task count kept deliberately quiet
// underneath it: Robin's point is that it was never about how many.
function renderTally() {
  const { progress } = state.data;
  const el = $('tally');

  const done = state.lanes
    .map((l) => ({ l, min: (progress[l.key] || {}).done || 0 }))
    .filter((x) => x.min > 0)
    .sort((a, b) => b.min - a.min);

  // Nothing yet is not a failure worth a panel. Say nothing.
  if (!done.length) { el.hidden = true; return; }
  el.hidden = false;

  // Count each task once, however many blocks it was dropped into.
  const ticked = new Set();
  for (const s of state.data.slots) {
    for (const t of s.tasks || []) if (t.done) ticked.add(t.tana_id);
  }
  const n = ticked.size;

  const total = done.reduce((sum, x) => sum + x.min, 0);
  const chips = done.map(({ l, min }) =>
    `<li style="--h:${l.hue}"><span class="tally-dot"></span>
      <span class="tally-name">${esc(l.label)}</span>
      <span class="tally-min">${humanMin(min)}</span></li>`).join('');

  el.innerHTML = `
    <h2 class="tally-h">Today held <span>${humanMin(total)}</span></h2>
    <ul class="tally-list">${chips}</ul>
    ${n ? `<p class="tally-tasks">${n} task${n === 1 ? '' : 's'} finished along the way.</p>` : ''}`;
}

function renderQuote() {
  const q = state.data.quote;
  $('quote').hidden = !q;
  if (!q) return;
  $('quote-text').textContent = `“${q.text}”`;
  $('quote-author').textContent = q.author ? `— ${q.author}` : '';
  requestAnimationFrame(() => $('quote').classList.add('in'));
}

const ENSO_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M44 14a24 24 0 1 0 9 18" fill="none" stroke="currentColor"
        stroke-width="3.5" stroke-linecap="round"/></svg>`;

const PPM = 1.5;        // pixels per minute
const SNAP = 15;        // drops land on the nearest quarter hour

function renderTimeline() {
  const { events, settings } = state.data;
  // A block adopted from a calendar event is drawn as that event, not a second
  // time beside it. It still counts toward the lane: the worker totals every
  // slot, whatever draws it.
  const slots = state.data.slots.filter((s) => s.start_min !== null && !s.event_id);
  const el = $('timeline');

  // An empty day isn't a gap to apologise for, and it shouldn't render as
  // seventeen hours of blank ruled paper either. Collapse to an ensō.
  if (!slots.length && !events.length) {
    el.style.height = '300px';
    el.innerHTML = `<div class="enso-empty">${ENSO_SVG}<p>Nothing scheduled. Just this.</p></div>`;
    // Collapsed, so there's no time axis to drop onto. A drop here falls back
    // to the next half hour rather than guessing from a meaningless y.
    state.tl = { empty: true };
    return;
  }

  // Widen the window if anything falls outside the configured day.
  let start = Number(settings.day_start || 360);
  let end = Number(settings.day_end || 1380);
  for (const x of [...slots, ...events.filter((e) => !e.allDay)]) {
    start = Math.min(start, Math.floor(x.start_min / 60) * 60);
    end = Math.max(end, Math.ceil((x.start_min + x.duration) / 60) * 60);
  }

  const top = (m) => (m - start) * PPM;
  el.style.height = `${(end - start) * PPM + 20}px`;
  state.tl = { empty: false, start, end };

  const parts = [];

  for (let m = start; m <= end; m += 30) {
    const half = m % 60 !== 0;
    parts.push(`<div class="hour ${half ? 'half' : ''}" style="top:${top(m)}px">
      <span>${half ? '' : hhmm(m)}</span></div>`);
  }

  // Hidden until the event is hovered: removing something from the real
  // calendar shouldn't be a target you can hit while reaching for anything else.
  const evDel = (e) =>
    `<button class="ev-x" data-ev-del="${esc(e.id)}" title="Delete from Google Calendar"
       aria-label="Delete ${esc(e.title)}">×</button>`;

  // All-day events read as banners, not blocks.
  const allDay = events.filter((e) => e.allDay);
  for (const e of allDay) {
    parts.push(`<div class="ev" style="top:${top(start) - 4}px;height:30px;z-index:2">
      <div class="ev-t">${esc(e.title)} <span class="ev-m">all day</span></div>
      ${evDel(e)}</div>`);
  }

  for (const e of events.filter((x) => !x.allDay)) {
    const h = Math.max(26, e.duration * PPM - 3);

    // An all-day event has no length to credit, so only timed ones adopt.
    const laneKey = eventLane(e.title);
    const l = laneKey ? laneMeta(laneKey) : null;
    const taken = !!slotForEvent(e.id);

    const cls = ['ev', l ? 'adoptable' : '', taken ? 'adopted' : ''].filter(Boolean).join(' ');
    const hue = l ? `--h:${l.hue};` : '';
    const attr = l ? ` data-ev-adopt="${esc(e.id)}" role="button" tabindex="0"` : '';
    const hint = l
      ? ` title="${esc(e.title)} counts as ${esc(l.label)}. Click to ${taken ? 'stop counting it' : 'count it'}."`
      : '';

    parts.push(`<div class="${cls}" style="${hue}top:${top(e.start_min)}px;height:${h}px"${attr}${hint}>
      <div class="ev-t">${esc(e.title)}${taken ? ` <span class="ev-tick">✓ ${esc(l.label)}</span>` : ''}</div>
      ${h > 44 ? `<div class="ev-m">${hhmm(e.start_min)}–${hhmm(e.start_min + e.duration)}${e.location ? ' · ' + esc(e.location) : ''}</div>` : ''}
      ${evDel(e)}</div>`);
  }

  for (const s of slots) {
    const l = laneMeta(s.lane);
    const h = Math.max(30, s.duration * PPM - 3);
    const tasks = s.tasks || [];

    // List the contents whenever there are any, so dropping one task on a block
    // shows it. The exception is a block that *is* a single task - its title is
    // already that task, so repeating it says nothing. roomFor is how many rows
    // the block's height allows; the rest fold into a "+N more" that opens the
    // editor, where the full list lives.
    const titled = tasks.length === 1 && tasks[0].title === s.title;
    const listTasks = titled ? [] : tasks;
    const roomFor = Math.max(0, Math.floor((h - 52) / 22));
    const showTasks = listTasks.length > 0;

    // A category block (bare practice) counts by being here; no tick. Anything
    // carrying tasks keeps its checkbox. `practice` comes from the server.
    parts.push(`<div class="slot ${!s.practice && s.done ? 'done' : ''} ${h < 44 ? 'tiny' : ''} ${s.practice ? 'practice' : ''}"
        style="--h:${l.hue};top:${top(s.start_min)}px;height:${h}px"
        data-slot="${s.id}" data-drop-slot="${s.id}">
      <div class="slot-grip slot-grip-top" data-grip="top" data-slot-grip="${s.id}"
           title="Drag to change the start"></div>
      ${s.practice ? '' : `<div class="slot-check" data-check="${s.id}">✓</div>`}
      <div class="slot-body">
        <div class="slot-t">${esc(s.title)}</div>
        ${h >= 44 ? `<div class="slot-m">${hhmm(s.start_min)}–${hhmm(s.start_min + s.duration)} · ${esc(l.label)}${tasks.length ? ` · ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : ''}</div>` : ''}
        ${showTasks ? `<div class="slot-tasks">${listTasks.slice(0, roomFor).map((t) => `
          <div class="slot-task ${t.done ? 'done' : ''}">
            <button class="slot-task-check" data-check-task="${esc(t.tana_id)}"
                    aria-label="Mark done: ${esc(t.title)}">✓</button>
            <span class="slot-task-t" data-edit-task="${s.id}:${esc(t.tana_id)}"
                  title="Edit name and length">${esc(t.title)}</span>
            <span class="slot-task-len" data-edit-task="${s.id}:${esc(t.tana_id)}"
                  title="Edit length">${taskLen(t)}m</span>
            <button class="slot-task-x" data-unlink="${s.id}:${esc(t.tana_id)}"
                    aria-label="Take out of this block">×</button>
          </div>`).join('')}
          ${listTasks.length > roomFor
            ? `<button class="slot-more" data-more="${s.id}">${roomFor === 0
                ? `Show ${listTasks.length} task${listTasks.length === 1 ? '' : 's'}`
                : `+${listTasks.length - roomFor} more`}</button>`
            : ''}
        </div>` : ''}
      </div>
      ${s.url ? `<a class="slot-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"
                    aria-label="Open ${esc(s.title)}">↗</a>` : ''}
      <button class="slot-x" data-slot-del="${s.id}"
              title="Take off the schedule. The task itself is untouched."
              aria-label="Take ${esc(s.title)} off the schedule">×</button>
      <div class="slot-grip slot-grip-bottom" data-grip="bottom" data-slot-grip="${s.id}"
           title="Drag to change the end"></div>
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
    const id = esc(t.tana_id);

    // The tick and the body are separate controls: one finishes the task, the
    // other schedules it. Nesting them would make the whole card ambiguous.
    // The row is also draggable onto the timeline, which is the same action as
    // clicking the body, just with the time chosen by where you let go.
    return `<div class="task" style="--h:${l.hue}" data-task-row="${id}" draggable="true">
      <button class="task-check" data-task-check="${id}"
              aria-label="Mark done: ${esc(t.title)}">✓</button>
      <button class="task-open" data-task="${id}">
        <div class="task-body">
          <div class="task-t">${esc(t.title)}</div>
          <div class="task-m">${meta.map((m) => `<span>${m}</span>`).join('')}</div>
        </div>
        ${t.priority ? `<span class="prio ${esc(t.priority)}">${esc(t.priority)}</span>` : ''}
      </button>
    </div>`;
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

// ── the practices column ──────────────────────────────────────────────
//
// An activity is a repeating thing: yoga, a sit, percussion. Unlike a task it
// is never used up, so it stays in the column however many times it's placed.
// Drag one onto the schedule, or click to pick a time.

function renderActivities() {
  const acts = state.data?.activities || [];
  // Every practice lane gets a section, even an empty one, so there's always
  // somewhere to add the first activity.
  const lanes = state.lanes.filter((l) => l.practice || acts.some((a) => a.lane === l.key));

  $('acts-panel').innerHTML = lanes.map((l) => {
    const mine = acts.filter((a) => a.lane === l.key);
    return `<section class="act-group" style="--h:${l.hue}">
      <h3 class="act-group-h">${esc(l.label)}</h3>
      ${mine.map((a) => `
        <div class="act-item" data-act="${a.id}" draggable="true"
             title="Drag onto the schedule, or click to place it">
          <button type="button" class="act-item-main" data-act-pick="${a.id}">
            <span class="act-item-t">${esc(a.title)}</span>
            <span class="act-item-m">${humanMin(a.duration)}${a.url ? ' ↗' : ''}</span>
          </button>
          <button type="button" class="act-item-x" data-act-del="${a.id}"
                  aria-label="Remove ${esc(a.title)}">×</button>
        </div>`).join('')}
      ${state.actNewLane === l.key ? `
        <div class="act-new">
          <input type="text" id="act-title" class="input input-sm" placeholder="Name" value="${esc(state.actDraft?.title || '')}">
          <input type="url" id="act-url" class="input input-sm" placeholder="Link (optional)" value="${esc(state.actDraft?.url || '')}">
          <div class="field-row">
            <input type="number" id="act-duration" class="input input-sm" min="5" max="720" step="5"
                   placeholder="Minutes" value="${Number(state.actDraft?.duration) || 30}">
            <button type="button" class="btn btn-ghost" id="act-save">Add it</button>
          </div>
        </div>`
        : `<button type="button" class="act-add" data-act-add="${l.key}">+ Add</button>`}
    </section>`;
  }).join('');

  if (state.actNewLane) $('act-title')?.focus();
}

function actById(id) {
  return (state.data?.activities || []).find((a) => a.id === Number(id));
}

$('acts-panel').addEventListener('click', async (e) => {
  // Ignore the click a drag leaves behind, or dropping one would also open
  // the editor.
  if (Date.now() - (state.dragEndedAt || 0) < 400) return;

  const pick = e.target.closest('[data-act-pick]');
  if (pick) {
    const a = actById(pick.dataset.actPick);
    if (a) openSheet({ lane: a.lane, activity: a });
    return;
  }

  const add = e.target.closest('[data-act-add]');
  if (add) {
    state.actNewLane = add.dataset.actAdd;
    state.actDraft = null;
    renderActivities();
    return;
  }

  if (e.target.closest('#act-save')) {
    const title = $('act-title').value.trim();
    if (!title) { toast('Give it a name'); return; }
    try {
      const a = await api('/api/activities', {
        method: 'POST',
        body: JSON.stringify({
          lane: state.actNewLane,
          title,
          url: $('act-url').value.trim() || null,
          duration: Number($('act-duration').value) || 30,
        }),
      });
      state.data.activities.push(a);
      state.actNewLane = null;
      state.actDraft = null;
      renderActivities();
      toast(`Added ${a.title}`);
    } catch (e2) { toast(e2.message); }
    return;
  }

  const del = e.target.closest('[data-act-del]');
  if (del) {
    const a = actById(del.dataset.actDel);
    if (!a) return;
    try {
      await api(`/api/activities/${a.id}`, { method: 'DELETE' });
      state.data.activities = state.data.activities.filter((x) => x.id !== a.id);
      renderActivities();
      toast(`Removed ${a.title}`);
    } catch (e2) { toast(e2.message); }
  }
});

// Keep what's typed if the panel re-renders mid-entry.
$('acts-panel').addEventListener('input', () => {
  if (!state.actNewLane) return;
  state.actDraft = {
    title: $('act-title')?.value || '',
    url: $('act-url')?.value || '',
    duration: $('act-duration')?.value || 30,
  };
});

$('acts-panel').addEventListener('dragstart', (e) => {
  const item = e.target.closest('[data-act]');
  if (!item) return;
  state.dragging = { kind: 'activity', id: Number(item.dataset.act) };
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', item.dataset.act);
  item.classList.add('dragging');
});

$('acts-panel').addEventListener('dragend', (e) => {
  e.target.closest('[data-act]')?.classList.remove('dragging');
  endDrag();
});

// Quietly name the practice, for the lanes where a Sōtō name is honest.
function syncZenNote() {
  const zen = laneMeta($('sheet-lane').value).zen;
  $('sheet-zen').hidden = !zen;
  if (zen) $('sheet-zen').innerHTML =
    `<span class="kanji">${esc(zen.kanji)}</span> ${esc(zen.romaji)} · ${esc(zen.gloss)}`;
}

function openSheet({ slot, task, lane, activity, blockTask }) {
  state.editing = { slot, task, activity, blockTask };

  // Editing one task that lives inside a block: only its name and its own
  // length matter. The block's lane, start and the rest don't apply here, and
  // saving must never touch the block - so those fields are hidden.
  const bt = blockTask || null;

  $('sheet-title').textContent = bt ? 'Edit task' : slot ? 'Edit block' : 'Add to the day';
  $('sheet-save').textContent = bt || slot ? 'Save' : 'Add';
  $('sheet-delete').hidden = !slot || !!bt;

  // Block/placement-only fields, off in task mode.
  $('sheet-lane-field').hidden = !!bt;
  $('sheet-float-row').hidden = !!bt;
  $('sheet-start-field').style.display = bt ? 'none' : '';

  // The name field. A Tana task behind the sheet - a task in a block, one
  // clicked in the list, or a sole-task block - renames in Tana; a bare block
  // edits only its own label.
  const blockTasks = slot?.tasks || [];
  const renameTaskId = bt?.tana_id ?? task?.tana_id
    ?? (blockTasks.length === 1 ? blockTasks[0].tana_id : null);
  const label = bt?.title || slot?.title || task?.title || activity?.title || '';

  state.editing.rename = { taskId: renameTaskId, slotId: slot?.id ?? null, orig: label };
  $('sheet-name').value = label;
  $('sheet-name').hidden = false;
  $('sheet-task').hidden = true;

  $('sheet-lane').innerHTML = state.lanes
    .map((l) => `<option value="${l.key}">${esc(l.label)}</option>`).join('');
  $('sheet-lane').value = slot?.lane || task?.lane || activity?.lane || lane || 'zazen';

  const floating = slot && !bt ? slot.start_min === null : false;
  $('sheet-float').checked = floating;
  $('sheet-start').value = hhmm(slot && slot.start_min !== null ? slot.start_min : nextFreeSlot());

  // Task mode shows this task's own length; otherwise the block/task/activity
  // duration, falling back to 30 (Tana Duration is set on only ~9% of tasks).
  $('sheet-duration').value = bt
    ? bt.duration || defaultDuration(bt.lane)
    : slot?.duration || task?.duration || activity?.duration
      || defaultDuration(slot?.lane || task?.lane || activity?.lane || lane);

  $('sheet-quick').innerHTML = [10, 15, 25, 30, 45, 60]
    .map((m) => `<button type="button" data-min="${m}">${m}m</button>`).join('');

  renderSheetTasks(bt ? null : slot);
  syncFloatUI();
  syncZenNote();
  if (bt) $('sheet-push').hidden = true;   // push is a block gesture, not a task one
  $('sheet-bg').hidden = false;
  if (bt) $('sheet-duration').focus();
  else if (!floating) $('sheet-start').focus();
}

// The full task list for a block, ticks and remove buttons and all. Anything
// that didn't fit in the block's inline view is here.
function renderSheetTasks(slot) {
  const tasks = slot?.tasks || [];
  $('sheet-tasks').hidden = !tasks.length;
  if (!tasks.length) return;

  $('sheet-tasks-label').textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'} in this block`;
  $('sheet-tasks-list').innerHTML = tasks.map((t) => `
    <div class="sheet-task-row ${t.done ? 'done' : ''}" style="--h:${laneMeta(t.lane).hue}">
      <button type="button" class="slot-task-check" data-sheet-check="${esc(t.tana_id)}"
              aria-label="Mark done: ${esc(t.title)}">✓</button>
      <span class="sheet-task-name" data-edit-task="${slot.id}:${esc(t.tana_id)}"
            title="Edit name and length">${esc(t.title)}</span>
      <span class="slot-task-len" data-edit-task="${slot.id}:${esc(t.tana_id)}"
            title="Edit length">${taskLen(t)}m</span>
      <button type="button" class="slot-task-x" data-sheet-unlink="${slot.id}:${esc(t.tana_id)}"
              aria-label="Take out of this block">×</button>
    </div>`).join('');
}

$('sheet-tasks-list').addEventListener('click', async (e) => {
  // Editing a task swaps this same sheet into task mode.
  const edit = e.target.closest('[data-edit-task]');
  if (edit) {
    openTaskEditor(edit.dataset.editTask);
    return;
  }

  const check = e.target.closest('[data-sheet-check]');
  const unlink = e.target.closest('[data-sheet-unlink]');
  try {
    if (check) {
      await tickTask(check.dataset.sheetCheck);
    } else if (unlink) {
      const [slotId, tanaId] = unlink.dataset.sheetUnlink.split(':');
      await api(`/api/slots/${slotId}/tasks/${encodeURIComponent(tanaId)}`, { method: 'DELETE' });
      await Promise.all([loadDay(), loadTasks()]);
    } else {
      return;
    }
    // Keep the open sheet in step with what just changed.
    const fresh = state.data.slots.find((s) => s.id === state.editing?.slot?.id);
    if (fresh) { state.editing.slot = fresh; renderSheetTasks(fresh); }
    else closeSheet();
  } catch (e2) { toast(e2.message); }
});

// What a fresh block of this lane is worth, before anything overrides it.
// A siesta is an hour, a body session 50 minutes; everything else 30.
const LANE_MINUTES = { rest: 60, body: 50 };
function defaultDuration(lane) {
  return LANE_MINUTES[lane] || 30;
}

// A task's own length, for display: its stored per-block length if set, else a
// default. Never the block's length - that's deliberately separate.
function taskLen(t) {
  return t.duration || defaultDuration(t.lane);
}

// Open the task editor for a "slotId:tanaId" ref. Splits on the first colon
// only, so a just-created task's `local:...` id survives intact.
function openTaskEditor(ref) {
  const i = ref.indexOf(':');
  const slotId = Number(ref.slice(0, i));
  const tanaId = ref.slice(i + 1);
  const slot = state.data.slots.find((s) => s.id === slotId);
  const bt = slot?.tasks?.find((t) => t.tana_id === tanaId);
  if (slot && bt) openSheet({ slot, blockTask: bt });
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
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('sheet-bg').hidden) closeSheet();
  else if (!$('ev-bg').hidden) closeEvent();
});

// Enter commits the rename in place, without submitting the schedule form or
// closing the sheet. Saving commits it too (see the submit handler). A plain
// blur or Cancel doesn't, so clicking away isn't a silent rename.
$('sheet-name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  commitRename();
});

async function commitRename() {
  const r = state.editing?.rename;
  if (!r) return;
  const title = $('sheet-name').value.trim();
  if (!title || title === r.orig) { $('sheet-name').value = r.orig; return; }
  r.orig = title;   // so a second blur doesn't re-send

  try {
    if (r.taskId) {
      // Renaming the task rewrites Tana; the block titled after it follows.
      await api(`/api/tasks/${encodeURIComponent(r.taskId)}`, {
        method: 'PATCH', body: JSON.stringify({ title }),
      });
      toast('Renamed. Reaches Tana within 15 min.');
      await Promise.all([loadTasks(), loadDay()]);
    } else if (r.slotId) {
      // A bare block's name is its own; nothing goes to Tana.
      await api(`/api/slots/${r.slotId}`, {
        method: 'PATCH', body: JSON.stringify({ title }),
      });
      await loadDay();
    }
    // Keep the open editor pointed at the fresh copy.
    if (state.editing?.slot) {
      const fresh = state.data.slots.find((s) => s.id === state.editing.slot.id);
      if (fresh) state.editing.slot = fresh;
    }
  } catch (e) {
    toast(e.message);
    $('sheet-name').value = r.orig;
  }
}

$('sheet-float').addEventListener('change', syncFloatUI);
$('sheet-lane').addEventListener('change', () => {
  syncZenNote();
  // A siesta wants an hour; don't make him retype it.
  const lane = $('sheet-lane').value;
  if (!state.editing?.slot && !state.editing?.task && !state.editing?.activity) {
    $('sheet-duration').value = defaultDuration(lane);
  }
});

// Push moves the block later without unpicking it. For when it's going well.
$('sheet-push').addEventListener('click', (e) => {
  const b = e.target.closest('[data-push]');
  if (!b) return;
  const shifted = Math.min(1440, minOf($('sheet-start').value) + Number(b.dataset.push));
  $('sheet-start').value = hhmm(shifted);
});

$('sheet').addEventListener('submit', async (e) => {
  e.preventDefault();
  // Save commits a pending rename first, so the block gets the new name.
  await commitRename();
  const { slot, task, activity, blockTask } = state.editing;

  // Task mode: save only this task's length onto the link. Never the block -
  // a 10-min task in a 90-min block leaves the block at 90.
  if (blockTask) {
    try {
      await api(`/api/slots/${slot.id}/tasks/${encodeURIComponent(blockTask.tana_id)}`, {
        method: 'PATCH', body: JSON.stringify({ duration: Number($('sheet-duration').value) }),
      });
      toast('Task saved');
      closeSheet();
      await loadDay();
    } catch (e2) { toast(e2.message); }
    return;
  }

  const name = $('sheet-name').value.trim();
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
          // The edited name if given, else the lane's own ("Zazen", "Rest").
          title: name || task?.title || activity?.title || laneMeta(body.lane).label,
          tana_id: task?.tana_id || null,
          url: activity?.url || null,
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

// Put a deleted block back, tasks and all. The new block gets a new id, which
// is fine: nothing outside the day's own rows refers to a slot id.
async function restoreSlot(gone) {
  try {
    const slot = await api('/api/slots', {
      method: 'POST',
      body: JSON.stringify({
        day: gone.day, lane: gone.lane, title: gone.title,
        start_min: gone.start_min, duration: gone.duration,
        note: gone.note, url: gone.url, event_id: gone.event_id,
      }),
    });
    // Sequential, not parallel: slot_tasks.position is what orders the list,
    // and firing these at once would shuffle it.
    for (const t of gone.tasks) {
      await api(`/api/slots/${slot.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ tana_id: t.tana_id }),
      });
    }
    await loadDay();
    toast('Back on the schedule');
  } catch (e) { toast(e.message); }
}

// Put an armed delete button back to a plain ×. Safe to call when nothing is
// armed, which is why every other click path can just call it unconditionally.
function disarmEvent() {
  clearTimeout(state.armedTimer);
  state.armedEvent = null;
  for (const b of document.querySelectorAll('.ev-x.armed')) {
    b.classList.remove('armed');
    b.textContent = '×';
  }
}

async function onSlotAreaClick(e) {
  // A drag or resize that just finished leaves a click behind. Ignore it, or
  // moving a block would also pop the editor.
  if (Date.now() - (state.slotGestureAt || 0) < 400) return;

  // Delete a Google Calendar event. Two clicks: the first arms the button and
  // says so, the second does it. This reaches outside the app into a calendar
  // other people may be reading, so a stray click must not be enough.
  const evDel = e.target.closest('[data-ev-del]');
  if (evDel) {
    e.stopPropagation();
    const id = evDel.dataset.evDel;
    if (state.armedEvent !== id) {
      disarmEvent();
      state.armedEvent = id;
      evDel.classList.add('armed');
      evDel.textContent = 'Delete?';
      // Forgetting it was armed and clicking later shouldn't delete anything.
      state.armedTimer = setTimeout(disarmEvent, 5000);
      return;
    }
    disarmEvent();
    try {
      await api(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Deleted from Google Calendar');
      await loadDay();
    } catch (e2) { toast(e2.message); }
    return;
  }
  disarmEvent();

  // Count a calendar event toward its lane, or stop counting it. Nothing here
  // touches Google: adopting creates a local block, dropping it deletes that
  // block, and the event on the calendar is untouched either way.
  const adopt = e.target.closest('[data-ev-adopt]');
  if (adopt) {
    e.stopPropagation();
    const id = adopt.dataset.evAdopt;
    const ev = state.data.events.find((x) => x.id === id);
    if (!ev) return;

    const existing = slotForEvent(id);
    try {
      if (existing) {
        await api(`/api/slots/${existing.id}`, { method: 'DELETE' });
        toast('No longer counted');
      } else {
        const lane = eventLane(ev.title);
        await api('/api/slots', {
          method: 'POST',
          body: JSON.stringify({
            day: state.day, lane, title: ev.title,
            start_min: ev.start_min, duration: ev.duration, event_id: id,
          }),
        });
        toast(`Counted as ${laneMeta(lane).label}`);
      }
      await loadDay();
    } catch (e2) { toast(e2.message); }
    return;
  }

  // Take a block off the schedule. This deletes the *block*, never the task:
  // slot_tasks links go, the rows in `tasks` stay exactly as they were, and
  // nothing is queued for Tana. Rebuilding a block that held several tasks by
  // hand is tedious enough to be worth an undo.
  const slotDel = e.target.closest('[data-slot-del]');
  if (slotDel) {
    e.stopPropagation();
    const slot = state.data.slots.find((s) => s.id === Number(slotDel.dataset.slotDel));
    if (!slot) return;

    // Snapshot before the delete, or there's nothing left to put back.
    const gone = { ...slot, tasks: [...(slot.tasks || [])] };
    try {
      await api(`/api/slots/${slot.id}`, { method: 'DELETE' });
      await loadDay();
      toast('Off the schedule. The task is untouched.', {
        label: 'Undo',
        fn: () => restoreSlot(gone),
      });
    } catch (e2) { toast(e2.message); }
    return;
  }

  // A task listed inside a block: tick it on its own.
  const taskCheck = e.target.closest('[data-check-task]');
  if (taskCheck) {
    e.stopPropagation();
    await tickTask(taskCheck.dataset.checkTask);
    return;
  }

  // Take a task back out of a block. Doesn't touch the task itself.
  const unlink = e.target.closest('[data-unlink]');
  if (unlink) {
    e.stopPropagation();
    const [slotId, tanaId] = unlink.dataset.unlink.split(':');
    try {
      await api(`/api/slots/${slotId}/tasks/${encodeURIComponent(tanaId)}`, { method: 'DELETE' });
      await loadDay();
    } catch (e2) { toast(e2.message); }
    return;
  }

  // Click a task's name to edit its name and its own length, not the block's.
  const editTask = e.target.closest('[data-edit-task]');
  if (editTask) {
    e.stopPropagation();
    openTaskEditor(editTask.dataset.editTask);
    return;
  }

  const check = e.target.closest('[data-check]');
  if (check) {
    e.stopPropagation();
    const slot = state.data.slots.find((s) => s.id === Number(check.dataset.check));
    if (!slot) return;
    try {
      await api(`/api/slots/${slot.id}`, { method: 'PATCH', body: JSON.stringify({ done: !slot.done }) });
      // Write-back to Tana is queued, not immediate: only the Mac can talk to Tana.
      const n = (slot.tasks || []).length;
      if (n && !slot.done) {
        toast(n === 1 ? 'Done. Ticks in Tana within 15 min.'
                      : `Done, with ${n} tasks. They tick in Tana within 15 min.`);
      }
      await Promise.all([loadDay(), n ? loadTasks() : null]);
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

$('task-list').addEventListener('click', async (e) => {
  const check = e.target.closest('[data-task-check]');
  if (check) {
    e.stopPropagation();
    await tickTask(check.dataset.taskCheck);
    return;
  }
  const el = e.target.closest('[data-task]');
  if (!el) return;
  const task = state.tasks.find((t) => t.tana_id === el.dataset.task);
  if (task) openSheet({ task });
});

// ── drag a task onto the timeline ─────────────────────────────────────
//
// Same outcome as clicking the card, but you pick the time by where you let go
// rather than typing it. Touch doesn't fire HTML5 drag events, so the click
// path stays: on a phone you tap and get the editor.

function dropMinutes(e) {
  if (state.tl?.empty) return nextFreeSlot();
  const r = $('timeline').getBoundingClientRect();
  const raw = state.tl.start + (e.clientY - r.top) / PPM;
  const snapped = Math.round(raw / SNAP) * SNAP;
  return Math.min(Math.max(snapped, state.tl.start), state.tl.end);
}

$('task-list').addEventListener('dragstart', (e) => {
  const row = e.target.closest('[data-task-row]');
  if (!row) return;
  state.dragging = { kind: 'task', id: row.dataset.taskRow };
  e.dataTransfer.effectAllowed = 'copy';
  // Firefox won't start a drag without data set.
  e.dataTransfer.setData('text/plain', row.dataset.taskRow);
  row.classList.add('dragging');
});

$('task-list').addEventListener('dragend', (e) => {
  e.target.closest('[data-task-row]')?.classList.remove('dragging');
  endDrag();
});

// Lanes drag off the rail too, which is how a bare practice block gets made
// without opening the editor at all.
$('rail').addEventListener('dragstart', (e) => {
  const chip = e.target.closest('[data-lane-add]');
  if (!chip) return;
  state.dragging = { kind: 'lane', id: chip.dataset.laneAdd };
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', chip.dataset.laneAdd);
  chip.classList.add('dragging');
});

$('rail').addEventListener('dragend', (e) => {
  e.target.closest('[data-lane-add]')?.classList.remove('dragging');
  endDrag();
});

function endDrag() {
  state.dragging = null;
  // Some browsers fire a click on the source right after a drag. Note when a
  // drag ended so the rail's click-to-add-a-block handler can ignore it - a
  // drag already placed the block, and shouldn't also pop the dialog.
  state.dragEndedAt = Date.now();
  hideDropLine();
  document.querySelectorAll('.slot.drop-target')
    .forEach((s) => s.classList.remove('drop-target'));
}

function hideDropLine() {
  document.getElementById('drop-line')?.remove();
}

function showDropLine(min) {
  let line = document.getElementById('drop-line');
  if (!line) {
    line = document.createElement('div');
    line.id = 'drop-line';
    line.className = 'drop-line';
    $('timeline').append(line);
  }
  line.style.top = `${(min - state.tl.start) * PPM}px`;
  line.dataset.at = hhmm(min);
}

$('timeline').addEventListener('dragover', (e) => {
  if (!state.dragging) return;
  e.preventDefault();                    // without this, drop never fires
  e.dataTransfer.dropEffect = 'copy';

  // Dropping a task onto an existing block puts it *in* the block. Dropping it
  // on bare timeline makes a new one. Lanes always make a new block.
  const over = state.dragging.kind === 'task' ? e.target.closest('[data-drop-slot]') : null;
  document.querySelectorAll('.slot.drop-target')
    .forEach((s) => s !== over && s.classList.remove('drop-target'));

  if (over) {
    over.classList.add('drop-target');
    hideDropLine();
  } else if (!state.tl?.empty) {
    showDropLine(dropMinutes(e));
  }
});

$('timeline').addEventListener('dragleave', (e) => {
  if (!$('timeline').contains(e.relatedTarget)) endDrag();
});

$('timeline').addEventListener('drop', async (e) => {
  e.preventDefault();
  const drag = state.dragging;
  const over = drag?.kind === 'task' ? e.target.closest('[data-drop-slot]') : null;
  const start = dropMinutes(e);
  endDrag();
  if (!drag) return;

  try {
    if (over) {
      await api(`/api/slots/${over.dataset.dropSlot}/tasks`, {
        method: 'POST', body: JSON.stringify({ tana_id: drag.id }),
      });
      toast('Added to the block');
    } else if (drag.kind === 'activity') {
      // The activity itself stays put in the column; this only places a copy.
      const a = actById(drag.id);
      if (!a) return;
      await api('/api/slots', {
        method: 'POST',
        body: JSON.stringify({
          day: state.day, lane: a.lane, title: a.title, url: a.url,
          start_min: start, duration: a.duration,
        }),
      });
      toast(`${a.title} at ${hhmm(start)}`);
    } else if (drag.kind === 'lane') {
      const l = laneMeta(drag.id);
      await api('/api/slots', {
        method: 'POST',
        body: JSON.stringify({
          day: state.day, lane: l.key, title: l.label,
          start_min: start, duration: defaultDuration(l.key),
        }),
      });
      toast(`${l.label} at ${hhmm(start)}`);
    } else {
      const task = state.tasks.find((t) => t.tana_id === drag.id);
      if (!task) return;
      await api('/api/slots', {
        method: 'POST',
        body: JSON.stringify({
          day: state.day, lane: task.lane, title: task.title, tana_id: task.tana_id,
          start_min: start, duration: task.duration || defaultDuration(task.lane),
        }),
      });
      toast(`Scheduled ${hhmm(start)}`);
    }
    await Promise.all([loadDay(), loadTasks()]);
  } catch (e2) {
    toast(e2.message);
  }
});

// ── resize a block by its edges ────────────────────────────────────────
//
// Pointer events, not HTML5 drag: this works on touch too, and a drag image
// would be nonsense for a resize.

let resize = null;
let move = null;

// The controls inside a block that a press should belong to, not a move.
const SLOT_CONTROLS = '[data-check],[data-check-task],[data-unlink],[data-edit-task],[data-more],.slot-link';

$('timeline').addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('[data-slot-grip]');
  if (grip) {
    const slot = state.data.slots.find((s) => s.id === Number(grip.dataset.slotGrip));
    if (!slot || slot.start_min === null) return;
    e.preventDefault();
    // Capture keeps the drag alive when the pointer leaves the grip, but it
    // throws if the pointer isn't active. Never let that stop the resize arming.
    try { grip.setPointerCapture(e.pointerId); } catch {}
    resize = {
      id: slot.id, edge: grip.dataset.grip, y0: e.clientY,
      start0: slot.start_min, dur0: slot.duration,
      el: grip.closest('.slot'),
    };
    resize.el.classList.add('resizing');
    return;
  }

  // Drag the body to move the whole block. Mouse and pen only: on touch a
  // vertical drag on a block is how you'd scroll the page, so a tap opens the
  // editor there instead. A tick, a link, a task row don't start a move.
  if (e.pointerType === 'touch' || (e.button !== undefined && e.button !== 0)) return;
  const slotEl = e.target.closest('[data-slot]');
  if (!slotEl || e.target.closest(SLOT_CONTROLS)) return;
  const slot = state.data.slots.find((s) => s.id === Number(slotEl.dataset.slot));
  if (!slot || slot.start_min === null) return;   // floating blocks live in the tray
  const mEl = slotEl.querySelector('.slot-m');
  move = {
    id: slot.id, ptr: e.pointerId, y0: e.clientY,
    start0: slot.start_min, dur: slot.duration, el: slotEl, moved: false,
    mEl,
    // "· Work · 2 tasks" - everything after the time range, kept as the time
    // changes under the drag.
    mSuffix: mEl ? mEl.textContent.replace(/^[^·]*/, '') : '',
  };
});

$('timeline').addEventListener('pointermove', (e) => {
  if (resize) {
    const delta = Math.round(((e.clientY - resize.y0) / PPM) / SNAP) * SNAP;
    let { start0: start, dur0: dur } = resize;
    if (resize.edge === 'top') {
      // Dragging the top moves the start and keeps the end put.
      const end = start + dur;
      start = Math.min(Math.max(start + delta, 0), end - SNAP);
      dur = end - start;
    } else {
      dur = Math.max(SNAP, Math.min(dur + delta, 1440 - start));
    }
    resize.next = { start_min: start, duration: dur };
    resize.el.style.top = `${(start - state.tl.start) * PPM}px`;
    resize.el.style.height = `${Math.max(30, dur * PPM - 3)}px`;
    const m = resize.el.querySelector('.slot-m');
    if (m) m.textContent = `${hhmm(start)}–${hhmm(start + dur)}`;
    return;
  }

  if (!move) return;
  if (!move.moved) {
    // A few pixels of slop, so a click that jitters isn't read as a drag.
    if (Math.abs(e.clientY - move.y0) < 4) return;
    move.moved = true;
    try { move.el.setPointerCapture(move.ptr); } catch {}
    move.el.classList.add('moving');
  }
  const delta = Math.round(((e.clientY - move.y0) / PPM) / SNAP) * SNAP;
  const start = Math.min(Math.max(move.start0 + delta, 0), 1440 - move.dur);
  move.next = start;
  move.el.style.top = `${(start - state.tl.start) * PPM}px`;
  if (move.mEl) move.mEl.textContent = `${hhmm(start)}–${hhmm(start + move.dur)} ${move.mSuffix}`.trim();
});

async function endPointer() {
  if (resize) {
    const { id, next, start0, dur0, el } = resize;
    resize = null;
    el.classList.remove('resizing');
    if (!next || (next.start_min === start0 && next.duration === dur0)) return;
    state.slotGestureAt = Date.now();
    return persistSlot(id, next);
  }
  if (move) {
    const { id, next, start0, el, moved } = move;
    move = null;
    el.classList.remove('moving');
    // No real drag: leave it, the click that follows opens the editor.
    if (!moved || next === undefined || next === start0) return;
    state.slotGestureAt = Date.now();   // and swallow that click
    return persistSlot(id, { start_min: next });
  }
}

async function persistSlot(id, patch) {
  try {
    await api(`/api/slots/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await loadDay();
  } catch (e) {
    toast(e.message);
    await loadDay();   // snap back to where it really is
  }
}

$('timeline').addEventListener('pointerup', endPointer);
$('timeline').addEventListener('pointercancel', endPointer);

async function tickTask(tanaId) {
  const task = state.tasks.find((t) => t.tana_id === tanaId);
  if (!task) return;

  // Strike it through straight away, then let it go on the next load. Waiting
  // for the round trip makes a tick feel like it didn't register.
  const row = document.querySelector(`[data-task-row="${CSS.escape(tanaId)}"]`);
  if (row) row.classList.add('done');

  try {
    await api(`/api/tasks/${encodeURIComponent(tanaId)}`, {
      method: 'PATCH', body: JSON.stringify({ done: true }),
    });
  } catch (e) {
    if (row) row.classList.remove('done');
    toast(e.message);
    return;
  }

  // Undoable: a mis-tap here writes to Tana, and this is a phone-sized target.
  toast(`Done. Ticks in Tana within 15 min.`, {
    label: 'Undo',
    fn: async () => {
      try {
        await api(`/api/tasks/${encodeURIComponent(tanaId)}`, {
          method: 'PATCH', body: JSON.stringify({ done: false }),
        });
        await Promise.all([loadTasks(), loadDay()]);
      } catch (e2) { toast(e2.message); }
    },
  });

  await Promise.all([loadTasks(), loadDay()]);
}

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

// ── new task ──────────────────────────────────────────────────────────

// Areas and priorities are real Tana nodes, so the form has to reference them
// by id. The agent mirrors them; fetched once and kept.
async function loadTanaOptions() {
  if (state.tanaOptions) return state.tanaOptions;
  state.tanaOptions = await api('/api/tana-options');
  return state.tanaOptions;
}

$('new-task').addEventListener('click', async () => {
  $('new-title').value = '';
  $('new-duration').value = '';
  $('new-bg').hidden = false;
  $('new-title').focus();

  try {
    const { areas, priorities } = await loadTanaOptions();
    $('new-area').innerHTML = '<option value="">(no area)</option>' +
      areas.map((a) => `<option value="${esc(a.node_id)}">${esc(a.name)}</option>`).join('');
    $('new-priority').innerHTML =
      priorities.map((p) => `<option value="${esc(p.node_id)}"${p.name === 'P3' ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  } catch (e) {
    toast(`Couldn't load areas: ${e.message}`);
  }
});

const closeNew = () => { $('new-bg').hidden = true; };
$('new-cancel').addEventListener('click', closeNew);
$('new-bg').addEventListener('click', (e) => { if (e.target === $('new-bg')) closeNew(); });

$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('new-save');
  const areaSel = $('new-area').selectedOptions[0];
  const prioSel = $('new-priority').selectedOptions[0];

  btn.disabled = true;
  btn.textContent = 'Adding...';
  try {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: $('new-title').value.trim(),
        area_id: $('new-area').value || null,
        area: areaSel && $('new-area').value ? areaSel.textContent : null,
        priority_id: $('new-priority').value || null,
        priority: prioSel ? prioSel.textContent : null,
        duration: Number($('new-duration').value) || null,
      }),
    });
    closeNew();
    // It's usable here straight away; only Tana waits for the Mac agent.
    toast('Added. Reaches Tana within 15 min.');
    await loadTasks();
  } catch (e2) {
    toast(e2.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add to Tana';
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('new-bg').hidden) closeNew(); });

$('add-block').addEventListener('click', () => openSheet({}));

// ── + Event: a real Google Calendar entry ─────────────────────────────
//
// A block is this app's own; an event is a commitment other people can see, so
// it goes to Google rather than into slots.

function openEvent() {
  $('ev-title').value = '';
  $('ev-location').value = '';
  $('ev-start').value = hhmm(nextFreeSlot());
  $('ev-duration').value = 60;
  $('ev-quick').innerHTML = [15, 30, 45, 60, 90, 120]
    .map((m) => `<button type="button" data-ev-min="${m}">${m}m</button>`).join('');
  $('ev-bg').hidden = false;
  $('ev-title').focus();
}

const closeEvent = () => { $('ev-bg').hidden = true; };

$('add-event').addEventListener('click', openEvent);
$('ev-cancel').addEventListener('click', closeEvent);
$('ev-bg').addEventListener('click', (e) => { if (e.target === $('ev-bg')) closeEvent(); });
$('ev-quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ev-min]');
  if (b) $('ev-duration').value = b.dataset.evMin;
});

$('ev-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('ev-save');
  btn.disabled = true;
  btn.textContent = 'Adding...';
  try {
    await api('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        day: state.day,
        title: $('ev-title').value.trim(),
        start_min: minOf($('ev-start').value),
        duration: Number($('ev-duration').value),
        location: $('ev-location').value.trim() || null,
      }),
    });
    closeEvent();
    toast('Added to your calendar');
    await loadDay();
  } catch (e2) {
    toast(e2.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add to Calendar';
  }
});

// Clicking a lane's ring drops a block straight into that lane.
$('rail').addEventListener('click', (e) => {
  // Ignore the click a drag leaves behind: the drop already made the block.
  if (Date.now() - (state.dragEndedAt || 0) < 400) return;
  const b = e.target.closest('[data-lane-add]');
  if (b) openSheet({ lane: b.dataset.laneAdd });
});
$('prev-day').addEventListener('click', () => go(shiftDay(state.day, -1)));
$('next-day').addEventListener('click', () => go(shiftDay(state.day, 1)));
$('today-btn').addEventListener('click', () => go(state.today));

// The inline script in index.html has already stamped data-theme before paint,
// so this only ever flips it.
$('theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_STORE, next);
});

// Follow the system until the toggle is used, then stop second-guessing it.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (localStorage.getItem(THEME_STORE)) return;
  document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
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
  renderTally();
  renderQuote();
  renderActivities();
  measureBar();

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

// The tasks column sticks below the bar, so it needs the bar's real height
// rather than a guess that breaks when the date wraps to two lines. The rail
// sticks below the bar too, and the columns stick below both, so its height
// has to be measured for the same reason: the lanes wrap, and how many rows
// they wrap to depends on the window.
function measureBar() {
  const root = document.documentElement.style;
  const h = $('app').querySelector('.bar')?.offsetHeight;
  if (h) root.setProperty('--bar-h', `${h}px`);

  // Only when it is actually sticking. Below the breakpoint the rail scrolls
  // away with everything else, and the columns must not be pushed down by it.
  const rail = $('rail');
  const stuck = rail && getComputedStyle(rail).position === 'sticky';
  root.setProperty('--rail-h', stuck ? `${rail.offsetHeight}px` : '0px');
}
addEventListener('resize', measureBar);

// Keep the now-line honest without hammering the API.
setInterval(() => { if (state.data && state.day === state.today) renderTimeline(); }, 60_000);


if (state.key) {
  $('app').hidden = false;
  boot();
} else {
  $('gate').hidden = false;
}
