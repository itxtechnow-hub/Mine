export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { readStore, writeStore } from '@/lib/store';

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    const store = readStore();
    const prov = (store.providers || []).find((p: any) => p.id === id);
    if (!prov) {
      return NextResponse.json({ ok: false, error: 'Provider not found' }, { status: 404 });
    }
    const start = Date.now();
    let reachable = false;
    let statusCode = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${prov.baseUrl.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timer);
      statusCode = res.status;
      reachable = res.status > 0;
    } catch {
      reachable = false;
    }
    const latencyMs = Math.max(1, Date.now() - start);
    prov.latencyMs = latencyMs;
    prov.lastChecked = new Date().toISOString();
    prov.status = reachable ? 'healthy' : 'unreachable';
    writeStore(store);

    return NextResponse.json({ ok: true, id: prov.id, name: prov.name, reachable, statusCode, latencyMs });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Ping error' }, { status: 500 });
  }
}
