// Robski Mail backend. A tiny Hono service that fronts each account's IMAP/SMTP
// for life.robski.uk/mail. It trusts the SAME session token as the Life app
// (signed with AUTH_SECRET), so there's no second login.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { jwtVerify } from 'jose';
import { listAccounts, getAccount, addAccount, removeAccount, publicAccount, encrypt } from './store.mjs';
import { testAccount, listMailboxes, listMessages, getMessage, flagMessage, moveMessage, appendToSent } from './imap.mjs';
import { sendMail } from './smtp.mjs';

const app = new Hono();
const ORIGIN = process.env.ALLOW_ORIGIN || 'https://life.robski.uk';
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || '');

// CORS: only the Life app's origin, with the Authorization header.
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', ORIGIN);
  c.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  c.header('Vary', 'Origin');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/health', (c) => c.json({ ok: true }));

// Everything else needs a valid Life session token.
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next();
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try { await jwtVerify(token, SECRET); } catch { return c.json({ error: 'unauthorized' }, 401); }
  await next();
});

const acct = (c) => { const a = getAccount(c.req.query('account')); if (!a) throw new Error('unknown account'); return a; };
const wrap = (fn) => async (c) => { try { return await fn(c); } catch (e) { return c.json({ error: String(e.message || e) }, 502); } };

app.get('/accounts', (c) => c.json(listAccounts().map(publicAccount)));

app.post('/accounts', wrap(async (c) => {
  const b = await c.req.json();
  if (!b.email || !b.imapHost || !b.smtpHost || !b.pass) return c.json({ error: 'email, imapHost, smtpHost and pass are all required' }, 400);
  // Prove the credentials actually connect before we store them, so a typo
  // surfaces now rather than as a silent empty inbox later.
  const draft = { email: b.email, name: b.name, color: b.color,
    imapHost: b.imapHost, imapPort: Number(b.imapPort) || 993, imapSecure: b.imapSecure !== false,
    smtpHost: b.smtpHost, smtpPort: Number(b.smtpPort) || 465, smtpSecure: b.smtpSecure !== false,
    user: b.user || b.email, pass: b.pass };
  try { await testAccount({ ...draft, passEnc: encrypt(draft.pass) }); }
  catch (e) { return c.json({ error: `Could not sign in: ${e.message}` }, 400); }
  return c.json(publicAccount(addAccount(draft)), 201);
}));

app.delete('/accounts/:id', (c) => { removeAccount(c.req.param('id')); return c.json({ ok: true }); });

app.get('/mailboxes', wrap(async (c) => c.json(await listMailboxes(acct(c)))));
app.get('/messages', wrap(async (c) => c.json(await listMessages(acct(c), c.req.query('mailbox') || 'INBOX', Number(c.req.query('limit')) || 40))));
app.get('/message', wrap(async (c) => c.json(await getMessage(acct(c), c.req.query('mailbox') || 'INBOX', Number(c.req.query('uid'))))));

app.post('/flag', wrap(async (c) => { const b = await c.req.json(); await flagMessage(getAccount(b.account), b.mailbox, b.uid, !!b.seen); return c.json({ ok: true }); }));
app.post('/move', wrap(async (c) => { const b = await c.req.json(); await moveMessage(getAccount(b.account), b.mailbox, b.uid, b.target); return c.json({ ok: true }); }));

app.post('/send', wrap(async (c) => {
  const b = await c.req.json();
  const a = getAccount(b.account); if (!a) return c.json({ error: 'unknown account' }, 400);
  const sent = await sendMail(a, b);
  if (sent.raw) await appendToSent(a, sent.raw).catch(() => {});
  return c.json({ ok: true, messageId: sent.messageId });
}));

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port }, () => console.log(`mail backend on :${port}`));
