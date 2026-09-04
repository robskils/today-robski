import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEF_MIN, BRIEF_WINDOW_END, briefDue, fmtTime, longDate, esc, briefSubject, briefEmail,
} from './brief.js';

// The whole point of the claim in runDailyBrief is that briefDue says yes for
// every tick in a 90-minute window. If these two disagree, 08:45 becomes 90
// emails.
test('briefDue: yes at 08:45, and for the rest of the window', () => {
  assert.equal(briefDue(BRIEF_MIN, '2026-08-04', null), true);
  assert.equal(briefDue(BRIEF_MIN + 1, '2026-08-04', null), true);
  assert.equal(briefDue(BRIEF_WINDOW_END, '2026-08-04', null), true);
});

test('briefDue: no before 08:45, and no once the window has closed', () => {
  assert.equal(briefDue(BRIEF_MIN - 1, '2026-08-04', null), false);
  assert.equal(briefDue(0, '2026-08-04', null), false);
  assert.equal(briefDue(BRIEF_WINDOW_END + 1, '2026-08-04', null), false);
  // The evening case this window exists to prevent.
  assert.equal(briefDue(18 * 60, '2026-08-04', null), false);
});

test('briefDue: a day already sent is never sent again', () => {
  assert.equal(briefDue(BRIEF_MIN, '2026-08-04', '2026-08-04'), false);
  assert.equal(briefDue(BRIEF_MIN, '2026-08-05', '2026-08-04'), true);
});

test('fmtTime pads and clamps', () => {
  assert.equal(fmtTime(0), '00:00');
  assert.equal(fmtTime(525), '08:45');
  assert.equal(fmtTime(1439), '23:59');
});

// Built from the date string, never from a live clock, or a brief composed at
// 00:30 UTC would name yesterday.
test('longDate names the day being briefed', () => {
  assert.equal(longDate('2026-08-04'), 'Tuesday, 4 August');
  assert.equal(longDate('2026-01-01'), 'Thursday, 1 January');
});

// Event and task titles are somebody else's text. Tana holds Robin's own
// notes, but a calendar invite comes from outside.
test('esc neutralises markup in titles', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(esc('Ben & Jerry\'s'), 'Ben &amp; Jerry&#39;s');
});

test('briefEmail escapes an injected title rather than rendering it', () => {
  const html = briefEmail({
    day: '2026-08-04',
    events: [{ title: '<img src=x onerror=alert(1)>', allDay: false, start_min: 600, duration: 60 }],
    tasks: [{ title: '</td></table><b>escaped</b>' }],
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>escaped</b>'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('briefSubject says what is in the day', () => {
  assert.equal(
    briefSubject({ day: '2026-08-04', events: [{}], tasks: [{}, {}] }),
    'Tuesday, 4 August - 1 event, 2 P1',
  );
  assert.equal(
    briefSubject({ day: '2026-08-04', events: [{}, {}], tasks: [] }),
    'Tuesday, 4 August - 2 events',
  );
});

// An empty day is a good day, not a broken brief.
test('briefSubject and body stay calm on an empty day', () => {
  assert.equal(briefSubject({ day: '2026-08-04' }), 'Tuesday, 4 August - a clear day');
  const html = briefEmail({ day: '2026-08-04' });
  assert.ok(html.includes('Nothing scheduled'));
  assert.ok(html.includes('No P1s open'));
});

test('briefEmail renders times, all-day events and the quote', () => {
  const html = briefEmail({
    day: '2026-08-04',
    events: [
      { title: 'Timed sit', allDay: false, start_min: 420, duration: 60 },
      { title: 'Feriado', allDay: true, start_min: 0, duration: 1440 },
    ],
    tasks: [{ title: 'File the recibo', area_label: 'Work' }],
    quote: { text: 'Wash your bowl.', author: 'Zhaozhou' },
  });
  assert.ok(html.includes('07:00'));
  assert.ok(html.includes('08:00'));       // start + duration
  assert.ok(html.includes('All day'));
  assert.ok(html.includes('File the recibo'));
  assert.ok(html.includes('Work'));
  assert.ok(html.includes('Wash your bowl.'));
  assert.ok(html.includes('Zhaozhou'));
});

// Twenty-one P1s in an email is a wall you scroll past. Seven is a morning's
// worth, and the rest are one tap away.
test('briefEmail shows seven tasks and links to the remainder', () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ title: `Task ${i + 1}` }));
  const html = briefEmail({ day: '2026-08-04', tasks: many, siteUrl: 'https://x.daybook.fyi' });
  assert.ok(html.includes('Task 7'));
  assert.ok(!html.includes('Task 8'));
  assert.ok(html.includes('14 more'));
  assert.ok(html.includes('https://x.daybook.fyi/tasks?p1=1'));
});

test('briefEmail does not offer more when there is no more', () => {
  const html = briefEmail({ day: '2026-08-04', tasks: [{ title: 'Only one' }] });
  assert.ok(html.includes('Only one'));
  assert.ok(!html.includes('more &#8594;'));
});

// It goes to strangers now: no alphabet they may not read, and the product's own
// mark rather than a circle only Robin would recognise.
test('briefEmail carries the mark and no Japanese', () => {
  const html = briefEmail({ day: '2026-08-04' });
  assert.ok(html.includes('daybook.fyi/email-mark.png'));
  assert.ok(!/[\u3000-\u9fff]/.test(html));
  assert.ok(!html.includes('&#9711;'));
  assert.ok(!html.includes('&#20170;'));
});

test('briefEmail offers the way back in', () => {
  const html = briefEmail({ day: '2026-08-04', siteUrl: 'https://x.daybook.fyi' });
  for (const p of ['/journal', '/dreams', '/goals', '/today']) assert.ok(html.includes(`https://x.daybook.fyi${p}`), p);
  assert.ok(html.includes('Plan your day'));
  assert.ok(html.includes('For a life well lived.'));
  assert.ok(!html.includes('Sit first'));
});

// Gmail strips <style> blocks and Outlook renders with Word, so the page has
// to survive on inline styles and tables alone.
test('briefEmail carries no stylesheet, script or svg', () => {
  const html = briefEmail({
    day: '2026-08-04',
    events: [{ title: 'A', allDay: false, start_min: 600, duration: 30 }],
    quote: { text: 'Just this.', author: 'Zen teaching' },
  });
  assert.ok(!/<style/i.test(html));
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<svg/i.test(html));
  assert.ok(html.includes('role="presentation"'));
});

// Robin's eyesight is the reason the base size is what it is. A tidy-up that
// quietly drops it to 14px should fail here.
test('body text is never smaller than 13px, and the quote is large', () => {
  const html = briefEmail({
    day: '2026-08-04',
    tasks: [{ title: 'Something', lane_label: 'Work' }],
    quote: { text: 'Just this.', author: 'Zen teaching' },
  });
  const sizes = [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 0);
  assert.equal(sizes.filter((s) => s < 12).length, 0, 'nothing under 12px');
  assert.ok(Math.max(...sizes) >= 27, 'the teaching is set large');
});
