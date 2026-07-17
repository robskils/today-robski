// Does the live D1 match schema.sql? CREATE TABLE IF NOT EXISTS never adds a
// column to a table that already exists, so a column appended to the schema is
// silently absent in production until an ALTER runs. That gap only shows up as
// a 500 on the first insert that names the column - and never in local dev,
// which rebuilds the schema fresh.
//
//   node worker/audit-schema.mjs            # audit
//   node worker/audit-schema.mjs --fix      # ALTER in the missing columns
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FIX = process.argv.includes('--fix');
const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const KEYWORDS = ['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT'];
const tables = {};
for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)) {
  const cols = [];
  for (let line of m[2].split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('--') || KEYWORDS.some((k) => line.toUpperCase().startsWith(k))) continue;
    const c = line.match(/^(\w+)\s+([A-Z].*?)(?:,|$)/);
    if (c) cols.push({ name: c[1], def: line.replace(/,\s*(--.*)?$/, '') });
  }
  tables[m[1]] = cols;
}

const d1 = (cmd) => JSON.parse(execFileSync('npx',
  ['wrangler', 'd1', 'execute', 'today-robski', '--remote', '--yes', '--json', '--command', cmd],
  { encoding: 'utf8' }))[0].results;

let missing = 0;
for (const [tbl, cols] of Object.entries(tables)) {
  const have = new Set(d1(`SELECT name FROM pragma_table_info('${tbl}')`).map((r) => r.name));
  for (const c of cols) {
    if (have.has(c.name)) continue;
    missing++;
    console.log(`  ${tbl}.${c.name} missing`);
    if (FIX) {
      // SQLite can't ALTER-ADD a column with a non-constant default; strip it.
      const def = c.def.replace(/\s+DEFAULT\s+[^ ]+/i, '').replace(/\s+NOT NULL/i, '');
      d1(`ALTER TABLE ${tbl} ADD COLUMN ${def}`);
      console.log(`    added: ${def}`);
    }
  }
}
console.log(missing ? (FIX ? '\nfixed.' : '\nrun with --fix to add them.') : 'live schema matches.');
process.exit(missing && !FIX ? 1 : 0);
