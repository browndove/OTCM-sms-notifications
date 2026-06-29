import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const campaigns = db.get('campaigns').value().reverse();
  return NextResponse.json({ campaigns });
}
