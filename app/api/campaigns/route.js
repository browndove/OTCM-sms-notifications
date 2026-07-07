import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const campaigns = await db.getCampaignsWithStats();
  return NextResponse.json({ campaigns });
}
