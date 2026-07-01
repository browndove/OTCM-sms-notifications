import { NextResponse } from 'next/server';
import { sendMessageById } from '@/lib/send-message';

export async function POST(_request, { params }) {
  const { messageId } = await params;
  const outcome = await sendMessageById(messageId);

  if (outcome.status === 404) {
    return NextResponse.json({ error: outcome.error }, { status: 404 });
  }
  if (outcome.status === 400) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  if (!outcome.ok && outcome.status === 500) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: 500 });
  }

  return NextResponse.json({ ok: outcome.ok, result: outcome.result });
}
