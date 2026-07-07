import { NextResponse } from 'next/server';
import db from '@/lib/db';
import arkesel from '@/lib/arkesel';
import { syncReportsFromArkesel } from '@/lib/sync-reports';
import { importLocalJson } from '@/lib/import-local-data';

export async function POST(request) {
  try {
    let campaignId = null;
    try {
      const body = await request.json();
      campaignId = body?.campaignId || null;
    } catch {
      // no body — sync all campaigns (CLI / legacy)
    }

    const importResult = await importLocalJson();
    const syncResult = await syncReportsFromArkesel(db, arkesel, { campaignId });
    const stats = await db.getSmsReportStats(campaignId);

    return NextResponse.json({
      ok: true,
      import: importResult,
      sync: syncResult,
      stats
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
