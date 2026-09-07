// Calendar feeds: subscribe to Portuguese / UK public holidays and Fulham FC
// fixtures. Holidays are computed here (no external call, deterministic); the
// fixtures come from a small cached blob the cron refreshes. All feed events are
// read-only overlays - they carry `feed` + `readonly` so the client draws them
// distinctly and never offers edit/delete/drag. Their ids are synthetic
// (`feed:<kind>:<key>`), never block ids.
//
// Portugal and the UK keep the same clock all year (WET/GMT, WEST/BST together),
// so a UK kickoff time needs no cross-timezone shift for a Lisbon calendar.

const p2 = (n) => String(n).padStart(2, '0');
export const isoDate = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;

// Computus - Anonymous Gregorian algorithm. Returns Easter Sunday {y,m,d}.
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y: year, m: month, d: day };
}
// Shift an ISO date by n days.
function shift(iso, n) {
  const dt = new Date(iso + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
// The Nth (1-based) given weekday of a month; weekday 0=Sun..6=Sat.
function nthWeekday(year, month, weekday, n) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const iso = isoDate(year, month, d);
    if (new Date(iso + 'T00:00:00Z').getUTCMonth() + 1 !== month) break;
    if (dow(iso) === weekday && ++count === n) return iso;
  }
  return null;
}
// The last given weekday of a month.
function lastWeekday(year, month, weekday) {
  for (let d = 31; d >= 1; d--) {
    const dt = new Date(isoDate(year, month, d) + 'T00:00:00Z');
    if (dt.getUTCMonth() + 1 !== month) continue;
    if (dt.getUTCDay() === weekday) return isoDate(year, month, d);
  }
  return null;
}
// A fixed UK holiday lands on the next weekday if it falls on a weekend
// (the "substitute day" rule).
function ukSub(iso) {
  const w = dow(iso);
  if (w === 6) return shift(iso, 2);   // Sat -> Mon
  if (w === 0) return shift(iso, 1);   // Sun -> Mon
  return iso;
}

// Portugal's national public holidays for a year.
export function ptHolidays(year) {
  const e = isoDate(easter(year).y, easter(year).m, easter(year).d);
  return [
    { date: isoDate(year, 1, 1), title: 'Ano Novo' },
    { date: shift(e, -2), title: 'Sexta-feira Santa' },
    { date: e, title: 'Páscoa' },
    { date: isoDate(year, 4, 25), title: 'Dia da Liberdade' },
    { date: isoDate(year, 5, 1), title: 'Dia do Trabalhador' },
    { date: shift(e, 60), title: 'Corpo de Deus' },
    { date: isoDate(year, 6, 10), title: 'Dia de Portugal' },
    { date: isoDate(year, 8, 15), title: 'Assunção de Nossa Senhora' },
    { date: isoDate(year, 10, 5), title: 'Implantação da República' },
    { date: isoDate(year, 11, 1), title: 'Todos os Santos' },
    { date: isoDate(year, 12, 1), title: 'Restauração da Independência' },
    { date: isoDate(year, 12, 8), title: 'Imaculada Conceição' },
    { date: isoDate(year, 12, 25), title: 'Natal' },
  ];
}
// UK bank holidays (England & Wales) for a year.
export function ukHolidays(year) {
  const e = isoDate(easter(year).y, easter(year).m, easter(year).d);
  return [
    { date: ukSub(isoDate(year, 1, 1)), title: "New Year's Day" },
    { date: shift(e, -2), title: 'Good Friday' },
    { date: shift(e, 1), title: 'Easter Monday' },
    { date: nthWeekday(year, 5, 1, 1), title: 'Early May Bank Holiday' },
    { date: lastWeekday(year, 5, 1), title: 'Spring Bank Holiday' },
    { date: lastWeekday(year, 8, 1), title: 'Summer Bank Holiday' },
    { date: ukSub(isoDate(year, 12, 25)), title: 'Christmas Day' },
    { date: ukSub(isoDate(year, 12, 26)), title: 'Boxing Day' },
  ];
}

const FEED_META = {
  pt: { emoji: '🇵🇹', gen: ptHolidays },
  uk: { emoji: '🇬🇧', gen: ukHolidays },
};
// Years covered by an inclusive [from,to] ISO range.
function yearsIn(from, to) {
  const a = Number(from.slice(0, 4)), b = Number(to.slice(0, 4)); const out = [];
  for (let y = a; y <= b; y++) out.push(y);
  return out;
}
function holidaysInRange(feeds, from, to) {
  const out = [];
  for (const key of ['pt', 'uk']) {
    if (!feeds || !feeds[key]) continue;
    const meta = FEED_META[key];
    for (const y of yearsIn(from, to)) {
      for (const h of meta.gen(y)) {
        if (h.date < from || h.date > to) continue;
        out.push({ id: `feed:${key}:${h.date}`, title: `${meta.emoji} ${h.title}`, feed: key });
      }
    }
  }
  return out;
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
// `fixtures` is the flat list for the user's subscribed teams (index.js gathers
// it from the shared cache). Titles already read "A vs B", so no team prefix.
// Range shape (month/week view). Holidays all-day; fixtures timed (2h).
export function feedRangeEvents(feeds, fixtures, from, to) {
  const out = holidaysInRange(feeds, from, to).map((h) => ({
    id: h.id, title: h.title, location: null, url: null, notes: null,
    allDay: true, date: h.id.split(':')[2], end_date: null, start_min: null, end_min: null,
    recurringId: null, feed: h.feed, readonly: true,
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
export function feedDayEvents(feeds, fixtures, day) {
  const out = holidaysInRange(feeds, day, day).map((h) => ({
    id: h.id, title: h.title, location: null, url: null, notes: null,
    allDay: true, start_min: 0, duration: 1440, feed: h.feed, readonly: true,
  }));
  for (const f of (fixtures || []).filter((x) => x.date === day)) {
    out.push({
      id: `feed:team:${f.id}`, title: `⚽ ${f.title}`, location: null, url: null, notes: null,
      allDay: false, start_min: f.min, duration: 120, feed: 'team', readonly: true,
    });
  }
  return out;
}
