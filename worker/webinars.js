// Webinars (Daybook Friends, phase 3d): a scheduled group call anyone can join
// by link, no account needed. Robin's steer: a bigger version of the existing
// video call (everyone can be on camera), host-created with a public link, run
// on Jitsi by default with the option to embed an external stream instead.
//
// The host manages webinars from inside the app (authed). The join page lives at
// /w/<id> and is public - rendered by webinarPage() in index.js. Video is the
// Jitsi room DaybookWebinar<id> unless the host set stream_url.

const slug = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

// Keep only a sensible http(s) URL; anything else becomes "no stream" (Jitsi).
function cleanStream(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return null;
  return s.slice(0, 500);
}

const pub = (w) => ({
  id: w.id, title: w.title, description: w.description || '', startsAt: w.starts_at || null,
  streamUrl: w.stream_url || null, createdAt: w.created_at,
});

export async function createWebinar(env, b) {
  const title = String((b && b.title) || '').trim();
  if (!title) throw new Error('Give your webinar a title.');
  const id = slug(); const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO webinars (id, host_id, title, description, starts_at, stream_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, env.uid, title.slice(0, 200), String((b && b.description) || '').slice(0, 2000) || null, (b && b.startsAt) || null, cleanStream(b && b.streamUrl), now).run();
  return listWebinars(env);
}

export async function updateWebinar(env, id, b) {
  const own = await env.DB.prepare('SELECT id FROM webinars WHERE id = ? AND host_id = ?').bind(id, env.uid).first().catch(() => null);
  if (!own) throw new Error('That is not your webinar.');
  const sets = [], args = [];
  if (b.title !== undefined) { const t = String(b.title).trim(); if (!t) throw new Error('Give your webinar a title.'); sets.push('title = ?'); args.push(t.slice(0, 200)); }
  if (b.description !== undefined) { sets.push('description = ?'); args.push(String(b.description).slice(0, 2000) || null); }
  if (b.startsAt !== undefined) { sets.push('starts_at = ?'); args.push(b.startsAt || null); }
  if (b.streamUrl !== undefined) { sets.push('stream_url = ?'); args.push(cleanStream(b.streamUrl)); }
  if (sets.length) { args.push(id, env.uid); await env.DB.prepare(`UPDATE webinars SET ${sets.join(', ')} WHERE id = ? AND host_id = ?`).bind(...args).run(); }
  return listWebinars(env);
}

export async function listWebinars(env) {
  const rows = (await env.DB.prepare('SELECT * FROM webinars WHERE host_id = ? ORDER BY COALESCE(starts_at, created_at) DESC').bind(env.uid).all().catch(() => ({ results: [] }))).results || [];
  return { webinars: rows.map(pub) };
}

export async function deleteWebinar(env, id) {
  await env.DB.prepare('DELETE FROM webinars WHERE id = ? AND host_id = ?').bind(id, env.uid).run();
  return listWebinars(env);
}

// Public read (no auth), used to render the /w/<id> join page.
export async function getPublicWebinar(env, id) {
  return env.DB.prepare('SELECT w.*, u.name AS host_name, u.subdomain AS host_sub FROM webinars w JOIN users u ON u.id = w.host_id WHERE w.id = ?').bind(id).first().catch(() => null);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Turn a YouTube watch/live/short link into its embeddable form; null otherwise.
function ytEmbed(u) { const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|v\/)|youtu\.be\/)([\w-]{6,})/); return m ? `https://www.youtube.com/embed/${m[1]}` : null; }

