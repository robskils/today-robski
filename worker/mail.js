// Mail, entirely on the Worker. Cloudflare's raw TCP socket API (connect) lets
// the Worker speak IMAP and SMTP straight to Purelymail - no separate server, no
// extra host, free. The browser calls /api/mail/*; this talks the protocols.
//
// Accounts live in D1; the password is AES-256-GCM encrypted at rest with a key
// derived from AUTH_SECRET. Robin types it once in the app; it's never logged.
import { connect } from 'cloudflare:sockets';
import PostalMime from 'postal-mime';

// ── crypto ────────────────────────────────────────────────────────────
async function mailKey(env) {
  const raw = new TextEncoder().encode(`mail:${env.AUTH_SECRET || ''}`);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encryptPass(env, text) {
  const key = await mailKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const out = new Uint8Array(iv.length + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...out));
}
async function decryptPass(env, b64) {
  const key = await mailKey(env);
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
  return new TextDecoder().decode(pt);
}

// ── accounts (D1) ─────────────────────────────────────────────────────
const publicAccount = (a) => ({ id: a.id, email: a.email, name: a.name, color: a.color });
async function listAccounts(env) {
  const { results } = await env.DB.prepare('SELECT * FROM mail_accounts ORDER BY position, email').all();
  return results;
}
async function getAcct(env, id) {
  return env.DB.prepare('SELECT * FROM mail_accounts WHERE id = ?').bind(id).first();
}

// ── a byte-buffered line/literal reader over a socket ─────────────────
class Reader {
  constructor(readable) { this.r = readable.getReader(); this.buf = new Uint8Array(0); this.done = false; }
  async _more() {
    if (this.done) return false;
    const { value, done } = await this.r.read();
    if (done) { this.done = true; return false; }
    const n = new Uint8Array(this.buf.length + value.length); n.set(this.buf); n.set(value, this.buf.length); this.buf = n;
    return true;
  }
  async line() {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) { const s = new TextDecoder().decode(this.buf.subarray(0, i + 1)); this.buf = this.buf.slice(i + 1); return s; }
      if (!(await this._more())) { if (this.buf.length) { const s = new TextDecoder().decode(this.buf); this.buf = new Uint8Array(0); return s; } return null; }
    }
  }
  async bytes(n) {
    while (this.buf.length < n && await this._more()) { /* fill */ }
    const out = this.buf.slice(0, n); this.buf = this.buf.slice(n); return out;
  }
}

// Guard every network op so a hung server can't stall the whole Worker.
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

// ── IMAP ──────────────────────────────────────────────────────────────
const imapStr = (s) => `"${String(s).replace(/([\\"])/g, '\\$1')}"`;

