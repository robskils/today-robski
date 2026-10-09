// Calendar feeds: subscribe to public holidays (any country, via Nager.Date)
// and sports-team fixtures (any team, via TheSportsDB). Both are free, keyless
// (fixtures use TheSportsDB's public test key). Every feed event is a read-only
// overlay carrying `feed` + `readonly`, so the client never offers
// edit/delete/drag; ids are synthetic (`feed:<kind>:<key>`), never block ids.
// The worker fetches + caches the data and passes it in here (these builders
// stay pure). Portugal and the UK share the same clock all year, so a UK
// kickoff needs no cross-timezone shift for a Lisbon calendar.

// Years covered by an inclusive [from,to] ISO range.
export function yearsIn(from, to) {
  const a = Number(from.slice(0, 4)), b = Number(to.slice(0, 4)); const out = [];
  for (let y = a; y <= b; y++) out.push(y);
  return out;
}
// 🇵🇹 from "PT" - two Unicode regional-indicator symbols.
export function flagEmoji(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '📅';
  return String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)));
}

// ── Public holidays (Nager.Date - free, no key, ~200 countries) ──────────────
const NAGER = 'https://date.nager.at/api/v3';
// The country list for the picker: [{code, name}].
export async function fetchCountries() {
  try {
    const r = await fetch(`${NAGER}/AvailableCountries`, { headers: { 'User-Agent': 'Daybook/1.0' } });
    if (!r.ok) return [];
    const j = await r.json().catch(() => []);
    return (Array.isArray(j) ? j : []).map((c) => ({ code: c.countryCode, name: c.name })).filter((c) => c.code && c.name);
  } catch { return []; }
}
// A country's public holidays for a year -> [{date, name}] (native name).
export async function fetchHolidays(code, year) {
  const c = String(code || '').trim().toUpperCase(); const y = Number(year);
  if (!/^[A-Z]{2}$/.test(c) || !y) return [];
  try {
    const r = await fetch(`${NAGER}/PublicHolidays/${y}/${c}`, { headers: { 'User-Agent': 'Daybook/1.0' } });
    if (!r.ok) return [];
    const j = await r.json().catch(() => []);
    return (Array.isArray(j) ? j : []).map((h) => ({ date: h.date, name: h.localName || h.name })).filter((h) => h.date && h.name);
  } catch { return []; }
}

