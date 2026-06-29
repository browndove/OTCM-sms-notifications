const path = require('path');
const fs = require('fs');
const db = require('./db');

async function importLocalJson() {
  const jsonPath = path.join(process.cwd(), 'data', 'db.json');
  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'data/db.json not found' };
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const campaigns = data.campaigns || [];
  const messages = data.messages || [];

  let campaignCount = 0;
  let messageCount = 0;

  for (const campaign of campaigns) {
    const inserted = await db.insertCampaignIfMissing(campaign);
    if (inserted) campaignCount += 1;
  }

  for (const message of messages) {
    const inserted = await db.insertMessageIfMissing(message);
    if (inserted) messageCount += 1;
  }

  return {
    imported: true,
    campaigns: campaignCount,
    messages: messageCount,
    totalCampaigns: campaigns.length,
    totalMessages: messages.length
  };
}

module.exports = { importLocalJson };
