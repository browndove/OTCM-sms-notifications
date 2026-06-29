const crypto = require('crypto');
const XLSX = require('xlsx');
const db = require('./db');
const { normalizeGhanaNumber } = require('./phone');
const { buildMessage } = require('./template');

async function processSpreadsheet(buffer, originalname) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  if (!rows.length) {
    throw new Error('The sheet appears to be empty');
  }

  const sampleKeys = Object.keys(rows[0]);
  const findKey = (candidates) =>
    sampleKeys.find((k) =>
      candidates.some((c) => k.trim().toLowerCase() === c.toLowerCase())
    );

  const nameKey = findKey(['NAMES', 'NAME']);
  const locationKey = findKey(['LOCATION']);
  const contactKey = findKey(['CONTACT', 'CONTACTS', 'PHONE', 'PHONE NUMBER']);
  const licenseKey = findKey(['LICENSE NUMBERS', 'LICENCE NUMBERS', 'LICENSE NO', 'LICENCE NO']);
  const snKey = findKey(['SN', 'S/N', 'NO']);

  if (!nameKey || !contactKey || !licenseKey) {
    const err = new Error('Could not find required columns (NAMES, CONTACT, LICENSE NUMBERS) in the sheet.');
    err.foundColumns = sampleKeys;
    throw err;
  }

  const campaignId = crypto.randomUUID();
  const recipients = rows.map((row, idx) => {
    const phoneRaw = row[contactKey];
    const phoneResult = normalizeGhanaNumber(phoneRaw);
    const name = String(row[nameKey] || '').trim();
    const license = String(row[licenseKey] || '').trim();
    const location = locationKey ? String(row[locationKey] || '').trim() : '';
    const sn = snKey ? row[snKey] : idx + 1;

    const message = name && license
      ? buildMessage({ NAMES: name, 'LICENSE NUMBERS': license }, {})
      : null;

    let status = 'ready';
    if (!name || !license) status = 'incomplete_row';
    else if (!phoneResult.valid) status = 'invalid_phone';

    return {
      id: crypto.randomUUID(),
      campaignId,
      sn,
      name,
      location,
      license,
      phoneRaw: phoneRaw === undefined ? '' : String(phoneRaw),
      phoneFormatted: phoneResult.formatted,
      phoneIssue: phoneResult.valid ? null : phoneResult.reason,
      message,
      sendStatus: 'pending',
      arkeselId: null,
      arkeselResponse: null,
      deliveryStatus: null,
      deliveryUpdatedAt: null,
      error: null,
      rowStatus: status
    };
  });

  const campaign = {
    id: campaignId,
    createdAt: new Date().toISOString(),
    sourceFile: originalname,
    totalRows: recipients.length,
    readyCount: recipients.filter((r) => r.sendStatus === 'pending' && !r.phoneIssue && r.message).length
  };

  await db.insertCampaignAndMessages(campaign, recipients);

  return { campaign, recipients };
}

module.exports = { processSpreadsheet };