// ── Team fixtures (any team) ─────────────────────────────────────────────────
// TheSportsDB free tier (test key "3"). The user searches for their team; we
// store its id + name and fetch its next ~15 games (eventsnext) with a UTC
// timestamp, normalised to a Lisbon wall-clock {date, min}. Portugal and the UK
// share the same clock all year, so no cross-zone shift is needed for either.
const SDB = 'https://www.thesportsdb.com/api/v1/json/3';
// Format a UTC instant as Europe/Lisbon local {date:'YYYY-MM-DD', min}.
function toLisbon(dateUTC) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(dateUTC).reduce((o, p) => (o[p.type] = p.value, o), {});
    const hh = parts.hour === '24' ? 0 : Number(parts.hour);
    return { date: `${parts.year}-${parts.month}-${parts.day}`, min: hh * 60 + Number(parts.minute) };
  } catch { return null; }
}
// Turn the raw API payload into our compact fixture rows.
export function parseTeamFixtures(apiJson) {
  const evs = (apiJson && apiJson.events) || [];
  const out = [];
  for (const e of evs) {
    const ts = e.strTimestamp || (e.dateEvent && e.strTime ? `${e.dateEvent}T${e.strTime}` : null);
    if (!ts) continue;
    // strTimestamp is UTC; append Z if it has no zone.
    const utc = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : ts + 'Z');
    if (isNaN(utc)) continue;
    const loc = toLisbon(utc); if (!loc) continue;
    out.push({ id: String(e.idEvent), title: e.strEvent || 'Match', date: loc.date, min: loc.min, league: e.strLeague || '' });
  }
  return out;
}
// Search for a team by name. Returns a short, safe list for the picker.
export async function searchTeams(q) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  try {
    const r = await fetch(`${SDB}/searchteams.php?t=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Daybook/1.0' } });
    if (!r.ok) return [];
    const j = await r.json().catch(() => ({}));
    return ((j && j.teams) || []).slice(0, 12).map((t) => ({
      id: String(t.idTeam), name: t.strTeam || 'Team',
      sport: t.strSport || '', league: t.strLeague || '', country: t.strCountry || '',
      badge: t.strTeamBadge || t.strBadge || '',
    })).filter((t) => t.id && t.name);
  } catch { return []; }
}
// Fetch + normalise a team's upcoming fixtures. [] on any failure so a feed
// hiccup never breaks the calendar.
export async function fetchTeamFixtures(teamId) {
  const id = String(teamId || '').replace(/[^0-9]/g, '');
  if (!id) return [];
  try {
    const r = await fetch(`${SDB}/eventsnext.php?id=${id}`, { headers: { 'User-Agent': 'Daybook/1.0' } });
    if (!r.ok) return [];
    return parseTeamFixtures(await r.json().catch(() => ({})));
  } catch { return []; }
}
// The user's subscribed teams (new model). Back-compat: an old fulham:true feed
// reads as a Fulham subscription.
export function feedTeams(feeds) {
  const teams = (feeds && Array.isArray(feeds.teams)) ? feeds.teams : [];
  if ((!teams || !teams.length) && feeds && feeds.fulham) return [{ id: '133600', name: 'Fulham FC' }];
  return teams;
}
function fixturesInRange(fixtures, from, to) {
  return (fixtures || []).filter((f) => f.date >= from && f.date <= to);
}

// ── merge helpers the worker calls ───────────────────────────────────────────
// `holidays` is a flat list of {code, date, name} for the user's countries and
// `fixtures` the flat list for their teams - the worker resolves both from cache
// and passes them in, so these builders stay pure. Fixture titles already read
// "A vs B", so no team prefix.
// Range shape (month/week view). Holidays all-day; fixtures timed (2h).
export function feedRangeEvents(holidays, fixtures, from, to) {
  const out = (holidays || []).filter((h) => h.date >= from && h.date <= to).map((h) => ({
    id: `feed:hol:${h.code}:${h.date}`, title: `${flagEmoji(h.code)} ${h.name}`, location: null, url: null, notes: null,
    allDay: true, date: h.date, end_date: null, start_min: null, end_min: null,
    recurringId: null, feed: 'hol', readonly: true,
  }));
  for (const f of fixturesInRange(fixtures, from, to)) {
    out.push({
      id: `feed:team:${f.id}`, title: `⚽ ${f.title}`, location: null, url: null, notes: null,
      allDay: false, date: f.date, start_min: f.min, end_date: f.date, end_min: Math.min(f.min + 120, 1439),
      recurringId: null, feed: 'team', readonly: true,
    });
  }
  return out;
}
// Day shape (Today timeline + /api/day). Holidays all-day; fixtures timed.
export function feedDayEvents(holidays, fixtures, day) {
  const out = (holidays || []).filter((h) => h.date === day).map((h) => ({
    id: `feed:hol:${h.code}:${h.date}`, title: `${flagEmoji(h.code)} ${h.name}`, location: null, url: null, notes: null,
    allDay: true, start_min: 0, duration: 1440, feed: 'hol', readonly: true,
  }));
  for (const f of (fixtures || []).filter((x) => x.date === day)) {
    out.push({
      id: `feed:team:${f.id}`, title: `⚽ ${f.title}`, location: null, url: null, notes: null,
      allDay: false, start_min: f.min, duration: 120, feed: 'team', readonly: true,
    });
  }
  return out;
}

// ── Event sources ────────────────────────────────────────────────────────────
// Subscribe to any public events feed - an .ics/webcal calendar, or a listings
// page that embeds schema.org/Event data (what most modern event sites publish
// for Google). The parsers below are pure; the worker fetches + caches and calls
// fetchSourceEvents. A browsed event can then be COPIED onto your own calendar as
// a normal editable event - these overlays are read-only like holidays/fixtures.

// The user's subscribed sources: [{id, url, label, color}].
export function feedSources(feeds) {
  return (feeds && Array.isArray(feeds.sources)) ? feeds.sources : [];
}
// Small stable id from a string (djb2 -> base36): a source id from its URL, or
// an event id when a feed gives no UID.
export function hashId(s) {
  let h = 5381; const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
// Today / date maths in Lisbon wall-clock, for the "future only" filter.
export function lisbonToday() { const l = toLisbon(new Date()); return l ? l.date : new Date().toISOString().slice(0, 10); }
export function addDaysIso(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Normalise webcal:// -> https://; return '' for anything that isn't http(s).
export function normFeedUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice(9);
  if (!/^https?:\/\//i.test(u)) return '';
  try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.toString() : ''; } catch { return ''; }
}
// A readable default label from a URL's host (news.example.co.uk -> Example).
export function hostLabel(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, '');
    const core = h.split('.').slice(0, -1).join('.') || h;
    const word = core.split('.').pop();
    return word.charAt(0).toUpperCase() + word.slice(1);
  } catch { return 'Events'; }
}

// ---- iCalendar (.ics / webcal) ----
function icsUnescape(s) { return String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
// One DTSTART/DTEND field -> {date, min, allDay} in Lisbon wall-clock. A Z time
// is UTC and gets shifted; a floating or TZID time is taken as local (good
// enough for a Lisbon-based calendar, and most PT feeds are already local).
function parseIcsWhen(field) {
  if (!field) return null;
  const v = String(field.val || '').trim();
  const dateOnly = (field.params && field.params.VALUE === 'DATE') || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (dateOnly || m[4] == null) return { date, min: null, allDay: true };
  if (m[7] === 'Z') { const loc = toLisbon(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))); if (loc) return { date: loc.date, min: loc.min, allDay: false }; }
  return { date, min: (+m[4]) * 60 + (+m[5]), allDay: false };
}
export function parseIcs(text) {
  if (!text || typeof text !== 'string' || text.indexOf('VEVENT') < 0) return [];
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const out = []; let cur = null;
  for (const line of unfolded.split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) { const e = normIcsEvent(cur); if (e) out.push(e); } cur = null; continue; }
    if (!cur) continue;
    const ci = line.indexOf(':'); if (ci < 0) continue;
    const left = line.slice(0, ci); const val = line.slice(ci + 1);
    const semi = left.indexOf(';');
    const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase().trim();
    const params = {};
    if (semi >= 0) for (const p of left.slice(semi + 1).split(';')) { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1); }
    if (!(name in cur)) cur[name] = { val, params };   // first wins (ignore repeated RRULE/EXDATE lines)
  }
  return out;
}
function normIcsEvent(raw) {
  const start = parseIcsWhen(raw.DTSTART); if (!start) return null;
  const end = parseIcsWhen(raw.DTEND);
  const title = icsUnescape(raw.SUMMARY && raw.SUMMARY.val).trim(); if (!title) return null;
  const uid = (raw.UID && raw.UID.val) || '';
  const url = (raw.URL && raw.URL.val) || '';
  return {
    id: uid ? 'u' + hashId(uid) : hashId(title + start.date + (start.min || '')),
    title: title.slice(0, 200),
    date: start.date, min: start.allDay ? null : start.min, allDay: start.allDay,
    endDate: end ? end.date : null, endMin: (end && !end.allDay) ? end.min : null,
    location: icsUnescape(raw.LOCATION && raw.LOCATION.val).trim().slice(0, 200),
    url: /^https?:\/\//i.test(url) ? url : '',
    image: '', category: ((raw.CATEGORIES && raw.CATEGORIES.val) || '').split(',')[0].trim(),
    price: '', notes: icsUnescape(raw.DESCRIPTION && raw.DESCRIPTION.val).trim().slice(0, 500),
  };
}

// ---- schema.org/Event JSON-LD (embedded in a listings page) ----
function jsonLdText(v) { if (v == null) return ''; if (typeof v === 'string') return v; if (typeof v === 'object') return v.name || v['@value'] || ''; return String(v); }
function parseIsoWhen(s) {
  s = String(s || '').trim(); if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/); if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] == null) return { date, min: null, allDay: true };
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) { const d = new Date(s); if (!isNaN(d)) { const loc = toLisbon(d); if (loc) return { date: loc.date, min: loc.min, allDay: false }; } }
  return { date, min: (+m[4]) * 60 + (+m[5]), allDay: false };
}
function normJsonLdEvent(node) {
  const title = jsonLdText(node.name).trim(); if (!title) return null;
  const start = parseIsoWhen(node.startDate); if (!start) return null;
  const end = parseIsoWhen(node.endDate);
  let loc = ''; const L = node.location;
  if (typeof L === 'string') loc = L;
  else if (Array.isArray(L)) loc = jsonLdText(L[0]);
  else if (L && typeof L === 'object') {
    loc = jsonLdText(L.name); const a = L.address;
    if (a) { const as = typeof a === 'string' ? a : [a.streetAddress, a.addressLocality].filter(Boolean).join(', '); if (as && !loc.includes(as)) loc = [loc, as].filter(Boolean).join(', '); }
  }
  let img = node.image; if (Array.isArray(img)) img = img[0]; if (img && typeof img === 'object') img = img.url || ''; if (typeof img !== 'string') img = '';
  let price = ''; let off = node.offers; if (Array.isArray(off)) off = off[0];
  if (off && typeof off === 'object') {
    const p = off.price != null ? off.price : off.lowPrice;
    if (p != null && p !== '') price = (Number(p) === 0) ? 'Free' : `${off.priceCurrency || ''} ${p}`.trim();
    else if (/free/i.test(jsonLdText(off.name))) price = 'Free';
  }
  const url = jsonLdText(node.url) || (typeof node['@id'] === 'string' ? node['@id'] : '');
  const type = Array.isArray(node['@type']) ? node['@type'][0] : node['@type'];
  return {
    id: hashId(title + start.date + (start.min || '') + (url || '')),
    title: title.slice(0, 200), date: start.date, min: start.allDay ? null : start.min, allDay: start.allDay,
    endDate: end ? end.date : null, endMin: (end && !end.allDay) ? end.min : null,
    location: String(loc || '').trim().slice(0, 200), url: /^https?:\/\//i.test(url) ? url : '',
    image: /^https?:\/\//i.test(img) ? img : '', category: String(type || '').replace(/Event$/, ''),
    price, notes: '',
  };
}
function walkLd(node, out, seen, depth) {
  depth = depth || 0; if (depth > 6 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walkLd(n, out, seen, depth + 1); return; }
  if (node['@graph']) walkLd(node['@graph'], out, seen, depth + 1);
  const t = node['@type']; const types = Array.isArray(t) ? t : [t];
  if (types.some((x) => typeof x === 'string' && /Event$/i.test(x)) && node.startDate) {
    const e = normJsonLdEvent(node); if (e) { const k = e.url || (e.title + e.date); if (!seen.has(k)) { seen.add(k); out.push(e); } }
  }
  if (node.itemListElement) walkLd(node.itemListElement, out, seen, depth + 1);
  if (node.item && typeof node.item === 'object') walkLd(node.item, out, seen, depth + 1);
  if (node.subEvent) walkLd(node.subEvent, out, seen, depth + 1);
}
export function parseJsonLdEvents(html) {
  if (!html || typeof html !== 'string') return [];
  const out = []; const seen = new Set();
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/<!--/g, '').replace(/-->/g, '');
    let data; try { data = JSON.parse(raw); } catch { continue; }
    walkLd(data, out, seen, 0);
  }
  return out;
}

// ---- overlay builders (pure), mirroring feedRangeEvents/feedDayEvents ----
// `sources` here is [{id, label, color, events:[normalised]}].
export function sourceRangeEvents(sources, from, to) {
  const out = [];
  for (const s of sources || []) for (const e of (s.events || [])) {
    if (e.date < from || e.date > to) continue;
    out.push({
      id: `feed:src:${s.id}:${e.id}`, title: e.title, location: e.location || null, url: e.url || null, notes: e.notes || null,
      allDay: !!e.allDay, date: e.date, end_date: e.endDate || null,
      start_min: e.allDay ? null : e.min, end_min: (e.endMin != null) ? e.endMin : null,
      recurringId: null, feed: 'src', readonly: true, srcLabel: s.label || '', srcColor: s.color || null,
    });
  }
  return out;
}
export function sourceDayEvents(sources, day) {
  const out = [];
  for (const s of sources || []) for (const e of (s.events || [])) {
    if (e.date !== day) continue;
    out.push({
      id: `feed:src:${s.id}:${e.id}`, title: e.title, location: e.location || null, url: e.url || null, notes: e.notes || null,
      allDay: !!e.allDay, start_min: e.allDay ? 0 : e.min,
      duration: e.allDay ? 1440 : (e.endMin != null && e.min != null ? Math.max(30, e.endMin - e.min) : 90),
      feed: 'src', readonly: true, srcLabel: s.label || '', srcColor: s.color || null,
    });
  }
  return out;
}

// ---- AgendaLX: the official Lisbon cultural agenda (custom JSON, keyless) ----
// Not one of the standard feed formats, but the richest Lisbon source, so we
// adapt it. Each event carries an `occurences` array of dates; we emit one row
// per upcoming occurrence (capped, so a daily run doesn't flood the list).
function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#8217;|&#039;|&#39;|&lsquo;|&rsquo;/g, "'").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
    .replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch { return m; } })
    .trim();
}
function agendaLxTime(s) {
  const m = /(\d{1,2})[h:](\d{2})?/.exec(String(s || ''));
  if (!m) return null;
  const hh = +m[1]; const mi = m[2] ? +m[2] : 0;
  return (hh > 23 || mi > 59) ? null : hh * 60 + mi;
}
function firstName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of Object.keys(obj)) { const v = obj[k]; if (v && v.name) return v.name; }
  return '';
}
export function parseAgendaLx(arr) {
  const out = []; const seen = new Set();
  for (const e of (Array.isArray(arr) ? arr : [])) {
    if (!e || typeof e !== 'object') continue;
    const title = decodeEntities((e.title && (e.title.rendered || e.title)) || '').slice(0, 200); if (!title) continue;
    const min = agendaLxTime(e.string_times);
    const venue = decodeEntities(firstName(e.venue)).slice(0, 200);
    const cat = decodeEntities(firstName(e.categories_name_list));
    const tags = (e.tags_name_list && typeof e.tags_name_list === 'object') ? Object.keys(e.tags_name_list) : [];
    const free = tags.includes('gratuito') || /grat/i.test(String(e.price_cat || ''));
    const price = free ? 'Free' : (e.price_val ? String(e.price_val).slice(0, 40) : '');
    const url = /^https?:\/\//i.test(e.link || '') ? e.link : '';
    const img = /^https?:\/\//i.test(e.featured_media_large || '') ? e.featured_media_large : '';
    let dates = Array.isArray(e.occurences) ? e.occurences.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
    if (!dates.length && /^\d{4}-\d{2}-\d{2}/.test(e.StartDate || '')) dates = [String(e.StartDate).slice(0, 10)];
    if (!dates.length) continue;
    // One row per event, at its next upcoming date - a two-month daily run
    // should appear once, not flood every day. The full run rides along as `run`.
    const floor = lisbonToday();
    const date = dates.find((d) => d >= floor) || dates[dates.length - 1];
    const id = hashId((e.id || title) + ':' + date);
    if (seen.has(id)) continue; seen.add(id);
    const run = dates.length > 1 ? decodeEntities(e.string_dates || '').slice(0, 80) : '';
    out.push({ id, title, date, min, allDay: min == null, endDate: null, endMin: null, location: venue, url, image: img, category: cat, price, notes: '', run });
  }
  return out;
}
async function fetchAgendaLx(u) {
  const base = new URL(u);
  base.pathname = '/wp-json/agendalx/v1/events'; base.search = '';
  base.searchParams.set('per_page', '50');
  let all = [];
  for (let page = 1; page <= 5; page++) {
    base.searchParams.set('page', String(page));
    try {
      const r = await fetch(base.toString(), { headers: { 'User-Agent': 'Daybook/1.0 (+https://daybook.fyi)', accept: 'application/json' }, cf: { cacheTtl: 600 } });
      if (!r.ok) break;
      const j = await r.json().catch(() => null);
      const arr = Array.isArray(j) ? j : ((j && j.events) || []);
      if (!arr.length) break;
      all = all.concat(parseAgendaLx(arr));
      if (arr.length < 50) break;
    } catch { break; }
  }
  const floor = lisbonToday();
  const seen = new Set();
  all = all.filter((e) => e && e.date >= floor && !(seen.has(e.id) || !seen.add(e.id)));
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.min == null ? 1440 : a.min) - (b.min == null ? 1440 : b.min))));
  return { ok: true, events: all.slice(0, 250) };
}

// ---- the worker fetcher: fetch a source URL, sniff format, return events ----
export async function fetchSourceEvents(url) {
  const u = normFeedUrl(url); if (!u) return { ok: false, error: 'That is not a valid link.' };
  let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {}
  if (host === 'agendalx.pt') return fetchAgendaLx(u);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Daybook/1.0 (+https://daybook.fyi)', accept: 'text/calendar, text/html, application/xhtml+xml, */*' }, redirect: 'follow', cf: { cacheTtl: 300 } });
    if (!r.ok) return { ok: false, error: `The link returned ${r.status}.` };
    let body = await r.text(); if (body.length > 3000000) body = body.slice(0, 3000000);
    const head = body.slice(0, 800).toUpperCase();
    let events = (head.includes('BEGIN:VCALENDAR') || head.includes('BEGIN:VEVENT')) ? parseIcs(body) : parseJsonLdEvents(body);
    const floor = lisbonToday();
    events = (events || []).filter((e) => e && e.date >= floor);
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.min == null ? 1440 : a.min) - (b.min == null ? 1440 : b.min))));
    return { ok: true, events: events.slice(0, 250) };
  } catch { return { ok: false, error: 'Could not reach that link.' }; }
}

// ── Suggest feeds for a place ──────────────────────────────────────────────
// Type a city or use your location; we resolve it (OpenStreetMap Nominatim,
// free + keyless) and suggest event sources for it. Eventbrite works worldwide
// (schema.org/Event in its city pages); Portugal adds ViralAgenda; Lisbon adds
// the official city agenda, CCB and Bilheteira Online.
export function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export async function lookupPlace({ q, lat, lng }) {
  try {
    let u;
    if (q && String(q).trim()) {
      u = new URL('https://nominatim.openstreetmap.org/search');
      u.searchParams.set('q', String(q).trim().slice(0, 120)); u.searchParams.set('format', 'json'); u.searchParams.set('limit', '1'); u.searchParams.set('addressdetails', '1');
    } else if (Number.isFinite(+lat) && Number.isFinite(+lng)) {
      u = new URL('https://nominatim.openstreetmap.org/reverse');
      u.searchParams.set('lat', String(+lat)); u.searchParams.set('lon', String(+lng)); u.searchParams.set('format', 'json'); u.searchParams.set('addressdetails', '1'); u.searchParams.set('zoom', '10');
    } else return null;
    const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Daybook/1.0 (+https://daybook.fyi)' } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const row = Array.isArray(j) ? j[0] : j;
    const a = row && row.address; if (!a) return null;
    let city = a.city || a.town || a.village || a.municipality || a.city_district || (row && row.name) || a.county || a.state || '';
    city = city.replace(/^(greater|grande|city of|cidade de)\s+/i, '').trim();
    const country = a.country || '';
    const countryCode = String(a.country_code || '').toLowerCase();
    if (!city) return null;
    return { city, country, countryCode, label: [city, country].filter(Boolean).join(', ') };
  } catch { return null; }
}
export function suggestFeeds(place) {
  if (!place || !place.city) return [];
  const citySlug = slugify(place.city);
  const countrySlug = slugify(place.country) || place.countryCode || 'events';
  const out = [];
  // Eventbrite - worldwide.
  out.push({ label: `Eventbrite · ${place.city}`, url: `https://www.eventbrite.com/d/${countrySlug}--${citySlug}/all-events/`, note: 'Workshops, music, nightlife' });
  // ViralAgenda - Portugal's cultural listings.
  if (place.countryCode === 'pt') out.push({ label: `ViralAgenda · ${place.city}`, url: `https://www.viralagenda.com/pt/${citySlug}`, note: 'Concerts, theatre, exhibitions' });
  // Lisbon's own, curated.
  if (/lisbo/i.test(place.city)) {
    out.unshift({ label: 'Agenda Cultural de Lisboa', url: 'https://www.agendalx.pt/', note: "The city's official what's-on" });
    out.push({ label: 'CCB · Belém', url: 'https://www.ccb.pt/eventos/?ical=1', note: 'Centro Cultural de Belém' });
    out.push({ label: 'Bilheteira Online', url: 'https://www.bol.pt/', note: 'Ticketed shows across Portugal' });
  }
  return out;
}

// ── Unsplash cover-image search ────────────────────────────────────────────
// A thin server-side proxy so the access key never reaches the browser. Returns
// a normalised, hotlink-ready result set, or { available:false } when no key is
// configured (the picker then offers paste-a-URL only). Free Demo tier is plenty
// for personal use; set UNSPLASH_ACCESS_KEY to switch search on.
export async function unsplashSearch(key, q, page) {
  if (!key) return { available: false, results: [] };
  const query = String(q || '').trim();
  if (!query) return { available: true, results: [] };
  const u = `https://api.unsplash.com/search/photos?per_page=24&orientation=landscape&content_filter=high&query=${encodeURIComponent(query)}&page=${Math.max(1, parseInt(page, 10) || 1)}`;
  let r;
  try { r = await fetch(u, { headers: { 'Accept-Version': 'v1', Authorization: `Client-ID ${key}` } }); }
  catch { return { available: true, error: 'network', results: [] }; }
  if (!r.ok) return { available: true, error: 'http ' + r.status, results: [] };
  let data = {};
  try { data = await r.json(); } catch {}
  const results = (data.results || []).map((p) => ({
    id: p.id,
    thumb: (p.urls && (p.urls.small || p.urls.thumb)) || '',
    url: (p.urls && (p.urls.regular || p.urls.full)) || '',
    by: (p.user && p.user.name) || 'Unsplash',
    byUrl: (p.user && p.user.links && p.user.links.html) || 'https://unsplash.com',
    link: (p.links && p.links.html) || '',
    dl: (p.links && p.links.download_location) || '',
    color: p.color || null,
    alt: (p.alt_description || p.description || query).slice(0, 120),
  })).filter((x) => x.url);
  return { available: true, results };
}

// Unsplash asks that a download be "triggered" when a photo is actually used.
// Fire-and-forget; failure is harmless.
export async function unsplashTrigger(key, dl) {
  if (!key || !dl) return;
  try { await fetch(`${dl}${dl.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(key)}`); } catch {}
}
