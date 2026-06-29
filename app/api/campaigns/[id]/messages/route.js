import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(_request, { params }) {
  const { id } = await params;
  const messages = db.get('messages').filter({ campaignId: id }).value();
  return NextResponse.json({ messages });
}