async function imapOpen(env, acct) {
  const pass = await decryptPass(env, acct.pass_enc);
  const socket = connect({ hostname: acct.imap_host, port: acct.imap_port }, { secureTransport: 'on', allowHalfOpen: false });
  const reader = new Reader(socket.readable);
  const writer = socket.writable.getWriter();
  const enc = new TextEncoder();
  let tag = 0;
  await withTimeout(reader.line(), 10000, 'IMAP greeting'); // * OK ...

  async function readResponse(t) {
    const lines = [];
    for (;;) {
      let line = await reader.line();
      if (line == null) throw new Error('IMAP connection closed');
      let m = line.match(/\{(\d+)\}\r?\n$/);
      while (m) {                                   // inline literal: pull the bytes, keep reading the line
        const lit = await reader.bytes(Number(m[1]));
        line = line.replace(/\{\d+\}\r?\n$/, '') + new TextDecoder().decode(lit);
        const cont = await reader.line();
        line += cont; m = cont.match(/\{(\d+)\}\r?\n$/);
      }
      lines.push(line);
      if (line.startsWith(t + ' ')) return { ok: /^\S+\s+OK/i.test(line), lines };
      if (line.startsWith('+')) return { cont: true, lines };
    }
  }
  const cmd = (command) => { const t = 'A' + (++tag); return withTimeout((async () => { await writer.write(enc.encode(`${t} ${command}\r\n`)); return readResponse(t); })(), 20000, 'IMAP command'); };

  return {
    async login() { const r = await cmd(`LOGIN ${imapStr(acct.username)} ${imapStr(pass)}`); if (!r.ok) throw new Error('Mail login failed - check the username and password.'); },
    async logout() { try { await cmd('LOGOUT'); } catch {} try { await writer.close(); } catch {} },
    async select(mbox) { const r = await cmd(`SELECT ${imapStr(mbox)}`); if (!r.ok) throw new Error(`Cannot open ${mbox}`); const ex = r.lines.map((l) => l.match(/\* (\d+) EXISTS/)).find(Boolean); return ex ? Number(ex[1]) : 0; },
    async listMailboxes() {
      const r = await cmd('LIST "" "*"'); const out = [];
      for (const l of r.lines) { const m = l.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"([^"]*)"|(\S+))/); if (m) out.push({ path: m[2] || m[3], flags: m[1] }); }
      return out;
    },
    async listRecent(limit) {
      const r = await cmd(`FETCH ${Math.max(1, 1)}:* (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
      // Note: caller SELECTs first; we fetch all then keep the last `limit`.
      const msgs = [];
      for (const l of r.lines) {
        if (!/^\* \d+ FETCH/.test(l)) continue;
        const uid = (l.match(/UID (\d+)/) || [])[1];
        const flags = (l.match(/FLAGS \(([^)]*)\)/) || [])[1] || '';
        // The header literal is glued straight onto the FETCH prefix, so the
        // first header (From) is NOT at a line start. Strip the prefix up to the
        // closing ] of BODY[HEADER.FIELDS (...)] and anchor each header on \n.
        const hdr = '\n' + l.replace(/^\* \d+ FETCH .*?\]\s*/s, '');
        const grab = (name) => decodeWords((hdr.match(new RegExp(`\\n${name}:\\s*([^\\r\\n]*)`, 'i')) || [])[1] || '').trim();
        const from = grab('From');
        const subject = grab('Subject') || '(no subject)';
        const date = grab('Date');
        if (uid) msgs.push({ uid: Number(uid), seen: /\\Seen/.test(flags), from: parseAddr(from), subject, date: parseDate(date) });
      }
      msgs.sort((a, b) => (a.uid < b.uid ? 1 : -1));
      return msgs.slice(0, limit);
    },
    async fetchRaw(uid) {
      const t = 'A' + (++tag);
      await writer.write(enc.encode(`${t} UID FETCH ${uid} (BODY.PEEK[])\r\n`));
      let line = await reader.line(); let m;
      while (line != null && !(m = line.match(/\{(\d+)\}\r?\n$/))) { if (line.startsWith(t + ' ')) return null; line = await reader.line(); }
      if (!m) return null;
      const raw = await reader.bytes(Number(m[1]));
      for (;;) { const l = await reader.line(); if (l == null || l.startsWith(t + ' ')) break; }
      return raw;
    },
    async storeSeen(uid, seen) { await cmd(`UID STORE ${uid} ${seen ? '+' : '-'}FLAGS (\\Seen)`); },
    async move(uid, target) {
      const r = await cmd(`UID MOVE ${uid} ${imapStr(target)}`);
      if (!r.ok) { await cmd(`UID COPY ${uid} ${imapStr(target)}`); await cmd(`UID STORE ${uid} +FLAGS (\\Deleted)`); await cmd('EXPUNGE'); }
    },
    cmd, reader, writer, enc,
  };
}

// ── header decoding ───────────────────────────────────────────────────
function decodeWords(s) {
  if (!s) return s;
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, encChar, text) => {
    try {
      let bytes;
      if (encChar.toUpperCase() === 'B') bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      else { const q = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))); bytes = Uint8Array.from(q, (c) => c.charCodeAt(0)); }
      return new TextDecoder(cs.toLowerCase()).decode(bytes);
    } catch { return text; }
  }).replace(/\?=\s+=\?/g, '').trim();
}
function parseAddr(s) {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/) || s.match(/^\s*<?([^<>]+@[^<>]+)>?\s*$/);
  if (!m) return { name: '', address: s.trim() };
  return m[2] ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: m[1].trim() };
}
function parseDate(s) { const d = new Date(s); return isNaN(d) ? s : d.toISOString(); }

// ── SMTP ──────────────────────────────────────────────────────────────
async function smtpSend(env, acct, msg) {
  const pass = await decryptPass(env, acct.pass_enc);
  const implicitTls = Number(acct.smtp_port) === 465;
  let socket = connect({ hostname: acct.smtp_host, port: Number(acct.smtp_port) }, implicitTls ? { secureTransport: 'on' } : { secureTransport: 'starttls' });
  let reader = new Reader(socket.readable);
  let writer = socket.writable.getWriter();
  const enc = new TextEncoder();
  const say = async (line) => { await writer.write(enc.encode(line + '\r\n')); };
  const expect = async (codes, what) => {
    let line; let all = '';
    for (;;) { line = await withTimeout(reader.line(), 15000, `SMTP ${what}`); if (line == null) throw new Error(`SMTP ${what}: connection closed`); all += line; if (/^\d{3} /.test(line)) break; }
    const code = all.match(/(\d{3}) /); if (!code || !codes.includes(code[1])) throw new Error(`SMTP ${what}: ${all.trim()}`);
  };
  await expect(['220'], 'greeting');
  await say('EHLO robski.uk'); await expect(['250'], 'EHLO');
  if (!implicitTls) { await say('STARTTLS'); await expect(['220'], 'STARTTLS'); socket = socket.startTls(); reader = new Reader(socket.readable); writer = socket.writable.getWriter(); await say('EHLO robski.uk'); await expect(['250'], 'EHLO2'); }
  await say('AUTH LOGIN'); await expect(['334'], 'AUTH');
  await say(btoa(acct.username)); await expect(['334'], 'AUTH user');
  await say(btoa(pass)); await expect(['235'], 'AUTH pass');
  await say(`MAIL FROM:<${acct.email}>`); await expect(['250'], 'MAIL FROM');
  for (const to of msg.rcpts) { await say(`RCPT TO:<${to}>`); await expect(['250', '251'], 'RCPT TO'); }
  await say('DATA'); await expect(['354'], 'DATA');
  const body = msg.raw.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..'); // dot-stuff
  await writer.write(enc.encode(body + '\r\n.\r\n')); await expect(['250'], 'send');
  await say('QUIT'); try { await writer.close(); } catch {}
}

// Build an RFC 822 message. Body is base64 (safe for any UTF-8 content).
function buildMessage(acct, msg) {
  const b64 = btoa(unescape(encodeURIComponent(msg.text || '')));
  const subj = /[^\x00-\x7F]/.test(msg.subject || '') ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(msg.subject)))}?=` : (msg.subject || '(no subject)');
  const headers = [
    `From: ${acct.name ? `${mimeWord(acct.name)} ` : ''}<${acct.email}>`,
    `To: ${msg.to}`,
    msg.cc ? `Cc: ${msg.cc}` : null,
    `Subject: ${subj}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${acct.email.split('@')[1]}>`,
    msg.inReplyTo ? `In-Reply-To: ${msg.inReplyTo}` : null,
    msg.inReplyTo ? `References: ${msg.inReplyTo}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean).join('\r\n');
  return `${headers}\r\n\r\n${b64.replace(/(.{76})/g, '$1\r\n')}`;
}
const mimeWord = (s) => /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=` : s;

// ── routes ────────────────────────────────────────────────────────────
// index.js delegates any /api/mail/* path here (already behind the auth gate).
export async function handleMail(request, env, url, json, err) {
  const path = url.pathname, method = request.method;
  const seg = path.replace(/^\/api\/mail\/?/, '').split('/');
  const sub = seg[0] || '';

  try {
    if (sub === 'accounts' && method === 'GET') return json((await listAccounts(env)).map(publicAccount), request);

    if (sub === 'accounts' && method === 'POST') {
      const b = await request.json();
      if (!b.email || !b.imapHost || !b.smtpHost || !b.pass) return err('email, imapHost, smtpHost and password are required', request, 400);
      const acct = {
        id: crypto.randomUUID().slice(0, 8), email: b.email, name: b.name || b.email, color: b.color || null,
        imap_host: b.imapHost, imap_port: Number(b.imapPort) || 993,
        smtp_host: b.smtpHost, smtp_port: Number(b.smtpPort) || 465,
        username: b.username || b.email, pass_enc: await encryptPass(env, b.pass),
      };
      const im = await imapOpen(env, acct);                       // prove it connects before storing
      try { await im.login(); } finally { await im.logout(); }
      await env.DB.prepare('INSERT INTO mail_accounts (id,email,name,color,imap_host,imap_port,smtp_host,smtp_port,username,pass_enc,position) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(acct.id, acct.email, acct.name, acct.color, acct.imap_host, acct.imap_port, acct.smtp_host, acct.smtp_port, acct.username, acct.pass_enc, 0).run();
      return json(publicAccount(acct), request, 201);
    }

    if (sub === 'accounts' && method === 'DELETE') { await env.DB.prepare('DELETE FROM mail_accounts WHERE id = ?').bind(seg[1]).run(); return json({ ok: true }, request); }

    const acct = await getAcct(env, url.searchParams.get('account') || (await request.clone().json().catch(() => ({}))).account);
    if (!acct) return err('unknown account', request, 400);

    if (sub === 'mailboxes') { const im = await imapOpen(env, acct); try { await im.login(); return json(await im.listMailboxes(), request); } finally { await im.logout(); } }

    if (sub === 'messages') {
      const mailbox = url.searchParams.get('mailbox') || 'INBOX';
      const im = await imapOpen(env, acct);
      try { await im.login(); const total = await im.select(mailbox); return json({ total, messages: total ? await im.listRecent(Number(url.searchParams.get('limit')) || 40) : [] }, request); }
      finally { await im.logout(); }
    }

    if (sub === 'message') {
      const mailbox = url.searchParams.get('mailbox') || 'INBOX', uid = Number(url.searchParams.get('uid'));
      const im = await imapOpen(env, acct);
      try {
        await im.login(); await im.select(mailbox);
        const raw = await im.fetchRaw(uid); if (!raw) return err('message not found', request, 404);
        const p = await PostalMime.parse(raw);
        return json({
          uid, subject: p.subject || '(no subject)', from: p.from || null,
          to: (p.to || []).map((a) => ({ name: a.name, address: a.address })),
          cc: (p.cc || []).map((a) => ({ name: a.name, address: a.address })),
          date: (p.date ? new Date(p.date).toISOString() : ''),
          messageId: p.messageId || null, html: p.html || null, text: p.text || '',
          attachments: (p.attachments || []).map((a) => ({ filename: a.filename, size: (a.content && a.content.byteLength) || 0, type: a.mimeType })),
        }, request);
      } finally { await im.logout(); }
    }

    if (sub === 'flag' && method === 'POST') { const b = await request.json(); const im = await imapOpen(env, acct); try { await im.login(); await im.select(b.mailbox || 'INBOX'); await im.storeSeen(b.uid, !!b.seen); return json({ ok: true }, request); } finally { await im.logout(); } }

    if (sub === 'move' && method === 'POST') { const b = await request.json(); const im = await imapOpen(env, acct); try { await im.login(); await im.select(b.mailbox || 'INBOX'); await im.move(b.uid, b.target || 'Trash'); return json({ ok: true }, request); } finally { await im.logout(); } }

    if (sub === 'send' && method === 'POST') {
      const b = await request.json();
      const rcpts = [b.to, b.cc].filter(Boolean).join(',').split(',').map((s) => s.trim()).filter(Boolean);
      if (!rcpts.length) return err('a recipient is required', request, 400);
      await smtpSend(env, acct, { rcpts, raw: buildMessage(acct, b) });
      return json({ ok: true }, request);
    }

    return err('not found', request, 404);
  } catch (e) {
    console.error('mail:', e.message);
    return err(e.message || 'Mail error', request, 502);
  }
}
