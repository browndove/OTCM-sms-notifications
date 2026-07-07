import { NextResponse } from 'next/server';
import { resendSubmittedForCampaign } from '@/lib/send-message';

export async function POST(request, { params }) {
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50);

    const result = await resendSubmittedForCampaign(id, { limit, delayMs: 300 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'Resend failed' }, { status: 500 });
  }
}
