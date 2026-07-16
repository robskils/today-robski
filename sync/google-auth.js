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
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

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

async function credentials() {
  let id = process.env.GOOGLE_CLIENT_ID;
  let secret = process.env.GOOGLE_CLIENT_SECRET;
  if (id && secret) return { id, secret };

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

  id = (await rl.question('  Client ID: ')).trim();
  secret = (await rl.question('  Client secret: ')).trim();

  if (!id || !secret) {
    finishing = true;
    console.error('\nBoth are needed. Nothing done.');
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

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nOpening Google consent in your browser.');
  console.log('If it does not open, paste this in yourself:\n');
  console.log(`  ${authUrl}\n`);
  spawn('open', [authUrl.toString()], { stdio: 'ignore' }).unref();
});
