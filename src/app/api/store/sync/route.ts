export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { writeStore } from '@/lib/store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const updated = writeStore(body);
    return NextResponse.json({ ok: true, store: updated });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Sync error' }, { status: 400 });
  }
}
