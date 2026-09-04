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
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['public/app.html', 'public/life.html', 'public/notes.html', 'public/tables.html', 'public/index.html'];
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
