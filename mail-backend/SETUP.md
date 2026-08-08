# Robski Mail backend — setup

A small always-on service that fronts each email account's IMAP/SMTP for
**life.robski.uk/mail**. The Life app talks to it with your existing Life
session token (no second login). Your passwords are AES-256-GCM encrypted at
rest and never leave the server after you enter them.

## What you provide (once)

1. **A host** to run it on. Recommended:
   - **Fly.io** (~$2/mo for a 256MB machine that sleeps when idle). `fly.toml` is ready.
   - **Render** free web service (spins down when idle → first request is slow; fine to start).
   - **Your Mac** via `cloudflared tunnel` (free, but only while the Mac is awake).
2. **Two secrets** (set as env vars / Fly secrets):
   - `AUTH_SECRET` — **must be the exact same value** as the today-robski Worker's
     `AUTH_SECRET` (that's what makes the single-sign-on work).
     Get it: `cd .. && npx wrangler secret list` won't show the value; if you
     don't have it saved, rotate both together.
   - `MASTER_KEY` — any long random string; it encrypts stored mail passwords.
     Generate: `openssl rand -base64 32`. Keep it safe — losing it means
     re-adding accounts.
3. **Per-account mail settings** (host/port + an app password), entered later in
   the app's Mail → "Add account" form. You type these; I never see them.

## Deploy on Fly.io

```bash
cd mail-backend
fly launch --no-deploy            # accept the app name or edit fly.toml
fly volumes create maildata --size 1 --region cdg
fly secrets set AUTH_SECRET='<same as the Worker>' MASTER_KEY='<openssl rand -base64 32>'
fly deploy
```

Then point a subdomain at it so CORS and cookies stay tidy:
- In Cloudflare DNS add a CNAME `mail-api` → `robski-mail.fly.dev` (proxied).
- `fly certs add mail-api.robski.uk`

## Connect the app

Open **life.robski.uk/mail**. The first time it asks for the **backend URL** —
enter `https://mail-api.robski.uk` (or your Fly URL). It's saved in the browser.
Then **Add account** for each mailbox.

### Common IMAP/SMTP settings

| Provider        | IMAP host / port          | SMTP host / port        | Password |
|-----------------|---------------------------|-------------------------|----------|
| Gmail/Workspace | imap.gmail.com : 993      | smtp.gmail.com : 465    | an **App Password** (2FA on) |
| Purelymail      | imap.purelymail.com : 993 | smtp.purelymail.com : 465 | your mailbox password |
| iCloud          | imap.mail.me.com : 993    | smtp.mail.me.com : 587  | an app-specific password |
| Generic         | mail.<domain> : 993       | mail.<domain> : 465/587 | mailbox password |

## Run locally (to test before deploying)

```bash
cd mail-backend
npm install
AUTH_SECRET='<same as Worker>' MASTER_KEY='dev' node server.mjs
# then in the Mail setup card use http://localhost:8080
```

## Endpoints (all need a valid Life token except /health)

`GET /health` · `GET/POST/DELETE /accounts` · `GET /mailboxes` ·
`GET /messages` · `GET /message` · `POST /flag` · `POST /move` · `POST /send`

## Status

Backend boots, auth (shared token) and credential encryption are verified. The
IMAP/SMTP paths need a **real account** to test end-to-end — add your first
account and we'll shake out any provider-specific quirks together.
