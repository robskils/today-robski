// Lane mapping rules. Run: node shared/lanes.test.mjs

import { LANES, AREA_TO_LANE, laneForArea } from './lanes.js';

let failed = 0;
const eq = (actual, expected, label) => {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (got ${actual}, wanted ${expected})`}`);
  if (!ok) failed++;
};

console.log('\npractice lanes never receive tasks');
// Zazen and Rest are things done daily, not backlogs to work through. If an
// Area ever maps onto one, its ring starts counting todos instead of sitting.
for (const l of LANES.filter((x) => x.practice)) {
  const mapped = Object.entries(AREA_TO_LANE).filter(([, v]) => v === l.key).map(([k]) => k);
  eq(mapped.length, 0, `nothing maps to ${l.key}${mapped.length ? ` (found: ${mapped})` : ''}`);
}

console.log('\nZen study is not zazen');
eq(laneForArea('Well-being / Mind / Spirit'), 'other', 'Well-being / Mind / Spirit -> other');

console.log('\nBody tasks are life admin, not workouts');
// "Book a physio" belongs in My Life. The Body ring is filled by activities.
eq(laneForArea('Body / Health'), 'mylife', 'Body / Health -> mylife');
eq(laneForArea('Somatic Studio'), 'mylife', 'Somatic Studio -> mylife');

console.log('\nsanity');
eq(laneForArea('My Life'), 'mylife', 'My Life -> mylife');
eq(laneForArea('Money'), 'mylife', 'Money -> mylife');
eq(laneForArea('Língua Portuguesa'), 'portuguese', 'Língua Portuguesa -> portuguese');
eq(laneForArea('Dance'), 'forro', 'Dance -> forro');
eq(laneForArea('Business'), 'work', 'Business -> work');
eq(laneForArea(null), 'other', 'no area -> other');
eq(laneForArea('Nonsense'), 'other', 'unknown area -> other');

console.log('\nno stale lane keys left behind');
// A renamed lane that something still points at would silently vanish from
// the rail, since the client only draws lanes that exist.
eq(LANES.some((l) => l.key === 'admin'), false, "'admin' is gone, renamed to mylife");
eq(LANES.some((l) => l.key === 'mylife'), true, "'mylife' exists");

console.log('\nevery mapping targets a real lane');
const keys = new Set(LANES.map((l) => l.key));
for (const [area, lane] of Object.entries(AREA_TO_LANE)) {
  if (!keys.has(lane)) { console.log(`  FAIL ${area} -> ${lane} (no such lane)`); failed++; }
}
eq(failed, failed, `${Object.keys(AREA_TO_LANE).length} mappings checked`);

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
process.exit(failed ? 1 : 0);
