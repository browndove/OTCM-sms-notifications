import { NextResponse } from 'next/server';
import arkesel from '@/lib/arkesel';

export async function GET() {
  try {
    const result = await arkesel.getBalance();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.response?.data || err.message },
      { status: 500 }
    );
  }
}
