export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { readStore } from '@/lib/store';

export async function GET() {
  const store = readStore();
  const models = (store.models || []).map((m: any) => ({
    id: m.id,
    object: 'model',
    created: 1730000000,
    owned_by: m.provider || 'mineroute',
    context_window: m.context || '128k'
  }));
  return NextResponse.json({ object: 'list', data: models });
}
