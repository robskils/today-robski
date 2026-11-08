// The backup route for email, used when Purelymail SMTP fails or isn't configured:
// Cloudflare Email Service through the EMAIL binding. It sends from FROM_EMAIL, whose
// domain must be enabled for Email Sending on the account (`wrangler email sending list`).
// Never throws: returns { ok, status, text() }, so callers treat it like a fetch response.
export async function sendBackupMail(env, { to, subject, html, text, replyTo }) {
  try {
    if (!env.EMAIL) throw new Error('EMAIL binding missing');
    const m = String(env.FROM_EMAIL || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    const email = m ? m[2] : String(env.FROM_EMAIL || '').trim();
    const plain = text || String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    await env.EMAIL.send({
      to, subject, html, text: plain,
      from: { email, name: 'Kaya' },
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true, status: 200, text: async () => '' };
  } catch (e) {
    const message = String((e && e.message) || e);
    return { ok: false, status: 500, text: async () => message };
  }
}
