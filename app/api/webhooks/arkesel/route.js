import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  console.log('Arkesel webhook received:', JSON.stringify(body));

  const arkeselId = body.id || body.message_id || body.sms_id || body.uuid;
  const status = (body.status || body.delivery_status || body.dlrStatus || '').toString().toLowerCase();

  if (!arkeselId) {
    console.warn('Webhook payload missing an id field, ignoring:', body);
    return NextResponse.json({ received: true, matched: false });
  }

  const msg = await db.getMessageByArkeselId(arkeselId);
  if (!msg) {
    console.warn('No matching message for arkeselId', arkeselId);
    return NextResponse.json({ received: true, matched: false });
  }

  await db.updateMessage(msg.id, {
    deliveryStatus: status || 'unknown',
    deliveryUpdatedAt: new Date().toISOString(),
    deliveryRaw: body
  });

  return NextResponse.json({ received: true, matched: true });
}
