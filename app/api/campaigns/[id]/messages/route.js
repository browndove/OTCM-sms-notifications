import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);

  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100);
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);
  const status = searchParams.get('status') || 'all';
  const search = searchParams.get('search') || '';

  const [messages, total, stats] = await Promise.all([
    db.getMessagesByCampaignIdPaginated(id, { limit, offset, status, search }),
    db.countMessagesByCampaignId(id, { status, search }),
    db.getCampaignMessageStats(id)
  ]);

  return NextResponse.json({ messages, total, stats, limit, offset });
}
