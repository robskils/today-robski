// The invitation email. Run: node worker/invite.test.mjs
//
// It carries two pieces of somebody's typed text - the inviter's display name
// and their note - into a stranger's inbox, so the escaping is the part that
// matters. The rest pins the copy Robin asked for: the invitation is from a
// person, to Daybook, and it never asks anyone for a code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteEmail } from './invite-email.js';

const LINK = 'https://daybook.fyi/join/AB2CD3EF';

test('names the inviter and the product, and nothing else', () => {
  const html = inviteEmail({ from: 'Robin', link: LINK });
  assert.match(html, /Robin has invited you to join/);
  assert.match(html, /<em>Daybook<\/em>/);
  // "Robski Daybook" was the old wordmark. An invitation is to Daybook, not to
  // somebody else's Daybook.
  assert.doesNotMatch(html, /Robski/);
});

test('the link is the whole action - no code to type', () => {
  const html = inviteEmail({ from: 'Robin', link: LINK });
  assert.ok(html.includes(`href="${LINK}"`), 'the button links to the join URL');
  assert.match(html, /Accept the invitation/);
  assert.match(html, /there is no code to enter/);
});

test('escapes the inviter name', () => {
  const html = inviteEmail({ from: '<script>alert(1)</script>', link: LINK });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('escapes the personal note and keeps its line breaks', () => {
  const html = inviteEmail({ from: 'Robin', link: LINK, message: 'Hi <b>you</b>\nsecond line' });
  assert.doesNotMatch(html, /<b>you<\/b>/);
  assert.match(html, /Hi &lt;b&gt;you&lt;\/b&gt;/);
  assert.match(html, /white-space:pre-wrap/);
});

test('escapes a quote in the link so it cannot break out of the href', () => {
  const html = inviteEmail({ from: 'Robin', link: 'https://daybook.fyi/join/X" onclick="x' });
  assert.doesNotMatch(html, /onclick="x"/);
  assert.match(html, /&quot;/);
});

test('no note means no quote block', () => {
  assert.doesNotMatch(inviteEmail({ from: 'Robin', link: LINK }), /border-left:3px solid/);
  assert.match(inviteEmail({ from: 'Robin', link: LINK, message: 'hello' }), /border-left:3px solid/);
});
