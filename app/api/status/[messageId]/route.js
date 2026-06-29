import { NextResponse } from 'next/server';
import db from '@/lib/db';
import arkesel from '@/lib/arkesel';

export async function GET(_request, { params }) {
  const { messageId } = await params;
  const msg = await db.getMessageById(messageId);

  if (!msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  if (!msg.arkeselId) {
    return NextResponse.json({ error: 'Message has no Arkesel id yet (not sent)' }, { status: 400 });
  }

  try {
    const result = await arkesel.getSmsStatus(msg.arkeselId);
    const status = result?.data?.status || result?.status || 'unknown';

    await db.updateMessage(msg.id, {
      deliveryStatus: status,
      deliveryUpdatedAt: new Date().toISOString(),
      deliveryRaw: result
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.response?.data || err.message },
      { status: 500 }
    );
  }
}
