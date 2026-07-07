const arkesel = require('./arkesel');
const db = require('./db');

function extractArkeselId(result) {
  return result?.data?.id || result?.data?.[0]?.id || null;
}

async function sendMessageById(messageId, { clearDelivery = false } = {}) {
  const msg = await db.getMessageById(messageId);

  if (!msg) {
    return { ok: false, error: 'Message not found', status: 404 };
  }

  if (msg.phoneIssue || !msg.message) {
    return {
      ok: false,
      error: 'Message is not sendable (invalid phone or missing data)',
      status: 400
    };
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
    const arkeselId = extractArkeselId(result);

    const updates = {
      sendStatus: isSuccess ? 'sent_ok' : 'send_failed',
      arkeselId,
      arkeselResponse: result,
      error: isSuccess ? null : JSON.stringify(result)
    };

    if (clearDelivery && isSuccess) {
      updates.deliveryStatus = null;
      updates.deliveryUpdatedAt = null;
      updates.deliveryRaw = null;
    }

    await db.updateMessage(msg.id, updates);

    return { ok: isSuccess, result, messageId: msg.id, arkeselId };
  } catch (err) {
    const errPayload = err.response?.data || { message: err.message };
    await db.updateMessage(msg.id, {
      sendStatus: 'send_failed',
      error: JSON.stringify(errPayload)
    });
    return { ok: false, error: errPayload, status: 500, messageId: msg.id };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPendingForCampaign(campaignId, { limit = 25, delayMs = 300 } = {}) {
  const pending = await db.getPendingSendableMessages(campaignId, limit);
  let sent = 0;
  let failed = 0;

  for (const msg of pending) {
    const outcome = await sendMessageById(msg.id);
    if (outcome.ok) sent += 1;
    else failed += 1;
    if (delayMs > 0) await sleep(delayMs);
  }

  const remaining = await db.countPendingSendableMessages(campaignId);

  return {
    processed: pending.length,
    sent,
    failed,
    remaining
  };
}

async function resendSubmittedForCampaign(campaignId, { limit = 25, delayMs = 300 } = {}) {
  const targets = await db.getSubmittedDeliveryMessages(campaignId, limit);
  let sent = 0;
  let failed = 0;

  for (const msg of targets) {
    const outcome = await sendMessageById(msg.id, { clearDelivery: true });
    if (outcome.ok) sent += 1;
    else failed += 1;
    if (delayMs > 0) await sleep(delayMs);
  }

  const remaining = await db.countSubmittedDeliveryMessages(campaignId);

  return {
    processed: targets.length,
    sent,
    failed,
    remaining
  };
}

module.exports = { sendMessageById, sendPendingForCampaign, resendSubmittedForCampaign, extractArkeselId };
