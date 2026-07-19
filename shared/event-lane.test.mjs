// Adopting the wrong event is a quiet failure: the day's record is simply
// wrong, and nothing complains. The dangerous half is the false positive, so
// most of these cases are titles that must NOT match.

import assert from 'node:assert';
import { laneForEvent } from '../public/event-lane.js';
import { LANES } from './lanes.js';

// Matches the seeded rows in schema.sql.
const ACTIVITIES = [
  { title: 'Yoga Download', lane: 'body' },
  { title: 'Apple Health+', lane: 'body' },
  { title: '8 Pieces of Brocade', lane: 'body' },
  { title: 'Forró', lane: 'music' },
  { title: 'Percussion', lane: 'music' },
  { title: 'Singing', lane: 'music' },
  { title: 'Songwriting', lane: 'music' },
];

const lane = (title) => laneForEvent(title, LANES, ACTIVITIES);

let failed = 0;
function check(title, want, why) {
  const got = lane(title);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(title).padEnd(26)} -> ${got}${ok ? '' : ` (wanted ${want})`}${why ? `  ${why}` : ''}`);
}

console.log('\nevents that should be offered');
check('Zazen', 'zazen');
check('Morning Zazen', 'zazen');
check('zazen 7am', 'zazen');
check('Work', 'work');
check('Work call with Ana', 'work');

console.log('\naccents and case are not a barrier');
check('Forró', 'music');
check('forro social', 'music');
check('FORRÓ!', 'music');
check('Yoga Download', 'body');
check('Singing lesson', 'music');

console.log('\nevents that must NOT be adopted');
check('Workshop with Ana', null, 'not Work');
check('Artichoke delivery', null, 'not Art');
check('Restaurant booking', null, 'not Rest');
check('Bodyboarding', null, 'not Body');
check('Zazenkai prep', null, 'not Zazen');
check('Dentist', null);
check('', null);
check(null, null);

// The untracked lane has no target, so nothing can be credited to it.
console.log('\nuntracked lanes are never a destination');
const other = LANES.find((l) => l.untracked);
assert.ok(other, 'expected an untracked lane to exist');
check(other.label, null, 'untracked');

console.log(failed ? `\n${failed} FAILED\n` : '\nall passed\n');
process.exit(failed ? 1 : 0);
