export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { compressTextPipeline } from '@/lib/compression-engine';
import { readStore } from '@/lib/store';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const store = readStore();
  const out = compressTextPipeline(
    String(body.text || ''),
    body.profile || store.compression?.profile || 'standard',
    body.engines || store.compression?.engines || {}
  );
  return NextResponse.json({ ok: true, ...out });
}
