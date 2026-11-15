// Stamp a fresh cache-busting version across the HTML files.
//
//   npm run bump
//
// The version is a local timestamp, YYYYMMDDHHmm. That matters: two Claude
// sessions work in this repo at once, and the old scheme of incrementing a
// letter suffix produced two different conventions (a, b, c … and b2, z2, za2)
// plus arithmetic that could go BACKWARDS - "za" incremented to "b". A version
// that goes backwards can land on a string a browser has already cached, which
// serves stale CSS to a user who has done nothing wrong and has no way to tell.
// A timestamp only ever increases and needs no agreement between sessions.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Stamp EVERY .html under public/, found by walking the tree - not a hard-coded
// list. The old list kept missing pages: first the legacy marketing pages sat at
// ?v=1, then the blog/* posts and the whole pt/fr/es/de/it locale trees sat at
// ?v=8, so a changed favicon or CSS never reached anyone who'd visited them (a
// returning visitor re-requests the SAME ?v= URL and the browser serves its old
// cached copy - this is how the old logo lingered after the 香 seal shipped).
// Walking the tree means a new page is covered the day it lands. (2026-11-15.)
function htmlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(full));
    else if (e.isFile() && e.name.endsWith('.html')) out.push(full);
  }
  return out;
}
const FILES = htmlFiles('public');
const p2 = (n) => String(n).padStart(2, '0');
const d = new Date();
const v = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}`;

let found = 0;
for (const f of FILES) {
  const before = readFileSync(f, 'utf8');
  const after = before.replace(/\?v=[0-9a-z]+/g, `?v=${v}`);
  if (after !== before) found++;
  writeFileSync(f, after);
}
console.log(`cache version -> ${v} (${found} file${found === 1 ? '' : 's'} changed)`);
