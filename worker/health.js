// Integration health monitor. Robin: "we don't like silent breakages."
//
// LifeFold leans on a handful of free external services. When one dies - as
// TheSportsDB's old free key did, returning a 200 with a plain-text "key
// disabled" error that the code swallowed as an empty list - every call just
// quietly returns nothing, and the only way anyone finds out is by trying to use
// the feature. This probes the read-only dependencies on a schedule and judges
// health from the ACTUAL response, not just the HTTP status; the worker records
// up/down and emails the owner when a service changes state, so a breakage
// surfaces by itself. See runHealthCheck / maybeHealthCheck in index.js.

// A fetch with a hard timeout, so a hung dependency can't stall the sweep.
async function ping(url, { ms = 8000, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LifeFold/1.0', ...headers }, signal: ctl.signal });
    return { status: r.status, ok: r.ok, body: await r.text() };
  } finally { clearTimeout(timer); }
}
const timedOut = (e) => (e && (e.name === 'AbortError' || /timed out|aborted/i.test(e.message || ''))) ? 'Timed out' : (e && e.message) || 'Failed';
function asJson(r) { try { return JSON.parse(r.body); } catch { return null; } }

// Each probe returns { ok, detail }. `detail` is a short human line for the panel
// and the alert email. `needs(env)` skips a probe whose service isn't configured
// (no key), so it never shows as "down" for a feature the owner hasn't set up.
export const HEALTH_PROBES = [
  {
    key: 'sportsdb', label: 'Football fixtures · TheSportsDB',
    async probe(env) {
      try {
        const key = (env && env.SPORTSDB_KEY) || '123';
        const r = await ping(`https://www.thesportsdb.com/api/v1/json/${key}/searchteams.php?t=Arsenal`);
        if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
        const j = asJson(r);
        if (!j) return { ok: false, detail: `Not JSON: "${r.body.slice(0, 70).trim()}"` };   // the "key disabled" plain-text case
        if (!Array.isArray(j.teams) || !j.teams.length) return { ok: false, detail: 'No match for a known club - the API key may be disabled' };
        return { ok: true, detail: `OK (found ${j.teams[0].strTeam})` };
      } catch (e) { return { ok: false, detail: timedOut(e) }; }
    },
  },
  {
    key: 'holidays', label: 'Public holidays · Nager.Date',
    async probe() {
      try {
        const r = await ping('https://date.nager.at/api/v3/AvailableCountries');
        if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
        const j = asJson(r);
        return (Array.isArray(j) && j.length) ? { ok: true, detail: `OK (${j.length} countries)` } : { ok: false, detail: 'Empty / unexpected response' };
      } catch (e) { return { ok: false, detail: timedOut(e) }; }
    },
  },
  {
    key: 'geocode', label: 'Place search · Open-Meteo',
    async probe() {
      try {
        const r = await ping('https://geocoding-api.open-meteo.com/v1/search?name=Lisbon&count=1');
        if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
        const j = asJson(r);
        return (j && Array.isArray(j.results) && j.results.length) ? { ok: true, detail: 'OK' } : { ok: false, detail: 'No result for a known city' };
      } catch (e) { return { ok: false, detail: timedOut(e) }; }
    },
  },
  {
    key: 'unsplash', label: 'Cover images · Unsplash', needs: (env) => !!(env && env.UNSPLASH_ACCESS_KEY),
    async probe(env) {
      try {
        const r = await ping('https://api.unsplash.com/search/photos?query=sea&per_page=1', { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` } });
        if (r.status === 401 || r.status === 403) return { ok: false, detail: `Key rejected (HTTP ${r.status})` };
        if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
        return { ok: true, detail: 'OK' };
      } catch (e) { return { ok: false, detail: timedOut(e) }; }
    },
  },
];

// Run every applicable probe in parallel. Returns { key: {label, ok, detail, at} }.
export async function runHealthProbes(env) {
  const out = {};
  await Promise.all(HEALTH_PROBES.filter((p) => !p.needs || p.needs(env)).map(async (p) => {
    const r = await p.probe(env).catch((e) => ({ ok: false, detail: (e && e.message) || 'Failed' }));
    out[p.key] = { label: p.label, ok: !!r.ok, detail: String(r.detail || '').slice(0, 180), at: Date.now() };
  }));
  return out;
}
