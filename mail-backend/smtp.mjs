// Sending via the account's own SMTP server, using nodemailer. The raw message
// is also handed back so the caller can append it to the Sent folder over IMAP.
import nodemailer from 'nodemailer';
import { accountPassword } from './store.mjs';

export async function sendMail(account, msg) {
  const transport = nodemailer.createTransport({
    host: account.smtpHost, port: account.smtpPort, secure: account.smtpSecure,
    auth: { user: account.user, pass: accountPassword(account) },
  });
  const mail = {
    from: { name: account.name || '', address: account.email },
    to: msg.to, cc: msg.cc || undefined, bcc: msg.bcc || undefined,
    subject: msg.subject || '(no subject)',
    text: msg.text || undefined,
    html: msg.html || undefined,
    inReplyTo: msg.inReplyTo || undefined,
    references: msg.references || undefined,
  };
  const info = await transport.sendMail(mail);
  return { messageId: info.messageId, raw: info.message ? String(info.message) : null };
}
