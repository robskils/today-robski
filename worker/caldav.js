// CalDAV: connect any CalDAV calendar (iCloud, Yahoo, Fastmail, a self-hosted
// server) with an email + an app-specific password, and read/write it two-way.
// Stored as a calendar_accounts row (provider='caldav'); its events merge onto
// the Koyeba calendar like the extra Google accounts, with the same
// acct:<id>:<uid> id scheme so writes route back here.
//
// Robin doesn't use Yahoo himself - this is for members who do (2026-10-25). It's
// best-effort against real servers; the common cases (timed events with a TZID or
// a UTC "Z" time, and all-day events) are handled, recurrences are expanded by the
// server so we get real instances in the window.
import { encryptSecret, decryptSecret } from './ai.js';

export const CALDAV_PRESETS = {
  icloud: { base: 'https://caldav.icloud.com', label: 'iCloud' },
  yahoo: { base: 'https://caldav.calendar.yahoo.com', label: 'Yahoo' },
  fastmail: { base: 'https://caldav.fastmail.com/dav/calendars', label: 'Fastmail' },
};

// ── timezone helpers (a VEVENT's wall-clock, in its own zone, -> an instant,
// then to the viewer's zone) ────────────────────────────────────────────────
function tzOffMin(date, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour % 24), +p.minute, +p.second) - date.getTime()) / 60000;
  } catch { return 0; }
}
// A naive wall-clock (y,mo,d,h,mi) interpreted IN zone `tz` -> the real UTC instant.
function wallToInstant(y, mo, d, h, mi, tz) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = naive;
  for (let i = 0; i < 2; i++) guess = naive - tzOffMin(new Date(guess), tz) * 60000;
  return new Date(guess);
}
// An instant -> {date:'YYYY-MM-DD', min} in the viewer's zone.
function instantParts(date, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const validTz = (t) => { if (!t || !/^[A-Za-z][A-Za-z0-9_+./-]*\/[A-Za-z0-9_+./-]+$/.test(t)) return ''; try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return t; } catch { return ''; } };

