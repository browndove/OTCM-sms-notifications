import { NextResponse } from 'next/server';
import db from '@/lib/db';
import arkesel from '@/lib/arkesel';
import { syncReportsFromArkesel } from '@/lib/sync-reports';
import { importLocalJson } from '@/lib/import-local-data';

export async function POST() {
  try {
    const importResult = await importLocalJson();
    const syncResult = await syncReportsFromArkesel(db, arkesel);
    const stats = await db.getSmsReportStats();

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
