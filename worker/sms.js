// One SMS sender for the whole worker: the 5-minute Zazen alert and the login
// code both go through here. GatewayAPI over their EU platform, the setup Robin
// already has credit on, with his own brand as the sender so a text reads as
// coming from the tool. Needs GATEWAYAPI_KEY and ALERT_PHONE (the recipient) as
// secrets; without either, SMS is simply off and the caller falls back.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// `to` names the recipient so the per-user cron can text each member their own
// number; it defaults to ALERT_PHONE (the owner's) for the login code and the
// test send, which predate multi-tenant alerts.
export async function sendSms(env, message, to = env.ALERT_PHONE) {
  const num = String(to || '').replace(/\D/g, '');
  if (!env.GATEWAYAPI_KEY || !num) return { ok: false, skipped: 'not configured' };

  // Robin's account is on GatewayAPI's EU platform, whose tokens are rejected
  // by the default gatewayapi.com host with a bare "Invalid token" - the one
  // difference that had every send 401ing. Overridable, but defaults to EU.
  const host = env.GATEWAYAPI_HOST || 'gatewayapi.eu';
  const res = await fetch(`https://${host}/rest/mtsms`, {
    method: 'POST',
    headers: { Authorization: `Token ${env.GATEWAYAPI_KEY}`, ...JSON_HEADERS },
    body: JSON.stringify({
      // Alphanumeric sender: a code isn't a conversation, and it's the same
      // brand the rest of the tool carries.
      sender: env.ALERT_SENDER || 'Daybook',
      message,
      recipients: [{ msisdn: num }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('gatewayapi:', res.status, detail);
    return { ok: false, status: res.status, detail };
  }
  return { ok: true, ...(await res.json()) };
}
