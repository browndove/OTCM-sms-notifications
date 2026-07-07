const { Pool } = require('pg');

const globalForPg = globalThis;
let schemaReady = false;

function getPool() {
  if (!globalForPg.pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set in environment variables');
    }
    globalForPg.pgPool = new Pool({ connectionString });
  }
  return globalForPg.pgPool;
}

async function ensureSchema() {
  if (schemaReady) return;

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      source_file TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      ready_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      sn TEXT,
      name TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      license TEXT NOT NULL DEFAULT '',
      phone_raw TEXT NOT NULL DEFAULT '',
      phone_formatted TEXT,
      phone_issue TEXT,
      message TEXT,
      send_status TEXT NOT NULL DEFAULT 'pending',
      arkesel_id TEXT,
      arkesel_response JSONB,
      delivery_status TEXT,
      delivery_updated_at TIMESTAMPTZ,
      delivery_raw JSONB,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_campaign_id ON messages(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_messages_arkesel_id ON messages(arkesel_id);

    CREATE TABLE IF NOT EXISTS sms_reports (
      arkesel_id TEXT PRIMARY KEY,
      message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL DEFAULT 'API SMS',
      sender_id TEXT,
      recipient TEXT,
      units INTEGER,
      status TEXT,
      message_body TEXT,
      recipient_name TEXT,
      license_number TEXT,
      sent_at TIMESTAMPTZ,
      raw JSONB,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sms_reports_sent_at ON sms_reports(sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sms_reports_recipient ON sms_reports(recipient);
  `);

  schemaReady = true;
}

function rowToCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    sourceFile: row.source_file,
    totalRows: row.total_rows,
    readyCount: row.ready_count
  };
}

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sn: row.sn,
    name: row.name,
    location: row.location,
    license: row.license,
    phoneRaw: row.phone_raw,
    phoneFormatted: row.phone_formatted,
    phoneIssue: row.phone_issue,
    message: row.message,
    sendStatus: row.send_status,
    arkeselId: row.arkesel_id,
    arkeselResponse: row.arkesel_response,
    deliveryStatus: row.delivery_status,
    deliveryUpdatedAt: row.delivery_updated_at instanceof Date
      ? row.delivery_updated_at.toISOString()
      : row.delivery_updated_at,
    deliveryRaw: row.delivery_raw,
    error: row.error
  };
}

async function insertCampaignAndMessages(campaign, messages) {
  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO campaigns (id, created_at, source_file, total_rows, ready_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [campaign.id, campaign.createdAt, campaign.sourceFile, campaign.totalRows, campaign.readyCount]
    );

    for (const msg of messages) {
      await client.query(
        `INSERT INTO messages (
          id, campaign_id, sn, name, location, license, phone_raw, phone_formatted,
          phone_issue, message, send_status, arkesel_id, arkesel_response,
          delivery_status, delivery_updated_at, delivery_raw, error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          msg.id,
          msg.campaignId,
          msg.sn == null ? null : String(msg.sn),
          msg.name,
          msg.location,
          msg.license,
          msg.phoneRaw,
          msg.phoneFormatted,
          msg.phoneIssue,
          msg.message,
          msg.sendStatus,
          msg.arkeselId,
          msg.arkeselResponse,
          msg.deliveryStatus,
          msg.deliveryUpdatedAt,
          msg.deliveryRaw,
          msg.error
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getCampaigns() {
  await ensureSchema();
  const { rows } = await getPool().query(
    'SELECT * FROM campaigns ORDER BY created_at DESC'
  );
  return rows.map(rowToCampaign);
}

async function getCampaignMessageStats(campaignId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE phone_issue IS NULL AND message IS NOT NULL AND send_status = 'pending'
      )::int AS ready,
      COUNT(*) FILTER (WHERE phone_issue IS NOT NULL)::int AS invalid_phone,
      COUNT(*) FILTER (
        WHERE phone_issue IS NULL AND (name = '' OR license = '' OR message IS NULL)
      )::int AS incomplete,
      COUNT(*) FILTER (
        WHERE phone_issue IS NULL AND message IS NOT NULL
      )::int AS sendable,
      COUNT(*) FILTER (WHERE send_status = 'sent_ok')::int AS sent_ok,
      COUNT(*) FILTER (WHERE send_status = 'send_failed')::int AS send_failed,
      COUNT(*) FILTER (
        WHERE phone_issue IS NULL AND message IS NOT NULL AND send_status IN ('pending', 'send_failed')
      )::int AS remaining,
      COUNT(*) FILTER (
        WHERE phone_issue IS NULL AND message IS NOT NULL
          AND send_status IN ('pending', 'queued')
      )::int AS pending,
      COUNT(*) FILTER (
        WHERE send_status = 'sent_ok' AND LOWER(delivery_status) = 'submitted'
      )::int AS submitted
    FROM messages WHERE campaign_id = $1`,
    [campaignId]
  );
  return rows[0];
}

async function getCampaignsWithStats() {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT
      c.id,
      c.created_at,
      c.source_file,
      c.total_rows,
      c.ready_count,
      COUNT(m.id)::int AS message_count,
      COUNT(*) FILTER (WHERE m.send_status = 'sent_ok')::int AS sent_ok,
      COUNT(*) FILTER (
        WHERE m.phone_issue IS NULL AND m.message IS NOT NULL
          AND m.send_status IN ('pending', 'send_failed')
      )::int AS remaining
    FROM campaigns c
    LEFT JOIN messages m ON m.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    sourceFile: row.source_file,
    totalRows: row.total_rows,
    readyCount: row.ready_count,
    messageCount: row.message_count,
    sentOk: row.sent_ok,
    remaining: row.remaining
  }));
}

function buildMessageFilterClause(status, search, startIndex = 2) {
  const parts = [];
  const values = [];
  let index = startIndex;

  if (status === 'pending') {
    parts.push('phone_issue IS NULL', 'message IS NOT NULL', "send_status = 'pending'");
  } else if (status === 'sent_ok') {
    parts.push("send_status = 'sent_ok'");
  } else if (status === 'send_failed') {
    parts.push("send_status = 'send_failed'");
  } else if (status === 'invalid_phone') {
    parts.push('phone_issue IS NOT NULL');
  } else if (status === 'incomplete_row') {
    parts.push('phone_issue IS NULL', "(name = '' OR license = '' OR message IS NULL)");
  } else if (status === 'submitted') {
    parts.push("send_status = 'sent_ok'", "LOWER(delivery_status) = 'submitted'");
  }

  if (search) {
    parts.push(
      `(name ILIKE $${index} OR license ILIKE $${index} OR phone_raw ILIKE $${index} OR location ILIKE $${index})`
    );
    values.push(`%${search}%`);
    index += 1;
  }

  return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', values, nextIndex: index };
}

async function getMessagesByCampaignIdPaginated(campaignId, { limit = 50, offset = 0, status = 'all', search = '' } = {}) {
  await ensureSchema();
  const filter = buildMessageFilterClause(status, search.trim(), 2);
  const params = [campaignId, ...filter.values, limit, offset];
  const limitIndex = filter.nextIndex;
  const offsetIndex = limitIndex + 1;

  const { rows } = await getPool().query(
    `SELECT * FROM messages
     WHERE campaign_id = $1${filter.clause}
     ORDER BY sn NULLS LAST, name
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params
  );
  return rows.map(rowToMessage);
}

async function countMessagesByCampaignId(campaignId, { status = 'all', search = '' } = {}) {
  await ensureSchema();
  const filter = buildMessageFilterClause(status, search.trim(), 2);
  const params = [campaignId, ...filter.values];

  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM messages WHERE campaign_id = $1${filter.clause}`,
    params
  );
  return rows[0].count;
}

async function getMessagesByCampaignId(campaignId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    'SELECT * FROM messages WHERE campaign_id = $1 ORDER BY sn NULLS LAST, name',
    [campaignId]
  );
  return rows.map(rowToMessage);
}

async function getMessageById(id) {
  await ensureSchema();
  const { rows } = await getPool().query('SELECT * FROM messages WHERE id = $1', [id]);
  return rowToMessage(rows[0]);
}

async function getMessageByArkeselId(arkeselId) {
  await ensureSchema();
  const { rows } = await getPool().query('SELECT * FROM messages WHERE arkesel_id = $1', [arkeselId]);
  return rowToMessage(rows[0]);
}

async function getPendingSendableMessages(campaignId, limit = 25) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM messages
     WHERE campaign_id = $1
       AND phone_issue IS NULL
       AND message IS NOT NULL
       AND send_status IN ('pending', 'send_failed')
     ORDER BY sn NULLS LAST, name
     LIMIT $2`,
    [campaignId, limit]
  );
  return rows.map(rowToMessage);
}

async function countPendingSendableMessages(campaignId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM messages
     WHERE campaign_id = $1
       AND phone_issue IS NULL
       AND message IS NOT NULL
       AND send_status IN ('pending', 'send_failed')`,
    [campaignId]
  );
  return rows[0].count;
}

async function getSubmittedDeliveryMessages(campaignId, limit = 25) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM messages
     WHERE campaign_id = $1
       AND send_status = 'sent_ok'
       AND LOWER(delivery_status) = 'submitted'
       AND phone_issue IS NULL
       AND message IS NOT NULL
     ORDER BY sn NULLS LAST, name
     LIMIT $2`,
    [campaignId, limit]
  );
  return rows.map(rowToMessage);
}

async function countSubmittedDeliveryMessages(campaignId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM messages
     WHERE campaign_id = $1
       AND send_status = 'sent_ok'
       AND LOWER(delivery_status) = 'submitted'`,
    [campaignId]
  );
  return rows[0].count;
}

const MESSAGE_FIELD_MAP = {
  sendStatus: 'send_status',
  arkeselId: 'arkesel_id',
  arkeselResponse: 'arkesel_response',
  deliveryStatus: 'delivery_status',
  deliveryUpdatedAt: 'delivery_updated_at',
  deliveryRaw: 'delivery_raw',
  error: 'error'
};

async function updateMessage(id, fields) {
  await ensureSchema();

  const sets = [];
  const values = [id];
  let index = 2;

  for (const [key, value] of Object.entries(fields)) {
    const column = MESSAGE_FIELD_MAP[key];
    if (!column) continue;
    sets.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  }

  if (!sets.length) return getMessageById(id);

  const { rows } = await getPool().query(
    `UPDATE messages SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return rowToMessage(rows[0]);
}

function rowToSmsReport(row) {
  if (!row) return null;
  return {
    arkeselId: row.arkesel_id,
    messageId: row.message_id,
    sourceType: row.source_type,
    senderId: row.sender_id,
    recipient: row.recipient,
    units: row.units,
    status: row.status,
    messageBody: row.message_body,
    recipientName: row.recipient_name,
    licenseNumber: row.license_number,
    sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at,
    syncedAt: row.synced_at instanceof Date ? row.synced_at.toISOString() : row.synced_at,
    raw: row.raw
  };
}

async function insertCampaignIfMissing(campaign) {
  await ensureSchema();
  const result = await getPool().query(
    `INSERT INTO campaigns (id, created_at, source_file, total_rows, ready_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [campaign.id, campaign.createdAt, campaign.sourceFile, campaign.totalRows, campaign.readyCount]
  );
  return result.rowCount > 0;
}

async function insertMessageIfMissing(message) {
  await ensureSchema();
  const result = await getPool().query(
    `INSERT INTO messages (
      id, campaign_id, sn, name, location, license, phone_raw, phone_formatted,
      phone_issue, message, send_status, arkesel_id, arkesel_response,
      delivery_status, delivery_updated_at, delivery_raw, error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (id) DO NOTHING
    RETURNING id`,
    [
      message.id,
      message.campaignId,
      message.sn == null ? null : String(message.sn),
      message.name,
      message.location,
      message.license,
      message.phoneRaw,
      message.phoneFormatted,
      message.phoneIssue,
      message.message,
      message.sendStatus,
      message.arkeselId,
      message.arkeselResponse,
      message.deliveryStatus,
      message.deliveryUpdatedAt,
      message.deliveryRaw,
      message.error
    ]
  );
  return result.rowCount > 0;
}

async function getAllArkeselIds() {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT DISTINCT arkesel_id FROM messages WHERE arkesel_id IS NOT NULL`
  );
  return rows.map((r) => r.arkesel_id);
}

async function upsertSmsReport(report) {
  await ensureSchema();
  const msg = await getMessageByArkeselId(report.arkeselId);

  const { rows } = await getPool().query(
    `INSERT INTO sms_reports (
      arkesel_id, message_id, source_type, sender_id, recipient, units, status,
      message_body, recipient_name, license_number, sent_at, raw, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    ON CONFLICT (arkesel_id) DO UPDATE SET
      message_id = EXCLUDED.message_id,
      sender_id = EXCLUDED.sender_id,
      recipient = EXCLUDED.recipient,
      units = EXCLUDED.units,
      status = EXCLUDED.status,
      message_body = EXCLUDED.message_body,
      recipient_name = EXCLUDED.recipient_name,
      license_number = EXCLUDED.license_number,
      sent_at = EXCLUDED.sent_at,
      raw = EXCLUDED.raw,
      synced_at = NOW()
    RETURNING *`,
    [
      report.arkeselId,
      msg?.id || null,
      report.sourceType || 'API SMS',
      report.senderId,
      report.recipient,
      report.units,
      report.status,
      report.messageBody,
      report.recipientName,
      report.licenseNumber,
      report.sentAt,
      report.raw
    ]
  );
  return rowToSmsReport(rows[0]);
}

async function getSmsReports({ limit = 50, offset = 0, campaignId = null } = {}) {
  await ensureSchema();
  if (campaignId) {
    const { rows } = await getPool().query(
      `SELECT r.* FROM sms_reports r
       INNER JOIN messages m ON m.id = r.message_id
       WHERE m.campaign_id = $1
       ORDER BY r.sent_at DESC NULLS LAST, r.synced_at DESC
       LIMIT $2 OFFSET $3`,
      [campaignId, limit, offset]
    );
    return rows.map(rowToSmsReport);
  }

  const { rows } = await getPool().query(
    `SELECT * FROM sms_reports ORDER BY sent_at DESC NULLS LAST, synced_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(rowToSmsReport);
}

async function countSmsReports(campaignId = null) {
  await ensureSchema();
  if (campaignId) {
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS count FROM sms_reports r
       INNER JOIN messages m ON m.id = r.message_id
       WHERE m.campaign_id = $1`,
      [campaignId]
    );
    return rows[0].count;
  }
  const { rows } = await getPool().query('SELECT COUNT(*)::int AS count FROM sms_reports');
  return rows[0].count;
}

async function getSmsReportStats() {
  await ensureSchema();
  const { rows } = await getPool().query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
      COUNT(*) FILTER (WHERE status NOT IN ('DELIVERED', 'SUBMITTED'))::int AS failed,
      COALESCE(SUM(units), 0)::int AS units_used
    FROM sms_reports
  `);
  return rows[0];
}

module.exports = {
  ensureSchema,
  insertCampaignAndMessages,
  insertCampaignIfMissing,
  insertMessageIfMissing,
  getCampaigns,
  getCampaignsWithStats,
  getCampaignMessageStats,
  getMessagesByCampaignId,
  getMessagesByCampaignIdPaginated,
  countMessagesByCampaignId,
  getMessageById,
  getMessageByArkeselId,
  getPendingSendableMessages,
  countPendingSendableMessages,
  getSubmittedDeliveryMessages,
  countSubmittedDeliveryMessages,
  getAllArkeselIds,
  updateMessage,
  upsertSmsReport,
  getSmsReports,
  getSmsReportStats,
  countSmsReports
};
