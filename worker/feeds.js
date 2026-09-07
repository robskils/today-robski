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
