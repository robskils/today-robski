// The 08:45 email. One quiet page a day: what the calendar holds, what is
// genuinely first, and one teaching to carry.
//
// Why an email at all, when the app already shows this: Robin opens his inbox
// every morning and does not always open the app. A notification he has to go
// and fetch is a notification he misses. This comes to him.
//
// Everything here is pure so `npm test` can read the rendered page without a
// worker, a network, or a clock. The gathering and sending live in index.js.

// 08:45 local. The cron ticks every minute, so the brief goes out on the first
// tick at or after this. The window closes at 10:15: if Cloudflare drops an
// hour of ticks the brief still lands late morning, but a brief arriving at
// six in the evening is worse than no brief, so it is skipped instead.
export const BRIEF_MIN = 8 * 60 + 45;
export const BRIEF_WINDOW_END = 10 * 60 + 15;

// True when this minute should send. `lastDay` is the day already sent, held in
// settings, which is what stops 90 ticks sending 90 emails.
export function briefDue(nowMin, day, lastDay) {
  if (lastDay === day) return false;
  return nowMin >= BRIEF_MIN && nowMin <= BRIEF_WINDOW_END;
}

export function fmtTime(min) {
  const m = Math.max(0, Math.min(1440, min | 0));
  return `${String((m / 60) | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// "Tuesday, 4 August". Built from the date string in UTC rather than from a
// live clock, so the header always names the day being briefed.
//
// Weekday and date are formatted separately and joined here rather than asking
// en-GB for both at once: Node renders that as "Tuesday 4 August" and workerd
// need not agree. Composing it means the header reads the same in the test and
// in the inbox.
export function longDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  const part = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(at);
  return `${part({ weekday: 'long' })}, ${part({ day: 'numeric', month: 'long' })}`;
}

// Titles come from Google and the user's own tasks, so they are text landing
// inside our markup. Escape before it goes anywhere near the page.
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The inbox line. Says what is actually in the day, so the brief is useful
// even unopened.
export function briefSubject({ day, events = [], tasks = [] }) {
  const bits = [];
  if (events.length) bits.push(`${events.length} ${events.length === 1 ? 'event' : 'events'}`);
  if (tasks.length) bits.push(`${tasks.length} P1`);
  const tail = bits.length ? bits.join(', ') : 'a clear day';
  return `${longDate(day)} - ${tail}`;
}

// ── the page ──────────────────────────────────────────────────────────
//
// Dojo Zen de Lisboa's paper-and-ink palette (css/dzl.css), which Robin
// already loves, rather than a second Zen palette invented here.
const PAPER = '#f5f0e8';
const CARD = '#fffdf9';
const INK = '#1c1812';
const MIST = '#6b6459';
const RULE = '#e0d9cc';
const GOLD = '#a8844a';
const RED = '#c4412e';

// Table layout, inline styles, no <style> block, no flexbox, no SVG: Gmail
// strips the first and Outlook renders with Word. Same constraints as the
// sign-in email in auth.js.
//
// Base size is 17px and the quote is 27px. Robin's eyesight is the reason;
// nothing here should need leaning in to read.
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";

function row(inner) {
  return `<tr><td style="padding:0 34px">${inner}</td></tr>`;
}

// A section heading: the Japanese, then the English underneath it. Small caps
// spacing rather than a big bold word, so the page stays quiet.
function heading(kanji, label) {
  return row(`
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:34px 0 14px">
            <tr>
              <td style="font-family:${SERIF};font-size:19px;color:${GOLD};padding:0 10px 0 0;white-space:nowrap">${kanji}</td>
              <td width="100%" style="font-family:${SANS};font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:${MIST}">${label}</td>
            </tr>
          </table>`);
}

function eventRow(e) {
  const when = e.allDay
    ? 'All day'
    : `${fmtTime(e.start_min)}<span style="color:${MIST}">&ndash;${fmtTime(e.start_min + e.duration)}</span>`;
  const where = e.location
    ? `<div style="font-size:14px;color:${MIST};margin:3px 0 0">${esc(e.location)}</div>`
    : '';
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px">
            <tr>
              <td width="112" valign="top" style="font-family:${SANS};font-size:15px;font-variant-numeric:tabular-nums;color:${INK};padding:11px 12px 11px 0;white-space:nowrap">${when}</td>
              <td valign="top" style="font-family:${SANS};font-size:17px;line-height:1.4;color:${INK};padding:10px 0;border-top:1px solid ${RULE}">
                ${esc(e.title)}${where}
              </td>
            </tr>
          </table>`;
}

