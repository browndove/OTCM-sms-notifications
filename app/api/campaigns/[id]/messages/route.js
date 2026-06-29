import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(_request, { params }) {
  const { id } = await params;
  const messages = await db.getMessagesByCampaignId(id);
  return NextResponse.json({ messages });
}
