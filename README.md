# OTCMS Training — Bulk SMS Sender

A small web app for the Pharmacy Council to upload the licence list (Excel/CSV),
preview the personalized training-reminder SMS for every person, send them all
through Arkesel, and watch delivery status update live.

## What it does

1. **Upload** the spreadsheet (columns: `SN`, `NAMES`, `LOCATION`, `CONTACT`,
   `LICENSE NUMBERS` — small naming variations like "Licence No" are tolerated).
2. **Preview** — the app builds each person's message and flags rows it can't
   send (missing phone, malformed phone, missing name/licence) *before* you
   send anything.
3. **Send** — one click sends to everyone who's ready, throttled so it doesn't
   hammer the API. You can also retry individual rows.
4. **Track delivery** — Arkesel posts a delivery report back to this app
   (webhook) once you wire that up in your Arkesel dashboard (see below). The
   table updates automatically. A manual "Refresh statuses" button polls
   Arkesel directly as a fallback if you haven't set up the webhook yet.

The message format matches your example exactly:

> Otchere Emmanuel Nyarko OTCMS (Licence No. PC/CS/ER/0781R), Kindly register
> for the Annual Pharmacy Council OTCMS Training Programme by dialling
> *790*0#. Training runs from Mon. 13th Jul. to Fri. 7th Aug. 2026. For
> enquiries, call 0209229100

If you need to change the dates, USSD code, or enquiries number for a future
campaign, edit the defaults in `lib/template.js`.

## What I found in your spreadsheet

I ran your actual file (`LICENCE_NUMBERS_-_OTCMS_NEW_APPLICATION_2026.xlsx`)
through the app while testing. Out of 203 rows:

- **107 are ready to send** — valid name, licence number, and phone.
- **95 have no usable phone number** — either blank or just whitespace.
  These people can't be reached by SMS at all until you get updated contacts
  for them. The app will show these as "Incomplete" and skip them
  automatically.
- **1 has a malformed phone number** — *Asare Mary*, row 49, contact column
  reads `2472192243` (10 digits, doesn't start with 0 — looks like a typo).
  Worth checking the original source for her correct number.
- **4 rows share a licence number with another row** (your own COMMENT column
  already flags one of these as "Double licence numbers"). This doesn't stop
  sending — it's just worth a manual look since two different people are
  listed under licence numbers `PC/CS/ER/0875R` and `PC/CS/ER/0905R`.
- All valid phone numbers were in the 9-digit local format with the leading 0
  dropped (e.g. `246383343`), which the app converts to Arkesel's expected
  `233246383343` format automatically. It also accepts the standard
  `0246383343` format if your next spreadsheet has the leading zero intact.

You'll likely want to chase up phone numbers for those 95 people through
another channel before this campaign goes out, since SMS can't reach them.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your Arkesel API key

Copy the example env file and fill in your key:

```bash
cp .env.example .env
```

Open `.env` and set:

```
ARKESEL_API_KEY=your_real_key_from_arkesel_dashboard
SMS_SENDER_ID=PharmCncl
```

Get your API key from the Arkesel dashboard under **Settings → API Keys**.
Your Sender ID must already be approved in your Arkesel account — Arkesel
will reject sends from an unapproved sender ID, so check this first if sends
start failing.

### 3. Run it

```bash
npm run dev
```

Then open `http://localhost:3000` (or whatever `PORT` you set in `.env.local`).

## Deploying so your team can use it

This needs a real server (not just a static site) because it holds your
Arkesel API key server-side and needs to receive Arkesel's webhook calls.
Render, Railway, Fly.io, or a small VPS all work well — any place that can
run a long-lived Node process and give you a public HTTPS URL.

Typical steps on a platform like Render or Railway:

1. Push this folder to a GitHub repo (private, since it'll later hold your
   `.env` — just don't commit `.env` itself; it's already gitignored).
2. Create a new "Web Service" pointing at that repo.
3. Set the build command to `npm install && npm run build` and start command to `npm start`.
4. Add the environment variables from `.env.example` in the platform's
   dashboard (never commit real keys to the repo).
5. Once deployed, you'll get a URL like `https://your-app.onrender.com`.

### Setting up delivery webhooks (the "which went through" part)

1. Log into your Arkesel dashboard.
2. Find **Bulk SMS → Settings** (or **SMS API → Callback URL**, depending on
   your dashboard layout — Arkesel's UI labels this slightly differently
   across account types).
3. Set the delivery callback URL to:
   ```
   https://your-app-domain.com/api/webhooks/arkesel
   ```
4. Save. From then on, every SMS this app sends will get its delivery status
   (delivered / failed / pending) pushed back automatically, and the table in
   the app will update within ~20 seconds.

If you'd rather not set a dashboard-wide callback, you can instead set
`ARKESEL_CALLBACK_URL` in your `.env` to the same URL — the app will then
pass it on every individual send request. Either approach works; the
dashboard setting is simpler if this is your only Arkesel integration.

**Important:** the webhook only works once your app has a real public HTTPS
URL. It won't work on `localhost` — Arkesel's servers can't reach your laptop.
Until you deploy, use the "Refresh statuses" button instead, which polls
Arkesel directly for each sent message's status.

## Notes on number formatting

Arkesel expects numbers as `233XXXXXXXXX` (no `+`, no leading `0`). This app
converts automatically from:
- `0XXXXXXXXX` (standard local format)
- `XXXXXXXXX` (9 digits, leading 0 dropped — common Excel issue)
- `233XXXXXXXXX` / `+233XXXXXXXXX` (already correct)

Anything else (wrong length, letters, etc.) gets flagged as invalid rather
than silently sent to a wrong number.

## A note on cost

Each send uses one Arkesel SMS credit (more if the message exceeds one SMS's
character limit — this template is short enough to stay within a single
segment for most names). Check your balance in the top-right corner of the
app, or via `GET /api/balance`, before sending to the full list.

## Project structure

```
app/
  page.js           — React dashboard (upload, preview, send, live status)
  layout.js         — root layout
  globals.css       — styles
  api/              — Next.js API routes (upload, send, webhook, status, balance)
lib/
  arkesel.js        — Arkesel API client (send, status lookup, balance)
  phone.js          — Ghana phone number normalization
  template.js       — SMS message builder
  db.js             — simple JSON file storage (lowdb) — campaigns + messages
  process-upload.js — spreadsheet parsing logic
data/db.json        — local data store (gitignored in production use)
```

## Known limitation

Data is stored in a flat JSON file (`data/db.json`), which is fine for a
small team sending occasional campaigns to a few hundred people. If you
later need multiple people sending campaigns at the same time, or much
larger lists (thousands+), it'd be worth moving to a real database
(Postgres/MySQL) — the storage layer is isolated in `server/db.js` so that
swap wouldn't require touching the rest of the app — the storage layer is isolated in `lib/db.js`.
