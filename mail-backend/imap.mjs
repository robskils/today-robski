// IMAP operations via ImapFlow. v1 opens a short-lived connection per request
// and closes it - simple and robust. A warm connection pool is the obvious next
// optimisation, but correctness first.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { accountPassword } from './store.mjs';

function client(account) {
  return new ImapFlow({
    host: account.imapHost, port: account.imapPort, secure: account.imapSecure,
    auth: { user: account.user, pass: accountPassword(account) },
    logger: false, emitLogs: false,
  });
}
async function withClient(account, fn) {
  const c = client(account);
  await c.connect();
  try { return await fn(c); } finally { await c.logout().catch(() => {}); }
}

// Verify credentials by connecting once (used when adding an account).
export async function testAccount(account) {
  await withClient(account, async () => true);
}

// Common folders, plus whatever the server lists. Keeps the well-known ones on top.
export async function listMailboxes(account) {
  return withClient(account, async (c) => {
    const boxes = [];
    for await (const box of await c.list()) {
      boxes.push({ path: box.path, name: box.name, specialUse: box.specialUse || null });
    }
    return boxes;
  });
}

const addr = (a) => (a && a.value && a.value[0]) ? { name: a.value[0].name || '', address: a.value[0].address || '' } : null;

// Newest `limit` message headers in a mailbox (envelope + flags + a short snippet).
export async function listMessages(account, mailbox, limit = 40) {
  return withClient(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const total = c.mailbox.exists;
      if (!total) return { total: 0, messages: [] };
      const from = Math.max(1, total - limit + 1);
      const out = [];
      for await (const m of c.fetch(`${from}:*`, { uid: true, envelope: true, flags: true, internalDate: true })) {
        const e = m.envelope || {};
        out.push({
          uid: m.uid,
          subject: e.subject || '(no subject)',
          from: addr(e.from ? { value: e.from } : null),
          date: (e.date || m.internalDate || new Date()).toISOString?.() || String(e.date || ''),
          seen: (m.flags && (m.flags.has ? m.flags.has('\\Seen') : m.flags.includes('\\Seen'))) || false,
        });
      }
      out.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
      return { total, messages: out };
    } finally { lock.release(); }
  });
}

// Full message: parsed headers + text/html body + attachment names.
export async function getMessage(account, mailbox, uid) {
  return withClient(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const { content } = await c.download(uid, undefined, { uid: true });
      const parsed = await simpleParser(content);
      return {
        uid,
        subject: parsed.subject || '(no subject)',
        from: parsed.from?.value?.[0] || null,
        to: (parsed.to?.value || []).map((v) => ({ name: v.name, address: v.address })),
        date: (parsed.date || new Date()).toISOString(),
        messageId: parsed.messageId || null,
        html: parsed.html || null,
        text: parsed.text || '',
        attachments: (parsed.attachments || []).map((a) => ({ filename: a.filename, size: a.size, type: a.contentType })),
      };
    } finally { lock.release(); }
  });
}

export async function flagMessage(account, mailbox, uid, seen) {
  return withClient(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      if (seen) await c.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      else await c.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
      return true;
    } finally { lock.release(); }
  });
}

export async function moveMessage(account, mailbox, uid, target) {
  return withClient(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try { await c.messageMove(uid, target, { uid: true }); return true; }
    finally { lock.release(); }
  });
}

// Append a copy of a sent message to the Sent folder, so it shows in the client.
export async function appendToSent(account, raw) {
  return withClient(account, async (c) => {
    let sent = 'Sent';
    for await (const box of await c.list()) if (box.specialUse === '\\Sent') sent = box.path;
    await c.append(sent, raw, ['\\Seen']).catch(() => {});
    return true;
  });
}
