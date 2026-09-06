/**
 * The invitation email. Pure - it renders, it sends nothing - so `npm test` can
 * render it without a worker, exactly like brief.js.
 *
 * The note and the inviter's name are both somebody's typed text landing in
 * another person's inbox, so both go through escHtml.
 */

const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Table-and-inline-styles, like the sign-in code email: the same warm paper, the
// same rust keyline. No code to copy - the button carries it.
export function inviteEmail({ from, message, link, tagline, accent }) {
  const who = escHtml(from);
  const pre = `${who} has invited you to join Daybook.`;
  const dbc = /^#[0-9a-f]{3,6}$/i.test(String(accent || '')) ? accent : '#c4412e';
  const initial = escHtml((String(from || '?').trim()[0] || '?').toUpperCase());
  // A little of the inviter's Daybook card: a coloured monogram and their
  // tagline. Email-safe (a background-colour circle, no data-URI image).
  const cardBlock = tagline ? `<tr><td style="padding:20px 38px 0" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td width="48" style="width:48px"><div style="width:48px;height:48px;border-radius:50%;background:${dbc};color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:48px;text-align:center">${initial}</div></td>
            <td style="padding-left:13px;text-align:left"><p style="margin:0;font-size:15.5px;color:#211c17;line-height:1.45"><b>${who}</b><br><span style="font-size:14.5px;color:#8b7f72">${escHtml(tagline)}</span></p></td>
          </tr></table>
        </td></tr>` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#efeae0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efeae0;padding:40px 16px">
    <tr><td align="center">
      <!-- Fluid card: 100% up to a 440px cap, so it fits a phone screen. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;background:#fbf9f4;border-radius:18px;overflow:hidden;border:1px solid #e4ddcf">

        <tr><td style="padding:34px 38px 0" align="center">
          <img src="https://daybook.fyi/email-mark.png" width="66" height="35" alt="" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none">
          <p style="margin:13px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:27px;font-weight:700;letter-spacing:-0.01em;color:#211c17">Daybook</p>
          <p style="margin:7px 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14.5px;letter-spacing:0.01em;color:#8b7f72">For a life well lived</p>
        </td></tr>

        <tr><td style="padding:22px 38px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#c4412e;height:3px;line-height:3px;font-size:0">&nbsp;</td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:28px 38px 0" align="center">
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.35;color:#211c17">${who} has invited you to join <em>Daybook</em></p>
        </td></tr>

        ${cardBlock}

        ${message ? `<tr><td style="padding:22px 38px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#f4f1ea;border-left:3px solid #c4412e;border-radius:0 10px 10px 0;padding:16px 18px">
              <p style="margin:0;font-size:15.5px;color:#3f382f;line-height:1.6;white-space:pre-wrap">${escHtml(message)}</p>
            </td>
          </tr></table>
        </td></tr>` : ''}

        <tr><td style="padding:22px 38px 0">
          <p style="margin:0;font-size:15px;color:#574e44;line-height:1.6;text-align:center">Daybook is a calm home for your day - your calendar, mail, tasks, notes, money and more, all in one place. You own everything in it, and it's private to you.</p>
        </td></tr>

        <tr><td style="padding:26px 38px 0" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#c4412e;border-radius:11px">
              <a href="${escHtml(link)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:600;color:#fbf9f4;text-decoration:none">Accept the invitation</a>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:20px 38px 0">
          <p style="margin:0;font-size:13px;color:#8b7f72;line-height:1.6;text-align:center">The link signs you in and sets up your Daybook - there is no code to enter. If the button does not work, open<br><a href="${escHtml(link)}" style="color:#c4412e;text-decoration:none">${escHtml(link)}</a></p>
        </td></tr>

        <tr><td style="padding:26px 38px 34px" align="center">
          <p style="margin:0;font-size:12.5px;color:#a2988a;line-height:1.5">Not expecting this? You can safely ignore it - nothing happens until you accept.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
