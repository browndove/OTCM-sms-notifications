import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 500, 1000);
    const offset = Number(searchParams.get('offset')) || 0;

    const [reports, stats] = await Promise.all([
      db.getSmsReports({ limit, offset }),
      db.getSmsReportStats()
    ]);

    return NextResponse.json({ reports, stats });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
