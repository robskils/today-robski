/**
 * Financial advice: track finance YouTube channels, and when a channel posts a
 * NEW video, have Gemini WATCH it (audio + on-screen charts, natively - not a
 * transcript) and produce a summary + concrete action points. A separate pass
 * extrapolates the long-term trends across recent videos.
 *
 * New videos are found from each channel's RSS feed (no API key, no scraping a
 * player). The watching is Gemini, because Claude can't ingest video.
 *
 * Storage is Robski Life's own block table:
 *   kind='finchannel'  title=channel name   props={channelId, url}
 *   kind='finvideo'    title=video title     props={videoId, channelId,
 *                        channelTitle, url, thumb, published, actions[], topics[]}
 *                      body = the summary
 * The long-term-trends text lives in settings under kv_fin_trends.
 */

const RSS = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const WATCH = (id) => `https://www.youtube.com/watch?v=${id}`;
const THUMB = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const CHAN_RE = /(UC[0-9A-Za-z_-]{22})/;

function decodeXml(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
const safeJSON = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

// ── D1 helpers (Robski Life's block table) ──────────────────────────────
async function blocksOfKind(env, kind) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, props, body, created_at FROM blocks WHERE kind = ? AND user_id = ? AND archived = 0 ORDER BY created_at DESC',
  ).bind(kind, env.uid).all();
  return (results || []).map((r) => ({ ...r, props: safeJSON(r.props) }));
}
async function insertBlock(env, kind, title, props, body) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO blocks (id, kind, parent_id, position, title, body, props, created_at, updated_at, archived, user_id) VALUES (?, ?, NULL, 0, ?, ?, ?, ?, ?, 0, ?)',
  ).bind(id, kind, title, body ?? null, JSON.stringify(props || {}), now, now, env.uid).run();
  return { id, kind, title, props: props || {}, body: body ?? null, created_at: now };
}

// ── channel resolution ──────────────────────────────────────────────────
// Accepts a channel id, a /channel/… or /@handle URL, a bare @handle, or a name.
export async function resolveChannel(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Paste a channel link or @handle');

  let channelId = null;
  const direct = raw.match(/channel\/(UC[0-9A-Za-z_-]{22})/) || (CHAN_RE.test(raw) && !/https?:|@|\//.test(raw) ? [null, raw.match(CHAN_RE)[1]] : null);
  if (direct) channelId = direct[1];

  if (!channelId) {
    let url = raw;
    if (/^@/.test(raw)) url = 'https://www.youtube.com/' + raw;
    else if (!/^https?:/i.test(raw)) url = 'https://www.youtube.com/@' + raw.replace(/^@/, '');
    // ucbcb=1 + the consent cookies skip YouTube's "before you continue" redirect
    // (a Worker otherwise lands on the consent page, which has no channel id).
    url += (url.includes('?') ? '&' : '?') + 'ucbcb=1&hl=en';
    let html = '';
    try {
      html = await (await fetch(url, { headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'accept-language': 'en-US,en',
        cookie: 'SOCS=CAISNQgDEitib3F1ZXQ; CONSENT=YES+1',
      } })).text();
    } catch {}
    // The page's OWN id, in priority order - never the first "channelId" in the
    // HTML, which is often a recommended channel, not this one.
    const m = html.match(/rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/)
      || html.match(/"externalId":"(UC[0-9A-Za-z_-]{22})"/)
      || html.match(/property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/)
      || html.match(/channel_id=(UC[0-9A-Za-z_-]{22})/)
      || html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
    if (m) channelId = m[1];
  }
  if (!channelId) throw new Error('Could not find that channel - try the full channel URL');

  // Name from the RSS feed's own <title>.
  let title = channelId;
  try {
    const rss = await (await fetch(RSS(channelId))).text();
    const t = rss.match(/<title>([^<]+)<\/title>/);
    if (t) title = decodeXml(t[1]);
  } catch {}
  return { channelId, title, url: `https://www.youtube.com/channel/${channelId}` };
}

export async function addChannel(env, input) {
  const meta = await resolveChannel(input);
  const existing = (await blocksOfKind(env, 'finchannel')).find((c) => c.props.channelId === meta.channelId);
  if (existing) return { channel: existing, already: true };
  const block = await insertBlock(env, 'finchannel', meta.title, { channelId: meta.channelId, url: meta.url, addedAt: new Date().toISOString() }, null);
  return { channel: block, already: false };
}

