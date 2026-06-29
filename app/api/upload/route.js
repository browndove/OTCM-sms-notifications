import { NextResponse } from 'next/server';
import { processSpreadsheet } from '@/lib/process-upload';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const name = file.name || 'upload.xlsx';
    if (!/\.(xlsx|xls|csv)$/i.test(name)) {
      return NextResponse.json({ error: 'Only .xlsx, .xls, or .csv files are allowed' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const result = processSpreadsheet(buffer, name);

    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    if (err.foundColumns) {
      return NextResponse.json(
        { error: err.message, foundColumns: err.foundColumns },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message || 'Failed to process file' },
      { status: err.message?.includes('empty') || err.message?.includes('columns') ? 400 : 500 }
    );
  }
}
