// Timezone maths around the Lisbon DST changes. Run: node worker/time.test.mjs
//
// These matter because slots store wall-clock minutes from local midnight while
// calendar events arrive as instants. Measuring events as an elapsed delta from
// the day-start instant silently shifts them by an hour on either side of a
// transition, and a fixed 24h window drops or steals late events.

import { zonedDayStart, nextDayStr, localParts } from './index.js';

const TZ = 'Europe/Lisbon';
let failed = 0;

function eq(actual, expected, label) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : `\n        expected ${expected}\n        actual   ${actual}`}`);
  if (!ok) failed++;
}

// How the worker positions an event on the timeline.
function eventStartMin(iso, day) {
  const p = localParts(new Date(iso), TZ);
  return p.date < day ? 0 : p.min;
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

console.log('\nzonedDayStart');
eq(zonedDayStart('2026-07-16', TZ).toISOString(), '2026-07-15T23:00:00.000Z', 'summer (WEST, UTC+1)');
eq(zonedDayStart('2026-01-15', TZ).toISOString(), '2026-01-15T00:00:00.000Z', 'winter (WET, UTC+0)');
eq(zonedDayStart('2025-10-26', TZ).toISOString(), '2025-10-25T23:00:00.000Z', 'WEST->WET day starts in WEST');
eq(zonedDayStart('2026-03-29', TZ).toISOString(), '2026-03-29T00:00:00.000Z', 'WET->WEST day starts in WET');

console.log('\nday length across a transition');
const oct = (zonedDayStart(nextDayStr('2025-10-26'), TZ) - zonedDayStart('2025-10-26', TZ)) / 3600000;
const mar = (zonedDayStart(nextDayStr('2026-03-29'), TZ) - zonedDayStart('2026-03-29', TZ)) / 3600000;
eq(oct, 25, '26 Oct 2025 is 25 hours');
eq(mar, 23, '29 Mar 2026 is 23 hours');

console.log('\nevent placement: a 14:00 local meeting renders at 14:00');
eq(hhmm(eventStartMin('2026-07-16T13:00:00Z', '2026-07-16')), '14:00', 'summer');
eq(hhmm(eventStartMin('2026-01-15T14:00:00Z', '2026-01-15')), '14:00', 'winter');
eq(hhmm(eventStartMin('2025-10-26T14:00:00Z', '2025-10-26')), '14:00', 'after WEST->WET (was 15:00)');
eq(hhmm(eventStartMin('2026-03-29T13:00:00Z', '2026-03-29')), '14:00', 'after WET->WEST (was 13:00)');

console.log('\nevent placement: either side of the 26 Oct 2025 switch');
eq(hhmm(eventStartMin('2025-10-25T23:30:00Z', '2025-10-26')), '00:30', '00:30 before the switch');
eq(hhmm(eventStartMin('2025-10-26T22:30:00Z', '2025-10-26')), '22:30', '22:30 after the switch');

console.log('\nwindow covers the whole local day');
{
  const day = '2025-10-26';
  const end = zonedDayStart(nextDayStr(day), TZ);
  const late = new Date('2025-10-26T23:30:00Z'); // 23:30 local, in WET
  eq(late < end, true, '23:30 on the 25h day is inside the window');
  eq(localParts(late, TZ).date, day, '...and lands on the right day');
}
{
  const day = '2026-03-29';
  const end = zonedDayStart(nextDayStr(day), TZ);
  const nextMorning = new Date('2026-03-29T23:30:00Z'); // 00:30 on the 30th, in WEST
  eq(nextMorning < end, false, '00:30 the next morning is excluded from the 23h day');
}

console.log('\noverlapping events get clipped to the day');
eq(eventStartMin('2026-07-15T21:00:00Z', '2026-07-16'), 0, 'event starting yesterday clips to 00:00');

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
process.exit(failed ? 1 : 0);