function taskRow(t) {
  const lane = t.lane_label
    ? `<div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:${MIST};margin:4px 0 0">${esc(t.lane_label)}</div>`
    : '';
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="22" valign="top" style="font-family:${SANS};font-size:17px;color:${RED};padding:11px 0 11px 0;line-height:1.4">&bull;</td>
              <td valign="top" style="font-family:${SANS};font-size:17px;line-height:1.45;color:${INK};padding:10px 0;border-top:1px solid ${RULE}">
                ${esc(t.title)}${lane}
              </td>
            </tr>
          </table>`;
}

// An empty section is not a failure and should not read as one. A day with no
// meetings is a good day.
function empty(text) {
  return `<p style="margin:2px 0 0;font-family:${SERIF};font-size:19px;font-style:italic;color:${MIST};border-top:1px solid ${RULE};padding:14px 0 0">${text}</p>`;
}

export function briefEmail({ day, events = [], tasks = [], quote = null, siteUrl = 'https://robski.daybook.fyi' }) {
  const timed = [...events].sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : a.start_min - b.start_min));

  const calendar = timed.length
    ? timed.map(eventRow).join('')
    : empty('Nothing scheduled. The day is yours.');

  const p1 = tasks.length
    ? tasks.map(taskRow).join('')
    : empty('No P1s open. Nothing is on fire.');

  const teaching = quote
    ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0">
            <tr><td style="border-left:2px solid ${GOLD};padding:2px 0 2px 20px">
              <p style="margin:0;font-family:${SERIF};font-size:27px;line-height:1.4;color:${INK}">${esc(quote.text)}</p>
              ${quote.author ? `<p style="margin:12px 0 0;font-family:${SANS};font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:${MIST}">${esc(quote.author)}</p>` : ''}
            </td></tr>
          </table>`
    : '';

  // What the inbox shows before the mail is opened.
  const preheader = quote ? esc(quote.text) : briefSubject({ day, events, tasks });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(longDate(day))}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:34px 0 46px">
    <tr><td align="center" style="padding:0 12px">
      <!-- Fill the width up to 560px, so it shrinks to fit a phone instead of
           forcing a 560px card that overflows the screen. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:${CARD};border:1px solid ${RULE};border-radius:2px">

        <!-- The ensō, as a character. A drawn circle would be an image to
             load or an SVG to be stripped; this is neither. -->
        <tr><td align="center" style="padding:40px 34px 0">
          <div style="font-family:${SERIF};font-size:46px;line-height:1;color:${GOLD}">&#9711;</div>
          <p style="margin:22px 0 0;font-family:${SERIF};font-size:30px;line-height:1.25;color:${INK}">${esc(longDate(day))}</p>
          <p style="margin:9px 0 0;font-family:${SANS};font-size:12px;letter-spacing:0.34em;text-transform:uppercase;color:${MIST}">Good morning</p>
        </td></tr>

        ${teaching ? heading('&#20170;&#26085;', 'Today&#39;s teaching') + row(teaching) : ''}

        ${heading('&#20104;&#23450;', 'Calendar')}
        ${row(calendar)}

        ${heading('&#19968;&#30058;', 'First things')}
        ${row(p1)}

        <tr><td style="padding:38px 34px 34px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${RULE}">
            <tr><td align="center" style="padding:22px 0 0">
              <a href="${siteUrl}" style="font-family:${SANS};font-size:15px;letter-spacing:0.14em;text-transform:uppercase;color:${GOLD};text-decoration:none">Open Daybook &#8594;</a>
              <p style="margin:16px 0 0;font-family:${SERIF};font-size:17px;font-style:italic;color:${MIST}">Sit first. The rest will keep.</p>
            </td></tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}
