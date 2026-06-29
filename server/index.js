require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');

const db = require('./db');
const { normalizeGhanaNumber } = require('./phone');
const { buildMessage } = require('./template');
const arkesel = require('./arkesel');

const app = express();
const PREFERRED_PORT = Number(process.env.PORT) || 3000;

function findAvailablePort(startPort, maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      const tester = net.createServer()
        .once('error', (err) => {
          if (err.code === 'EADDRINUSE' && port - startPort < maxAttempts) {
            port += 1;
            tryPort();
          } else {
            reject(err);
          }
        })
        .once('listening', () => {
          tester.close(() => resolve(port));
        })
        .listen(port);
    };
    tryPort();
  });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls, or .csv files are allowed'), ok);
  }
});

// ---------- Upload & parse ----------
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const wb = XLSX.readFile(req.file.path, { cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    fs.unlink(req.file.path, () => {});

    if (!rows.length) {
      return res.status(400).json({ error: 'The sheet appears to be empty' });
    }

    // Detect column names loosely (case/space tolerant) so small header
    // variations don't break the upload.
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
      return res.status(400).json({
        error: 'Could not find required columns (NAMES, CONTACT, LICENSE NUMBERS) in the sheet.',
        foundColumns: sampleKeys
      });
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
        sendStatus: 'pending', // pending -> queued -> sent_ok / send_failed -> delivered / delivery_failed
        arkeselId: null,
        arkeselResponse: null,
        deliveryStatus: null,
        deliveryUpdatedAt: null,
        error: null
      };
    });

    const campaign = {
      id: campaignId,
      createdAt: new Date().toISOString(),
      sourceFile: req.file.originalname,
      totalRows: recipients.length,
      readyCount: recipients.filter((r) => r.sendStatus === 'pending' && !r.phoneIssue && r.message).length
    };

    db.get('campaigns').push(campaign).write();
    db.get('messages').push(...recipients).write();

    res.json({ campaign, recipients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to process file' });
  }
});

// ---------- Get a campaign's recipients (for refresh/reload) ----------
app.get('/api/campaigns/:id/messages', (req, res) => {
  const messages = db.get('messages').filter({ campaignId: req.params.id }).value();
  res.json({ messages });
});

app.get('/api/campaigns', (req, res) => {
  res.json({ campaigns: db.get('campaigns').value().reverse() });
});

// ---------- Send (single message, called repeatedly by frontend with throttling) ----------
app.post('/api/send/:messageId', async (req, res) => {
  const msg = db.get('messages').find({ id: req.params.messageId }).value();
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  if (msg.phoneIssue || !msg.message) {
    return res.status(400).json({ error: 'Message is not sendable (invalid phone or missing data)' });
  }

  const sender = process.env.SMS_SENDER_ID || 'PharmCncl';
  const callbackUrl = process.env.ARKESEL_CALLBACK_URL || undefined;

  try {
    const result = await arkesel.sendSms({
      sender,
      message: msg.message,
      recipient: msg.phoneFormatted,
      callbackUrl
    });

    const isSuccess = result && (result.status === 'success' || result.code === 'ok');
    const arkeselId = result?.data?.id || result?.data?.[0]?.id || null;

    db.get('messages')
      .find({ id: msg.id })
      .assign({
        sendStatus: isSuccess ? 'sent_ok' : 'send_failed',
        arkeselId,
        arkeselResponse: result,
        error: isSuccess ? null : JSON.stringify(result)
      })
      .write();

    res.json({ ok: isSuccess, result });
  } catch (err) {
    const errPayload = err.response?.data || { message: err.message };
    db.get('messages')
      .find({ id: msg.id })
      .assign({
        sendStatus: 'send_failed',
        error: JSON.stringify(errPayload)
      })
      .write();
    res.status(500).json({ ok: false, error: errPayload });
  }
});

// ---------- Webhook: Arkesel posts delivery reports here ----------
// Register this URL (https://YOUR_DOMAIN/api/webhooks/arkesel) in the
// Arkesel dashboard under SMS > Settings > Delivery Callback URL.
app.post('/api/webhooks/arkesel', (req, res) => {
  console.log('Arkesel webhook received:', JSON.stringify(req.body));

  const body = req.body || {};
  // Arkesel's delivery report payload shape can vary slightly by account;
  // we defensively check common field names for the message id and status.
  const arkeselId = body.id || body.message_id || body.sms_id || body.uuid;
  const status = (body.status || body.delivery_status || body.dlrStatus || '').toString().toLowerCase();

  if (!arkeselId) {
    console.warn('Webhook payload missing an id field, ignoring:', body);
    return res.status(200).json({ received: true, matched: false });
  }

  const msg = db.get('messages').find({ arkeselId }).value();
  if (!msg) {
    console.warn('No matching message for arkeselId', arkeselId);
    return res.status(200).json({ received: true, matched: false });
  }

  db.get('messages')
    .find({ id: msg.id })
    .assign({
      deliveryStatus: status || 'unknown',
      deliveryUpdatedAt: new Date().toISOString(),
      deliveryRaw: body
    })
    .write();

  res.status(200).json({ received: true, matched: true });
});

// ---------- Manual status poll fallback (if webhook isn't set up yet) ----------
app.get('/api/status/:messageId', async (req, res) => {
  const msg = db.get('messages').find({ id: req.params.messageId }).value();
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (!msg.arkeselId) return res.status(400).json({ error: 'Message has no Arkesel id yet (not sent)' });

  try {
    const result = await arkesel.getSmsStatus(msg.arkeselId);
    const status = result?.data?.status || result?.status || 'unknown';

    db.get('messages')
      .find({ id: msg.id })
      .assign({
        deliveryStatus: status,
        deliveryUpdatedAt: new Date().toISOString(),
        deliveryRaw: result
      })
      .write();

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get('/api/balance', async (req, res) => {
  try {
    const result = await arkesel.getBalance();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Catch multer/file-filter errors and any other thrown errors with clean JSON
// instead of Express's default HTML stack trace page.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 400).json({ error: err.message || 'Something went wrong' });
});

findAvailablePort(PREFERRED_PORT)
  .then((port) => {
    if (port !== PREFERRED_PORT) {
      console.warn(`Port ${PREFERRED_PORT} in use; using ${port} instead.`);
    }
    app.listen(port, () => {
      console.log(`OTCMS SMS app running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Could not find an available port:', err.message);
    process.exit(1);
  });
