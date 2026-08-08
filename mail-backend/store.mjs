// Account storage. Configs (host/port/user) live as plain JSON; the password is
// AES-256-GCM encrypted at rest with MASTER_KEY, so a leaked file isn't a leaked
// mailbox. Robin enters the password once in the app; it is never sent back out.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash, randomUUID } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || './data';
const FILE = join(DATA_DIR, 'accounts.json');
// A 32-byte key from MASTER_KEY (any length string, hashed to 32 bytes).
const KEY = createHash('sha256').update(String(process.env.MASTER_KEY || '')).digest();

if (!process.env.MASTER_KEY) console.warn('WARNING: MASTER_KEY not set - credentials will not be safely encrypted.');

export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(b64) {
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), enc = raw.subarray(28);
  const d = createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return []; }
}
function save(list) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2));
}

// Public shape hides the encrypted password and gives the app what it renders.
export const publicAccount = (a) => ({ id: a.id, email: a.email, name: a.name, color: a.color });

export function listAccounts() { return load(); }
export function getAccount(id) { return load().find((a) => a.id === id) || null; }
export function addAccount(input) {
  const list = load();
  const a = {
    id: randomUUID().slice(0, 8),
    email: input.email, name: input.name || input.email, color: input.color || null,
    imapHost: input.imapHost, imapPort: Number(input.imapPort) || 993, imapSecure: input.imapSecure !== false,
    smtpHost: input.smtpHost, smtpPort: Number(input.smtpPort) || 465, smtpSecure: input.smtpSecure !== false,
    user: input.user || input.email, passEnc: encrypt(input.pass),
  };
  list.push(a); save(list); return a;
}
export function removeAccount(id) { save(load().filter((a) => a.id !== id)); }
export const accountPassword = (a) => decrypt(a.passEnc);