// ── feed parsing ────────────────────────────────────────────────────────
function parseFeed(xml) {
  const out = [];
  for (const p of String(xml || '').split('<entry>').slice(1)) {
    const videoId = (p.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    if (!videoId) continue;
    out.push({
      videoId,
      title: decodeXml((p.match(/<title>([^<]+)<\/title>/) || [])[1] || 'Untitled'),
      published: (p.match(/<published>([^<]+)<\/published>/) || [])[1] || null,
      url: WATCH(videoId),
      thumb: THUMB(videoId),
    });
  }
  return out;
}

// ── Gemini: watch a video, summarise it ─────────────────────────────────
const GEMINI = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

async function geminiJSON(env, parts, schema, { temperature = 0.3 } = {}) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini is not set up yet - add the GEMINI_API_KEY secret.');
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) },
  };
  const res = await fetch(GEMINI(model, key), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Gemini ${res.status}: ${t.slice(0, 240)}`); }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('');
  try { return JSON.parse(text); } catch { return { summary: text }; }
}

const VIDEO_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    actions: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'actions'],
};

async function summariseVideo(env, video) {
  const prompt = `You are watching this finance / investing YouTube video for a busy investor. Actually watch it - including anything shown on screen (charts, tickers, price levels) - and return:
- summary: 3 to 5 sentences on what the creator actually argues, keeping any specific numbers, tickers, price levels or timeframes they cite.
- actions: 2 to 5 concrete, specific things a viewer could consider doing off the back of it (skip generic "do your own research" filler).
- topics: 3 to 6 short tags for the key themes (assets, sectors, macro themes).
Be faithful and neutral. This is a summary of the creator's views, not advice to the reader.`;
  const out = await geminiJSON(env, [{ file_data: { file_uri: video.url } }, { text: prompt }], VIDEO_SCHEMA);
  return { summary: String(out.summary || '').trim(), actions: Array.isArray(out.actions) ? out.actions.slice(0, 6) : [], topics: Array.isArray(out.topics) ? out.topics.slice(0, 8) : [] };
}

// ── poll: find new videos, watch + store them ───────────────────────────
// perChannel: how many recent videos per channel to consider. latestOnly forces
// a rescan of just the single most-recent video per channel (the page's manual
// "scan latest" button), summarising it even if others are pending.
export async function pollChannels(env, { perChannel = 3, max = 8, latestOnly = false } = {}) {
  const channels = await blocksOfKind(env, 'finchannel');
  if (!channels.length) return { added: 0, channels: 0, found: 0, errors: [] };
  const known = new Set((await blocksOfKind(env, 'finvideo')).map((v) => v.props.videoId).filter(Boolean));
  let added = 0, found = 0; const errors = [];
  for (const ch of channels) {
    const cid = ch.props.channelId; if (!cid) continue;
    let xml; try { xml = await (await fetch(RSS(cid))).text(); } catch (e) { errors.push(`${ch.title}: feed unreachable`); continue; }
    const vids = parseFeed(xml).slice(0, latestOnly ? 1 : perChannel);
    for (const v of vids) {
      if (known.has(v.videoId)) continue;
      known.add(v.videoId); found++;
      if (added >= max) return { added, found, channels: channels.length, capped: true, errors };
      try {
        const s = await summariseVideo(env, v);
        await insertBlock(env, 'finvideo', v.title,
          { videoId: v.videoId, channelId: cid, channelTitle: ch.title, url: v.url, thumb: v.thumb, published: v.published, actions: s.actions, topics: s.topics },
          s.summary);
        added++;
      } catch (e) { console.error('advice summarise', v.videoId, e.message); if (errors.length < 3) errors.push(`${ch.title}: ${e.message}`); }
    }
  }
  return { added, found, channels: channels.length, errors };
}

// ── long-term trends across recent videos ───────────────────────────────
export async function synthesiseTrends(env) {
  const vids = (await blocksOfKind(env, 'finvideo')).slice(0, 40);
  if (!vids.length) return { text: null, ts: null };
  const digest = vids.map((v) => `• "${v.title}" — ${v.props.channelTitle || ''} (${(v.props.published || '').slice(0, 10)})\n  ${v.body}\n  actions: ${(v.props.actions || []).join('; ')}\n  topics: ${(v.props.topics || []).join(', ')}`).join('\n\n');
  const prompt = `Below are summaries of recent videos from finance channels this investor follows. Extrapolate the LONG-TERM trends and throughlines across them.

Cover: where the creators broadly AGREE, where they DIVERGE, which assets / sectors / macro themes keep recurring, the main risks being flagged, and the emerging medium-to-long-term picture. Ground it in what's actually in the summaries; don't invent specifics not present.

Return JSON: { "text": <4-8 sentence synthesis>, "signals": [<3-6 short bullet strings for the strongest recurring signals>] }.
Neutral synthesis of the creators' collective view - not advice to the reader.

VIDEOS:
${digest}`;
  const schema = { type: 'object', properties: { text: { type: 'string' }, signals: { type: 'array', items: { type: 'string' } } }, required: ['text'] };
  const out = await geminiJSON(env, [{ text: prompt }], schema, { temperature: 0.4 });
  const payload = { text: String(out.text || '').trim(), signals: Array.isArray(out.signals) ? out.signals.slice(0, 8) : [], ts: new Date().toISOString(), from: vids.length };
  try { await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'kv_fin_trends', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(env.uid, JSON.stringify(payload)).run(); } catch {}
  return payload;
}

// Gated poll for the every-minute cron: only actually sweep every ~3h.
// TODO(multi-tenant cron): loops user 1 only for now; iterate all users with
// channels once the cron is reworked. Scoping env to uid 1 makes the block
// helpers and settings throttle resolve to Robin's data.
export async function maybePollChannels(env) {
  if (!env.GEMINI_API_KEY) return;
  env = { ...env, uid: 1 };
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE user_id = 1 AND key = 'kv_fin_last_poll'").first().catch(() => null);
  const last = row && Number(row.value) ? Number(row.value) : 0;
  if (now - last < 3 * 3600) return;
  await env.DB.prepare("INSERT INTO settings (user_id, key, value) VALUES (1, 'kv_fin_last_poll', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(String(now)).run();
  const res = await pollChannels(env);
  if (res.added) { try { await synthesiseTrends(env); } catch {} }
}
