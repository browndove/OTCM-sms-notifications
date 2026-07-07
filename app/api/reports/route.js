import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 100);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);
    const campaignId = searchParams.get('campaignId') || null;

    const [reports, stats, total] = await Promise.all([
      db.getSmsReports({ limit, offset, campaignId }),
      db.getSmsReportStats(campaignId),
      db.countSmsReports(campaignId)
    ]);

    return NextResponse.json({ reports, stats, total, limit, offset });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
