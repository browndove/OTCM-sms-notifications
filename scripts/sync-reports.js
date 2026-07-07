#!/usr/bin/env node
/**
 * One-off script: import data/db.json into Postgres, then sync Arkesel SMS reports.
 * Usage: node scripts/sync-reports.js [campaignId]
 * (loads DATABASE_URL and ARKESEL_API_KEY from .env.local via Next-style env)
 */
const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const db = require('../lib/db');
const arkesel = require('../lib/arkesel');
const { syncReportsFromArkesel } = require('../lib/sync-reports');
const { importLocalJson } = require('../lib/import-local-data');

(async () => {
  console.log('Importing local JSON data…');
  const importResult = await importLocalJson();
  console.log(importResult);

  const campaignId = process.argv[2] || null;
  if (campaignId) {
    console.log(`Syncing Arkesel reports for campaign ${campaignId}…`);
  } else {
    console.log('Syncing Arkesel reports for all campaigns…');
  }
  const syncResult = await syncReportsFromArkesel(db, arkesel, { campaignId });
  console.log(syncResult);

  const stats = await db.getSmsReportStats(campaignId);
  console.log('Report stats:', stats);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