// ── iCalendar ───────────────────────────────────────────────────────────────
function icsUnescape(s) { return String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function xmlEscape(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// A simple repeat keyword -> an RRULE value (no prefix). null = does not repeat.
export function caldavRrule(repeat) {
  switch (String(repeat || '').toLowerCase()) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekdays': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly': return 'FREQ=WEEKLY';
    case 'monthly': return 'FREQ=MONTHLY';
    case 'yearly': return 'FREQ=YEARLY';
    default: return null;
  }
}
// Parse one VEVENT (already unfolded) into our event shape, in the viewer's zone.
function parseVevent(block, userTz) {
  const fields = {};
  for (const line of block.split('\n')) {
    const ci = line.indexOf(':'); if (ci < 0) continue;
    const left = line.slice(0, ci), val = line.slice(ci + 1);
    const semi = left.indexOf(';');
    const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase().trim();
    const params = {};
    if (semi >= 0) for (const p of left.slice(semi + 1).split(';')) { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1); }
    if (!fields[name]) fields[name] = { val: val.trim(), params };
  }
  const uid = (fields.UID && fields.UID.val) || '';
  const title = icsUnescape(fields.SUMMARY && fields.SUMMARY.val).trim();
  if (!uid || !title) return null;
  const when = (f) => {
    if (!f) return null;
    const v = String(f.val || '').trim();
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if (!m) return null;
    if ((f.params && f.params.VALUE === 'DATE') || m[4] == null) return { date: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
    let inst;
    if (m[7] === 'Z') inst = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    else { const tz = validTz(f.params && f.params.TZID) || userTz; inst = wallToInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz); }
    const pp = instantParts(inst, userTz);
    return { date: pp.date, min: pp.min, allDay: false };
  };
  const s = when(fields.DTSTART); if (!s) return null;
  const e = when(fields.DTEND) || (s.allDay ? { date: s.date, allDay: true } : { date: s.date, min: Math.min(1439, s.min + 60), allDay: false });
  // Part of a repeating series? An expanded instance carries RECURRENCE-ID, a
  // master carries RRULE. Either way a UID-level edit would hit the whole series,
  // so the merge marks these read-only.
  const recurring = /(?:^|\n)(?:RRULE|RECURRENCE-ID)[;:]/i.test(block);
  return {
    uid, title: title.slice(0, 300), recurring,
    allDay: s.allDay,
    date: s.date, start_min: s.allDay ? null : s.min,
    end_date: e.date, end_min: e.allDay ? null : e.min,
    location: icsUnescape(fields.LOCATION && fields.LOCATION.val).trim().slice(0, 300) || null,
    notes: icsUnescape(fields.DESCRIPTION && fields.DESCRIPTION.val).trim().slice(0, 1000) || null,
  };
}
function parseVevents(icsText, userTz) {
  if (!icsText || icsText.indexOf('VEVENT') < 0) return [];
  const unfolded = icsText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const out = [];
  const re = /BEGIN:VEVENT\n([\s\S]*?)END:VEVENT/g; let m;
  while ((m = re.exec(unfolded))) { const ev = parseVevent(m[1], userTz); if (ev) out.push(ev); }
  return out;
}
const pad = (n) => String(n).padStart(2, '0');
// Build a single-VEVENT iCalendar for a write, in UTC (a "Z" time needs no VTIMEZONE).
function buildVcalendar({ uid, title, allDay, startInstant, endInstant, startDate, endDate, location, notes, rrule }) {
  const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const dateStamp = (iso) => iso.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Koyeba//CalDAV//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utc(new Date())}`];
  if (allDay) { lines.push(`DTSTART;VALUE=DATE:${dateStamp(startDate)}`, `DTEND;VALUE=DATE:${dateStamp(endDate)}`); }
  else { lines.push(`DTSTART:${utc(startInstant)}`, `DTEND:${utc(endInstant)}`); }
  lines.push(`SUMMARY:${icsEscape(title)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (notes) lines.push(`DESCRIPTION:${icsEscape(notes)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// ── CalDAV protocol ───────────────────────────────────────────────────────
function basicAuth(user, pass) {   // UTF-8 safe, no deprecated unescape
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}
const X = (name, xml) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i')); return m ? m[1] : ''; };
const Xall = (name, xml) => { const out = []; const re = new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'ig'); let m; while ((m = re.exec(xml))) out.push(m[1]); return out; };
const firstHref = (xml) => icsUnescape((X('href', xml) || '').trim());

async function dav(method, url, { user, pass, depth, body, ct, extra } = {}) {
  const headers = { Authorization: basicAuth(user, pass), ...(depth != null ? { Depth: String(depth) } : {}), ...(ct ? { 'Content-Type': ct } : {}), ...(extra || {}) };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(url, { method, headers, body, signal: ctl.signal, redirect: 'follow' }); return { status: r.status, ok: r.ok, text: await r.text(), etag: r.headers.get('ETag') || '', url: r.url }; }
  finally { clearTimeout(timer); }
}

// Discover a usable calendar collection URL from a base host + credentials:
// current-user-principal -> calendar-home-set -> the first writable VEVENT
// collection. Returns { calUrl } or throws a human message.
export async function caldavDiscover(base, user, pass) {
  const propPrincipal = '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
  let r = await dav('PROPFIND', base, { user, pass, depth: 0, body: propPrincipal, ct: 'application/xml; charset=utf-8' });
  if (r.status === 401) throw new Error('Those sign-in details were rejected. Check the email and the app-specific password.');
  if (!r.ok && r.status !== 207) throw new Error(`Could not reach the calendar server (HTTP ${r.status}).`);
  const principalHref = firstHref(X('current-user-principal', r.text)) || firstHref(r.text);
  if (!principalHref) throw new Error('The server did not return a calendar account for those details.');
  const principalUrl = new URL(principalHref, r.url || base).href;

  const propHome = '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
  r = await dav('PROPFIND', principalUrl, { user, pass, depth: 0, body: propHome, ct: 'application/xml; charset=utf-8' });
  const homeHref = firstHref(X('calendar-home-set', r.text));
  if (!homeHref) throw new Error('Could not find the calendars for that account.');
  const homeUrl = new URL(homeHref, r.url || principalUrl).href;

  const propCals = '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>';
  r = await dav('PROPFIND', homeUrl, { user, pass, depth: 1, body: propCals, ct: 'application/xml; charset=utf-8' });
  // Pick the first collection that is a calendar and supports VEVENT.
  for (const resp of Xall('response', r.text)) {
    const rt = X('resourcetype', resp);
    if (!/calendar/i.test(rt)) continue;
    const comps = X('supported-calendar-component-set', resp);
    if (comps && !/VEVENT/i.test(comps)) continue;
    const href = firstHref(resp); if (!href) continue;
    return { calUrl: new URL(href, r.url || homeUrl).href, name: icsUnescape((X('displayname', resp) || '').trim()) || 'Calendar' };
  }
  throw new Error('No writable calendar was found on that account.');
}

// Events in [from,to] from a CalDAV collection, shaped like our other events,
// in the viewer's zone. Recurrences are expanded by the server.
export async function caldavRangeEvents(calUrl, user, pass, fromInstant, toInstant, userTz) {
  const z = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data><c:expand start="${z(fromInstant)}" end="${z(toInstant)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${z(fromInstant)}" end="${z(toInstant)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await dav('REPORT', calUrl, { user, pass, depth: 1, body, ct: 'application/xml; charset=utf-8' });
  if (!r.ok && r.status !== 207) return [];
  const out = [];
  for (const resp of Xall('response', r.text)) {
    const data = X('calendar-data', resp); if (!data || data.indexOf('VEVENT') < 0) continue;
    for (const ev of parseVevents(data.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), userTz)) out.push(ev);
  }
  return out;
}