// The public join page. Self-contained (inline CSS/JS): served to anyone with
// the link, on any host. Jitsi loads only on click so the page opens quietly.
export function webinarPage(w, id) {
  if (!w) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Webinar not found · Daybook</title><meta name="robots" content="noindex"><style>body{margin:0;background:#efeae0;color:#211c17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.c{text-align:center;padding:32px}.c a{color:#c4412e}</style></head><body><div class="c"><h1>This webinar link isn't valid</h1><p>It may have been removed by the host.</p><p><a href="https://daybook.fyi">daybook.fyi</a></p></div></body></html>`;
  }
  const host = w.host_name || w.host_sub || 'Someone';
  const yt = w.stream_url ? ytEmbed(w.stream_url) : null;
  const room = 'DaybookWebinar' + id;
  const desc = (w.description || '').trim();
  const stage = yt
    ? `<div class="stage"><iframe src="${esc(yt)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
    : w.stream_url
    ? `<div class="stage link"><div><p>The host is streaming here:</p><a class="btn" href="${esc(w.stream_url)}" target="_blank" rel="noopener noreferrer">Open the stream ↗</a></div></div>`
    : `<div class="stage" id="stage"><div class="join" id="join"><p class="jointxt">You're about to join a live call. Your camera and mic stay off until you turn them on.</p><button class="btn" id="joinbtn">Join the call</button></div></div>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(w.title)} · Daybook</title><meta name="robots" content="noindex">
<style>
  :root{--paper:#efeae0;--card:#fbf9f4;--ink:#211c17;--ink2:#574e44;--ink3:#8b7f72;--line:#e4ddcf;--rust:#c4412e}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5}
  .wrap{max-width:860px;margin:0 auto;padding:22px 18px 60px}
  .brand{display:flex;align-items:center;gap:9px;margin-bottom:22px}
  .brand .dot{width:11px;height:11px;border-radius:50%;background:var(--rust)}
  .brand .nm{font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:-.01em}
  .eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3);margin:0 0 8px}
  h1{font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.1;margin:0 0 12px;text-wrap:balance}
  .meta{color:var(--ink2);font-size:15px;margin:0 0 22px}
  .meta b{color:var(--ink)}
  .stage{aspect-ratio:16/9;width:100%;background:#17130f;border-radius:16px;overflow:hidden;display:grid;place-items:center;border:1px solid var(--line)}
  .stage iframe{width:100%;height:100%;border:0;display:block}
  .stage.link{background:var(--card)}
  .join{text-align:center;padding:28px;color:#e8e1d4}
  .jointxt{max-width:380px;margin:0 auto 18px;color:#c9bfae;font-size:15px}
  .btn{display:inline-block;background:var(--rust);color:#fff;border:0;border-radius:11px;padding:13px 26px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none}
  .btn:hover{background:#a8341f}
  .desc{margin:22px 0 0;padding:18px 20px;background:var(--card);border:1px solid var(--line);border-radius:14px;white-space:pre-wrap;color:var(--ink2);font-size:15.5px}
  .foot{margin-top:30px;font-size:12px;color:var(--ink3)}
  .foot a{color:var(--rust);text-decoration:none}
  @media (prefers-color-scheme:dark){:root{--paper:#1a1613;--card:#221d18;--ink:#f2ece1;--ink2:#c8bdae;--ink3:#9a8f80;--line:#342c24}}
</style></head>
<body><div class="wrap">
  <div class="brand"><span class="dot"></span><span class="nm">Daybook</span></div>
  <p class="eyebrow">Live webinar</p>
  <h1>${esc(w.title)}</h1>
  <p class="meta">Hosted by <b>${esc(host)}</b>${w.starts_at ? ` · <span id="when" data-t="${esc(w.starts_at)}">${esc(w.starts_at)}</span>` : ''}</p>
  ${stage}
  ${desc ? `<div class="desc">${esc(desc)}</div>` : ''}
  <p class="foot">Powered by <a href="https://daybook.fyi">Daybook</a> · your camera and microphone are only ever on when you choose.</p>
</div>
<script>
  (function(){
    var el=document.getElementById('when');
    if(el){try{var d=new Date(el.dataset.t);if(!isNaN(d))el.textContent=d.toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}catch(e){}}
    var b=document.getElementById('joinbtn');
    if(b){b.addEventListener('click',function(){
      var s=document.getElementById('stage');
      var f=document.createElement('iframe');
      f.src='https://meet.jit.si/${room}';
      f.allow='camera; microphone; fullscreen; display-capture; autoplay';
      f.allowFullscreen=true;f.style.width='100%';f.style.height='100%';f.style.border='0';
      s.innerHTML='';s.appendChild(f);
    });}
  })();
</script>
</body></html>`;
}
