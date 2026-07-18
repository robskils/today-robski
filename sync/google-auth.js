#!/usr/bin/env node
/**
 * One-off helper to connect Google Calendar.
 *
 * You click through Google's consent screen yourself. The token exchange happens
 * on this machine; nothing is sent anywhere except to Google and, if you say yes,
 * to your own Cloudflare worker as secrets.
 *
 * Just run it. It asks for what it needs:
 *   npm run google-auth
 */

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PORT = 8790;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
// calendar.events covers both reading the day and creating an event from
// + Event. A refresh token carries the scopes it was granted with, so widening
// this means running google-auth again to re-consent.
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const rl = createInterface({ input: stdin, output: stdout });

// Ctrl-D or piped input closes stdin mid-question, which would otherwise leave
// the await hanging forever with no output.
let finishing = false;
rl.on('close', () => {
  if (!finishing) {
    console.error('\n\nCancelled. Nothing was changed.');
    process.exit(1);
  }
});

function setSecret(name, value) {
  // --stdin isn't universal across wrangler versions; piping input is.
  execFileSync('npx', ['wrangler', 'secret', 'put', name], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

// A real client id looks like 1234567890-abc123.apps.googleusercontent.com.
// Anything else is a leftover or a typo, and sending it to Google just earns an
// opaque "invalid_client" after you have already clicked through a consent page.
const looksLikeClientId = (s) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(s || '');

async function credentials() {
  const envId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const envSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (looksLikeClientId(envId) && envSecret) {
    console.log(`\n  Using GOOGLE_CLIENT_ID from the environment: ${envId.slice(0, 24)}...`);
    return { id: envId, secret: envSecret };
  }

  if (envId || envSecret) {
    console.log(`\n  Ignoring GOOGLE_CLIENT_ID="${envId}" in your environment: that is not a`);
    console.log('  Google client id. Asking instead. To silence this permanently:');
    console.log('    unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET');
  }

  console.log(`
Google Calendar needs an OAuth client. If you have not made one yet:

  1. https://console.cloud.google.com/projectcreate  - name it "today-robski"
  2. APIs & Services > Library > search "Google Calendar API" > Enable
  3. APIs & Services > OAuth consent screen
       External, app name "Today", your email in both contact fields.
       Under Audience > Test users, add robin@lumley-savile.com.
  4. APIs & Services > Credentials > Create credentials > OAuth client ID
       Application type: Desktop app     <- important, loopback needs this
       Name: today-robski
  5. Copy the Client ID and Client secret it shows you.
`);

  const id = (await rl.question('  Client ID: ')).trim();
  const secret = (await rl.question('  Client secret: ')).trim();

  if (!id || !secret) {
    finishing = true;
    console.error('\nBoth are needed. Nothing done.');
    process.exit(1);
  }

  // Catch it here rather than after a pointless round trip to the consent screen.
  if (!looksLikeClientId(id)) {
    finishing = true;
    console.error(`\n  "${id}" is not a Google client id.`);
    console.error('  It should end in .apps.googleusercontent.com - copy it from');
    console.error('  APIs & Services > Credentials. Nothing done.');
    process.exit(1);
  }

  return { id, secret };
}

const { id: CLIENT_ID, secret: CLIENT_SECRET } = await credentials();

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // force a refresh token even on re-auth

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
      .end(`<p>No code returned: ${error || 'unknown'}. You can close this tab.</p>`);
    console.error(`\nAuthorisation failed: ${error || 'no code'}`);
    server.close();
    process.exit(1);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  });
  const data = await tokenRes.json();

  if (!data.refresh_token) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
      .end('<p>No refresh token came back. Close this tab and check the terminal.</p>');
    console.error('\nNo refresh_token in the response:', JSON.stringify(data, null, 2));
    console.error('If you have authorised this client before, revoke it at');
    console.error('https://myaccount.google.com/permissions and run again.');
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/html' }).end(
    '<body style="font:17px system-ui;padding:40px"><h2>Done.</h2>' +
    '<p>Back to the terminal. You can close this tab.</p></body>',
  );
  server.close();

  console.log('\n  Authorised.\n');

  // The worker needs all three, not just the refresh token: it trades the
  // refresh token for an access token on every cold start.
  const ans = (await rl.question('  Set the three Google secrets on the worker and deploy? [Y/n] ')).trim().toLowerCase();

  if (ans === 'n') {
    console.log('\n  Nothing set. Your refresh token, if you want it by hand:\n');
    console.log(`    ${data.refresh_token}\n`);
    console.log('  You would need all three:');
    console.log('    npx wrangler secret put GOOGLE_CLIENT_ID');
    console.log('    npx wrangler secret put GOOGLE_CLIENT_SECRET');
    console.log('    npx wrangler secret put GOOGLE_REFRESH_TOKEN\n');
    finishing = true;
    rl.close();
    process.exit(0);
  }

  try {
    setSecret('GOOGLE_CLIENT_ID', CLIENT_ID);
    setSecret('GOOGLE_CLIENT_SECRET', CLIENT_SECRET);
    setSecret('GOOGLE_REFRESH_TOKEN', data.refresh_token);
    console.log('\n  Deploying...\n');
    execFileSync('npx', ['wrangler', 'deploy'], { stdio: 'inherit' });
    console.log('\n  Calendar connected. Reload https://today.robski.uk\n');
  } catch (e) {
    console.error(`\n  Failed: ${e.message}`);
    console.error('  Your refresh token, so the consent step is not wasted:\n');
    console.error(`    ${data.refresh_token}\n`);
    finishing = true;
    rl.close();
    process.exit(1);
  }

  finishing = true;
  rl.close();
  process.exit(0);
});

// An abandoned run sits here holding the port, waiting for a callback that never
// arrives. Say so, instead of throwing a stack trace at someone who just wants
// their calendar connected.
server.on('error', (e) => {
  finishing = true;
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use, almost certainly an earlier`);
    console.error('  google-auth still waiting for a callback. Stop it with:\n');
    console.error(`    pkill -f google-auth.js\n`);
    console.error('  then run this again.');
  } else {
    console.error(`\n  Could not listen on ${PORT}: ${e.message}`);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nOpening Google consent in your browser.');
  console.log('If it does not open, paste this in yourself:\n');
  console.log(`  ${authUrl}\n`);
  spawn('open', [authUrl.toString()], { stdio: 'ignore' }).unref();
});
