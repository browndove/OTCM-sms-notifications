const CHUNK_SIZE = 10;

function normalizeSingleReport(arkeselId, entry) {
  if (!entry) return null;
  const data = entry.data || entry;
  return normalizeReportEntry(arkeselId, {
    senderID: data.sender || data.senderID,
    receiver: data.recipient || data.receiver,
    message_status: data.status || data.message_status,
    message: data.message,
    message_count: data.message_count,
    sent_at_time: data.sent_at_time
  });
}

async function fetchReportChunk(arkesel, ids) {
  try {
    const result = await arkesel.getMessageReports(ids);
    return result?.data || {};
  } catch (err) {
    console.warn('Batch report fetch failed, falling back to single lookups:', err.message);
    const reports = {};
    for (const id of ids) {
      try {
        const single = await arkesel.getSmsStatus(id);
        const normalized = normalizeSingleReport(id, single);
        if (normalized) reports[id] = normalized.raw;
      } catch (singleErr) {
        console.warn('Failed to fetch report for', id, singleErr.message);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return reports;
  }
}

function normalizeReportEntry(arkeselId, entry) {
  if (!entry || entry.status === 'error') return null;

  const messageBody = entry.message || '';
  const nameMatch = messageBody.match(/^(.+?) OTCMS \(Licence No\.?\s*([^)]+)\)/i);

  return {
    arkeselId,
    sourceType: 'API SMS',
    senderId: entry.senderID || entry.sender || null,
    recipient: entry.receiver || entry.recipient || null,
    units: entry.message_count ?? 1,
    status: (entry.message_status || entry.status || 'unknown').toUpperCase(),
    messageBody,
    recipientName: nameMatch ? nameMatch[1].trim() : null,
    licenseNumber: nameMatch ? nameMatch[2].trim() : null,
    sentAt: entry.sent_at_time || null,
    raw: entry
  };
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function syncReportsFromArkesel(db, arkesel) {
  const arkeselIds = await db.getAllArkeselIds();
  if (!arkeselIds.length) {
    return { synced: 0, updated: 0, arkeselIds: 0 };
  }

  let synced = 0;
  let updated = 0;
  const chunks = chunk(arkeselIds, CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i += 1) {
    const ids = chunks[i];
    console.log(`Fetching reports ${i + 1}/${chunks.length} (${ids.length} messages)…`);
    const reports = await fetchReportChunk(arkesel, ids);

    for (const [arkeselId, entry] of Object.entries(reports)) {
      const normalized = normalizeReportEntry(arkeselId, entry);
      if (!normalized) continue;

      const saved = await db.upsertSmsReport(normalized);
      if (saved) synced += 1;

      const msg = await db.getMessageByArkeselId(arkeselId);
      if (msg) {
        await db.updateMessage(msg.id, {
          deliveryStatus: normalized.status,
          deliveryUpdatedAt: normalized.sentAt || new Date().toISOString(),
          deliveryRaw: normalized.raw
        });
        updated += 1;
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  return { synced, updated, arkeselIds: arkeselIds.length };
}

module.exports = { syncReportsFromArkesel, normalizeReportEntry };
