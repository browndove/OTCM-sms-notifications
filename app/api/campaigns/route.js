import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const campaigns = await db.getCampaigns();
  return NextResponse.json({ campaigns });
}
