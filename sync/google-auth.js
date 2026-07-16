#!/usr/bin/env node
/**
 * One-off helper to mint a Google Calendar refresh token.
 *
 * You run this, you click through the Google consent screen yourself, and it
 * prints a refresh token. Nothing is sent anywhere: the token exchange happens
 * on your machine and the result goes to your terminal, for you to paste into
 * `wrangler secret put GOOGLE_REFRESH_TOKEN`.
 *
 * Before running, create an OAuth client (see README):
 *   export GOOGLE_CLIENT_ID=...
 *   export GOOGLE_CLIENT_SECRET=...
 *   node sync/google-auth.js
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 8790;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first. See README.');
  process.exit(1);
}

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
    '<p>Your refresh token is in the terminal. You can close this tab.</p></body>',
  );

  console.log('\n  Refresh token:\n');
  console.log(`    ${data.refresh_token}\n`);
  console.log('  Now run, pasting it when prompted:\n');
  console.log('    npx wrangler secret put GOOGLE_REFRESH_TOKEN\n');

  server.close();
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nOpening Google consent in your browser.');
  console.log('If it does not open, paste this in yourself:\n');
  console.log(`  ${authUrl}\n`);
  spawn('open', [authUrl.toString()], { stdio: 'ignore' }).unref();
});
