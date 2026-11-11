export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { readStore } from '@/lib/store';

export async function GET() {
  const store = readStore();
  return NextResponse.json(store);
}
