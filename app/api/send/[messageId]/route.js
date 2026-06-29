import { NextResponse } from 'next/server';
import db from '@/lib/db';
import arkesel from '@/lib/arkesel';

export async function POST(_request, { params }) {
  const { messageId } = await params;
  const msg = await db.getMessageById(messageId);

  if (!msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  if (msg.phoneIssue || !msg.message) {
    return NextResponse.json(
      { error: 'Message is not sendable (invalid phone or missing data)' },
      { status: 400 }
    );
  }

  const sender = process.env.SMS_SENDER_ID || 'PharmCncl';
  const callbackUrl = process.env.ARKESEL_CALLBACK_URL || undefined;

  try {
    const result = await arkesel.sendSms({
      sender,
      message: msg.message,
      recipient: msg.phoneFormatted,
      callbackUrl
    });

    const isSuccess = result && (result.status === 'success' || result.code === 'ok');
    const arkeselId = result?.data?.id || result?.data?.[0]?.id || null;

    await db.updateMessage(msg.id, {
      sendStatus: isSuccess ? 'sent_ok' : 'send_failed',
      arkeselId,
      arkeselResponse: result,
      error: isSuccess ? null : JSON.stringify(result)
    });

    return NextResponse.json({ ok: isSuccess, result });
  } catch (err) {
    const errPayload = err.response?.data || { message: err.message };
    await db.updateMessage(msg.id, {
      sendStatus: 'send_failed',
      error: JSON.stringify(errPayload)
    });
    return NextResponse.json({ ok: false, error: errPayload }, { status: 500 });
  }
}