// Find an event's resource href + etag by UID (needed to update/delete it).
async function caldavFindByUid(calUrl, user, pass, uid) {
  const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match>${xmlEscape(uid)}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await dav('REPORT', calUrl, { user, pass, depth: 1, body, ct: 'application/xml; charset=utf-8' });
  const resp = Xall('response', r.text)[0];
  if (!resp) return null;
  const href = firstHref(resp); if (!href) return null;
  return { href: new URL(href, calUrl).href, etag: (X('getetag', resp) || '').replace(/["']/g, '').trim() };
}

// Fetch one event by UID, parsed in the viewer's zone (for merge-on-update).
export async function caldavGet(calUrl, user, pass, uid, userTz) {
  const found = await caldavFindByUid(calUrl, user, pass, uid);
  if (!found) return null;
  const r = await dav('GET', found.href, { user, pass });
  if (!r.ok) return null;
  return parseVevents(r.text, userTz)[0] || null;
}

export async function caldavPut(calUrl, user, pass, uid, ev) {
  // A new event lives at <collection>/<uid>.ics. On update, re-use its href.
  const existing = await caldavFindByUid(calUrl, user, pass, uid).catch(() => null);
  const href = existing ? existing.href : new URL(`${encodeURIComponent(uid)}.ics`, calUrl.endsWith('/') ? calUrl : calUrl + '/').href;
  const ics = buildVcalendar({ uid, ...ev });
  const r = await dav('PUT', href, { user, pass, body: ics, ct: 'text/calendar; charset=utf-8', extra: existing && existing.etag ? { 'If-Match': `"${existing.etag}"` } : {} });
  return r.ok;
}
export async function caldavDelete(calUrl, user, pass, uid) {
  const existing = await caldavFindByUid(calUrl, user, pass, uid).catch(() => null);
  if (!existing) return true;   // already gone
  const r = await dav('DELETE', existing.href, { user, pass, extra: existing.etag ? { 'If-Match': `"${existing.etag}"` } : {} });
  return r.ok || r.status === 404;
}

// Store a connected CalDAV account (after a successful discover).
export async function caldavStore(env, uid, { label, calUrl, user, pass, color }) {
  const enc = await encryptSecret(env, pass);
  const n = await env.DB.prepare('SELECT COUNT(*) AS c FROM calendar_accounts WHERE user_id = ?').bind(uid).first().catch(() => ({ c: 0 }));
  const hues = [205, 150, 275, 35, 330, 95, 250, 15];
  const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 16);
  await env.DB.prepare(
    "INSERT INTO calendar_accounts (id, user_id, provider, label, color, caldav_url, caldav_user, caldav_pass_enc, cal_id, writable, enabled, created_at) VALUES (?, ?, 'caldav', ?, ?, ?, ?, ?, ?, 1, 1, ?)",
  ).bind(id, uid, label || user, String(color || hues[((n && n.c) || 0) % hues.length]), calUrl, user, enc, calUrl, new Date().toISOString()).run();
  return id;
}
// Decrypt a stored CalDAV account's password for a read/write.
export async function caldavCreds(env, row) {
  try { return { url: row.caldav_url, user: row.caldav_user, pass: await decryptSecret(env, row.caldav_pass_enc) }; } catch { return null; }
}

// Internals exposed for unit tests (no network, no secrets).
export const __test = { parseVevents, parseVevent, wallToInstant, instantParts, buildVcalendar };
